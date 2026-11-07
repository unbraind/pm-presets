/** Independent acceptance checks for the saved typed-binding hardening on current main. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import { requirePresetDefinition } from "../src/catalog.ts";
import { computeDesiredPresetState } from "../src/desired-state.ts";
import { computeParameterizedDiff, computePresetDiff, readWorkspaceSnapshot } from "../src/diff.ts";
import { resolveParameterValues } from "../src/params.ts";
import { applyPreset } from "../src/presets/shared.ts";
import { PARAMETERS, SETTINGS, TEMPLATES } from "../src/presets/startup-roadmap/index.ts";
import { assertNoCredentials, trackerBytes } from "./fixtures/params-secret-oracle.ts";

test("binding capture keeps settings, templates and seeds coherent during replacement", async (t) => {
  const parent = fs.mkdtempSync(join(tmpdir(), "presets-binding-acceptance-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  for (const projectKey of ["alpha", "a-1", "roadmap2"]) {
    const root = join(parent, projectKey);
    const client = new PmClient({ pmRoot: root, noExtensions: true });
    await client.init();
    assert.equal(fs.existsSync(join(root, ".git")), false);
    const resolved = resolveParameterValues(PARAMETERS, { projectKey });
    const injected = { ...resolved, values: { ...resolved.values } };
    const options = { resolvedParameterValues: injected, withSeeds: true, replace: true };
    const applying = applyPreset({ command: "binding-acceptance", args: [], options, global: {}, pm_root: root, sdk: createExtensionCommandSdk(root, client) }, {
      label: "Roadmap", presetId: "startup-roadmap", settings: SETTINGS, templates: TEMPLATES, parameters: PARAMETERS, nextSteps: [],
    });
    injected.values.projectKey = "later";
    options.withSeeds = false;
    options.replace = false;
    await applying;
    const snapshot = await readWorkspaceSnapshot(root, client);
    assert.equal(snapshot.settings?.id_prefix, `${projectKey}-`);
    const items = (await client.listAllComplete()).items;
    assert.equal(items.length, 1);
    assert.equal(items[0].title, `Define the ${projectKey} first roadmap initiative`);
    assert.equal(Object.values(snapshot.seeds!)[0].body, `Starter initiative for the ${projectKey} project seeded by pm-presets. Replace with a real initiative.`);
    const expectedTemplates = JSON.parse(JSON.stringify(TEMPLATES).replaceAll("${param:projectKey}", projectKey)) as unknown;
    assert.deepEqual(snapshot.templateDocuments, expectedTemplates);
    assert.equal((await computePresetDiff(requirePresetDefinition("startup-roadmap", { projectKey }), snapshot, { replace: true })).inSync, true);
  }
});

test("desired artifact capture survives mutation of every public payload during normalization", async () => {
  const definition = requirePresetDefinition("startup-roadmap", { projectKey: "alpha" });
  const settings = structuredClone(definition.settings);
  const templates = structuredClone(definition.templateDocuments!);
  const seeds = structuredClone(definition.seedItems!);
  const record = { version: 1 as const, seedIds: ["original-preset-startup-roadmap-0"] };
  const input = { settings, templates, seeds, record, presetId: definition.id, replace: true };
  const planning = computeDesiredPresetState(input);
  input.presetId = "indie-dev";
  input.replace = false;
  settings.id_prefix = "changed-";
  Object.values(templates)[0].options.body = "${param:unanswered}";
  seeds[0].title = "${param:unanswered}";
  record.seedIds[0] = "changed-preset-startup-roadmap-0";
  const desired = await planning;
  assert.equal(desired.settings.id_prefix, "alpha-");
  assert.equal(desired.replace, true);
  assert.equal(desired.ownership?.presetId, "startup-roadmap");
  assert.deepEqual(desired.templates, Object.entries(definition.templateDocuments!).map(([filename, document]) => ({ filename, document })));
  assert.equal(desired.seeds[0].id, "original-preset-startup-roadmap-0");
  assert.equal(desired.seeds[0].item.title, "Define the alpha first roadmap initiative");
});

test("selected seeds require catalog membership before any tracker mutation", async (t) => {
  const parent = fs.mkdtempSync(join(tmpdir(), "presets-membership-acceptance-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  const root = join(parent, "refusals");
  const client = new PmClient({ pmRoot: root, noExtensions: true });
  await client.init();
  const sdk = createExtensionCommandSdk(root, client), before = trackerBytes(root);
  for (const presetId of [undefined, "", "unknown-preset", ...Object.getOwnPropertyNames(Object.prototype), "prototype"]) {
    await assert.rejects(() => applyPreset({ command: "membership-acceptance", args: [], options: { withSeeds: true }, global: {}, pm_root: root, sdk }, {
      label: "Unknown", presetId, settings: { id_prefix: "safe-" }, templates: {}, nextSteps: [],
    }), { code: "invalid_artifact_record", exitCode: 2 });
    assert.equal(trackerBytes(root), before);
  }
  // Previously released, ordinary catalog definitions remain accepted in nongit trackers.
  for (const presetId of ["indie-dev", "startup-roadmap"]) {
    const permitted = join(parent, presetId), definition = requirePresetDefinition(presetId);
    const native = new PmClient({ pmRoot: permitted, noExtensions: true });
    await native.init();
    await applyPreset({ command: "membership-acceptance", args: [], options: { withSeeds: true }, global: {}, pm_root: permitted, sdk: createExtensionCommandSdk(permitted, native) }, {
      label: presetId, presetId, settings: definition.settings, templates: definition.templateDocuments!, nextSteps: [],
    });
    assert.equal((await native.listAllComplete()).items.length, definition.seedItems!.length);
  }
});

test("legacy sensitive diffs refuse before normalization while external references remain usable", async (t) => {
  const definition = requirePresetDefinition("indie-dev");
  const credential = "synthetic-legacy-credential-0123456789";
  let normalizationAttempts = 0;
  const intercept = t.mock.method(fs.promises, "mkdtemp", () => {
    normalizationAttempts++;
    throw new Error("normalization must not start for sensitive trees");
  });
  syncBuiltinESMExports();
  try {
    for (const tree of ["governance", "validation", "testing"] as const) {
      const sensitive = { ...definition, settings: { ...definition.settings, [tree]: { ...definition.settings[tree], legacy_token: credential } }, secretSettingPaths: [`${tree}.legacy_token`] };
      const snapshot = { settings: sensitive.settings, templateNames: [] };
      const before = JSON.stringify(snapshot);
      for (const compare of [
        () => computePresetDiff(sensitive, snapshot, { replace: true }),
        () => computeParameterizedDiff(sensitive, [], {}, snapshot, { replace: true }),
      ]) await assert.rejects(compare, { code: "invalid_secret_reference", exitCode: 2 });
      const ordinary = await computePresetDiff(sensitive, snapshot);
      assertNoCredentials(JSON.stringify(ordinary), [credential]);
      assert.equal(ordinary.inSync, false);
      assert.equal(JSON.stringify(snapshot), before);
    }
    const sensitivePrefix = { ...definition, settings: { ...definition.settings, id_prefix: "sensitive-prefix-" }, secretSettingPaths: ["id_prefix"] };
    await assert.rejects(() => computePresetDiff(sensitivePrefix, { settings: undefined, templateNames: [] }, { withSeeds: true }), { code: "invalid_secret_reference", exitCode: 2 });
    assert.equal(normalizationAttempts, 0);
  } finally {
    intercept.mock.restore();
    syncBuiltinESMExports();
  }
  const safe = { ...definition, settings: { ...definition.settings, secret_references: { deploy: "@SAFE_TOKEN" } } };
  const allowed = await computePresetDiff(safe, { settings: undefined, templateNames: [] }, { replace: true, withSeeds: true });
  assert.equal(allowed.settings.find(({ path }) => path === "secret_references.deploy")?.preset, "@SAFE_TOKEN");
  assert.equal(allowed.seeds.missing.length, definition.seedItems!.length);
});
