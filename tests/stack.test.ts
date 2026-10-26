/** Real host planning, strict input fuzzing and native-state preservation outside git. */
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createExtensionCommandSdk, PmClient, planProfileApplication, locateItem, readLocatedItem, readSettings, runTemplatesSave } from "@unbrained/pm-cli/sdk";
import type { ExtensionCommandSdk } from "@unbrained/pm-cli/sdk/authoring";
import { planPresetStack, stackSettingsPreview, StackRefusal, summarizePresetStack, type PresetStackInput, type PresetStackPlan } from "../src/stack.ts";
import { presetTemplateEntries } from "../src/catalog.ts";
import { PRESET_REGISTRY, type PresetId } from "../src/registry.ts";
import { PRESET_SEEDS } from "../src/seeds.ts";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import mod from "../src/index.ts";

/** Initialize the actual SDK without an enclosing repository. */
async function workspace(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "preset-stack-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  const client = new PmClient({ pmRoot, cwd: root, noExtensions: true, author: "stack-test" });
  await client.init();
  return { root, pmRoot, client, sdk: createExtensionCommandSdk(pmRoot, client, "stack-test") };
}
/** Snapshot every byte, including foreign files, history and relationships. */
function snapshot(pmRoot: string) {
  return Object.fromEntries(readdirSync(pmRoot, { recursive: true, withFileTypes: true }).filter((file) => file.isFile())
    .map((file) => [join(file.parentPath, file.name).slice(pmRoot.length), readFileSync(join(file.parentPath, file.name), "utf8")]));
}
/** Match stable typed refusals without depending on private SDK diagnostics. */
function refusal(code: string) {
  return (error: unknown) => error instanceof StackRefusal && error.code === code && error.exitCode === 2 && error.remedy.length > 15;
}
/** Supply consistent choices from the same primary owner wherever it competes. */
function choices(plan: PresetStackPlan, primary: PresetId) {
  return Object.fromEntries(plan.ownership.filter((entry) => entry.conflict).map((entry) => [entry.path, entry.owners.includes(primary) ? primary : entry.owners[0]]));
}

test("all bundled presets adapt to the host planner and preview every selected surface without writes", async (t) => {
  const { pmRoot, sdk } = await workspace(t);
  const before = snapshot(pmRoot);
  for (const { id } of PRESET_REGISTRY) {
    const plan = await planPresetStack(pmRoot, sdk, { selections: [{ preset: id, seeds: true }] });
    assert.equal(plan.ready, true);
    assert.equal(plan.seeds.length, id === "software-sprint" ? 2 : 1);
    assert.deepEqual(plan.profile!.templates.map(({ name }) => name), presetTemplateEntries(id).map(({ name }) => name).sort());
    const expected = planProfileApplication(plan.profile!, { settings: await readSettings(pmRoot), templates: new Map(), typesRaw: null, statusesRaw: null, fieldsRaw: null, workflows: [], installedPackages: new Set() });
    assert.deepEqual(plan.hostPlan, expected, "the host owns classification and template semantics");
    const summary = summarizePresetStack(plan);
    assert.equal(summary.counts.unresolved, 0);
    assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 9000);
  }
  assert.deepEqual(snapshot(pmRoot), before);
});

test("a read-only tracker needs no lock directory and remains byte-identical", async (t) => {
  const { pmRoot, sdk } = await workspace(t);
  rmSync(join(pmRoot, "locks"), { recursive: true, force: true });
  const before = snapshot(pmRoot);
  const entries = readdirSync(pmRoot, { recursive: true, withFileTypes: true });
  try {
    for (const entry of entries) chmodSync(join(entry.parentPath, entry.name), entry.isDirectory() ? 0o555 : 0o444);
    chmodSync(pmRoot, 0o555);
    const plan = await planPresetStack(pmRoot, sdk, { selections: [{ preset: "indie-dev" }] });
    assert.equal(plan.ready, true);
    assert.deepEqual(snapshot(pmRoot), before);
  } finally {
    chmodSync(pmRoot, 0o755);
    for (const entry of entries) if (entry.isDirectory()) chmodSync(join(entry.parentPath, entry.name), 0o755);
  }
});

test("competing settings and template owners require choices, shared values coalesce, and order is canonical", async (t) => {
  const { pmRoot, sdk } = await workspace(t);
  const selections = [{ preset: "software-sprint" }, { preset: "indie-dev" }] as const;
  const before = snapshot(pmRoot);
  const conflict = await planPresetStack(pmRoot, sdk, { selections });
  assert.equal(conflict.ready, false);
  assert.equal(conflict.unresolved, 4);
  assert.equal(conflict.hostPlan, null);
  assert.equal(summarizePresetStack(conflict).code, "conflicts");
  assert.ok(conflict.ownership.some((entry) => entry.path === "/templates/task" && entry.conflict));
  assert.ok(conflict.ownership.some((entry) => entry.path === "/settings/governance/create_default_type" && !entry.conflict && entry.owners.length === 2));
  const request = { selections, choices: choices(conflict, "software-sprint") };
  const resolved = await planPresetStack(pmRoot, sdk, request);
  assert.equal(resolved.ready, true);
  assert.deepEqual(await planPresetStack(pmRoot, sdk, { ...request, selections: [...selections].reverse(), choices: Object.fromEntries(Object.entries(request.choices).reverse()) }), resolved);
  assert.equal(resolved.hostPlan!.templates.changes.length, 5);
  assert.equal(resolved.settingsPatch.id_prefix, "sprint-");
  assert.deepEqual(snapshot(pmRoot), before);
  for (const bad of [{ "/templates/unknown": "indie-dev" }, { "/settings/governance/create_default_type": "indie-dev" }, { "/templates/bug": "indie-dev" }]) {
    await assert.rejects(planPresetStack(pmRoot, sdk, { selections, choices: bad as unknown as PresetStackInput["choices"] }), refusal("invalid_input"));
  }
});

test("disjoint surfaces compose, seed identity ownership is atomic, and target reads determine unchanged", async (t) => {
  const { pmRoot, sdk } = await workspace(t);
  const request: PresetStackInput = { selections: [{ preset: "indie-dev" }, { preset: "open-source", settings: false, seeds: true }] };
  const first = await planPresetStack(pmRoot, sdk, request);
  assert.equal(first.ready, true);
  assert.equal(first.hostPlan!.templates.changes.length, 5);
  assert.equal(first.seeds.length, 1);
  await runTemplatesSave("task", { ...presetTemplateEntries("indie-dev").find(({ name }) => name === "task")!.options }, { path: pmRoot });
  const equal = await planPresetStack(pmRoot, sdk, request);
  assert.equal(equal.hostPlan!.templates.changes.find(({ name }) => name === "task")!.status, "unchanged");
  await runTemplatesSave("task", { type: "Task", body: "Peer updated this template\r\n" }, { path: pmRoot });
  const changed = await planPresetStack(pmRoot, sdk, request);
  assert.equal(changed.hostPlan!.templates.changes.find(({ name }) => name === "task")!.status, "update");
  await sdk.mutateWorkspaceSettings({ operationId: "peer-prefix", mutate: (current) => ({ ...current, id_prefix: "indie-" }) });
  assert.equal((await planPresetStack(pmRoot, sdk, request)).hostPlan!.config.changes[0].status, "unchanged");
  // Simulate a future catalog collision, using actual seed data rather than an SDK mock.
  const original = PRESET_SEEDS["open-source"];
  t.after(() => { PRESET_SEEDS["open-source"] = original; });
  {
    PRESET_SEEDS["open-source"] = [{ ...PRESET_SEEDS["indie-dev"][0], body: "Competing payload" }];
    const selections = [{ preset: "indie-dev", settings: false, templates: false, seeds: true }, { preset: "open-source", settings: false, templates: false, seeds: true }] as const;
    const pending = await planPresetStack(pmRoot, sdk, { selections });
    assert.equal(pending.unresolved, 1);
    assert.match(pending.ownership[0].path, /^\/seeds\//);
    const resolved = await planPresetStack(pmRoot, sdk, { selections, choices: choices(pending, "open-source") });
    assert.equal(resolved.seeds[0].item.body, "Competing payload");
    assert.equal(resolved.seeds[0].owner, "open-source");
    assert.deepEqual(resolved.profile!.config, []);
  }
});

test("strict request schema fuzz rejects sparse, nonfinite, oversized and executable inputs before host access", async () => {
  const valid = { preset: "indie-dev" };
  const invalid: unknown[] = [null, [], 1, Infinity, NaN, "stack", {}, { selections: null }, { selections: [] }, { selections: Array(1) },
    { selections: Array(8).fill(valid) }, { selections: [valid, valid] }, { selections: [null] }, { selections: ["indie-dev"] },
    { selections: [{ preset: "unknown" }] }, { selections: [{ preset: 5 }] }, { selections: [valid], extra: true },
    { selections: [valid], choices: null }, { selections: [valid], choices: [] },
    { selections: [valid], choices: { "bad": "indie-dev" } }, { selections: [valid], choices: { "/settings/x": "kanban" } },
    { selections: [valid], choices: { [`/settings/${"x".repeat(512)}`]: "indie-dev" } },
    { selections: [valid], choices: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`/settings/${index}`, "indie-dev"])) },
    { selections: [{ ...valid, settings: false, templates: false }] },
    { selections: [{ ...valid, [Symbol("unknown")]: true }] },
    Object.defineProperty({ selections: [valid] }, "choices", { get() { throw new Error("accessor executed"); }, enumerable: true }),
    { selections: Object.defineProperty([valid], "0", { get() { throw new Error("accessor executed"); } }) },
    { selections: [Object.defineProperty({}, "preset", { get() { throw new Error("accessor executed"); }, enumerable: true })] },
    { selections: [valid], choices: Object.defineProperty({}, "/settings/x", { get() { throw new Error("accessor executed"); }, enumerable: true }) },
    { selections: [valid], choices: { [Symbol("wrong")]: "indie-dev" } },
    Object.defineProperty({ selections: [valid] }, "hidden", { value: 1 }),
  ];
  for (const value of [Infinity, -Infinity, NaN, Number.MAX_VALUE, -1, 0, 1, 1e-300, "true", null, [], {}, undefined]) {
    for (const flag of ["settings", "templates", "seeds"]) invalid.push({ selections: [{ ...valid, [flag]: value }] });
  }
  for (const value of invalid) await assert.rejects(planPresetStack("unused", undefined as unknown as ExtensionCommandSdk, value as PresetStackInput), refusal("invalid_input"));
  await assert.rejects(planPresetStack("unused", undefined as unknown as ExtensionCommandSdk, { selections: [valid] } as PresetStackInput), refusal("sdk_required"));
  await assert.rejects(planPresetStack("unused", {} as ExtensionCommandSdk, { selections: [valid] } as PresetStackInput), refusal("sdk_required"));
});

test("host normalization conflicts and corrupt targets refuse without leaking settings", async (t) => {
  const { pmRoot, sdk } = await workspace(t);
  const selections = [{ preset: "bug-triage" }, { preset: "indie-dev" }] as const;
  const pending = await planPresetStack(pmRoot, sdk, { selections });
  const resolved = choices(pending, "bug-triage");
  resolved["/settings/governance/preset"] = "indie-dev";
  await assert.rejects(planPresetStack(pmRoot, sdk, { selections, choices: resolved }), refusal("normalization_conflict"));
  writeFileSync(join(pmRoot, "settings.json"), "{\"private-canary\":true}");
  await assert.rejects(planPresetStack(pmRoot, sdk, { selections: [{ preset: "indie-dev" }] }), refusal("target_unavailable"));
});

test("emitted summary counts reject extreme values rather than returning ok", async (t) => {
  const { pmRoot, sdk } = await workspace(t);
  const plan = await planPresetStack(pmRoot, sdk, { selections: [{ preset: "indie-dev" }] });
  for (const unresolved of [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_VALUE, 1025]) {
    assert.throws(() => summarizePresetStack({ ...plan, unresolved }), refusal("invalid_input"));
  }
});

test("a real SDK replay receipt cannot stand in for a fresh canonical settings preview", async (t) => {
  const { sdk } = await workspace(t);
  await sdk.mutateWorkspaceSettings({ operationId: "preview-contract-test", mutate: (current) => ({ ...current, id_prefix: "replayed-" }) });
  const replayed = await sdk.mutateWorkspaceSettings({ operationId: "preview-contract-test", dryRun: true, includePreview: true, mutate: (current) => current });
  assert.equal(replayed.replayed, true);
  assert.throws(() => stackSettingsPreview(replayed), refusal("sdk_required"));
});

test("source command handler uses the same schema, summary and bounded artifact refusal", async (t) => {
  const { pmRoot, root, sdk } = await workspace(t);
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  const file = join(root, "stack.json");
  writeFileSync(file, JSON.stringify({ selections: [{ preset: "indie-dev" }] }));
  const result = await harness.runCommand({ command: "presets stack", pmRoot, sdk, options: { input: file } });
  assert.equal((result.result as { ready: boolean }).ready, true);
  await assert.rejects(harness.runCommand({ command: "presets stack", pmRoot, sdk, options: {} }), refusal("invalid_input"));
});

test("seeded model: 500 random operation sequences preserve SDK-read native fields and relationships across old-input replays and CRLF", async (t) => {
  const { pmRoot, client, sdk } = await workspace(t);
  const parent = await client.create({ type: "Epic", title: "Native parent" });
  const child = await client.create({ type: "Task", title: "Native child", parent: parent.item.id, body: "Whitespace  \r\n\r\nNative body", priority: "1", tags: "alpha,beta" });
  await client.files(child.item.id, { add: ["src/example.ts"] });
  await client.docs(child.item.id, { add: ["docs/example.md"] });
  await client.comments(child.item.id, { add: "Native comment\r\nwith whitespace  " });
  /** SDK authoritative store reads avoid the context-usage side effect of the get command. */
  async function read(id: string) { const located = await locateItem(pmRoot, id); assert.ok(located); return (await readLocatedItem(located)).document; }
  const model = new Map([[parent.item.id, await read(parent.item.id)], [child.item.id, await read(child.item.id)]]);
  const expectedSettings = await readSettings(pmRoot);
  const nativeBefore = snapshot(pmRoot);
  let seed = 0x51ac0ffe;
  /** Reproducible generator; no normalization or host semantics are recreated here. */
  function random(max: number): number { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % max; }
  const archive: PresetStackInput[] = [];
  let operations = 0;
  for (let sequence = 0; sequence < 500; sequence++) {
    const first = PRESET_REGISTRY[random(7)].id;
    const second = PRESET_REGISTRY.filter(({ id }) => id !== first)[random(6)].id;
    let input: PresetStackInput = { selections: [{ preset: first, settings: true, seeds: random(2) === 1 }, { preset: second, settings: false, templates: false, seeds: true }] };
    const expectedTemplates = new Set(presetTemplateEntries(first).map(({ name }) => name));
    const expectedSeeds = PRESET_SEEDS[second].length + (input.selections[0].seeds ? PRESET_SEEDS[first].length : 0);
    const original = await planPresetStack(pmRoot, sdk, input); operations++;
    assert.equal(original.ready, true);
    assert.deepEqual(new Set(original.hostPlan!.templates.changes.map(({ name }) => name)), expectedTemplates);
    assert.equal(original.seeds.length, expectedSeeds);
    archive.push(structuredClone(input));
    input = JSON.parse(JSON.stringify({ selections: [...input.selections].reverse() }, null, random(3)).replaceAll("\n", "\r\n")) as PresetStackInput;
    assert.deepEqual(await planPresetStack(pmRoot, sdk, input), original); operations++;
    const replay = archive[random(archive.length)];
    assert.deepEqual(await planPresetStack(pmRoot, sdk, JSON.parse(` \r\n${JSON.stringify(replay)}\r\n `)), await planPresetStack(pmRoot, sdk, replay)); operations += 2;
    assert.deepEqual(await readSettings(pmRoot), expectedSettings);
    for (const [id, expected] of model) assert.deepEqual(await read(id), expected, `native model after sequence ${sequence}`);
  }
  assert.deepEqual(snapshot(pmRoot), nativeBefore, "all native fields, relationship events, foreign records and history stay byte-identical");
  assert.equal(operations, 2000);
});
