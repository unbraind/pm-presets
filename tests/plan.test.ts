/** Real SDK contracts and pure provider snapshots exercise identical negotiation semantics. */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PmClient, getWorkspaceContracts, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import type { WorkspaceContracts } from "@unbrained/pm-cli/sdk";
import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk/authoring";
import { compilePresetPlan, bundledPresetComposition, summarizePresetPlan, PlanRefusal } from "../src/plan.ts";
import type { PresetComposition, PresetPlanTarget } from "../src/plan.ts";
import { readDirectoryPlanTarget, runPresetPlan } from "../src/plan-command.ts";

/** Exact snapshots include settings and append-only history, excluding disposable read indexes. */
function snapshot(root: string) {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && !entry.parentPath.includes("cache"))
    .map((entry) => [join(entry.parentPath, entry.name).slice(root.length), readFileSync(join(entry.parentPath, entry.name), "utf8")]));
}
/** Check category, safe diagnostics and the host's refusal status together. */
function refusal(code: string) {
  return (error: unknown) => error instanceof PlanRefusal && error.code === code && error.exitCode === 2 && error.remedy.length > 20;
}
/** Concrete declared feature requirements include backend and activated command prerequisites. */
const composition: PresetComposition = { id: "team", features: [
  { id: "settings", optional: false, requires: [{ kind: "capability", name: "settings.audit" }] },
  { id: "sync", optional: true, requires: [{ kind: "command", name: "github sync" }] },
] };
/** Minimal SDK-shaped contracts without optional extension/schema fields. */
const contracts: WorkspaceContracts = { types: ["Task"], statuses: ["open", "closed", "canceled"], openStatus: "open", closeStatus: "closed", canceledStatus: "canceled" };
const target: PresetPlanTarget = { backend: "directory", capabilities: ["settings.audit"], contracts };

test("missing required contracts refuse; optional features omit atomically on both backend labels", () => {
  for (const backend of ["directory", "database"] as const) {
    const plan = compilePresetPlan(composition, { ...target, backend });
    assert.equal(plan.ready, true);
    assert.deepEqual(plan.selected, ["settings"]);
    assert.deepEqual(plan.omitted, ["sync"]);
    assert.deepEqual(plan.refused, []);
    assert.deepEqual(plan.gaps, [{ feature: "sync", kind: "command", name: "github sync", code: "missing_capability", remedy: "Enable the host command contract github sync, then replan." }]);
    const blocked = compilePresetPlan(composition, { ...target, backend, capabilities: [] });
    assert.equal(blocked.ready, false);
    assert.deepEqual(blocked.refused, ["settings"]);
    assert.deepEqual(blocked.selected, []);
    assert.match(blocked.gaps[0].remedy, /provider supporting settings.audit/);
  }
  const privateExtra = compilePresetPlan({ id: "safe", features: [{ id: "gap", optional: true, requires: [{ kind: "command", name: "absent", privateValue: "private-canary" } as unknown as PresetComposition["features"][number]["requires"][number]] }] }, target);
  assert.doesNotMatch(JSON.stringify(privateExtra), /privateValue|private-canary/);
  const directory = compilePresetPlan(composition, target);
  const database = compilePresetPlan(composition, { ...target, backend: "database" });
  assert.deepEqual({ ...database, backend: "directory" }, directory);
  assert.deepEqual(summarizePresetPlan(directory), { ...directory, gapCount: 1, omittedGaps: 0 });
});

test("live SDK schema and extension contracts select every exact prerequisite without changing the tracker", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  const client = new PmClient({ pmRoot, cwd: root, noExtensions: true });
  await client.init();
  await client.schemaAddField("confidence_hint", { type: "string" });
  const extension = join(pmRoot, "extensions", "plan-fixture");
  mkdirSync(extension, { recursive: true });
  writeFileSync(join(extension, "manifest.json"), JSON.stringify({ name: "plan-fixture", version: "1.0.0", entry: "index.mjs", manifest_version: 2, capabilities: ["commands"], trusted: true, sandbox_profile: "none" }));
  writeFileSync(join(extension, "index.mjs"), 'export default {activate(api) {api.registerCommand({name:"fixture inspect", action:"fixture-inspect", run:()=>({ok:true})});}};');
  const live = await getWorkspaceContracts(pmRoot, { cwd: root });
  assert.ok(live.extensionCommands?.some((command) => command.command === "fixture inspect"));
  const input: PresetComposition = { id: "live", features: [{ id: "all", optional: false, requires: [
    { kind: "type", name: "Task" }, { kind: "status", name: "open" }, { kind: "field", name: "confidence_hint" }, { kind: "command", name: "fixture inspect" },
  ] }, { id: "portable", optional: true, requires: [] }] };
  const before = snapshot(pmRoot);
  const originals = structuredClone({ input, live });
  const plan = compilePresetPlan(input, { ...target, contracts: live });
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.selected, ["all", "portable"]);
  assert.deepEqual(plan.gaps, []);
  assert.deepEqual(snapshot(pmRoot), before);
  assert.deepEqual({ input, live }, originals);
  const missing = compilePresetPlan(input, target);
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.gaps.map((gap) => gap.kind), ["field", "command"]);
  const unknowns: PresetComposition = { id: "absent", features: [{ id: "missing", optional: false, requires: [{ kind: "type", name: "Unknown" }, { kind: "status", name: "Unknown" }] }] };
  assert.deepEqual(compilePresetPlan(unknowns, target).gaps.map((gap) => gap.kind), ["type", "status"]);
  const sdk = createExtensionCommandSdk(pmRoot, client, "plan-test", "presets plan");
  const ctx: CommandHandlerContext = { command: "presets plan", args: ["indie-dev"], options: {}, global: {}, pm_root: pmRoot, sdk };
  const directory = await readDirectoryPlanTarget(ctx);
  assert.deepEqual(directory.capabilities, ["templates.write", "settings.audit", "items.create"]);
  assert.deepEqual((await readDirectoryPlanTarget({ ...ctx, sdk: undefined, global: { noExtensions: true } })).capabilities, ["templates.write"]);
  const partialSdk = { ...sdk, client: { ...client, create: undefined } } as unknown as typeof sdk;
  assert.deepEqual((await readDirectoryPlanTarget({ ...ctx, sdk: partialSdk })).capabilities, ["templates.write", "settings.audit"]);
  const ready = await runPresetPlan(ctx);
  assert.equal("ready" in ready && ready.ready, true);
  assert.deepEqual(snapshot(pmRoot), before);
  await assert.rejects(readDirectoryPlanTarget({ ...ctx, pm_root: join(root, "absent") }), refusal("contracts_unavailable"));
  writeFileSync(join(pmRoot, "settings.json"), "invalid json");
  await assert.rejects(readDirectoryPlanTarget(ctx), refusal("contracts_unavailable"));
});

test("bundled plans cover all seven presets and explicit starter-item requirements", () => {
  for (const id of ["bug-triage", "indie-dev", "open-source", "software-sprint", "startup-roadmap", "kanban", "agent-workflow"]) {
    const input = bundledPresetComposition(id);
    assert.equal(input.features.length, 2);
    assert.equal(compilePresetPlan(input, target).ready, false);
    assert.equal(bundledPresetComposition(id, true).features[2].requires[0].name, "items.create");
  }
  assert.throws(() => bundledPresetComposition("unknown"), /Unknown preset/);
});

test("malformed declarations fail closed with typed remedies rather than becoming omissions", () => {
  const badCompositions: unknown[] = [null, [], {}, { ...composition, id: "" }, { ...composition, features: {} }, { ...composition, features: [] }, { ...composition, features: Array(33).fill(composition.features[0]) },
    { ...composition, features: [null] }, { ...composition, features: [{ ...composition.features[0], id: "x\nsecret" }] }, { ...composition, features: [composition.features[0], composition.features[0]] },
    { ...composition, features: [{ ...composition.features[0], optional: "false" }] }, { ...composition, features: [{ ...composition.features[0], requires: {} }] },
    { ...composition, features: [{ ...composition.features[0], requires: Array(9).fill({ kind: "type", name: "Task" }) }] },
    ...[null, { kind: {} , name: "Task" }, { kind: "unknown", name: "Task" }, { kind: "type", name: 5 }].map((requirement) => ({ ...composition, features: [{ ...composition.features[0], requires: [requirement] }] })),
    { ...composition, features: [{ ...composition.features[0], requires: [{ kind: "type", name: "Task" }, { kind: "type", name: "Task" }] }] },
  ];
  const badTargets: unknown[] = [null, {}, { ...target, backend: "guessed" }, { ...target, capabilities: {} }, { ...target, capabilities: [42] }, { ...target, contracts: null },
    ...["types", "statuses", "openStatus", "closeStatus", "canceledStatus"].map((key) => ({ ...target, contracts: { ...contracts, [key]: null } })),
    ...[null, [null], [{}], [{ key: "" }]].map((fields) => ({ ...target, contracts: { ...contracts, fields } })),
    ...[null, [null], [{}], [{ command: "" }]].map((extensionCommands) => ({ ...target, contracts: { ...contracts, extensionCommands } })),
  ];
  for (const input of badCompositions) assert.throws(() => compilePresetPlan(input as PresetComposition, target), refusal("invalid_input"));
  for (const input of badTargets) assert.throws(() => compilePresetPlan(composition, input as PresetPlanTarget), refusal("invalid_input"));
});

test("compact reports disclose truncation and complete required/optional counts", () => {
  const input: PresetComposition = { id: "bounded", features: Array.from({ length: 32 }, (_, i) => ({ id: `feature-${i}`, optional: i % 2 === 0,
    requires: Array.from({ length: 8 }, (_, n) => ({ kind: "capability" as const, name: `${"x".repeat(75)}-${n}` })) })) };
  const full = compilePresetPlan(input, target);
  const short = summarizePresetPlan(full);
  assert.equal(short.gapCount, 256);
  assert.equal(short.omittedGaps + short.gaps.length, 256);
  assert.ok(short.gaps.length <= 12);
  assert.ok(Buffer.byteLength(JSON.stringify(short.gaps)) < 4200);
  assert.ok(Buffer.byteLength(JSON.stringify(short)) < 8000);
  assert.equal(short.omitted.length, 16);
  assert.equal(short.refused.length, 16);
});

test("CLI boundary accepts explicit database snapshots and preserves typed structured failures", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-plan-artifacts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "composition.json"), targetFile = join(root, "target.json");
  writeFileSync(file, JSON.stringify(composition));
  writeFileSync(targetFile, JSON.stringify({ ...target, backend: "database" }));
  const ctx: CommandHandlerContext = { command: "presets plan", args: [], options: { composition: file, target: targetFile }, global: {}, pm_root: root };
  const ready = await runPresetPlan(ctx);
  assert.equal("ready" in ready && ready.ready, true);
  writeFileSync(targetFile, JSON.stringify({ ...target, capabilities: [] }));
  const refused = await runPresetPlan(ctx);
  assert.ok("exit_code" in refused);
  assert.equal(refused.exit_code, 2);
  assert.equal(refused.code, "missing_capability");
  assert.equal(refused.ready, false);
  for (const bad of [{ ...ctx, args: ["kanban"] }, { ...ctx, options: { ...ctx.options, withSeeds: true } }, { ...ctx, options: {}, args: [] }, { ...ctx, options: {}, args: ["kanban", "extra"] }]) {
    await assert.rejects(runPresetPlan(bad), refusal("invalid_input"));
  }
  await assert.rejects(runPresetPlan({ ...ctx, options: { ...ctx.options, composition: join(root, "missing.json") } }), refusal("invalid_input"));
});
