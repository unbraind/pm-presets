/** Adversarial native-write oracles for every managed seed field and command surface. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import mod from "../src/index.ts";
import { normalizeSeedArtifact, computeDesiredPresetState, compareDesiredPresetState, seedArtifactMatches } from "../src/desired-state.ts";
import { readSeedArtifacts, readSeedTypes } from "../src/artifact-reader.ts";
import { PRESET_SEEDS, type SeedItem } from "../src/seeds.ts";
import { requirePresetDefinition } from "../src/catalog.ts";
import { computePresetDiff, computeParameterizedDiff, readWorkspaceSnapshot } from "../src/diff.ts";
import { PRESET_PARAMETERS, PRESET_REGISTRY } from "../src/registry.ts";
import { planPresetStack } from "../src/stack.ts";
import { bundledPresetComposition } from "../src/plan.ts";
import { trackerBytes } from "./fixtures/params-secret-oracle.ts";
import type { PresetParameter } from "../src/params.ts";

test("property: every template field contributes to both synchronization verdicts", async () => {
  for (const { id } of PRESET_REGISTRY) {
    const definition = requirePresetDefinition(id);
    for (const [filename, document] of Object.entries(definition.templateDocuments!)) {
      for (const field of Object.keys(document)) {
        const changed = { ...document, [field]: null };
        const snapshot = { settings: definition.settings, templateNames: definition.templates.map(({ name }) => name), templateDocuments: { ...definition.templateDocuments, [filename]: changed } };
        for (const diff of [await computePresetDiff(definition, snapshot), await computeParameterizedDiff(definition, PRESET_PARAMETERS[id], {}, snapshot)]) {
          assert.equal(diff.inSync, false, `${id}/${filename}/${field}`);
          assert.ok(diff.artifacts.includes(`templates/${filename}`));
        }
      }
      for (const field of Object.keys(document.options)) {
        const snapshot = { settings: definition.settings, templateNames: definition.templates.map(({ name }) => name), templateDocuments: { ...definition.templateDocuments,
          [filename]: { ...document, options: { ...document.options, [field]: null } } } };
        assert.equal((await computeParameterizedDiff(definition, PRESET_PARAMETERS[id], {}, snapshot)).inSync, false, `${id}/${filename}/options/${field}`);
      }
    }
  }
});

test("property: desired seed fields equal independently created native artifacts", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-native-seeds-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const client = new PmClient({ pmRoot: root, noExtensions: true }); await client.init();
  await client.schemaAddType("WorkUnit", { alias: ["work"] });
  const types = await readSeedTypes(root, client);
  assert.deepEqual(await readSeedTypes(root), types);
  const tags = [" RoadMap, roadmap, ALPHA ", '["ALPHA","RoadMap","alpha"]', "", "z,é,A,a"];
  for (let index = 0; index < 32; index++) {
    const seed: SeedItem = { type: index % 3 === 0 ? "work" : index % 2 ? " feature " : "Feature", title: ` \u2003Native ${index}\u00a0 `,
      priority: ["medium", "HIGH", "0", "minimal"][index % 4], tags: tags[index % tags.length], body: `\n\nBody ${index}\n\n` };
    const before = structuredClone(seed);
    const id = `case${index}-preset-native-0`;
    await client.create({ ...seed, id, unset: ["parent"] });
    const actual = await readSeedArtifacts(root, [id], client);
    const desired = await computeDesiredPresetState({ presetId: "native", settings: { id_prefix: "pm-" }, templates: {}, seeds: [seed],
      record: { version: 1, seedIds: [id] }, seedTypes: types });
    const state = { settings: desired.settings, templates: {}, seeds: actual, applicationRecords: { native: desired.ownership!.record } };
    assert.deepEqual(compareDesiredPresetState(desired, state), [], `native field parity case ${index}`);
    assert.equal(seedArtifactMatches(seed, actual[id], types), true);
    for (const change of [{ title: "Different" }, { body: "Different" }, { tags: ["different"] }, { priority: 3 }, { type: "Issue" }, { parent: "pm-parent" }]) {
      assert.equal(seedArtifactMatches(seed, { ...actual[id], ...change }, types), false, "real controlled field changes must remain drift");
    }
    assert.deepEqual(seed, before);
  }
  const canonical = normalizeSeedArtifact({ type: " task ", title: " Title " });
  assert.equal(canonical.type, "Task"); assert.equal(canonical.priority, "2"); assert.equal(canonical.body, "");
  assert.equal(normalizeSeedArtifact({ type: "WORK", title: "Title" }, [{ name: "WorkUnit", aliases: ["work"] }]).type, "WorkUnit");
  assert.equal(normalizeSeedArtifact({ type: "Custom", title: "Title" }, [{ name: "Custom" }]).type, "Custom");
  assert.equal(normalizeSeedArtifact({ type: "constructor", title: "Title" }).type, "constructor");
  assert.equal(normalizeSeedArtifact({ type: "bug", title: "Title" }).type, "Issue");
  assert.throws(() => normalizeSeedArtifact({ type: "Task", title: " \u2003 " }), { code: "invalid_manifest" });
  await assert.rejects(() => computeDesiredPresetState({ presetId: "native", settings: { id_prefix: "pm-" }, templates: {}, seeds: [{ type: "Task", title: "Title", priority: "invalid" }] }), { code: "invalid_manifest" });
  fs.writeFileSync(join(root, "schema", "types.json"), "{invalid");
  // Optional legacy schema faults follow the host's fallback contract; the
  // package must preserve exactly the inventory the native writer sees.
  const schema = await new PmClient({ pmRoot: root, noExtensions: true }).schemaList();
  assert.deepEqual(await readSeedTypes(root), [...schema.builtin, ...schema.custom, ...schema.extension].map(({ name, aliases }) => ({ name, aliases })));
});

test("all seed command writers and strict diff renderers share native normalization", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-seed-commands-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  const original = structuredClone(PRESET_SEEDS);
  t.after(() => { for (const [id, seeds] of Object.entries(original)) PRESET_SEEDS[id] = seeds; });
  for (const seeds of Object.values(PRESET_SEEDS)) for (const seed of seeds) {
    seed.type = seed.type.toLowerCase(); seed.title = ` \u2003${seed.title} `;
    seed.priority = "MEDIUM"; seed.tags = '["Review","review","ALPHA"]'; seed.body = `\n\n${seed.body}\n\n`;
  }
  const saved = [console.log, console.warn, console.error]; console.log = console.warn = console.error = () => {};
  t.after(() => { [console.log, console.warn, console.error] = saved; });
  for (const preset of Object.keys(PRESET_SEEDS)) {
    const pmRoot = join(root, preset), client = new PmClient({ pmRoot, noExtensions: true }); await client.init();
    const definition = requirePresetDefinition(preset);
    for (const type of definition.itemTypes) await client.schemaAddType(type.name);
    for (const command of ["presets apply", definition.command]) {
      await harness.runCommand({ command, args: command === "presets apply" ? [preset] : [], options: { withSeeds: true }, pmRoot });
      for (const json of [false, true]) for (const rootForm of [false, true]) {
        const before = trackerBytes(pmRoot);
        await harness.runCommand({ command: rootForm ? "presets" : "presets diff", args: rootForm ? [] : [preset],
          options: { ...(rootForm ? { diff: preset } : {}), strict: true }, global: { json }, pmRoot });
        assert.equal(trackerBytes(pmRoot), before);
      }
      assert.equal((await computePresetDiff(requirePresetDefinition(preset), await readWorkspaceSnapshot(pmRoot, client))).inSync, true);
      const stack = await planPresetStack(pmRoot, createExtensionCommandSdk(pmRoot, client), { selections: [{ preset: definition.id, settings: false, templates: false, seeds: true }] });
      for (const { item } of stack.seeds) {
        assert.equal(item.priority, "2"); assert.equal(item.title, item.title.trim()); assert.equal(item.body, item.body?.trim());
        assert.deepEqual(JSON.parse(item.tags!), ["alpha", "review"]);
      }
      const nativeTypes = await readSeedTypes(pmRoot, client);
      assert.ok(bundledPresetComposition(preset, true).features.find(({ id }) => id === "seeds")!.requires.every((requirement) => requirement.kind !== "type" || nativeTypes.some(({ name }) => name === requirement.name)));
    }
  }
  // Declaration previews retain genuinely unanswered authored bindings while
  // default-backed plans above always use native seed values.
  const manifest = PRESET_PARAMETERS["startup-roadmap"] as PresetParameter[];
  const parameter = manifest[0];
  manifest[0] = { ...parameter, default: undefined };
  try {
    const pmRoot = join(root, "startup-roadmap"), client = new PmClient({ pmRoot, noExtensions: true });
    const stack = await planPresetStack(pmRoot, createExtensionCommandSdk(pmRoot, client), { selections: [{ preset: "startup-roadmap", settings: false, templates: false, seeds: true }] });
    assert.ok(stack.seeds[0].item.title.includes("${param:projectKey}"));
    assert.ok(bundledPresetComposition("startup-roadmap", true).features.some(({ id }) => id === "seeds"));
  } finally { manifest[0] = parameter; }
});
