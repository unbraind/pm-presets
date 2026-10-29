/** Semantic secret destinations and final composed strings remain safe at every boundary. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk/authoring";
import mod from "../src/index.ts";
import { projectPresetDefinition } from "../src/catalog.ts";
import { computeParameterizedDiff, computePresetDiff } from "../src/diff.ts";
import { collectSecretSettingPaths, resolveParameterizedPreset, resolveSettingsWithParameters, resolveTemplatesWithParameters, resolveSeedsWithParameters, type PresetParameter, type PresetParameterManifest } from "../src/params.ts";
import { applyPreset, storedTemplate, type PresetSettingsPatch } from "../src/presets/shared.ts";
import { PRESET_PARAMETERS, PRESET_REGISTRY } from "../src/registry.ts";
import { SETTINGS, TEMPLATES } from "../src/presets/startup-roadmap/index.ts";
import { PRESET_SEEDS } from "../src/seeds.ts";
import { assertNoCredentials, secretCorpus, trackerBytes } from "./fixtures/params-secret-oracle.ts";

const descriptor = PRESET_REGISTRY.find((entry) => entry.id === "startup-roadmap")!;

test("property: every secret-reference destination redacts legacy values independently of parameter provenance", async () => {
  const credentials = secretCorpus();
  const manifests: PresetParameterManifest[] = [[], [{ name: "unused", type: "secret", required: false }], [{ name: "public", type: "string", required: false, default: "safe" }]];
  for (const [index, credential] of credentials.entries()) {
    const key = `deploy_${index}`;
    const settings: PresetSettingsPatch = { id_prefix: "safe-", secret_references: { [key]: "@NEW_TOKEN" } };
    for (const manifest of manifests) {
      assert.deepEqual(collectSecretSettingPaths(settings, manifest), [`secret_references.${key}`]);
      const projected = projectPresetDefinition(descriptor, { parameters: manifest, settings, templates: {} });
      assert.deepEqual(projected.secretSettingPaths, [`secret_references.${key}`]);
      for (const provenance of [projected.secretSettingPaths, undefined, []]) {
        const definition = { ...projected, secretSettingPaths: provenance };
        for (const legacy of [credential, [credential, { nested: credential }], { nested: [credential] }, null, false, 7, "@PREVIOUS_TOKEN"]) {
          const snapshot = { settings: { id_prefix: "safe-", secret_references: { [key]: legacy } }, templateNames: [] };
          const before = JSON.stringify({ definition, snapshot });
          for (const diff of [await computePresetDiff(definition, snapshot), await computeParameterizedDiff(definition, manifest, {}, snapshot)]) {
            assertNoCredentials(JSON.stringify(diff), credentials);
            const entry = diff.settings.find((entry) => entry.path === `secret_references.${key}`)!;
            assert.equal(entry.preset, "@NEW_TOKEN");
            assert.equal(entry.workspace, legacy === "@PREVIOUS_TOKEN" ? legacy : "<redacted>");
            assert.equal(entry.status, "change");
            assert.equal(diff.settings.find((entry) => entry.path === "id_prefix")!.workspace, "safe-");
          }
          assert.equal(JSON.stringify({ definition, snapshot }), before);
        }
        for (const current of [undefined, "@NEW_TOKEN"]) {
          const diff = await computeParameterizedDiff(definition, manifest, {}, { settings: current === undefined ? {} : settings, templateNames: [] });
          const entry = diff.settings.find((entry) => entry.path === `secret_references.${key}`)!;
          assert.equal(entry.workspace, current);
          assert.equal(entry.status, current === undefined ? "add" : "match");
        }
      }
    }
  }
  // Direct SDK definitions can carry arbitrary JSON shapes. Sensitivity still
  // follows every leaf under the destination, without claiming they are valid manifests.
  const settings = { id_prefix: "safe-", secret_references: { list: [null, false], nested: { flag: false }, empty: null, count: 7 } } as unknown as PresetSettingsPatch;
  assert.deepEqual(collectSecretSettingPaths(settings, []), ["secret_references.count", "secret_references.empty", "secret_references.list", "secret_references.nested.flag"]);
  assert.deepEqual(collectSecretSettingPaths({ secret_references: ["@TOKEN"] } as unknown as PresetSettingsPatch, []), ["secret_references"]);
  const definition = { ...projectPresetDefinition(descriptor, { parameters: [], settings: { id_prefix: "safe-" }, templates: {} }), settings };
  const diff = await computePresetDiff(definition, { settings: { secret_references: { list: credentials[0], nested: { flag: credentials[0] }, empty: credentials[0], count: credentials[0] } }, templateNames: [] });
  assertNoCredentials(JSON.stringify(diff), credentials);
  assert.ok(diff.settings.filter((entry) => entry.path.startsWith("secret_references.")).every((entry) => entry.workspace === "<redacted>"));
});

test("property: final substitution never assembles a binding across parameter or literal boundaries", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-composition-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  const client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const sdk = createExtensionCommandSdk(pmRoot, client);
  const before = trackerBytes(pmRoot);
  const names = ["left", "middle", "right"];
  const targets = ["${param:missing}", "${param:left}", "${param:hold}", "${param:token}", "${param:bad name}", "${param:"];
  for (const target of targets) {
    for (let split = 1; split < "${param:".length; split += 1) {
      const partitions = [[target.slice(0, split), target.slice(split)]];
      for (let next = split + 1; next < "${param:".length; next += 1) partitions.push([target.slice(0, split), target.slice(split, next), target.slice(next)]);
      for (const fragments of partitions) {
        const parameters: PresetParameterManifest = [...fragments.map((defaultValue, index) => ({ name: names[index], type: "string" as const, required: false, default: defaultValue })),
          { name: "hold", type: "string", required: false }, { name: "token", type: "secret", required: false }];
        const supplied = Object.fromEntries(fragments.map((fragment, index) => [names[index], fragment]));
        const adjacent = fragments.map((_, index) => `\${param:${names[index]}}`).join("");
        const literals = fragments.length === 2 ? [`${fragments[0]}\${param:${names[1]}}`, `\${param:${names[0]}}${fragments[1]}`] : [];
        for (const authored of [adjacent, ...literals]) {
          const settings = { id_prefix: "safe-", nested: { values: [null, { body: authored }] } } as PresetSettingsPatch;
          const templates = { "safe.json": storedTemplate("safe", { body: authored }) };
          const seeds = [{ type: "Task", title: "Safe", body: authored, tags: "safe" }];
          for (const values of [{}, supplied]) {
            for (const allowUnresolved of [false, true]) {
              for (const run of [() => resolveSettingsWithParameters(parameters, values, settings, allowUnresolved),
                () => resolveTemplatesWithParameters(parameters, values, templates, allowUnresolved),
                () => resolveSeedsWithParameters(parameters, values, seeds, allowUnresolved),
                () => resolveParameterizedPreset(parameters, values, { settings, templates, seeds }, allowUnresolved),
                () => projectPresetDefinition(descriptor, { parameters, settings, templates }, values),
                () => resolveTemplatesWithParameters(parameters, values, { "safe.json": storedTemplate("safe", { body: `\${param:hold}|${authored}|\${param:hold}` }) }, true)]) {
                assert.throws(run, { code: "invalid_value", exitCode: 2 });
              }
            }
          }
          // The real mutation boundary must refuse before settings, templates,
          // history or lock files can change, including default-only inputs.
          await assert.rejects(() => applyPreset({ command: "test", args: [], global: {}, options: {}, pm_root: pmRoot, sdk } as CommandHandlerContext,
            { label: "Composed", parameters, settings, templates, nextSteps: [] }), { code: "invalid_value", exitCode: 2 });
        }
      }
    }
  }
  assert.equal(trackerBytes(pmRoot), before);
  const parameters: PresetParameterManifest = [{ name: "left", type: "string", required: false, default: "longer-safe" },
    { name: "right", type: "string", required: false, default: "ok" }, { name: "hold", type: "string", required: false }];
  for (const authored of ["${param:hold}|${param:left}${param:right}|${param:hold}", "${param:left}${param:hold}${param:right}", "${param:left}:${param:right}"]) {
    const expected = authored.replaceAll("${param:left}", "longer-safe").replaceAll("${param:right}", "ok");
    assert.equal(resolveSeedsWithParameters(parameters, {}, [{ type: "Task", title: authored }], true).seeds[0].title, expected);
    if (authored.includes("${param:hold}")) assert.throws(() => resolveSeedsWithParameters(parameters, {}, [{ type: "Task", title: authored }]), { code: "unanswered_parameter" });
    else assert.equal(resolveSeedsWithParameters(parameters, {}, [{ type: "Task", title: authored }]).seeds[0].title, expected);
  }
});

test("property: composed defaults refuse across SDK commands and renderers without tracker changes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-composed-commands-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  const client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const sdk = createExtensionCommandSdk(pmRoot, client);
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  assert.deepEqual(harness.activation.failed, []);
  const before = trackerBytes(pmRoot);
  const parameters = PRESET_PARAMETERS["startup-roadmap"] as PresetParameter[];
  const savedParameters = [...parameters], savedPrefix = SETTINGS.id_prefix;
  const template = Object.values(TEMPLATES)[0];
  const savedBody = template.options.body, savedSeeds = PRESET_SEEDS["startup-roadmap"];
  const stack = join(root, "stack.json");
  writeFileSync(stack, JSON.stringify({ selections: [{ preset: "startup-roadmap", settings: false, templates: false, seeds: true }] }));
  parameters.push({ name: "left", type: "string", required: false, default: "${param" }, { name: "right", type: "string", required: false, default: ":missing}" });
  try {
    for (const destination of ["settings", "templates", "seeds"]) {
      SETTINGS.id_prefix = destination === "settings" ? "${param:left}${param:right}" : savedPrefix;
      template.options.body = destination === "templates" ? "${param:left}${param:right}" : savedBody;
      PRESET_SEEDS["startup-roadmap"] = destination === "seeds" ? [{ type: "Task", title: "${param:left}${param:right}" }] : savedSeeds;
      for (const json of [false, true]) {
        for (const [command, args, options] of [
          ["presets apply", ["startup-roadmap"], { withSeeds: true }], ["presets apply", ["startup-roadmap"], { dryRun: true, withSeeds: true }],
          ["presets diff", ["startup-roadmap"], {}], ["presets", [], { diff: "startup-roadmap" }],
          ["presets show", ["startup-roadmap"], {}], ["presets list", [], {}], ["presets", [], { list: true }],
          ["presets validate", [], {}], ["presets plan", ["startup-roadmap"], { withSeeds: true }],
          ["presets stack", [], { input: stack }],
        ] as const) {
          // A seeds-only stack does not consume settings/templates. Exercise it
          // for the seed destination; other commands validate the whole preset.
          if (command === "presets stack" && destination !== "seeds") continue;
          await assert.rejects(() => harness.runCommand({ command, args: [...args], options, pmRoot, sdk, global: { json } }), { code: "invalid_value", exitCode: 2 });
          assert.equal(trackerBytes(pmRoot), before);
        }
      }
    }
  } finally {
    parameters.splice(0, Infinity, ...savedParameters); SETTINGS.id_prefix = savedPrefix;
    template.options.body = savedBody; PRESET_SEEDS["startup-roadmap"] = savedSeeds;
  }
});
