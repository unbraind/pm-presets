/** Independent state-machine properties for complete preset application and drift. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import { applyPreset } from "../src/presets/shared.ts";
import { SETTINGS, TEMPLATES, PARAMETERS } from "../src/presets/startup-roadmap/index.ts";
import { requirePresetDefinition } from "../src/catalog.ts";
import { computeParameterizedDiff, computePresetDiff, readWorkspaceSnapshot } from "../src/diff.ts";
import { trackerBytes } from "./fixtures/params-secret-oracle.ts";
import { artifactValuesEqual, computeDesiredPresetState, compareDesiredPresetState, ownArtifact, presetArtifactRecord, seedArtifactMatches } from "../src/desired-state.ts";
import { readSeedArtifacts } from "../src/artifact-reader.ts";
import { replacementSettings } from "../src/settings-replacement.ts";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import mod from "../src/index.ts";
import { buildExportedPreset } from "../src/export.ts";
import { readPresetApplicationHistory } from "../src/application-history.ts";

test("model: successful applies and every manual artifact edit agree with full-state diff", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-artifact-model-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm"), client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const sdk = createExtensionCommandSdk(pmRoot, client);
  const saved = [console.log, console.warn]; console.log = console.warn = () => {};
  t.after(() => { [console.log, console.warn] = saved; });
  let random = Number(process.env.PM_PRESETS_ARTIFACT_SEED ?? 17391), last = "alpha", lastReplace = false;
  /** Deterministic random operations can be replayed from a public integer seed. */
  const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random >>> 8; };
  const input = { label: "Roadmap", presetId: "startup-roadmap", settings: SETTINGS, templates: TEMPLATES, parameters: PARAMETERS, nextSteps: [] };
  /** Exercise the same complete application path used by all seven setup handlers. */
  const apply = (binding: string, force: boolean, withSeeds = true, replace = false) => applyPreset({ command: "model", args: [], options: { param: `projectKey=${binding}`, force, withSeeds, replace }, global: {}, pm_root: pmRoot, sdk }, input);
  /** The oracle independently constructs expected JSON and seed prose from authored fixtures. */
  async function verify(binding: string) {
    const snapshot = await readWorkspaceSnapshot(pmRoot, client);
    const expectedTemplates = JSON.parse(JSON.stringify(TEMPLATES).replaceAll("${param:projectKey}", binding));
    const expected = new Set<string>();
    const expectedSettings = JSON.parse(JSON.stringify(SETTINGS).replaceAll("${param:projectKey}", binding));
    /** Independently inspect every authored setting leaf, rather than just the prefix. */
    function settings(value: any, actual: any, path = "") {
      for (const [key, child] of Object.entries(value)) {
        const name = path ? `${path}.${key}` : key;
        if (child && typeof child === "object" && !Array.isArray(child)) settings(child, actual?.[key], name);
        else if (JSON.stringify(child) !== JSON.stringify(actual?.[key])) expected.add(`settings.json#${name}`);
      }
    }
    settings(expectedSettings, snapshot.settings);
    for (const [filename, document] of Object.entries(expectedTemplates)) {
      try { assert.deepEqual(snapshot.templateDocuments?.[filename], document); }
      catch { expected.add(`templates/${filename}`); }
    }
    const record = (snapshot.settings?.preset_artifacts as any)?.["startup-roadmap"];
    for (const id of record?.seedIds ?? []) {
      const item = snapshot.seeds?.[id];
      if (!item || item.type !== "Feature" || item.title !== `Define the ${binding} first roadmap initiative`
        || item.body !== `Starter initiative for the ${binding} project seeded by pm-presets. Replace with a real initiative.`
        || item.priority !== 2 || JSON.stringify(item.tags) !== '["roadmap"]' || item.parent !== undefined) expected.add(`items/${id}`);
    }
    const actual = await computeParameterizedDiff(requirePresetDefinition("startup-roadmap", { projectKey: binding }), PARAMETERS, { projectKey: binding }, snapshot, { replace: lastReplace });
    assert.equal(actual.inSync, expected.size === 0, `model disagrees at binding ${binding}`);
    for (const artifact of expected) assert.ok(actual.artifacts.includes(artifact), `drift omitted ${artifact}`);
    return actual;
  }
  await apply(last, true);
  assert.equal((await verify(last)).inSync, true);
  // The reported alpha/beta reproduction must refuse before settings/history change.
  const before = trackerBytes(pmRoot);
  await assert.rejects(() => apply("beta", false), (error: any) => error.code === "stale_artifacts" && error.exitCode === 2 && error.remedy.includes("templates/initiative.json"));
  assert.equal(trackerBytes(pmRoot), before);
  assert.equal((await verify("beta")).inSync, false);
  await apply("beta", true); last = "beta";
  assert.equal((await verify(last)).inSync, true);
  let successes = 2, refusals = 1, edits = 0;
  for (let step = 0; step < 180; step++) {
    const operation = next() % 8;
    if (operation < 3) {
      const binding = `k${next().toString(36).slice(0, 6)}`, force = operation === 0;
      const previous = trackerBytes(pmRoot);
      try { const replace = next() % 2 === 0; await apply(binding, force, next() % 2 === 0, replace); last = binding; lastReplace = replace; successes++; assert.equal((await verify(last)).inSync, true); }
      catch (error) { assert.equal((error as any).code, "stale_artifacts"); assert.equal(trackerBytes(pmRoot), previous); refusals++; }
    } else if (operation === 3) {
      const filename = Object.keys(TEMPLATES)[next() % Object.keys(TEMPLATES).length];
      fs.writeFileSync(join(pmRoot, "templates", filename), step % 2 ? '{"name":"manual","options":{"body":"edited"}}' : '{broken'); edits++;
    } else if (operation === 4) {
      const settingsPath = join(pmRoot, "settings.json");
      await sdk.mutateWorkspaceSettings({ operationId: `model-manual-${step}`, mutate: (current) => ({ ...JSON.parse(fs.readFileSync(settingsPath, "utf8")), ...current,
        ...[{ id_prefix: `manual${step}-` }, { testing: { ...current.testing, record_results_to_items: true } }, { governance: { ...current.governance, force_required_for_stale_lock: false } }][next() % 3],
      }) }); edits++;
    } else if (operation === 5) {
      const settings = JSON.parse(fs.readFileSync(join(pmRoot, "settings.json"), "utf8"));
      await client.update(settings.preset_artifacts["startup-roadmap"].seedIds[0], { title: `Manual title ${step}`, body: "Manual body" }); edits++;
    } else if (operation === 6) {
      fs.rmSync(join(pmRoot, "templates", "feature.json"), { force: true }); edits++;
    }
    await verify(last);
  }
  assert.ok(successes > 5 && refusals > 5 && edits > 20, "the model must exercise successes, pre-write refusals and manual edits");
});

test("complete planner validates ownership and compares every controlled field without inherited data", async () => {
  assert.equal(presetArtifactRecord(undefined, "p"), undefined);
  assert.equal(presetArtifactRecord({ preset_artifacts: {} }, "p"), undefined);
  assert.equal(presetArtifactRecord(Object.create({ preset_artifacts: { p: { version: 1, seedIds: [] } } }), "p"), undefined);
  assert.equal(ownArtifact(undefined, "x"), undefined);
  assert.equal(ownArtifact(Object.create({ x: "inherited" }), "x"), undefined);
  for (const records of [null, [], 1, "invalid"]) assert.throws(() => presetArtifactRecord({ preset_artifacts: records }, "p"), { code: "invalid_artifact_record", exitCode: 2 });
  const invalid = [null, [], {}, { version: 2, seedIds: [] }, { version: 1, seedIds: null }, { version: 1, seedIds: [7] },
    { version: 1, seedIds: ["INVALID"] }, { version: 1, seedIds: ["x", "x"] }, { version: 1, seedIds: [], extra: true }, { version: 1, seedIds: Array(1) }];
  for (const record of invalid) assert.throws(() => presetArtifactRecord({ preset_artifacts: { p: record } }, "p"), { code: "invalid_artifact_record" });
  const item = { type: "Task", title: "Seed" }, record = { version: 1 as const, seedIds: ["old-preset-p-0"] };
  const portable = buildExportedPreset({ name: "portable", settings: { id_prefix: "p-", preset_artifacts: { p: record } }, templates: [] });
  assert.ok(!Object.hasOwn(portable.settings, "preset_artifacts"));
  await assert.rejects(() => computeDesiredPresetState({ settings: { id_prefix: "p-", preset_artifacts: {} } as any, templates: {} }), { code: "invalid_manifest" });
  const input = { presetId: "p", settings: { id_prefix: "new-" }, templates: {}, seeds: [item] };
  const desired = await computeDesiredPresetState({ ...input, record });
  assert.equal(desired.seeds[0].id, "old-preset-p-0");
  assert.deepEqual(presetArtifactRecord(desired.settings as any, "p"), record);
  assert.equal((await computeDesiredPresetState(input)).seeds[0].id, "new-preset-p-0");
  await assert.rejects(() => computeDesiredPresetState({ ...input, presetId: undefined }), { code: "invalid_artifact_record" });
  await assert.rejects(() => computeDesiredPresetState({ ...input, record: { version: 1, seedIds: [] } }), { code: "invalid_artifact_record" });
  await assert.rejects(() => computeDesiredPresetState({ ...input, record: { version: 1, seedIds: ["foreign-id"] } }), { code: "invalid_artifact_record" });
  await assert.rejects(() => computeDesiredPresetState({ ...input, settings: { id_prefix: "bad_" } }), { code: "invalid_artifact_record" });
  await assert.rejects(() => computeDesiredPresetState({ ...input, seeds: [{ type: "Task", title: "${param:missing}" }] }), { code: "unknown_binding", exitCode: 2 });
  const currentItem = { type: "Task", title: "Seed", priority: 2 };
  assert.equal(seedArtifactMatches(item, currentItem), true);
  assert.equal(seedArtifactMatches(item, undefined), false);
  for (const change of [{ type: "Issue" }, { title: "Different" }, { priority: 1 }, { tags: ["extra"] }, { body: "extra" }, { parent: "p" }]) assert.equal(seedArtifactMatches(item, { ...currentItem, ...change }), false);
  assert.equal(seedArtifactMatches(item, Object.create(currentItem)), false);
  const shapes = [null, false, 1, "text", [], [1, null], {}, { nested: [1, { key: true }] }, JSON.parse('{"__proto__":"own"}')];
  for (const value of shapes) assert.equal(artifactValuesEqual(value, structuredClone(value)), true);
  for (const [a, b] of [[null, {}], [[], {}], [[1], []], [[1], [2]], [{ x: 1 }, { x: 2 }], [{ x: 1 }, {}], [Array(1), [null]]]) assert.equal(artifactValuesEqual(a, b), false);
  assert.equal(artifactValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(artifactValuesEqual(Array(1), Array(1)), true);
  const plain = await computeDesiredPresetState({ settings: { id_prefix: "p-", governance: {} }, templates: {} });
  assert.deepEqual(compareDesiredPresetState(plain, { settings: { id_prefix: "p-", governance: {} }, templates: {}, seeds: {} }), []);
  for (const settings of [undefined, [], { id_prefix: "p-", governance: null }, { id_prefix: "p-", governance: [] }]) assert.ok(compareDesiredPresetState(plain, { settings: settings as any, templates: {}, seeds: {} }).length > 0);
  const inheritedSeed = Object.create({ "old-preset-p-0": currentItem });
  assert.ok(compareDesiredPresetState(desired, { settings: desired.settings as any, templates: {}, seeds: inheritedSeed }).includes("items/old-preset-p-0"));
});

test("property: SDK diff requires complete payloads for every declared artifact", async () => {
  for (const id of ["bug-triage", "indie-dev", "open-source", "software-sprint", "startup-roadmap", "kanban", "agent-workflow"]) {
    const definition = requirePresetDefinition(id);
    const snapshot = { settings: definition.settings as any, templateNames: definition.templates.map(({ name }) => name), templateDocuments: definition.templateDocuments };
    assert.equal((await computePresetDiff(definition, snapshot)).inSync, true);
    const unresolved = { ...definition, settings: { ...definition.settings, public_note: "${param:missing}" } };
    const sameInvalidState = { ...snapshot, settings: unresolved.settings };
    for (const diff of [await computePresetDiff(unresolved, sameInvalidState), await computeParameterizedDiff(unresolved, [], {}, sameInvalidState)]) {
      assert.equal(diff.inSync, false); assert.ok(diff.artifacts.includes("settings.json"));
    }
    for (const document of Object.keys(definition.templateDocuments!)) {
      const partial = { ...definition.templateDocuments }; delete partial[document];
      for (const templateDocuments of [partial, undefined, Object.create(definition.templateDocuments!)]) {
        const incomplete = { ...definition, templateDocuments };
        await assert.rejects(() => computePresetDiff(incomplete, snapshot), { code: "invalid_manifest", exitCode: 2 });
        await assert.rejects(() => computeParameterizedDiff(incomplete, [], {}, snapshot), { code: "invalid_manifest", exitCode: 2 });
      }
    }
    for (const seedItems of [undefined, null, {}]) await assert.rejects(() => computePresetDiff({ ...definition, seedItems: seedItems as any }, snapshot, { withSeeds: true }), { code: "invalid_manifest", exitCode: 2 });
    await assert.rejects(() => computePresetDiff(definition, snapshot, { prefix: "${param:missing}" }), { code: "unknown_binding", exitCode: 2 });
    for (const [filename, document] of Object.entries(definition.templateDocuments!)) {
      const templateDocuments = { ...definition.templateDocuments, [filename]: { ...document, options: { ...document.options, body: "${param:missing}" } } };
      await assert.rejects(() => computePresetDiff({ ...definition, templateDocuments }, snapshot), { code: "unknown_binding", exitCode: 2 });
    }
  }
});

test("unrelated corrupt seeds cannot manufacture drift after another preset applies successfully", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-artifact-isolation-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const client = new PmClient({ pmRoot: root, noExtensions: true }); await client.init();
  const sdk = createExtensionCommandSdk(root, client);
  const saved = [console.log, console.warn]; console.log = console.warn = () => {};
  t.after(() => { [console.log, console.warn] = saved; });
  /** Apply through the shared writer against a workspace with several owners. */
  const apply = (id: string) => {
    const definition = requirePresetDefinition(id);
    return applyPreset({ command: "isolation", args: [], options: { withSeeds: true, force: true }, global: {}, pm_root: root, sdk }, { label: id, presetId: id, settings: definition.settings, templates: definition.templateDocuments!, nextSteps: [] });
  };
  await apply("bug-triage");
  const id = JSON.parse(fs.readFileSync(join(root, "settings.json"), "utf8")).preset_artifacts["bug-triage"].seedIds[0];
  const file = join(root, "issues", `${id}.toon`); assert.ok(fs.existsSync(file));
  fs.writeFileSync(file, "invalid unrelated item");
  await apply("startup-roadmap");
  const before = trackerBytes(root), snapshot = await readWorkspaceSnapshot(root, client);
  assert.equal((await computePresetDiff(requirePresetDefinition("startup-roadmap"), snapshot)).inSync, true);
  const other = await computePresetDiff(requirePresetDefinition("bug-triage"), snapshot);
  assert.equal(other.inSync, false); assert.ok(other.artifacts.includes(`items/${id}`));
  assert.equal(trackerBytes(root), before);
});

test("all setup aliases and both strict diff forms reconcile complete seeded state in JSON and TOON", async (t) => {
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  const root = fs.mkdtempSync(join(tmpdir(), "preset-artifact-aliases-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saved = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {};
  t.after(() => { [console.log, console.warn, console.error] = saved; });
  for (const preset of ["bug-triage", "indie-dev", "open-source", "software-sprint", "startup-roadmap", "kanban", "agent-workflow"]) {
    const pmRoot = join(root, preset, ".agents", "pm"), native = new PmClient({ pmRoot, noExtensions: true }); await native.init();
    for (const type of requirePresetDefinition(preset).itemTypes) await native.schemaAddType(type.name);
    await harness.runCommand({ command: "presets apply", args: [preset], options: { withSeeds: true, force: true, replace: true }, pmRoot });
    assert.ok((await readPresetApplicationHistory(pmRoot)).records[preset], "every SDK/CLI producer namespace must retain audited seed ownership");
    for (const json of [false, true]) for (const rootForm of [false, true]) {
      const result = await harness.runCommand({ command: rootForm ? "presets" : "presets diff", args: rootForm ? [] : [preset], options: { ...(rootForm ? { diff: preset } : {}), strict: true, replace: true }, global: { json }, pmRoot });
      assert.equal((result.result as any).inSync, true, preset);
    }
    const definition = requirePresetDefinition(preset);
    await harness.runCommand({ command: definition.command, options: { force: true }, pmRoot });
    const last = await harness.runCommand({ command: "presets diff", args: [preset], options: { strict: true }, pmRoot });
    assert.equal((last.result as any).inSync, true);
  }
});

test("artifact reads are complete and read-only, while corrupt items and invalid replacements refuse", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-artifact-read-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const client = new PmClient({ pmRoot: root, noExtensions: true }); await client.init();
  assert.deepEqual(await readSeedArtifacts(root, []), {});
  assert.deepEqual(await readSeedArtifacts(root, ["pm-missing"]), {});
  const result = await client.create({ id: "reader", type: "Task", title: "Reader", body: "Complete body", unset: ["parent"] });
  const id = result.item.id, before = trackerBytes(root);
  assert.equal((await readSeedArtifacts(root, [id]))[id].body, "Complete body");
  assert.equal((await readSeedArtifacts(root, [id], client))[id].body, "Complete body");
  assert.equal(trackerBytes(root), before);
  const schema = await client.schemaList();
  await assert.rejects(() => readSeedArtifacts(root, [id], { schemaList: async () => ({ ...schema, counts: { ...schema.counts, total: schema.counts.total + 1 } }) } as any), { code: "artifact_unreadable", exitCode: 2 });
  fs.writeFileSync(join(root, "tasks", `${id}.toon`), "invalid item");
  await assert.rejects(() => readSeedArtifacts(root, [id]), { code: "artifact_unreadable", exitCode: 2 });
  await assert.rejects(() => replacementSettings({ id_prefix: "p-", governance: { preset: "invalid" as any } }), { code: "artifact_unreadable" });
  const normalized = await replacementSettings({ id_prefix: "p-", governance: { preset: "minimal" } });
  assert.equal((normalized.governance as any).preset, "minimal");
});

test("replacement, ownership corruption and explicitly selected missing seeds always name drift", async (t) => {
  const definition = requirePresetDefinition("startup-roadmap");
  const snapshot = { settings: definition.settings as any, templateNames: definition.templates.map(({ name }) => name), templateDocuments: definition.templateDocuments };
  const explicitErrors = await computePresetDiff(definition, { ...snapshot, artifactErrors: ["history/_workspace.jsonl", "settings.json#preset_artifacts", "settings.json#preset_artifacts.startup-roadmap", "settings.json#preset_artifacts.other"] });
  assert.equal(explicitErrors.inSync, false);
  assert.ok(!explicitErrors.artifacts.includes("settings.json#preset_artifacts.other"));
  const withoutUndefined = await computePresetDiff({ ...definition, settings: { ...definition.settings, ignored: undefined } as any }, snapshot);
  assert.ok(!withoutUndefined.settings.some(({ path }) => path === "ignored"));
  await assert.rejects(() => computePresetDiff(definition, snapshot, { withSeeds: true, prefix: "bad_" }), { code: "invalid_artifact_record" });
  const cloneFailure = { ...definition, templateDocuments: { "bad.json": { options: { body: () => {} } } } as any };
  await assert.rejects(() => computePresetDiff(cloneFailure, snapshot), { code: "invalid_manifest" });
  const enrolled = { settings: { ...definition.settings, preset_artifacts: { "startup-roadmap": { version: 1, seedIds: ["road-preset-startup-roadmap-0"] } } }, templateNames: [] };
  await assert.rejects(() => computePresetDiff({ ...definition, settings: { id_prefix: "road-", governance: { preset: "invalid" as any } } }, enrolled, { replace: true }), { code: "artifact_unreadable" });
  const freshSeeds = await computePresetDiff(definition, snapshot, { withSeeds: true, prefix: "override-" });
  assert.equal(freshSeeds.inSync, false);
  assert.ok(freshSeeds.artifacts.some((name) => name.startsWith("items/override-preset-")));
  for (const records of [42, { "startup-roadmap": null }, { "startup-roadmap": { version: 1, seedIds: [] } }, { "startup-roadmap": { version: 1, seedIds: ["foreign-id"] } }]) {
    const result = await computePresetDiff(definition, { ...snapshot, settings: { ...definition.settings, preset_artifacts: records } as any });
    assert.equal(result.inSync, false);
    assert.ok(result.artifacts.includes("settings.json#preset_artifacts.startup-roadmap"));
  }
  const desired = await computeDesiredPresetState({ settings: definition.settings, templates: definition.templateDocuments!, replace: true });
  const edited = structuredClone(desired.settings) as any; edited.governance.extra_manual_key = "manual";
  const replaceDiff = await computePresetDiff(definition, { ...snapshot, settings: edited }, { replace: true });
  assert.equal(replaceDiff.inSync, false);
  assert.ok(replaceDiff.artifacts.includes("settings.json#governance"));
  const root = fs.mkdtempSync(join(tmpdir(), "preset-artifact-invalid-record-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await new PmClient({ pmRoot: root, noExtensions: true }).init();
  for (const records of [null, { bad: null }]) {
    const file = join(root, "settings.json"), data = JSON.parse(fs.readFileSync(file, "utf8")); data.preset_artifacts = records; fs.writeFileSync(file, JSON.stringify(data));
    assert.ok((await readWorkspaceSnapshot(root)).artifactErrors!.length > 0);
  }
  const file = join(root, "settings.json"), data = JSON.parse(fs.readFileSync(file, "utf8"));
  data.preset_artifacts = { "startup-roadmap": { version: 1, seedIds: ["road-preset-startup-roadmap-0"] } }; fs.writeFileSync(file, JSON.stringify(data));
  fs.mkdirSync(join(root, "features"), { recursive: true }); fs.writeFileSync(join(root, "features", "road-preset-startup-roadmap-0.toon"), "invalid item");
  const unreadable = await computePresetDiff(definition, await readWorkspaceSnapshot(root));
  assert.equal(unreadable.inSync, false);
  assert.ok(unreadable.artifacts.includes("items/road-preset-startup-roadmap-0"));
});

test("audited ownership survives deletion, and history caching validates exact bytes and isolates results", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-artifact-history-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saved = [console.log, console.warn]; console.log = console.warn = () => {};
  t.after(() => { [console.log, console.warn] = saved; });
  const pmRoot = join(root, "owned"), client = new PmClient({ pmRoot, noExtensions: true }); await client.init();
  const sdk = createExtensionCommandSdk(pmRoot, client);
  await applyPreset({ command: "history", args: [], options: { withSeeds: true, force: true }, global: {}, pm_root: pmRoot, sdk }, { label: "History", presetId: "startup-roadmap", settings: SETTINGS, templates: TEMPLATES, parameters: PARAMETERS, nextSteps: [] });
  const before = trackerBytes(pmRoot), first = await readPresetApplicationHistory(pmRoot);
  const seedId = first.records["startup-roadmap"]!.seedIds[0];
  first.records["startup-roadmap"]!.seedIds[0] = "tampered";
  assert.equal((await readPresetApplicationHistory(pmRoot)).records["startup-roadmap"]!.seedIds[0], seedId);
  assert.equal(trackerBytes(pmRoot), before);
  const settingsPath = join(pmRoot, "settings.json"), editedSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  delete editedSettings.preset_artifacts; fs.writeFileSync(settingsPath, JSON.stringify(editedSettings));
  fs.rmSync(join(pmRoot, "features", `${seedId}.toon`));
  const removed = await computePresetDiff(requirePresetDefinition("startup-roadmap"), await readWorkspaceSnapshot(pmRoot));
  assert.equal(removed.inSync, false);
  assert.ok(removed.artifacts.includes("settings.json#preset_artifacts.startup-roadmap"));
  assert.ok(removed.artifacts.includes(`items/${seedId}`));
  await assert.rejects(() => applyPreset({ command: "history", args: [], options: { force: true }, global: {}, pm_root: pmRoot, sdk }, { label: "History", presetId: "startup-roadmap", settings: SETTINGS, templates: TEMPLATES, parameters: PARAMETERS, nextSteps: [] }), { code: "invalid_artifact_record" });
  for (let index = 0; index < 18; index++) {
    const directory = join(root, `cache-${index}`), native = new PmClient({ pmRoot: directory, noExtensions: true }); await native.init();
    const audit = createExtensionCommandSdk(directory, native);
    const history = join(directory, "history", "_workspace.jsonl");
    fs.writeFileSync(history, "");
    assert.deepEqual(await readPresetApplicationHistory(directory), { records: {}, errors: [] });
    await audit.mutateWorkspaceSettings({ operationId: "pm-presets-cache-00000000-0000-4000-8000-000000000000", mutate: (current) => ({ ...current, id_prefix: "cached-" }) });
    assert.equal((await readPresetApplicationHistory(directory)).records.cache, null);
    if (index === 0) {
      await audit.mutateWorkspaceSettings({ operationId: "pm-presets-cache-00000000-0000-4000-8000-000000000001", mutate: (current) => ({ ...current, preset_artifacts: { cache: { version: 1, seedIds: ["cached-preset-cache-0"] } } }) });
      assert.equal((await readPresetApplicationHistory(directory)).records.cache!.seedIds[0], "cached-preset-cache-0");
      fs.appendFileSync(history, "{invalid\n");
      assert.deepEqual((await readPresetApplicationHistory(directory)).errors, ["history/_workspace.jsonl"]);
    }
  }
});

test("cleanup faults and lock-time ownership changes refuse explicitly without unreported writes", async (t) => {
  let orphan = "";
  const originalRm = fs.promises.rm;
  const cleanup = t.mock.method(fs.promises, "rm", (async (file: any, options: any) => {
    if (typeof file === "string" && basename(file).startsWith("preset-replacement-")) { orphan = file; throw new Error("synthetic cleanup failure"); }
    return originalRm(file, options);
  }) as typeof fs.promises.rm);
  syncBuiltinESMExports();
  try {
    await assert.rejects(() => replacementSettings({ id_prefix: "cleanup-" }), { code: "artifact_unreadable", exitCode: 2 });
    fs.rmSync(orphan, { recursive: true, force: true });
    await assert.rejects(() => replacementSettings({ id_prefix: "cleanup-", governance: { preset: "invalid" as any } }), { code: "artifact_unreadable", exitCode: 2 });
  }
  finally { cleanup.mock.restore(); syncBuiltinESMExports(); if (orphan) fs.rmSync(orphan, { recursive: true, force: true }); }

  const root = fs.mkdtempSync(join(tmpdir(), "preset-artifact-owner-race-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saved = [console.log, console.warn]; console.log = console.warn = () => {};
  t.after(() => { [console.log, console.warn] = saved; });
  const pmRoot = join(root, "locked"), client = new PmClient({ pmRoot, noExtensions: true }); await client.init();
  const native = createExtensionCommandSdk(pmRoot, client), settings = join(pmRoot, "settings.json");
  const sdk = { ...native, mutateWorkspaceSettings: async (request: Parameters<typeof native.mutateWorkspaceSettings>[0]) => {
    const value = JSON.parse(fs.readFileSync(settings, "utf8"));
    value.preset_artifacts = { "startup-roadmap": { version: 1, seedIds: ["peer-preset-startup-roadmap-0"] } }; fs.writeFileSync(settings, JSON.stringify(value));
    return native.mutateWorkspaceSettings(request);
  } };
  await assert.rejects(() => applyPreset({ command: "race", args: [], options: { withSeeds: true, force: true }, global: {}, pm_root: pmRoot, sdk }, { label: "Race", presetId: "startup-roadmap", settings: SETTINGS, templates: TEMPLATES, parameters: PARAMETERS, nextSteps: [] }), { code: "invalid_artifact_record" });
  assert.equal(JSON.parse(fs.readFileSync(settings, "utf8")).id_prefix, "pm-");
  assert.equal(fs.existsSync(join(pmRoot, "templates")), false);
});

test("admitted plans refuse missing audits and ownership changes from every competing writer boundary", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-artifact-admission-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saved = [console.log, console.warn]; console.log = console.warn = () => {};
  t.after(() => { [console.log, console.warn] = saved; });
  const input = { label: "Admission", presetId: "startup-roadmap", settings: SETTINGS, templates: TEMPLATES, parameters: PARAMETERS, nextSteps: [] };
  for (const fault of ["missing-before", "corrupt-before", "missing-after", "corrupt-after", "changed-after", "migrated-after"]) {
    const pmRoot = join(root, fault), client = new PmClient({ pmRoot, noExtensions: true }); await client.init();
    const sdk = createExtensionCommandSdk(pmRoot, client), context = { command: "admission", args: [], options: { withSeeds: true, force: true }, global: {}, pm_root: pmRoot, sdk };
    await applyPreset(context, input);
    const history = join(pmRoot, "history", "_workspace.jsonl"), settings = join(pmRoot, "settings.json"), lock = join(pmRoot, "locks", "pm-presets-apply.lock");
    /** Simulate an external writer after the package has resolved its input. */
    async function interfere() {
      if (fault.startsWith("missing")) fs.rmSync(history);
      else if (fault.startsWith("corrupt")) fs.appendFileSync(history, "{invalid\n");
      else if (fault.startsWith("changed")) {
        const value = JSON.parse(fs.readFileSync(settings, "utf8")); value.preset_artifacts["startup-roadmap"].seedIds = ["peer-preset-startup-roadmap-0"]; fs.writeFileSync(settings, JSON.stringify(value));
      } else await sdk.mutateWorkspaceSettings({ operationId: "pm-presets-startup-roadmap-00000000-0000-4000-8000-000000000002", mutate: (current) => ({ ...current, preset_artifacts: { "startup-roadmap": { version: 1, seedIds: ["peer-preset-startup-roadmap-0"] } } }) });
    }
    const delayed = fault.endsWith("after");
    if (!delayed) await interfere();
    else fs.writeFileSync(lock, "synthetic-foreign-owner");
    const pending = applyPreset(context, input); pending.catch(() => {});
    try {
      if (delayed) {
        const deadline = Date.now() + 10_000, claims = join(pmRoot, "locks", "pm-presets-apply-claims");
        while (fs.readdirSync(claims).length === 0) { assert.ok(Date.now() < deadline, "application must reach its admission before interference"); await new Promise((resolve) => setTimeout(resolve, 5)); }
        await interfere();
      }
      const peerSettings = fs.readFileSync(settings, "utf8"), peerHistory = fs.existsSync(history) ? fs.readFileSync(history, "utf8") : null;
      if (delayed) fs.rmSync(lock);
      await assert.rejects(pending, (error: any) => error.code === (fault.startsWith("changed") || fault.startsWith("migrated") ? "invalid_artifact_record" : "artifact_unreadable"));
      assert.equal(fs.readFileSync(settings, "utf8"), peerSettings);
      assert.equal(fs.existsSync(history) ? fs.readFileSync(history, "utf8") : null, peerHistory);
    } finally { fs.rmSync(lock, { force: true }); await pending.catch(() => {}); }
  }
});

test("missing capabilities and incomplete native writes never report successful application", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-artifact-write-fault-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saved = [console.log, console.warn], output: string[] = [];
  console.log = console.warn = (...values: unknown[]) => { output.push(values.map(String).join(" ")); };
  t.after(() => { [console.log, console.warn] = saved; });
  for (const fault of ["no-client", "no-create", "no-update", "no-schema", "seed-error", "template-directory-error", "template-file-error", "seed-missing", "template-missing", "template-corrupt", "settings-ignored"] as const) {
    const pmRoot = join(root, fault), client = new PmClient({ pmRoot, noExtensions: true }); await client.init();
    const native = createExtensionCommandSdk(pmRoot, client);
    const fake = { create: client.create.bind(client), update: client.update.bind(client), get: client.get.bind(client), schemaList: client.schemaList.bind(client) };
    if (fault === "no-create") (fake as any).create = undefined;
    if (fault === "no-schema") (fake as any).schemaList = undefined;
    if (fault === "no-update") (fake as any).update = undefined;
    if (fault === "seed-error") fake.create = async () => { throw new Error("synthetic-private-diagnostic"); };
    if (fault === "template-directory-error") fs.writeFileSync(join(pmRoot, "templates"), "blocked");
    if (fault === "template-file-error") {
      await applyPreset({ command: "baseline", args: [], options: {}, global: {}, pm_root: pmRoot, sdk: native }, { label: "Owned baseline", presetId: "startup-roadmap", settings: SETTINGS, templates: TEMPLATES, parameters: PARAMETERS, nextSteps: [] });
      fs.rmSync(join(pmRoot, "templates", "initiative.json"));
      fs.mkdirSync(join(pmRoot, "templates", "initiative.json"));
    }
    if (["seed-missing", "template-missing", "template-corrupt"].includes(fault)) fake.create = async (options) => {
      if (fault === "seed-missing") return { item: { id: options!.id } } as any;
      const result = await client.create(options);
      const file = join(pmRoot, "templates", "initiative.json");
      if (fault === "template-missing") fs.rmSync(file);
      else fs.writeFileSync(file, "{corrupt");
      return result;
    };
    const sdk = { ...native, client: (fault === "no-client" ? undefined : fake) as any,
      ...(fault === "settings-ignored" ? { mutateWorkspaceSettings: async () => ({ changed: false, dry_run: false, replayed: false }) } : {}) };
    const before = trackerBytes(pmRoot); output.length = 0;
    const run = () => applyPreset({ command: "fault", args: [], options: { withSeeds: fault !== "settings-ignored", force: true }, global: {}, pm_root: pmRoot, sdk }, {
      label: "Fault", presetId: "startup-roadmap", settings: SETTINGS, templates: TEMPLATES, parameters: PARAMETERS, nextSteps: [],
    });
    const capability = fault.startsWith("no-");
    await assert.rejects(run, (error: any) => error.code === (capability ? "artifact_capability_missing" : fault.endsWith("error") ? "artifact_write_failed" : "stale_artifacts") && error.exitCode === 2);
    assert.ok(!output.some((line) => line.includes("synthetic-private-diagnostic")));
    if (fault === "template-directory-error") assert.equal((await computePresetDiff(requirePresetDefinition("startup-roadmap"), await readWorkspaceSnapshot(pmRoot))).inSync, false);
    assert.ok(!output.some((line) => line.includes("preset applied. Next steps")), "partial writes must never be called success");
    if (capability) assert.equal(trackerBytes(pmRoot), before);
  }
  const noAudit = join(root, "no-audit"); await new PmClient({ pmRoot: noAudit, noExtensions: true }).init();
  const noAuditBefore = trackerBytes(noAudit);
  await assert.rejects(() => applyPreset({ command: "fault", args: [], options: {}, global: {}, pm_root: noAudit }, { label: "No audit", settings: { id_prefix: "p-" }, templates: {}, nextSteps: [] }), /audited settings capability/);
  assert.equal(trackerBytes(noAudit), noAuditBefore);
});

test("concurrent first enrollment converges on one managed seed identity under the apply admission", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-artifact-enrollment-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saved = [console.log, console.warn]; console.log = console.warn = () => {};
  t.after(() => { [console.log, console.warn] = saved; });
  for (const force of [false, true]) {
    const pmRoot = join(root, String(force)), client = new PmClient({ pmRoot, noExtensions: true }); await client.init();
    const sdk = createExtensionCommandSdk(pmRoot, client);
    const results = await Promise.allSettled(["alpha", "beta"].map((binding) => applyPreset({ command: "concurrent", args: [], options: { param: `projectKey=${binding}`, withSeeds: true, force }, global: {}, pm_root: pmRoot, sdk }, {
      label: "Concurrent", presetId: "startup-roadmap", settings: SETTINGS, templates: TEMPLATES, parameters: PARAMETERS, nextSteps: [],
    })));
    assert.equal(results.filter(({ status }) => status === "fulfilled").length, force ? 2 : 1);
    for (const result of results) if (result.status === "rejected") assert.equal(result.reason.code, "stale_artifacts");
    const settings = JSON.parse(fs.readFileSync(join(pmRoot, "settings.json"), "utf8")), binding = settings.id_prefix.slice(0, -1);
    assert.equal((await client.listAllComplete()).items.length, 1, "the second initial plan must adopt the admitted owner's seed identity");
    const diff = await computeParameterizedDiff(requirePresetDefinition("startup-roadmap", { projectKey: binding }), PARAMETERS, { projectKey: binding }, await readWorkspaceSnapshot(pmRoot));
    assert.equal(diff.inSync, true);
  }
});
