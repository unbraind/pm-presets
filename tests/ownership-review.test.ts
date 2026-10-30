/** Regressions for ownership, retained identities, and every reviewed contract. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stripTypeScriptTypes, syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import mod from "../src/index.ts";
import { requirePresetDefinition, validateAllPresets } from "../src/catalog.ts";
import { applyPreset, storedTemplate } from "../src/presets/shared.ts";
import type { PresetParameter } from "../src/params.ts";
import { PRESET_PARAMETERS } from "../src/registry.ts";
import { PRESET_SEEDS } from "../src/seeds.ts";
import { trackerBytes } from "./fixtures/params-secret-oracle.ts";
import { captureAdmissionRealm, acquireApplyAdmission } from "../src/apply-admission.ts";
import { buildExportedPreset } from "../src/export.ts";
import { admitSettingsOwnership, verifiedArtifactOwnership, seedOwnershipProven, refuseReservedSeedIdentity, isArtifactCollision } from "../src/artifact-ownership.ts";

/** Independent seeded generator chooses payloads and unrelated tracker state. */
function generator(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
}

test("property: random pre-existing trackers never grant ownership to collisions or lose retained history", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-ownership-property-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {}); t.mock.method(console, "warn", () => {});
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  const random = generator(170301);
  const modes = ["collision", "matching-collision", "history-collision", "deleted", "partial", "partial-collision", "template", "settings"] as const;
  for (let iteration = 0; iteration < 40; iteration++) {
    const mode = modes[iteration % modes.length], pmRoot = join(root, String(iteration));
    const client = new PmClient({ pmRoot, noExtensions: true }); await client.init("indie-");
    fs.mkdirSync(join(pmRoot, "locks", "pm-presets-apply-claims"), { recursive: true });
    const sdk = createExtensionCommandSdk(pmRoot, client);
    const definition = requirePresetDefinition("indie-dev"), id = "indie-preset-indie-dev-0";
    const input = { label: "Indie", presetId: "indie-dev", settings: definition.settings, templates: definition.templateDocuments!, nextSteps: [] };
    const marker = `Unrelated ${random()}`;
    for (let n = random() % 4; n > 0; n--) await client.create({ type: "Task", title: `${marker} ${n}`, body: String(random()) });
    /** Shared writer, unified command, and setup alias must make the same preflight decision. */
    const run = (dryRun: boolean, force: boolean) => iteration % 3 === 0
      ? applyPreset({ command: "property", args: [], options: { dryRun, force, withSeeds: true }, global: {}, pm_root: pmRoot, sdk }, input)
      : harness.runCommand({ command: iteration % 3 === 1 ? "presets apply" : definition.command, args: iteration % 3 === 1 ? ["indie-dev"] : [], options: { dryRun, force, withSeeds: true }, pmRoot, sdk });
    if (mode === "deleted" || mode === "partial" || mode === "partial-collision") {
      await run(false, true);
      if (mode === "deleted") fs.rmSync(join(pmRoot, "tasks", `${id}.toon`));
      else {
        // The audited enrollment survived, but native item creation never happened.
        // Simulate the write boundary by removing only this disposable seed and its stream.
        fs.rmSync(join(pmRoot, "tasks", `${id}.toon`)); fs.rmSync(join(pmRoot, "history", `${id}.jsonl`));
        if (mode === "partial-collision") await client.create({ type: "Task", id, title: marker, unset: ["parent"] });
      }
    } else if (mode === "template") {
      fs.mkdirSync(join(pmRoot, "templates"), { recursive: true });
      fs.writeFileSync(join(pmRoot, "templates", "idea.json"), JSON.stringify(storedTemplate("idea", { body: marker })));
    } else if (mode === "settings") {
      await sdk.mutateWorkspaceSettings({ operationId: "unrelated-owner", mutate: (current) => ({ ...current, id_prefix: `other${random()}-` }) });
    } else {
      const seed = definition.seedItems![0];
      await client.create({ ...(mode === "matching-collision" ? seed : { type: "Task", title: marker, body: String(random()) }), id, unset: ["parent"] });
      if (mode === "history-collision") fs.rmSync(join(pmRoot, "tasks", `${id}.toon`));
    }
    const before = trackerBytes(pmRoot);
    let recovery: string[] = [];
    if (mode === "partial") {
      await run(true, true); assert.equal(trackerBytes(pmRoot), before);
      await run(false, true); assert.ok(fs.existsSync(join(pmRoot, "tasks", `${id}.toon`)));
      continue;
    }
    for (const force of [true, false]) for (const dryRun of [false, true]) {
      await assert.rejects(() => run(dryRun, force), (error: unknown) => {
        const refusal = error as { code: string; message: string };
        assert.equal(refusal.code, mode === "deleted" ? "artifact_recovery_required" : "artifact_conflict");
        if (mode === "deleted") recovery = /Run 'pm ([^']+)'/.exec(refusal.message)![1].split(" ");
        assert.ok(refusal.message.includes(mode === "template" ? "templates/idea.json" : mode === "settings" ? "settings.json#/id_prefix" : id));
        return true;
      });
      assert.equal(trackerBytes(pmRoot), before, "refusal must preserve every authoritative document and audit stream");
    }
    if (mode === "deleted") {
      const history = fs.readFileSync(join(pmRoot, "history", `${id}.jsonl`), "utf8");
      const restored = spawnSync(process.execPath, [resolve("node_modules/@unbrained/pm-cli/dist/cli.js"), "--path", pmRoot, "--no-extensions", ...recovery], { encoding: "utf8" });
      assert.equal(restored.status, 0, restored.stderr);
      assert.ok(fs.readFileSync(join(pmRoot, "history", `${id}.jsonl`), "utf8").startsWith(history));
      await run(false, true);
    }
  }
});

test("settings replacement preserves unowned leaves and ownership metadata is never portable", async (t) => {
  assert.throws(() => admitSettingsOwnership({ governance: { manual: "keep" } }, { governance: {} }, {}), { code: "artifact_conflict" });
  assert.throws(() => admitSettingsOwnership({ governance: { manual: { nested: "keep" } } }, { governance: {} }, {}), { code: "artifact_conflict" });
  assert.deepEqual(admitSettingsOwnership({}, { secret_references: { token: "@TOKEN" } }, {}), { "settings.json#/secret_references/token": true });
  assert.deepEqual(admitSettingsOwnership({ key: [1] }, { key: [2] }, { "settings.json#/key": true }), { "settings.json#/key": true });
  const portable = buildExportedPreset({ name: "portable", settings: { id_prefix: "p-", preset_ownership: { "templates/idea.json": true } }, templates: [] });
  assert.ok(!Object.hasOwn(portable.settings, "preset_ownership"));
  const root = fs.mkdtempSync(join(tmpdir(), "preset-ownership-audit-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const client = new PmClient({ pmRoot: root, noExtensions: true }); await client.init();
  assert.deepEqual(await verifiedArtifactOwnership(root, {}), {});
  const sdk = createExtensionCommandSdk(root, client);
  await sdk.mutateWorkspaceSettings({ operationId: "unrelated", mutate: (current) => ({ ...current, id_prefix: "other-" }) });
  assert.deepEqual(await verifiedArtifactOwnership(root, {}), {});
  await sdk.mutateWorkspaceSettings({ operationId: "pm-presets-legacy-00000000-0000-4000-8000-000000000000", mutate: (current) => ({ ...current, id_prefix: "legacy-" }) });
  assert.deepEqual(await verifiedArtifactOwnership(root, {}), {}, "legacy preset audits remain readable without granting new template ownership");
  await assert.rejects(() => verifiedArtifactOwnership(root, { preset_ownership: { "templates/idea.json": true } }), { code: "invalid_artifact_record" });
  fs.appendFileSync(join(root, "history", "_workspace.jsonl"), "{invalid\n");
  await assert.rejects(() => verifiedArtifactOwnership(root, {}), { code: "invalid_artifact_record" });
});

test("catalog validation isolates a broken manifest and a broken seed from the other presets", () => {
  const manifest = PRESET_PARAMETERS["startup-roadmap"] as PresetParameter[];
  const saved = [...manifest], seeds = PRESET_SEEDS["indie-dev"];
  try {
    manifest.push({ name: "projectKey", type: "string", required: false });
    PRESET_SEEDS["indie-dev"] = [{ type: "Task", title: "${param:unknown}" }];
    const result = validateAllPresets();
    assert.equal(result.ok, false); assert.equal(result.checked, 7);
    assert.deepEqual(result.issues.map(({ presetId }) => presetId).sort(), ["indie-dev", "startup-roadmap"]);
  } finally { manifest.splice(0, Infinity, ...saved); PRESET_SEEDS["indie-dev"] = seeds; }
});

test("non-Linux admission realms allow independent processes to recover absent owners", async (t) => {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  const root = fs.mkdtempSync(join(tmpdir(), "preset-portable-admission-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missingProc = t.mock.method(fs, "readlinkSync", () => { throw new Error("No proc filesystem"); });
  syncBuiltinESMExports();
  try {
    for (const platform of ["darwin", "win32"]) {
      Object.defineProperty(process, "platform", { value: platform });
      const realm = captureAdmissionRealm();
      assert.equal(captureAdmissionRealm(), realm);
      const other = spawnSync(process.execPath, ["--input-type=module", "-e", `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; fs.readlinkSync = () => { throw new Error('No proc filesystem'); }; syncBuiltinESMExports(); Object.defineProperty(process, 'platform', { value: '${platform}' }); const { captureAdmissionRealm } = await import('./src/apply-admission.ts'); console.log(captureAdmissionRealm());`], { encoding: "utf8" });
      assert.equal(other.status, 0, other.stderr); assert.equal(other.stdout.trim(), realm);
    }
  } finally { Object.defineProperty(process, "platform", original); missingProc.mock.restore(); syncBuiltinESMExports(); }
  // Retry delay consumes independent random samples instead of a fixed symmetric period.
  const release = await acquireApplyAdmission(root);
  let clock = 0, samples = 0;
  const time = t.mock.method(Date, "now", () => clock++ > 2 ? 20000 : 0);
  const random = t.mock.method(Math, "random", () => { samples++; return 0; });
  try { await assert.rejects(() => acquireApplyAdmission(root)); assert.ok(samples > 0); }
  finally { time.mock.restore(); random.mock.restore(); release(); }
});

test("documented parameter authoring example compiles as a complete consumer snippet", () => {
  const document = fs.readFileSync("docs/params-example.md", "utf8");
  const snippets = [...document.matchAll(/```typescript\n([\s\S]*?)```/g)];
  const source = snippets[1][1];
  assert.match(source, /export const SEEDS = \[/);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source + '\nif (SEEDS.length !== 1 || TEMPLATES["initiative.json"].name !== "initiative") process.exit(1);'], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const readme = fs.readFileSync("README.md", "utf8");
  assert.match(readme, /apply startup-roadmap --param projectKey=acme --with-seeds --force/);
  for (const text of [readme, document]) assert.match(text, /host audit may create.*lock/s);
});

test("documented programmatic example runs against the declarations from the earlier sections", () => {
  const document = fs.readFileSync("docs/params-example.md", "utf8");
  const [manifest, bindings, programmatic] = [...document.matchAll(/```typescript\n([\s\S]*?)```/g)].map((match) => match[1]);
  const local = /^import \{ PARAMETERS, SEEDS, SETTINGS, TEMPLATES \} from "\.\/preset-definition\.ts";\n/m;
  assert.match(programmatic, local, "the example must name where its declarations come from");
  const source = stripTypeScriptTypes([manifest, bindings, programmatic.replace(local, "")].join("\n"))
    + '\nif (parts.seeds[0].title !== "Define the acme first roadmap initiative" || parts.settings.id_prefix !== "acme-") process.exit(1);';
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("managed missing-document refusal emits an executable native recovery command", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-managed-recovery-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {}); t.mock.method(console, "warn", () => {});
  const client = new PmClient({ pmRoot: root, noExtensions: true }); await client.init();
  const definition = requirePresetDefinition("indie-dev");
  const context = { command: "recovery", args: [], options: { withSeeds: true, force: true }, global: {}, pm_root: root, sdk: createExtensionCommandSdk(root, client) };
  const input = { label: "Indie", presetId: "indie-dev", settings: definition.settings, templates: definition.templateDocuments!, nextSteps: [] };
  await applyPreset(context, input);
  const id = "indie-preset-indie-dev-0", history = fs.readFileSync(join(root, "history", `${id}.jsonl`), "utf8");
  fs.rmSync(join(root, "tasks", `${id}.toon`));
  let command: string[] = [];
  await assert.rejects(() => applyPreset(context, input), (error: unknown) => {
    const refusal = error as { code: string; remedy: string };
    assert.equal(refusal.code, "artifact_recovery_required");
    command = /Run 'pm ([^']+)'/.exec(refusal.remedy)![1].split(" ");
    assert.equal(command[1], id); return true;
  });
  const result = spawnSync(process.execPath, [resolve("node_modules/@unbrained/pm-cli/dist/cli.js"), "--path", root, "--no-extensions", ...command], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.readFileSync(join(root, "history", `${id}.jsonl`), "utf8").startsWith(history));
  await applyPreset(context, input);
});

test("a failed native seed creation never reserves ownership of a later unrelated item", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-seed-failed-birth-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {}); t.mock.method(console, "warn", () => {});
  const client = new PmClient({ pmRoot: root, noExtensions: true }); await client.init();
  const definition = requirePresetDefinition("indie-dev"), context = { command: "birth", args: [], options: { withSeeds: true, force: true }, global: {}, pm_root: root, sdk: createExtensionCommandSdk(root, client) };
  const input = { label: "Indie", presetId: "indie-dev", settings: definition.settings, templates: definition.templateDocuments!, nextSteps: [] };
  const seeds = PRESET_SEEDS["indie-dev"];
  try {
    PRESET_SEEDS["indie-dev"] = [{ type: "NotRegistered", title: "Native failure" }];
    await assert.rejects(() => applyPreset(context, input), { code: "artifact_write_failed" });
  } finally { PRESET_SEEDS["indie-dev"] = seeds; }
  await client.create({ id: "indie-preset-indie-dev-0", type: "Task", title: "Unrelated after failure" });
  const before = trackerBytes(root);
  await assert.rejects(() => applyPreset(context, input), { code: "artifact_conflict" });
  assert.equal(trackerBytes(root), before);
});

test("birth verification refuses unknown, foreign and corrupt native history without adopting it", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-birth-verification-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const client = new PmClient({ pmRoot: root, noExtensions: true }); await client.init();
  assert.equal(await seedOwnershipProven(root, "pm-missing", undefined), false);
  assert.equal(await seedOwnershipProven(root, "pm-missing", true), false);
  assert.equal(await seedOwnershipProven(root, "pm-missing", "token"), false);
  assert.equal(await refuseReservedSeedIdentity(root, "pm-missing", false), undefined);
  const { item } = await client.create({ type: "Task", title: "Native birth", message: "token", unset: ["parent"] });
  assert.equal(await seedOwnershipProven(root, item.id, "token"), true);
  assert.equal(await seedOwnershipProven(root, item.id, "foreign-token"), false);
  await assert.rejects(() => refuseReservedSeedIdentity(root, item.id, false), { code: "artifact_conflict" });
  const file = join(root, "history", `${item.id}.jsonl`);
  const foreign = "pm-foreign";
  fs.writeFileSync(join(root, "history", `${foreign}.jsonl`), fs.readFileSync(file));
  assert.equal(await seedOwnershipProven(root, foreign, "token"), false);
  await assert.rejects(() => refuseReservedSeedIdentity(root, foreign, true), { code: "artifact_recovery_required" });
  const deleted = await client.create({ type: "Task", title: "Deleted projection", message: "token", unset: ["parent"] });
  await client.delete(deleted.item.id, { force: true });
  await assert.rejects(() => refuseReservedSeedIdentity(root, deleted.item.id, true), (error: unknown) => (error as Error).message.includes(`pm restore ${deleted.item.id}`));
  fs.appendFileSync(file, "{corrupt\n");
  await assert.rejects(() => seedOwnershipProven(root, item.id, "token"), { code: "artifact_unreadable" });
  await assert.rejects(() => refuseReservedSeedIdentity(root, item.id, true), (error: unknown) => (error as Error).message.includes(`pm history ${item.id} --verify`));
  const empty = "pm-empty";
  fs.writeFileSync(join(root, "history", `${empty}.jsonl`), "");
  assert.equal(await seedOwnershipProven(root, empty, "token"), false);
  await assert.rejects(() => refuseReservedSeedIdentity(root, empty, true), { code: "artifact_recovery_required" });
  const audit = createExtensionCommandSdk(root, client);
  await audit.mutateWorkspaceSettings({ operationId: "pm-presets-corrupt-00000000-0000-4000-8000-000000000000", mutate: (current) => ({ ...current, preset_ownership: 42 }) });
  await assert.rejects(() => verifiedArtifactOwnership(root, { preset_ownership: 42 }), { code: "invalid_artifact_record" });
});

test("exclusive template creation refuses late collisions without publishing an ownership receipt", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-template-race-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {}); t.mock.method(console, "warn", () => {});
  const client = new PmClient({ pmRoot: root, noExtensions: true }); await client.init();
  const context = { command: "template-race", args: [], options: {}, global: {}, pm_root: root, sdk: createExtensionCommandSdk(root, client) };
  const input = { label: "Race", settings: { id_prefix: "race-" }, templates: { "race.json": storedTemplate("race", { type: "Task" }) }, nextSteps: [] };
  const file = join(root, "templates", "race.json"), native = fs.writeFileSync;
  const hook = t.mock.method(fs, "writeFileSync", ((...args: Parameters<typeof fs.writeFileSync>) => {
    if (args[0] === file && !fs.existsSync(file)) native(file, "Unrelated late collision");
    return native(...args);
  }) as typeof fs.writeFileSync);
  syncBuiltinESMExports();
  try { await assert.rejects(() => applyPreset(context, input), { code: "artifact_conflict" }); }
  finally { hook.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(fs.readFileSync(file, "utf8"), "Unrelated late collision");
  const stored = JSON.parse(fs.readFileSync(join(root, "settings.json"), "utf8"));
  assert.ok(!Object.hasOwn(stored.preset_ownership, "templates/race.json"));
  await assert.rejects(() => applyPreset({ ...context, options: { force: true } }, input), { code: "artifact_conflict" });
});

test("provenance changes and audit faults during template publication stay typed and never grant ownership", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-template-audit-fault-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {}); t.mock.method(console, "warn", () => {});
  for (const fault of ["before-settings", "before-receipt", "corrupt-receipt-audit"] as const) {
    const pmRoot = join(root, fault), client = new PmClient({ pmRoot, noExtensions: true }); await client.init();
    const file = join(pmRoot, "templates", "receipt.json"), settings = join(pmRoot, "settings.json");
    const nativeRead = fs.readFileSync, nativeWrite = fs.writeFileSync;
    let reads = 0, published = false, injected = false;
    const read = t.mock.method(fs, "readFileSync", ((...args: Parameters<typeof fs.readFileSync>) => {
      if (args[0] === settings) {
        reads++;
        if (!injected && ((fault === "before-settings" && reads === 3) || (fault === "before-receipt" && published))) {
          injected = true;
          const stored = JSON.parse(String(nativeRead(settings, "utf8")));
          stored.preset_ownership = { ...stored.preset_ownership, "templates/foreign.json": true };
          nativeWrite(settings, JSON.stringify(stored));
        }
      }
      return Reflect.apply(nativeRead, fs, args);
    }) as typeof fs.readFileSync);
    const write = t.mock.method(fs, "writeFileSync", ((...args: Parameters<typeof fs.writeFileSync>) => {
      const result = nativeWrite(...args);
      if (args[0] === file) {
        published = true;
        if (fault === "corrupt-receipt-audit") fs.appendFileSync(join(pmRoot, "history", "_workspace.jsonl"), "{invalid\n");
      }
      return result;
    }) as typeof fs.writeFileSync);
    syncBuiltinESMExports();
    try {
      await assert.rejects(() => applyPreset({ command: "audit-fault", args: [], options: {}, global: {}, pm_root: pmRoot, sdk: createExtensionCommandSdk(pmRoot, client) }, {
        label: "Receipt", settings: { id_prefix: "receipt-" }, templates: { "receipt.json": storedTemplate("receipt", { type: "Task" }) }, nextSteps: [],
      }), (error: unknown) => {
        assert.equal((error as { code: string }).code, fault === "corrupt-receipt-audit" ? "artifact_write_failed" : "invalid_artifact_record");
        return true;
      });
    } finally { read.mock.restore(); write.mock.restore(); syncBuiltinESMExports(); }
    const stored = JSON.parse(fs.readFileSync(settings, "utf8"));
    assert.ok(!Object.hasOwn(stored.preset_ownership, "templates/receipt.json"));
  }
});


test("native collision classification excludes unrelated transport and schema failures", () => {
  for (const error of [undefined, null, "failure", new Error("failure"), { context: {} }, { context: { code: "other" } }]) assert.equal(isArtifactCollision(error), false);
  for (const code of ["item_already_exists", "item_identity_reserved"]) assert.equal(isArtifactCollision({ context: { code } }), true);
});

test("native create races refuse live and retained-history collisions without adopting their birth", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-native-identity-race-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {}); t.mock.method(console, "warn", () => {});
  for (const historyOnly of [false, true]) {
    const pmRoot = join(root, String(historyOnly)), client = new PmClient({ pmRoot, noExtensions: true }); await client.init();
    const id = "indie-preset-indie-dev-0", native = fs.promises.open;
    let audits = 0, injected = false;
    const hook = t.mock.method(fs.promises, "open", (async (...args: Parameters<typeof fs.promises.open>) => {
      const result = await native(...args);
      if (args[0] === join(pmRoot, "history", "_workspace.jsonl") && args[1] === "a" && ++audits === 2) {
        injected = true;
        await client.create({ id, type: "Task", title: "Independent writer" });
        if (historyOnly) fs.rmSync(join(pmRoot, "tasks", `${id}.toon`));
      }
      return result;
    }) as typeof fs.promises.open);
    syncBuiltinESMExports();
    const definition = requirePresetDefinition("indie-dev"), context = { command: "identity-race", args: [], options: { withSeeds: true, force: true }, global: {}, pm_root: pmRoot, sdk: createExtensionCommandSdk(pmRoot, client) };
    const input = { label: "Indie", presetId: "indie-dev", settings: definition.settings, templates: definition.templateDocuments!, nextSteps: [] };
    try { await assert.rejects(() => applyPreset(context, input), { code: "artifact_conflict" }); }
    finally { hook.mock.restore(); syncBuiltinESMExports(); }
    assert.equal(injected, true);
    const before = trackerBytes(pmRoot);
    await assert.rejects(() => applyPreset(context, input), { code: "artifact_conflict" });
    assert.equal(trackerBytes(pmRoot), before);
  }
});
