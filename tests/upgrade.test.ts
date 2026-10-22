/** Real non-Git SDK regressions for vendor evolution, audit history and recovery. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { createExtensionCommandSdk, PmClient } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import type { ExtensionCommandSdk } from "@unbrained/pm-cli/sdk/authoring";
import mod from "../src/index.ts";
import { comparePresetUpgrade, executePresetUpgrade, parseUpgradeReceipt, planPresetUpgrade, summarizePresetUpgrade, UpgradeRefusal } from "../src/upgrade.ts";
import type { PresetUpgradeReceipt, UpgradeSettings, VersionedPreset } from "../src/upgrade.ts";

/** Initialize real SDK state in a directory outside any repository. */
async function workspace(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "preset-upgrade-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  const client = new PmClient({ pmRoot, cwd: root, noExtensions: true });
  await client.init();
  return { root, pmRoot, client, sdk: createExtensionCommandSdk(pmRoot, client, "preset-upgrade-test", "migration") };
}
/** Content-only snapshots deliberately omit access times and disposable runtime indexes. */
function snapshot(pmRoot: string) {
  return Object.fromEntries(readdirSync(pmRoot, { recursive: true, withFileTypes: true }).filter((file) => file.isFile() && !file.parentPath.includes("cache"))
    .map((file) => [join(file.parentPath, file.name).slice(pmRoot.length), readFileSync(join(file.parentPath, file.name), "utf8")]));
}
/** Tiny vendor fixtures use valid core settings fields. */
function versions(from: UpgradeSettings, to: UpgradeSettings): [VersionedPreset, VersionedPreset] {
  return [{ id: "vendor", version: "v1", settings: from }, { id: "vendor", version: "v2", settings: to }];
}
/** Assert stable refusal semantics rather than matching private SDK diagnostics. */
function refusal(code: string) {
  return (error: unknown) => error instanceof UpgradeRefusal && error.code === code && error.exitCode === 2 && error.remedy.length > 10;
}

test("three-way conflict choices preserve intent; apply/retry/rollback use one audited mutation per direction", async (t) => {
  const { pmRoot, sdk, root } = await workspace(t);
  await sdk.mutateWorkspaceSettings({ operationId: "local-customization", mutate: (current) => ({ ...current, id_prefix: "local-", author_default: "private-canary" }) });
  const [from, to] = versions({ id_prefix: "old-", output: { default_format: "toon" } }, { id_prefix: "new-", output: { default_format: "json" } });
  const before = snapshot(pmRoot);
  const unresolved = await planPresetUpgrade(sdk, from, to);
  assert.deepEqual(snapshot(pmRoot), before, "planning cannot write settings or history");
  assert.equal(summarizePresetUpgrade(unresolved).ready, false);
  await assert.rejects(executePresetUpgrade(sdk, unresolved, "apply"), refusal("conflicts"));
  assert.deepEqual(snapshot(pmRoot), before);
  const local = await planPresetUpgrade(sdk, from, to, { "/id_prefix": "local" });
  assert.equal(local.after.id_prefix, "local-");
  assert.equal((local.after.output as UpgradeSettings).default_format, "json");
  assert.equal(local.after.author_default, "private-canary");
  const vendor = await planPresetUpgrade(sdk, from, to, { "/id_prefix": "vendor" });
  const retryPlan = await planPresetUpgrade(sdk, { ...from, settings: { output: { default_format: "toon" }, id_prefix: "old-" } }, to, { "/id_prefix": "vendor" });
  assert.equal(vendor.id, retryPlan.id, "object key insertion order cannot affect identity");
  const summary = summarizePresetUpgrade(vendor);
  assert.doesNotMatch(JSON.stringify(summary), /private-canary|author_default|local-/);
  assert.ok(JSON.stringify(summary).length < 1000);
  assert.equal(summary.conflicts[0]?.decision, "vendor");
  const historyPath = join(pmRoot, "history", "_workspace.jsonl");
  const historyBefore = readFileSync(historyPath, "utf8");
  const applied = await executePresetUpgrade(sdk, vendor, "apply");
  assert.equal(applied.changed, true);
  const appliedHistory = readFileSync(historyPath, "utf8");
  assert.ok(appliedHistory.startsWith(historyBefore));
  assert.equal(appliedHistory.trim().split("\n").length - historyBefore.trim().split("\n").length, 1);
  assert.match(appliedHistory.slice(historyBefore.length), /preset-apply-/);
  assert.match(appliedHistory.slice(historyBefore.length), /preset-upgrade-test/);
  assert.equal((await executePresetUpgrade(sdk, vendor, "apply")).replayed, true);
  assert.equal(readFileSync(historyPath, "utf8"), appliedHistory);
  assert.equal((await executePresetUpgrade(sdk, vendor, "rollback")).changed, true);
  const restoredHistory = readFileSync(historyPath, "utf8");
  assert.equal(restoredHistory.trim().split("\n").length - appliedHistory.trim().split("\n").length, 1);
  assert.match(restoredHistory.slice(appliedHistory.length), /preset-rollback-/);
  assert.equal((await executePresetUpgrade(sdk, vendor, "rollback")).replayed, true);
  assert.equal(readFileSync(historyPath, "utf8"), restoredHistory);
  assert.deepEqual(JSON.parse(readFileSync(join(pmRoot, "settings.json"), "utf8")).id_prefix, "local-");
  await assert.rejects(executePresetUpgrade(sdk, vendor, "apply"), refusal("stale_settings"));
  const fresh = await planPresetUpgrade(sdk, from, to, { "/id_prefix": "vendor" }, "2");
  assert.notEqual(fresh.id, vendor.id);
  assert.equal((await executePresetUpgrade(sdk, fresh, "apply")).changed, true);
  await executePresetUpgrade(sdk, fresh, "rollback");
  const health = spawnSync(process.execPath, [resolve("node_modules/@unbrained/pm-cli/dist/cli.js"), "--no-extensions", "health", "--strict-exit", "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(health.status, 0, health.stdout + health.stderr);
});

test("later and concurrent settings changes refuse stale apply and rollback without overwriting them", async (t) => {
  const { sdk, pmRoot } = await workspace(t);
  const receipt = await planPresetUpgrade(sdk, ...versions({ output: { default_format: "toon" } }, { output: { default_format: "json" } }));
  const concurrent = await Promise.all([executePresetUpgrade(sdk, receipt, "apply"), executePresetUpgrade(sdk, receipt, "apply")]);
  assert.equal(concurrent.filter((result) => result.changed).length, 1);
  await sdk.mutateWorkspaceSettings({ operationId: "later-change", mutate: (current) => ({ ...current, author_default: "later-intent" }) });
  const before = snapshot(pmRoot);
  await assert.rejects(executePresetUpgrade(sdk, receipt, "apply"), refusal("stale_settings"));
  await assert.rejects(executePresetUpgrade(sdk, receipt, "rollback"), refusal("stale_settings"));
  assert.deepEqual(snapshot(pmRoot), before);
});

test("nested additions/deletions, local-only fields, null, empty objects and atomic arrays are distinguished", async (t) => {
  const { sdk } = await workspace(t);
  const current = await sdk.mutateWorkspaceSettings({ operationId: "inspect", dryRun: true, includePreview: true, mutate: (value) => value });
  assert.ok(current.preview);
  const before = current.preview as unknown as UpgradeSettings;
  const [from, to] = versions({ testing: { record_results_to_items: true, allow_untrusted_linked_tests: false }, output: { default_format: "toon" }, author_default: "old" },
    { testing: { record_results_to_items: false, allow_untrusted_linked_tests: false }, output: { default_format: "toon" } });
  const receipt = await planPresetUpgrade(sdk, from, to, { "/author_default": "local" });
  assert.equal((receipt.after.output as UpgradeSettings).default_format, "toon");
  assert.ok(receipt.changes.some((entry) => entry.path === "/testing/record_results_to_items" && entry.kind === "already"));
  assert.deepEqual(receipt.before, JSON.parse(JSON.stringify(before)));
  const compared = comparePresetUpgrade(
    { map: { "a/b~": ["old"], removed: ["old"], same: null, structural: { child: 1 }, unchanged: "old", empty: {} } },
    { map: { "a/b~": ["new"], added: ["new"], same: null, structural: { child: 2 }, unchanged: "old", empty: {} } },
    { map: { "a/b~": ["local"], removed: ["old"], same: null, structural: "local-type", untouched: ["keep"], unchanged: "custom", empty: {} } },
    { "/map/a~1b~0": "local", "/map/structural": "vendor" });
  assert.deepEqual(compared.after, { map: { "a/b~": ["local"], added: ["new"], same: null, structural: { child: 2 }, untouched: ["keep"], unchanged: "custom", empty: {} } });
  assert.ok(compared.changes.some((entry) => entry.path === "/map/a~1b~0" && entry.kind === "conflict"));
  assert.deepEqual(comparePresetUpgrade({}, { added: { value: 1 } }, { added: { custom: true } }).after, { added: { value: 1, custom: true } });
  assert.deepEqual(comparePresetUpgrade({ removed: { value: 1 } }, {}, { removed: { value: 1 } }).after, {});
  assert.deepEqual(comparePresetUpgrade({ flag: true }, { flag: false }, { flag: true }).after, { flag: false });
  assert.deepEqual(comparePresetUpgrade({ nullable: 1 }, { nullable: null }, { nullable: 1 }).after, { nullable: null });
  assert.throws(() => comparePresetUpgrade(null as never, {}, {}), refusal("invalid_input"));
  await sdk.mutateWorkspaceSettings({ operationId: "map-field-baseline", mutate: (value) => ({ ...value, validation: { ...value.validation, estimate_defaults_by_type: { Task: 30, Issue: 60 } } }) });
  const deletion = await planPresetUpgrade(sdk, ...versions({ validation: { estimate_defaults_by_type: { Task: 30 } } }, { validation: { estimate_defaults_by_type: {} } }));
  assert.deepEqual((deletion.after.validation as UpgradeSettings).estimate_defaults_by_type, { Issue: 60 });
  await executePresetUpgrade(sdk, deletion, "apply");
  await executePresetUpgrade(sdk, deletion, "rollback");
  assert.deepEqual(JSON.parse(JSON.stringify(deletion.before)), JSON.parse(JSON.stringify((await sdk.mutateWorkspaceSettings({ operationId: "inspect-restored", dryRun: true, includePreview: true, mutate: (value) => value })).preview)));
  // A vendor deletion of a required field is refused by the host schema.
  await assert.rejects(planPresetUpgrade(sdk, ...versions({ output: { default_format: "toon" } }, {})), refusal("mutation_refused"));
  // Empty patches preserve every local setting.
  assert.equal(summarizePresetUpgrade(await planPresetUpgrade(sdk, ...versions({}, {}))).changed, false);
});

test("invalid vendor payloads, decisions, receipts and host state fail safely", async (t) => {
  const { sdk, pmRoot } = await workspace(t);
  const [from, to] = versions({}, {});
  await assert.rejects(planPresetUpgrade(sdk, from, to, {}, ""), refusal("invalid_input"));
  const invalid: unknown[] = [null, [], { ...from, id: "" }, { ...from, version: "" }, { ...from, settings: [] }, { ...from, extra: 1 },
    { ...from, settings: { value: undefined } }, { ...from, settings: { value: Number.NaN } }, { ...from, settings: { value: new Date() } },
    JSON.parse('{"id":"vendor","version":"v1","settings":{"__proto__":{}}}'), { ...from, settings: { x: [true, null, 1, "ok", { constructor: "bad" }] } }];
  let deep: unknown = {};
  for (let index = 0; index < 34; index++) deep = { nested: deep };
  invalid.push({ ...from, settings: deep });
  for (const value of invalid) await assert.rejects(planPresetUpgrade(sdk, value as VersionedPreset, to), refusal("invalid_input"));
  await assert.rejects(planPresetUpgrade(sdk, from, { ...to, id: "other" }), refusal("invalid_input"));
  await assert.rejects(planPresetUpgrade(sdk, from, from), refusal("invalid_input"));
  for (const decisions of [null, [], { wrong: "local" }, { "/wrong": "other" }, { "/wrong": "local" }]) {
    await assert.rejects(planPresetUpgrade(sdk, from, to, decisions as never), refusal("invalid_input"));
  }
  await assert.rejects(planPresetUpgrade({} as ExtensionCommandSdk, from, to), refusal("sdk_required"));
  const receipt = await planPresetUpgrade(sdk, from, to);
  assert.deepEqual(parseUpgradeReceipt(JSON.parse(JSON.stringify(receipt))), receipt);
  for (const bad of [null, {}, { ...receipt, schema: 2 }, { ...receipt, id: 5 }, { ...receipt, before: null }, { ...receipt, after: [] }, { ...receipt, changes: {} }, { ...receipt, after: {} }]) {
    assert.throws(() => parseUpgradeReceipt(bad), refusal("invalid_receipt"));
  }
  await assert.rejects(executePresetUpgrade(sdk, receipt, "wrong" as "apply"), refusal("invalid_input"));
  writeFileSync(join(pmRoot, "settings.json"), "{}\n");
  await assert.rejects(planPresetUpgrade(sdk, from, to), refusal("mutation_refused"));
});

test("canonical host normalization and missing canonical previews cannot yield misleading receipts", async (t) => {
  const { sdk } = await workspace(t);
  // Unknown schema keys are removed by the real host serializer.
  await assert.rejects(planPresetUpgrade(sdk, ...versions({}, { unknown_setting: true })), refusal("normalization_changed"));
  // A committed operation with the preview key exercises the SDK's documented absent-preview replay result.
  await sdk.mutateWorkspaceSettings({ operationId: "preset-upgrade-preview", mutate: (current) => ({ ...current, id_prefix: "replay-" }) });
  await assert.rejects(planPresetUpgrade(sdk, ...versions({}, {})), refusal("sdk_required"));
});

/** Deliberately recompute an edited artifact's digest to exercise semantic verification beyond corruption detection. */
function resigned(receipt: PresetUpgradeReceipt): PresetUpgradeReceipt {
  /** Reproduce stable JSON key ordering for untrusted-artifact tests only. */
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, ordered(child)]));
    return value;
  }
  const { id: _id, ...body } = receipt;
  return { ...body, id: createHash("sha256").update(JSON.stringify(ordered(body))).digest("hex") };
}

test("a digest cannot authorize inconsistent migration semantics", async (t) => {
  const { sdk } = await workspace(t);
  const receipt = await planPresetUpgrade(sdk, ...versions({}, {}));
  for (const edited of [{ ...receipt, after: {} }, { ...receipt, changes: [{ path: "/invented", kind: "vendor" as const, decision: "" as const }] },
    { ...receipt, to: { ...receipt.to, id: "other" } }, { ...receipt, to: receipt.from }]) {
    assert.throws(() => parseUpgradeReceipt(resigned(edited)), refusal("invalid_receipt"));
  }
});

test("CLI commands write private receipts, bound output, refuse bad artifacts and execute both directions", async (t) => {
  const { sdk, pmRoot, root } = await workspace(t);
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  const [from, to] = versions({ id_prefix: "old-" }, { id_prefix: "new-" });
  const oldFile = join(root, "v1.json");
  const newFile = join(root, "v2.json");
  const output = join(root, "receipt.json");
  const decisionFile = join(root, "decisions.json");
  writeFileSync(oldFile, JSON.stringify(from));
  writeFileSync(newFile, JSON.stringify(to));
  writeFileSync(decisionFile, JSON.stringify({ "/id_prefix": "local" }));
  const command = "presets upgrade plan";
  const options = { from: oldFile, to: newFile, receipt: output };
  const first = await harness.runCommand({ command, options, pmRoot, sdk });
  assert.equal((first.result as { ready: boolean }).ready, false);
  if (process.platform !== "win32") assert.equal(statSync(output).mode & 0o777, 0o600);
  await assert.rejects(harness.runCommand({ command, options, pmRoot, sdk }), refusal("invalid_input"));
  const resolvedFile = join(root, "resolved.json");
  await harness.runCommand({ command, options: { ...options, decisions: decisionFile, generation: "2", receipt: resolvedFile }, pmRoot, sdk });
  for (const direction of ["apply", "rollback"]) {
    const result = await harness.runCommand({ command: `presets upgrade ${direction}`, args: [resolvedFile], pmRoot, sdk });
    assert.equal((result.result as { ready: boolean }).ready, true);
  }
  await assert.rejects(harness.runCommand({ command, pmRoot, sdk }), refusal("invalid_input"));
  await assert.rejects(harness.runCommand({ command, options: { receipt: join(root, "absent-output.json") }, pmRoot, sdk }), refusal("invalid_input"));
  const invalidFile = join(root, "invalid.json");
  writeFileSync(invalidFile, "secret-invalid-json");
  const hugeFile = join(root, "huge.json");
  writeFileSync(hugeFile, " ".repeat(1024 * 1024 + 1));
  for (const file of [invalidFile, hugeFile, root, join(root, "absent")]) {
    await assert.rejects(harness.runCommand({ command, options: { ...options, from: file }, pmRoot, sdk }), refusal("invalid_input"));
  }
  await assert.rejects(harness.runCommand({ command: "presets upgrade apply", pmRoot, sdk }), refusal("invalid_input"));
  const largeValue = "x".repeat(600_000);
  writeFileSync(oldFile, JSON.stringify({ ...from, settings: { unchanged: largeValue } }));
  writeFileSync(newFile, JSON.stringify({ ...to, settings: { unchanged: largeValue } }));
  await assert.rejects(harness.runCommand({ command, options: { ...options, receipt: join(root, "oversized-receipt.json") }, pmRoot, sdk }), refusal("invalid_input"));
  // Compact summaries cap conflict details, but retain complete counts and the artifact identity.
  const receipt = parseUpgradeReceipt(JSON.parse(readFileSync(output, "utf8")));
  const report = summarizePresetUpgrade({ ...receipt, changes: Array.from({ length: 25 }, (_, index) => ({ path: `/field${index}`, kind: "conflict", decision: "" })) });
  assert.equal(report.conflicts.length, 20);
  assert.equal(report.omittedConflicts, 5);
  assert.equal(report.counts.conflict, 25);
  const longReport = summarizePresetUpgrade({ ...receipt, changes: [{ path: "/" + "x".repeat(5000), kind: "conflict", decision: "" }] });
  assert.equal(longReport.conflicts.length, 0);
  assert.equal(longReport.omittedConflicts, 1);
  assert.equal(existsSync(join(root, ".git")), false);
});

test("the complete command flow runs with no git executable or enclosing repository", (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-upgrade-no-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = `
    import {writeFileSync,readFileSync} from 'node:fs';
    import {join} from 'node:path';
    import {PmClient,createExtensionCommandSdk} from ${JSON.stringify(resolve("node_modules/@unbrained/pm-cli/dist/sdk/index.js"))};
    import {createExtensionTestHarness} from ${JSON.stringify(resolve("node_modules/@unbrained/pm-cli/dist/sdk/testing.js"))};
    import mod from ${JSON.stringify(resolve("src/index.ts"))};
    const root=process.cwd(),pmRoot=join(root,'.agents','pm');
    const client=new PmClient({pmRoot,cwd:root,noExtensions:true});await client.init();
    const sdk=createExtensionCommandSdk(pmRoot,client,'no-git','migration');
    const h=await createExtensionTestHarness(mod,{name:'pm-presets',capabilities:['commands','schema']});
    writeFileSync('v1.json',JSON.stringify({id:'v',version:'v1',settings:{output:{default_format:'toon'}}}));
    writeFileSync('v2.json',JSON.stringify({id:'v',version:'v2',settings:{output:{default_format:'json'}}}));
    const plan=await h.runCommand({command:'presets upgrade plan',options:{from:'v1.json',to:'v2.json',receipt:'receipt.json'},sdk,pmRoot});
    if(!plan.result.ready) throw Error('not ready');
    for(const direction of ['apply','apply','rollback','rollback']) await h.runCommand({command:'presets upgrade '+direction,args:['receipt.json'],sdk,pmRoot});
    if(JSON.parse(readFileSync(join(pmRoot,'settings.json'),'utf8')).output.default_format!=='toon') throw Error('not restored');
    console.log('no-git plan/apply/retry/rollback passed');`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { cwd: root, encoding: "utf8", env: { ...process.env, PATH: "", GIT_CEILING_DIRECTORIES: tmpdir() } });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /no-git plan\/apply\/retry\/rollback passed/);
});
