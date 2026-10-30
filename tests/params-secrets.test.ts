/** External references protect every tracker byte, including append-only audit history. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk/authoring";
import { buildExportedPreset } from "../src/export.ts";
import mod, { resolveSecretReference } from "../src/index.ts";
import { ParameterRefusal, collectParameterValues, resolveParameterValues, assertResolvedParameterValues, resolveParameterizedPreset, resolveSettingsWithParameters, resolveTemplatesWithParameters, resolveSeedsWithParameters, type PresetParameter, type PresetParameterManifest } from "../src/params.ts";
import { applyPreset, storedTemplate, type PresetSettingsPatch, type PresetTemplateMap } from "../src/presets/shared.ts";
import { PRESET_PARAMETERS, PRESET_REGISTRY } from "../src/registry.ts";
import { SETTINGS } from "../src/presets/startup-roadmap/index.ts";
import { PRESET_SEEDS } from "../src/seeds.ts";
import { requirePresetDefinition, projectPresetDefinition, presetTemplateEntries } from "../src/catalog.ts";
import { assertNoCredentials, secretCorpus, trackerBytes } from "./fixtures/params-secret-oracle.ts";

const manifest: PresetParameterManifest = [{ name: "token", type: "secret", required: true }];
const roadmapManifest = PRESET_PARAMETERS["startup-roadmap"] as PresetParameter[];
const descriptor = PRESET_REGISTRY.find((entry) => entry.id === "startup-roadmap")!;
const patch: PresetSettingsPatch = { id_prefix: "safe-", secret_references: { deploy: "${param:token}" } };

/** Capture both streams as well as returned renderable results and typed refusals. */
async function capture(run: () => unknown | Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { lines.push(JSON.stringify(await run())); }
  catch (error) { lines.push(String(error)); throw error; }
  finally { [console.log, console.warn, console.error] = saved; }
  return lines.join("\n");
}

test("property: literal secrets refuse across resolution APIs and input spellings without a write", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-reference-refusal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  const client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const before = trackerBytes(pmRoot);
  for (const secret of secretCorpus()) {
    const values = { token: secret };
    for (const run of [() => collectParameterValues(manifest, values), () => resolveParameterValues(manifest, values),
      () => assertResolvedParameterValues(manifest, { values, sources: { token: "supplied" }, unanswered: [] }),
      () => resolveParameterizedPreset(manifest, values, {}),
      () => resolveSettingsWithParameters(manifest, values, patch),
      () => resolveTemplatesWithParameters(manifest, values, {}),
      () => resolveSeedsWithParameters(manifest, values, []),
      () => projectPresetDefinition(descriptor, { parameters: manifest, settings: patch, templates: {} }, values)]) {
      assert.throws(run, (error: any) => { assert.equal(error.code, "invalid_secret_reference"); assert.equal(error.exitCode, 2); assert.match(error.remedy, /@ENV_NAME/); assertNoCredentials(String(error), [secret]); return true; });
    }
    const file = join(root, "params.json"); writeFileSync(file, JSON.stringify(values));
    for (const options of [{ param: `token=${secret}` }, { paramsFile: file }, { "params-file": file }]) {
      const context = { command: "test", args: [], global: {}, options, pm_root: pmRoot, sdk: createExtensionCommandSdk(pmRoot, client) } as CommandHandlerContext;
      await assert.rejects(() => applyPreset(context, { label: "Reference", settings: patch, templates: {}, parameters: manifest, nextSteps: [] }), (error: any) => {
        assert.equal(error.code, "invalid_secret_reference"); assertNoCredentials(String(error), [secret]); return true;
      });
      assert.equal(trackerBytes(pmRoot), before);
    }
  }
});

test("property: manifest destination validation rejects secret bindings in every public field before writes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-reference-destinations-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm"); const client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const before = trackerBytes(pmRoot);
  const values = { token: "@DEPLOY_TOKEN" };
  const publicSettings = ["id_prefix", "title", "tags", "filename", "seed_id", "validation", "governance", "testing", "nested", "public_configuration_with_a_long_name"];
  for (const field of publicSettings) {
    for (const value of ["${param:token}", "prefix-${param:token}", ["${param:token}"], { nested: "${param:token}" }]) {
      const settings = { id_prefix: "safe-", [field]: value } as PresetSettingsPatch;
      assert.throws(() => resolveSettingsWithParameters(manifest, {}, settings, true), { code: "secret_in_public_prose" });
      assert.throws(() => projectPresetDefinition(descriptor, { parameters: manifest, settings, templates: {} }), { code: "secret_in_public_prose" });
      await assert.rejects(() => applyPreset({ command: "test", args: [], global: {}, options: { param: "token=@DEPLOY_TOKEN", withSeeds: true }, pm_root: pmRoot, sdk: createExtensionCommandSdk(pmRoot, client) } as CommandHandlerContext,
        { label: "Refusal", settings, templates: {}, parameters: manifest, nextSteps: [] }), { code: "secret_in_public_prose" });
    }
  }
  for (const field of ["type", "title", "tags", "body", "priority", "id"]) {
    assert.throws(() => resolveSeedsWithParameters(manifest, values, [{ type: "Task", title: "Safe", [field]: "${param:token}" }]), { code: "secret_in_public_prose" });
    assert.throws(() => resolveTemplatesWithParameters(manifest, values, { "safe.json": storedTemplate("safe", { [field]: ["${param:token}"] }) }), { code: "secret_in_public_prose" });
  }
  for (const reference of ["prefix ${param:token}", ["${param:token}"], { inner: "${param:token}" }]) {
    assert.throws(() => resolveSettingsWithParameters(manifest, values, { id_prefix: "safe-", secret_references: { deploy: reference } } as PresetSettingsPatch), { code: "secret_in_public_prose" });
  }
  assert.equal(trackerBytes(pmRoot), before);
});

test("property: empty manifests validate settings, templates, field names and final prefix overrides before mutation", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-empty-manifest-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm"); const client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const before = trackerBytes(pmRoot);
  await assert.rejects(() => applyPreset({ command: "test", args: [], global: {}, options: {}, pm_root: pmRoot, sdk: createExtensionCommandSdk(pmRoot, client) }, {
    label: "Provider refusal", settings: { id_prefix: "safe-", governance: { get preset(): "minimal" { throw new Error("synthetic resolver failure"); } } },
    templates: {}, parameters: [], nextSteps: [],
  }), /Audited preset settings failed: synthetic resolver failure/);
  assert.equal(trackerBytes(pmRoot), before);
  for (const value of ["${param:missing}", "prefix ${param:broken", "${param:free}"]) {
    const freeform: PresetParameterManifest = [{ name: "free", type: "string", required: true }];
    assert.throws(() => resolveParameterValues(freeform, { free: value }), { code: "invalid_value" });
    for (const parts of [{ settings: { id_prefix: "${param:free}" } },
      { templates: { "safe.json": storedTemplate("safe", { body: "${param:free}" }) } },
      { seeds: [{ type: "Task", title: "${param:free}" }] }]) {
      assert.throws(() => resolveParameterizedPreset(freeform, { free: value }, parts), { code: "invalid_value" });
    }
  }
  for (const parameters of [undefined, []]) {
    for (const binding of ["${param:missing}", "${param:broken", "${param:bad name}"]) {
      const parts: Array<{ settings: PresetSettingsPatch & Record<string, unknown>; templates: PresetTemplateMap }> = [ { settings: { id_prefix: binding }, templates: {} },
        { settings: { id_prefix: "safe-", nested: { deep: [binding] } }, templates: {} },
        { settings: { id_prefix: "safe-" }, templates: { "safe.json": storedTemplate("safe", { body: binding }) } },
        { settings: { id_prefix: "safe-" }, templates: { [binding]: storedTemplate("safe", { body: "safe" }) } },
        { settings: { id_prefix: "safe-", [binding]: "safe" }, templates: {} } ];
      for (const part of parts) {
        await assert.rejects(() => applyPreset({ command: "test", args: [], global: {}, options: {}, pm_root: pmRoot, sdk: createExtensionCommandSdk(pmRoot, client) } as CommandHandlerContext,
          { label: "Empty", ...part, parameters, nextSteps: [] }), (error: any) => { assert.equal(error.exitCode, 2); assert.match(error.code, /unknown_binding|malformed_binding|invalid_binding_location/); return true; });
        assert.equal(trackerBytes(pmRoot), before);
      }
      await assert.rejects(() => applyPreset({ command: "test", args: [], global: {}, options: { prefix: binding }, pm_root: pmRoot, sdk: createExtensionCommandSdk(pmRoot, client) } as CommandHandlerContext,
        { label: "Override", settings: { id_prefix: "safe-" }, templates: {}, parameters, nextSteps: [] }), (error: any) => error.exitCode === 2);
    }
  }
  const saved = SETTINGS.id_prefix; const savedManifest = roadmapManifest.splice(0);
  try {
    SETTINGS.id_prefix = "${param:missing}";
    assert.throws(() => presetTemplateEntries("startup-roadmap"), { code: "unknown_binding" });
  } finally { SETTINGS.id_prefix = saved; roadmapManifest.push(...savedManifest); }
  assert.equal(trackerBytes(pmRoot), before);
});

test("property: every SDK command and audited rotation keeps random credentials external, history included", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-reference-history-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm"); const client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const sdk = createExtensionCommandSdk(pmRoot, client);
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] }); assert.deepEqual(harness.activation.failed, []);
  const savedManifest = [...PRESET_PARAMETERS["startup-roadmap"]];
  const savedRefs = (SETTINGS as PresetSettingsPatch).secret_references;
  roadmapManifest.push({ name: "token", type: "secret", required: false });
  (SETTINGS as PresetSettingsPatch).secret_references = { deploy: "${param:token}" };
  const savedEnv = process.env.PRESET_ROUND4_TOKEN;
  const secrets = secretCorpus();
  const stackFile = join(root, "stack.json");
  writeFileSync(stackFile, JSON.stringify({ selections: [{ preset: "startup-roadmap", settings: false, templates: false, seeds: true }] }));
  try {
    for (const secret of secrets) {
      process.env.PRESET_ROUND4_TOKEN = secret;
      const output = await capture(async () => {
        const resolved = resolveParameterValues(manifest, { token: "@PRESET_ROUND4_TOKEN" });
        assert.equal(resolved.values.token, "@PRESET_ROUND4_TOKEN");
        assert.equal(resolveSecretReference(resolved.values.token), secret);
        // Resolution is late: changing the variable changes the next consumption.
        process.env.PRESET_ROUND4_TOKEN = `${secret}-rotated`;
        assert.equal(resolveSecretReference(resolved.values.token), `${secret}-rotated`);
        await applyPreset({ command: "test", args: [], global: {}, options: { param: "token=@PRESET_ROUND4_TOKEN" }, pm_root: pmRoot, sdk } as CommandHandlerContext,
          { label: "Reference", settings: patch, templates: {}, parameters: manifest, nextSteps: [] });
        assertNoCredentials(trackerBytes(pmRoot), secrets);
        for (const json of [false, true]) {
          for (const [command, args, options] of [
            ["roadmap-setup", [], { param: "token=@PRESET_ROUND4_TOKEN", force: true }],
            ["presets apply", ["startup-roadmap"], { param: "token=@PRESET_ROUND4_TOKEN", withSeeds: true, force: true }],
            ["presets apply", ["startup-roadmap"], { param: "token=@PRESET_ROUND4_TOKEN", dryRun: true }],
            ["presets diff", ["startup-roadmap"], { param: "token=@PRESET_ROUND4_TOKEN" }],
            ["presets", [], { diff: "startup-roadmap", param: "token=@PRESET_ROUND4_TOKEN" }],
            ["presets show", ["startup-roadmap"], {}], ["presets list", [], {}], ["presets", [], { list: true }],
            ["presets validate", [], {}], ["presets plan", ["startup-roadmap"], {}], ["presets stack", [], { input: stackFile }],
            ["presets export", ["reference-copy"], {}], ["presets", [], { custom: "reference-copy" }],
            ["templates list", [], {}], ["templates show", ["initiative"], {}],
          ] as const) {
            const result = await harness.runCommand({ command, args: [...args], options, pmRoot, sdk, global: { json } });
            console.log(JSON.stringify(result));
            assertNoCredentials(trackerBytes(pmRoot), secrets);
          }
        }
      });
      assert.match(output, /@PRESET_ROUND4_TOKEN/);
      assertNoCredentials(output + trackerBytes(pmRoot), secrets);
      const persisted = JSON.parse(readFileSync(join(pmRoot, "settings.json"), "utf8"));
      assert.equal(persisted.secret_references.deploy, "@PRESET_ROUND4_TOKEN");
      const history = readFileSync(join(pmRoot, "history", "_workspace.jsonl"), "utf8");
      assert.match(history, /@PRESET_ROUND4_TOKEN/);
      assert.ok((await client.listAllComplete()).items.every((item) => item.id.startsWith("road-")));
    }
  } finally {
    roadmapManifest.splice(0, Infinity, ...savedManifest);
    if (savedRefs === undefined) delete (SETTINGS as PresetSettingsPatch).secret_references; else (SETTINGS as PresetSettingsPatch).secret_references = savedRefs;
    if (savedEnv === undefined) delete process.env.PRESET_ROUND4_TOKEN; else process.env.PRESET_ROUND4_TOKEN = savedEnv;
  }
});

test("external-reference validation fails closed without exposing environment diagnostics", () => {
  for (const builtinName of Object.getOwnPropertyNames(Object.prototype)) {
    const hadBuiltin = Object.hasOwn(process.env, builtinName);
    const priorBuiltin = process.env[builtinName];
    delete process.env[builtinName];
    try {
      assert.throws(() => resolveSecretReference(`@${builtinName}`), { code: "unavailable_secret_reference" });
      process.env[builtinName] = "synthetic-explicit-environment-value";
      assert.equal(resolveSecretReference(`@${builtinName}`), "synthetic-explicit-environment-value");
    } finally {
      if (hadBuiltin) process.env[builtinName] = priorBuiltin; else delete process.env[builtinName];
    }
  }
  const inheritedName = "PRESET_INHERITED_REFERENCE";
  const prototype = Object.getPrototypeOf(process.env);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, inheritedName);
  const own = Object.hasOwn(process.env, inheritedName), previous = process.env[inheritedName];
  delete process.env[inheritedName];
  Object.defineProperty(prototype, inheritedName, { configurable: true, value: "synthetic-inherited-value" });
  try { assert.throws(() => resolveSecretReference(`@${inheritedName}`), { code: "unavailable_secret_reference" }); }
  finally {
    if (descriptor) Object.defineProperty(prototype, inheritedName, descriptor); else delete prototype[inheritedName];
    if (own) process.env[inheritedName] = previous;
  }
  for (const reference of ["literal", "@TOKEN\n", " @TOKEN", "@TOKEN-name", "@1TOKEN"]) {
    assert.throws(() => resolveSecretReference(reference), { code: "invalid_secret_reference", exitCode: 2 });
  }
  assert.throws(() => resolveSecretReference("@PRESET_ROUND4_UNSET"), { code: "unavailable_secret_reference", exitCode: 2 });
  process.env.PRESET_ROUND4_UNSET = "";
  try { assert.throws(() => resolveSecretReference("@PRESET_ROUND4_UNSET"), { code: "unavailable_secret_reference" }); }
  finally { delete process.env.PRESET_ROUND4_UNSET; }
  for (const value of [null, "literal", [], { deploy: 7 }, { "bad-name": "@TOKEN" }, { deploy: "literal" }, { deploy: "${param:public}" }]) {
    assert.throws(() => resolveSettingsWithParameters([{ name: "public", type: "string", required: true }], { public: "literal" }, { id_prefix: "safe-", secret_references: value } as unknown as PresetSettingsPatch), { code: "invalid_secret_reference" });
  }
  for (const templates of [{ "${param:token}": storedTemplate("safe", {}) }, { "safe.json": storedTemplate("safe", { "${param:token}": "safe" }) }]) {
    assert.throws(() => resolveTemplatesWithParameters(manifest, { token: "@TOKEN" }, templates as unknown as PresetTemplateMap), { code: "invalid_binding_location" });
  }
});

test("pre-existing literal reference storage refuses without adding it to audited history", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-legacy-reference-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm"); const client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const settingsFile = join(pmRoot, "settings.json");
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  settings.secret_references = { deploy: "legacy-synthetic-credential" };
  writeFileSync(settingsFile, JSON.stringify(settings));
  const before = trackerBytes(pmRoot);
  assert.throws(() => buildExportedPreset({ name: "refused-copy", settings, templates: [] }), { code: "invalid_secret_reference" });
  assert.throws(() => buildExportedPreset({ name: "refused-copy", settings: {}, templates: [{ name: "safe", options: { body: "${param:missing}" } }] }), { code: "unknown_binding" });
  assert.throws(() => buildExportedPreset({ name: "refused-copy", settings: { id_prefix: "${param:missing}" }, templates: [] }), { code: "unknown_binding" });
  assert.throws(() => buildExportedPreset({ name: "refused-copy", settings: {}, templates: [
    { name: "duplicate", options: { body: "${param:missing}" } }, { name: "duplicate", options: { body: "safe" } },
  ] }), { code: "unknown_binding" });
  const input = { label: "Reference", settings: patch, templates: {}, parameters: manifest, nextSteps: [] };
  await assert.rejects(() => applyPreset({ command: "test", args: [], global: {}, options: { param: "token=@SAFE_TOKEN" }, pm_root: pmRoot, sdk: createExtensionCommandSdk(pmRoot, client) }, input), { code: "invalid_secret_reference", exitCode: 2 });
  assert.equal(trackerBytes(pmRoot), before);
  // Simulate a concurrent non-preset writer after preflight. Inspect the raw
  // source again inside the host mutation lock before it computes audit deltas.
  delete settings.secret_references; writeFileSync(settingsFile, JSON.stringify(settings));
  const sdk = createExtensionCommandSdk(pmRoot, client);
  const mutation = sdk.mutateWorkspaceSettings;
  sdk.mutateWorkspaceSettings = async (options) => {
    settings.secret_references = { deploy: "legacy-synthetic-credential" };
    writeFileSync(settingsFile, JSON.stringify(settings));
    return mutation(options);
  };
  await assert.rejects(() => capture(() => applyPreset({ command: "test", args: [], global: {}, options: { param: "token=@SAFE_TOKEN" }, pm_root: pmRoot, sdk }, input)), { code: "invalid_secret_reference", exitCode: 2 });
  // The injected writer's settings remain untouched; this apply appended no
  // credential to history and wrote no templates.
  const { existsSync } = await import("node:fs");
  assert.ok(!existsSync(join(pmRoot, "templates")));
  if (existsSync(join(pmRoot, "history", "_workspace.jsonl"))) {
    assertNoCredentials(readFileSync(join(pmRoot, "history", "_workspace.jsonl"), "utf8"), ["legacy-synthetic-credential"]);
  }
});


test("untrusted object shapes cannot clone unresolved settings or template bindings past validation", () => {
  class HiddenBinding { body = "${param:missing}"; }
  for (const object of [new HiddenBinding(), Object.assign(Object.create({}), { body: "${param:missing}" })]) {
    assert.throws(() => resolveSettingsWithParameters([], {}, { id_prefix: "safe-", nested: object } as PresetSettingsPatch), { code: "invalid_manifest" });
    assert.throws(() => resolveTemplatesWithParameters([], {}, { "safe.json": storedTemplate("safe", { body: object }) } as unknown as PresetTemplateMap), { code: "invalid_manifest" });
  }
});

test("command refusal recovery uses the actual host error contract without retaining parameter inputs", async () => {
  const { parameterSafeApi } = await import("../src/command-errors.ts");
  type Api = import("@unbrained/pm-cli/sdk/authoring").ExtensionApi;
  type Definition = Parameters<Api["registerCommand"]>[0];
  const flags = [{ long: "--param" }];
  let registered: Definition;
  const itemTypes = () => {};
  const api = parameterSafeApi({ registerCommand: (definition: Definition) => { registered = definition; }, registerItemTypes: itemTypes } as unknown as Api);
  assert.equal(api.registerItemTypes, itemTypes);
  const context = { command: "test", args: [], global: {}, options: { param: "token=synthetic-command-canary" }, pm_root: "unused" } as CommandHandlerContext;
  api.registerCommand({ flags, name: "declaration" });
  assert.equal(registered!.run, undefined);
  const nativeRefusal = Object.assign(new Error("unrelated native refusal"), { exitCode: 2 });
  api.registerCommand({ name: "unrelated", run: () => { throw nativeRefusal; } });
  assert.throws(() => registered!.run!(context), (actual: unknown) => actual === nativeRefusal);
  api.registerCommand({ name: "read-manifest", run: () => { throw new ParameterRefusal("unknown_binding", "Fix the manifest binding."); } });
  assert.throws(() => registered!.run!(context), (actual: any) => actual.name === "PmCliError" && actual.code === "unknown_binding" && actual.context.recovery.normalized_args[0] === "presets");

  api.registerCommand({ flags, name: "safe", run: () => ({ retained: true }) });
  assert.deepEqual(registered!.run!(context), { retained: true });
  for (const value of [undefined, null, false, 0, ""]) {
    api.registerCommand({ flags, name: "sync-value", run: () => value });
    assert.equal(registered!.run!(context), value);
  }
  for (const error of [null, new Error("plain"), Object.assign(new Error("bad code"), { exitCode: "2" })]) {
    api.registerCommand({ flags, name: "plain", run: () => { throw error; } });
    assert.throws(() => registered!.run!(context), (actual: unknown) => actual === error);
    api.registerCommand({ flags, name: "plain-async", run: () => Promise.reject(error) });
    await assert.rejects(() => Promise.resolve(registered!.run!(context)), (actual: unknown) => actual === error);
  }
  const parameterWithoutRemedy = new ParameterRefusal("invalid_value", "temporary");
  Reflect.deleteProperty(parameterWithoutRemedy, "remedy");
  api.registerCommand({ flags, name: "parameter-fallback", run: () => { throw parameterWithoutRemedy; } });
  assert.throws(() => registered!.run!(context), (actual: unknown) => (actual as { remedy: string }).remedy === "Check the command help and retry with external secret references.");
  for (const error of [Object.assign(new Error("safe refusal"), { exitCode: 2 }),
    Object.assign(new Error("safe refusal"), { exitCode: 2, code: 3, remedy: false }),
    Object.assign(new Error("safe refusal"), { exitCode: 2, code: "test_code", remedy: "Use external references." })]) {
    api.registerCommand({ flags, name: "refuse", run: () => { throw error; } });
    /** Check the same stable diagnostic for sync throws, promises and foreign thenables. */
    const inspect = (actual: any) => {
      assert.equal(actual.name, "PmCliError"); assert.equal(actual.exitCode, 2);
      assert.equal(actual.remedy, "remedy" in error && typeof error.remedy === "string" ? error.remedy : "Check the command help and retry.");
      assert.equal(actual.code, "code" in error && typeof error.code === "string" ? error.code : "preset_refused");
      assert.deepEqual(actual.context.recovery.normalized_args, ["presets"]);
      assert.equal(actual.context.recovery.recovery_mode, "compact");
      assert.ok(!JSON.stringify(actual).includes("synthetic-command-canary"));
      return true;
    };
    assert.throws(() => registered!.run!(context), inspect);
    api.registerCommand({ flags, name: "refuse-async", run: () => Promise.reject(error) });
    await assert.rejects(() => Promise.resolve(registered!.run!(context)), inspect);
    api.registerCommand({ flags, name: "refuse-thenable", run: () => ({ then(_resolve: unknown, reject: (reason: unknown) => void) { reject(error); } }) });
    await assert.rejects(() => Promise.resolve(registered!.run!(context)), inspect);
  }
});


test("catalog manifest validation refuses secret seed destinations without selecting seeds", () => {
  const saved = [...roadmapManifest], seeds = PRESET_SEEDS["startup-roadmap"];
  roadmapManifest.push({ name: "token", type: "secret", required: false });
  try {
    for (const field of ["title", "tags", "body", "type"]) {
      PRESET_SEEDS["startup-roadmap"] = [{ type: "Task", title: "Safe", [field]: "${param:token}" }];
      assert.throws(() => requirePresetDefinition("startup-roadmap"), { code: "secret_in_public_prose" });
      assert.throws(() => requirePresetDefinition("startup-roadmap", { token: "@TOKEN" }), { code: "secret_in_public_prose" });
    }
  } finally { roadmapManifest.splice(0, Infinity, ...saved); PRESET_SEEDS["startup-roadmap"] = seeds; }
});


test("SDK lookup follows the canonical CLI behind npm-style symlinks", async (t) => {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const { resolveSimulationSdk } = await import("../src/sdk-loader.ts");
  const root = mkdtempSync(join(tmpdir(), "preset-sdk-shim-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = resolve("node_modules/@unbrained/pm-cli/dist/cli.js"), bin = join(root, "bin"), shim = join(bin, "cli.js");
  symlinkSync(dirname(cli), bin, "junction");
  const require = createRequire(import.meta.url);
  const expected = require.resolve("@unbrained/pm-cli/sdk");
  const backend = require("node:module") as { _resolveFilename(...args: unknown[]): string };
  const native = backend._resolveFilename;
  const mock = t.mock.method(backend, "_resolveFilename", (...args: unknown[]) => {
    if (args[0] === "@unbrained/pm-cli/sdk" && (args[1] as { filename: string }).filename !== cli) throw new Error("Peer lookup requires the canonical host.");
    return native.apply(backend, args);
  });
  try {
    assert.equal(resolveSimulationSdk([shim]), expected);
    assert.equal(resolveSimulationSdk([pathToFileURL(shim).href]), expected);
  } finally { mock.mock.restore(); }
});

test("SDK lookup failures return typed refusals without argv or dependency diagnostics", async (t) => {
  const { createRequire } = await import("node:module");
  const { parameterSafeApi } = await import("../src/command-errors.ts");
  type Api = import("@unbrained/pm-cli/sdk/authoring").ExtensionApi;
  type Definition = Parameters<Api["registerCommand"]>[0];
  const canary = "synthetic-sdk-transport-credential";
  let definition: Definition;
  const api = parameterSafeApi({ registerCommand: (value: Definition) => { definition = value; } } as unknown as Api);
  const backend = createRequire(import.meta.url)("node:module") as { _resolveFilename(...args: unknown[]): string };
  const native = backend._resolveFilename;
  const mock = t.mock.method(backend, "_resolveFilename", (...args: unknown[]) => {
    if (args[0] === "@unbrained/pm-cli/sdk") throw new Error(canary);
    return native.apply(backend, args);
  });
  try {
    const error = new ParameterRefusal("invalid_secret_reference", "Use @ENV_NAME.");
    const context = { command: "test", args: [], global: {}, options: { param: `token=${canary}` }, pm_root: "unused" } as CommandHandlerContext;
    const expected = { exit_code: 2, code: "invalid_secret_reference", remediation: "Use @ENV_NAME." };
    api.registerCommand({ name: "refuse", flags: [{ long: "--param" }], run: () => { throw error; } });
    let sync: unknown;
    assert.doesNotThrow(() => { sync = definition!.run!(context); });
    assert.deepEqual(sync, expected); assertNoCredentials(JSON.stringify(sync), [canary]);
    api.registerCommand({ name: "refuse-async", flags: [{ long: "--param" }], run: () => Promise.reject(error) });
    let asynchronous: unknown;
    await assert.doesNotReject(async () => { asynchronous = await definition!.run!(context); });
    assert.deepEqual(asynchronous, expected); assertNoCredentials(JSON.stringify(asynchronous), [canary]);
  } finally { mock.mock.restore(); }
});


test("unified list/custom reject unused parameter inputs before output or export writes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-unused-input-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm"); const client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  const before = trackerBytes(pmRoot), output = join(pmRoot, "refused-copy.json");
  for (const dispatch of [{ list: true }, { custom: "refused-copy", output }]) {
    for (const input of [{ param: "token=synthetic-unused-credential" }, { param: ["token=@ENV_NAME"] },
      { paramsFile: "missing-params.json" }, { "params-file": "missing-params.json" }]) {
      await assert.rejects(() => harness.runCommand({ command: "presets", pmRoot, sdk: createExtensionCommandSdk(pmRoot, client), options: { ...dispatch, ...input } }), { code: "invalid_param_flag", exitCode: 2 });
      assert.equal(trackerBytes(pmRoot), before);
    }
  }
  const listed = await harness.runCommand({ command: "presets", pmRoot, options: { list: true, param: [], paramsFile: null, "params-file": null } });
  assert.equal((listed.result as { count: number }).count, 7);
});
