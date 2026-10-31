/** JSON key preservation and prototype integrity across parameter consumers and trackers. */
import assert from "node:assert/strict";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import mod from "../src/index.ts";
import { presetTemplateEntries, projectPresetDefinition, requirePresetDefinition } from "../src/catalog.ts";
import { assertResolvedParameterValues, collectSecretSettingPaths, redactSecretValuesDeep, resolveParameterizedPreset, resolveSettingsWithParameters, resolveTemplatesWithParameters, resolveSeedsWithParameters, type PresetParameter } from "../src/params.ts";
import { applyPreset, mergePresetSettings, runTemplatesShow, storedTemplate, type PresetSettingsPatch, type PresetTemplateMap } from "../src/presets/shared.ts";
import { readWorkspaceTemplates } from "../src/export.ts";
import { PRESET_PARAMETERS, PRESET_REGISTRY, type PresetId } from "../src/registry.ts";
import { SETTINGS, TEMPLATES } from "../src/presets/startup-roadmap/index.ts";
import { PRESET_SEEDS, seedsForPreset, resolvedSeedsForPreset, planSeeds } from "../src/seeds.ts";
import { planPresetStack } from "../src/stack.ts";
import { comparePresetUpgrade } from "../src/upgrade.ts";
import { assertNoCredentials, secretCorpus, trackerBytes } from "./fixtures/params-secret-oracle.ts";

const keys = [...new Set([...Object.getOwnPropertyNames(Object.prototype), "prototype", "ordinary", "a.b", "a/b", "a~b", ""])];
const referenceKeys = keys.filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key));
const descriptor = PRESET_REGISTRY.find(({ id }) => id === "startup-roadmap")!;
const roadmapSettings: PresetSettingsPatch = SETTINGS;
const parameters = [{ name: "text", type: "string", required: false, default: "resolved" }, { name: "token", type: "secret", required: false }] as const;

test("legacy apply-lock faults release admission without mutating settings or foreign ownership", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-lock-faults-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const fault of ["permission", "vanished", "timeout"] as const) {
    const pmRoot = join(root, fault, ".agents", "pm"), client = new PmClient({ pmRoot, noExtensions: true }); await client.init();
    const nativeSdk = createExtensionCommandSdk(pmRoot, client);
    let mutations = 0;
    const sdk = { ...nativeSdk, mutateWorkspaceSettings: (request: Parameters<typeof nativeSdk.mutateWorkspaceSettings>[0]) => { mutations++; return nativeSdk.mutateWorkspaceSettings(request); } };
    const claims = join(pmRoot, "locks", "pm-presets-apply-claims"), lock = join(pmRoot, "locks", "pm-presets-apply.lock");
    mkdirSync(claims, { recursive: true });
    if (fault === "timeout") writeFileSync(lock, "foreign-owner");
    const before = trackerBytes(pmRoot), open = fs.openSync, now = Date.now;
    const denied = Object.assign(new Error("synthetic permission denial"), { code: "EACCES" });
    let attempts = 0, advanced = false;
    const openMock = t.mock.method(fs, "openSync", ((...args: Parameters<typeof fs.openSync>) => {
      if (args[0] === lock && args[1] === "wx") {
        attempts++;
        if (fault === "permission") throw denied;
        if (fault === "vanished" && attempts === 1) throw Object.assign(new Error("vanished owner"), { code: "EEXIST" });
        if (fault === "timeout") advanced = true;
      }
      return Reflect.apply(open, fs, args);
    }) as typeof fs.openSync);
    const timeMock = t.mock.method(Date, "now", () => now() + (advanced ? 20_000 : 0));
    const logMock = t.mock.method(console, "log", () => {});
    syncBuiltinESMExports();
    try {
      const run = () => applyPreset({ command: "test", args: [], options: {}, global: {}, pm_root: pmRoot, sdk }, { label: "Fault", settings: { id_prefix: "fault-" }, templates: {}, nextSteps: [] });
      if (fault === "vanished") {
        await assert.doesNotReject(run);
        assert.equal(attempts, 2, "a vanished lock must be retried before applying");
        assert.equal(mutations, 1);
        assert.equal(JSON.parse(readFileSync(join(pmRoot, "settings.json"), "utf8")).id_prefix, "fault-");
        assert.equal(existsSync(lock), false);
      } else {
        await assert.rejects(run, fault === "permission" ? (error: unknown) => error === denied : /Another pm-presets apply is running/);
        assert.equal(mutations, 0, "lock failures must never enter the settings mutation");
        assert.equal(trackerBytes(pmRoot), before, "failure must preserve every tracker byte and foreign lock");
      }
      assert.deepEqual(fs.readdirSync(claims), [], "every exit must release its unique admission claim");
    } finally { openMock.mock.restore(); timeMock.mock.restore(); logMock.mock.restore(); syncBuiltinESMExports(); }
  }
});

test("property: accepted JSON keys survive substitution and redaction as own data at every depth", () => {
  const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
  const binding = "${param:text}";
  const data = Object.fromEntries(keys.map((key, index) => [key, [null, false, 7, binding, [binding, Object.fromEntries([[key, binding]])], Object.fromEntries([[key, binding]])][index % 6]]));
  const references = Object.fromEntries(referenceKeys.map((key) => [key, "${param:token}"]));
  const publicData = Object.fromEntries(Object.entries(data).filter(([key]) => key !== "__proto__" && key.length > 0));
  const settings = { ...data, id_prefix: "safe-", secret_references: references } as PresetSettingsPatch;
  const templates = { "safe.json": storedTemplate("safe", publicData as any) };
  const seeds = [{ ...publicData, type: "Task", title: binding }];
  const parts = { settings, templates, seeds };
  const before = JSON.stringify(parts);
  const expected = JSON.parse(before.replaceAll(binding, "resolved").replaceAll("${param:token}", "@KEY_TOKEN"));
  const values = { token: "@KEY_TOKEN" };
  for (const allowUnresolved of [false, true]) {
    assert.deepEqual(resolveSettingsWithParameters(parameters, values, settings, allowUnresolved).settings, expected.settings);
    assert.deepEqual(resolveTemplatesWithParameters(parameters, values, templates as PresetTemplateMap, allowUnresolved).templates, expected.templates);
    assert.deepEqual(resolveSeedsWithParameters(parameters, values, seeds, allowUnresolved).seeds, expected.seeds);
    const resolved = resolveParameterizedPreset(parameters, values, parts, allowUnresolved);
    assert.deepEqual({ settings: resolved.settings, templates: resolved.templates, seeds: resolved.seeds }, expected);
    assert.deepEqual(Object.keys(resolved.settings!.secret_references!), referenceKeys);
    assert.ok(Object.hasOwn(resolved.settings!.secret_references!, "__proto__"));
    assert.equal(Object.getPrototypeOf(resolved.settings!.secret_references!), Object.prototype);
  }
  const definition = projectPresetDefinition(descriptor, { parameters, settings, templates: templates as PresetTemplateMap }, values);
  assert.deepEqual(definition.settings, expected.settings);
  assert.ok(definition.templates[0].optionKeys.includes("constructor"));
  assert.deepEqual(collectSecretSettingPaths(settings, parameters), referenceKeys.map((key) => `secret_references.${key}`).sort((a, b) => a.localeCompare(b)));
  for (const credential of secretCorpus()) {
    const original = Object.fromEntries(keys.map((key) => [key, { nested: [credential] }]));
    const bytes = JSON.stringify(original);
    const redacted = redactSecretValuesDeep(original, [credential]);
    assert.deepEqual(redacted, Object.fromEntries(keys.map((key) => [key, { nested: ["<redacted>"] }])));
    assertNoCredentials(JSON.stringify(redacted), [credential]);
    assert.equal(JSON.stringify(original), bytes);
  }
  assert.equal(JSON.stringify(parts), before);
  for (const key of ["__proto__", " __proto__ ", " body ", ""]) {
    assert.throws(() => resolveTemplatesWithParameters(parameters, values, { "safe.json": storedTemplate("safe", Object.fromEntries([[key, binding]])) }), { code: "invalid_manifest", exitCode: 2 });
    assert.throws(() => resolveSeedsWithParameters(parameters, values, [{ type: "Task", title: "Safe", ...Object.fromEntries([[key, binding]]) }]), { code: "invalid_manifest", exitCode: 2 });
  }
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), prototype);
});

test("property: recursive settings merges never invoke setters or merge inherited fields", () => {
  const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
  for (const value of [null, false, 9, "own-value", ["own-value"], { child: "own-value" }]) {
    const patch = Object.fromEntries(keys.map((key) => [key, value]));
    const before = JSON.stringify(patch);
    assert.deepEqual(mergePresetSettings({}, patch, false), patch);
    assert.deepEqual(mergePresetSettings({}, patch, true), patch);
    assert.equal(JSON.stringify(patch), before);
  }
  const base = Object.fromEntries(keys.map((key) => [key, { kept: "base" }]));
  const patch = Object.fromEntries(keys.map((key) => [key, { added: "patch" }]));
  assert.deepEqual(mergePresetSettings(base, patch, false), Object.fromEntries(keys.map((key) => [key, { kept: "base", added: "patch" }])));
  const canary = "preset_inherited_merge_canary";
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, canary);
  try {
    Object.defineProperty(Object.prototype, canary, { value: "inherited-only", enumerable: true, configurable: true });
    const result = mergePresetSettings({}, JSON.parse('{"__proto__":{"child":"own-value"}}'), false);
    assert.deepEqual(Object.keys(Object.getOwnPropertyDescriptor(result, "__proto__")!.value), ["child"]);
  } finally {
    if (prior) Object.defineProperty(Object.prototype, canary, prior); else delete (Object.prototype as any)[canary];
  }
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), prototype);
});

test("native partial applies retain every unowned reference key and append to existing history", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-own-key-partial-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm"), client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const sdk = createExtensionCommandSdk(pmRoot, client);
  const refs = Object.fromEntries(referenceKeys.map((key) => [key, "@EXTERNAL_TOKEN"]));
  const context = { command: "test", args: [], options: {}, global: {}, pm_root: pmRoot, sdk };
  const originalLog = console.log; console.log = () => {};
  try {
    await applyPreset(context, { label: "Initial", parameters: [], settings: { id_prefix: "safe-", secret_references: refs }, templates: {}, nextSteps: [] });
    const history = readFileSync(join(pmRoot, "history", "_workspace.jsonl"), "utf8");
    await assert.doesNotReject(() => applyPreset({ ...context, options: { param: "token=@NEXT_TOKEN" } }, { label: "Partial", parameters: [{ name: "token", type: "secret", required: true }], settings: { id_prefix: "safe-", secret_references: { deploy: "${param:token}" } }, templates: {}, nextSteps: [] }));
    assert.deepEqual(JSON.parse(readFileSync(join(pmRoot, "settings.json"), "utf8")).secret_references, { ...refs, deploy: "@NEXT_TOKEN" });
    assert.ok(readFileSync(join(pmRoot, "history", "_workspace.jsonl"), "utf8").startsWith(history));
    let mutations = 0;
    const counted = { ...sdk, mutateWorkspaceSettings: (request: Parameters<typeof sdk.mutateWorkspaceSettings>[0]) => { mutations++; return sdk.mutateWorkspaceSettings(request); } };
    for (const value of [Object.fromEntries([["__proto__", "@CHANGED_TOKEN"]]), undefined]) {
      const before = trackerBytes(pmRoot);
      await assert.rejects(() => applyPreset({ ...context, sdk: counted }, { label: "Unsupported", settings: { id_prefix: "safe-", secret_references: value }, templates: {}, nextSteps: [] }), { code: "invalid_secret_reference", exitCode: 2 });
      assert.equal(mutations, 0, "unsupported reference edits must refuse before SDK mutation");
      assert.equal(trackerBytes(pmRoot), before);
    }
    const settingsPath = join(pmRoot, "settings.json");
    const beforeRaceHistory = readFileSync(join(pmRoot, "history", "_workspace.jsonl"), "utf8");
    const beforeRaceBytes = trackerBytes(pmRoot), beforeRaceRaw = readFileSync(settingsPath, "utf8");
    let peerRaw = "";
    const raced = { ...sdk, mutateWorkspaceSettings: async (request: Parameters<typeof sdk.mutateWorkspaceSettings>[0]) => {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      Object.defineProperty(settings.secret_references, "__proto__", { value: "@PEER_TOKEN", enumerable: true, configurable: true });
      peerRaw = JSON.stringify(settings); writeFileSync(settingsPath, peerRaw);
      return sdk.mutateWorkspaceSettings(request);
    } };
    await assert.rejects(() => applyPreset({ ...context, sdk: raced }, { label: "Race", settings: { id_prefix: "safe-", secret_references: Object.fromEntries([["__proto__", "@EXTERNAL_TOKEN"]]) }, templates: {}, nextSteps: [] }), { code: "invalid_secret_reference", exitCode: 2 });
    assert.equal(readFileSync(join(pmRoot, "history", "_workspace.jsonl"), "utf8"), beforeRaceHistory);
    assert.equal(trackerBytes(pmRoot), beforeRaceBytes.replace(beforeRaceRaw, peerRaw));
    const anotherRoot = join(root, "another", ".agents", "pm"), anotherClient = new PmClient({ pmRoot: anotherRoot, noExtensions: true }); await anotherClient.init();
    const anotherSdk = createExtensionCommandSdk(anotherRoot, anotherClient);
    const anotherContext = { ...context, pm_root: anotherRoot, sdk: anotherSdk };
    await applyPreset(anotherContext, { label: "Ordinary", settings: { id_prefix: "safe-", secret_references: { deploy: "@EXTERNAL_TOKEN" } }, templates: {}, nextSteps: [] });
    const anotherBefore = trackerBytes(anotherRoot);
    let anotherCalls = 0;
    const anotherCounted = { ...anotherSdk, mutateWorkspaceSettings: (request: Parameters<typeof anotherSdk.mutateWorkspaceSettings>[0]) => { anotherCalls++; return anotherSdk.mutateWorkspaceSettings(request); } };
    await assert.rejects(() => applyPreset({ ...anotherContext, sdk: anotherCounted }, { label: "Unsupported add", settings: { id_prefix: "safe-", secret_references: Object.fromEntries([["__proto__", "@EXTERNAL_TOKEN"]]) }, templates: {}, nextSteps: [] }), { code: "invalid_secret_reference", exitCode: 2 });
    assert.equal(anotherCalls, 0);
    assert.equal(trackerBytes(anotherRoot), anotherBefore);
  } finally { console.log = originalLog; }
});

test("property: SDK commands persist every reference name through settings templates and append-only history", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-own-key-sdk-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm"); const client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const sdk = createExtensionCommandSdk(pmRoot, client);
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  assert.deepEqual(harness.activation.failed, []);
  const manifest = PRESET_PARAMETERS["startup-roadmap"] as PresetParameter[];
  const savedManifest = [...manifest], savedReferences = Object.getOwnPropertyDescriptor(SETTINGS, "secret_references");
  const template = Object.values(TEMPLATES)[0], savedOption = Object.getOwnPropertyDescriptor(template.options, "__proto__");
  const oldEnv = process.env.PRESET_OWN_KEY_TOKEN; const credentials = secretCorpus(); process.env.PRESET_OWN_KEY_TOKEN = credentials[0];
  const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
  manifest.push({ name: "token", type: "secret", required: false });
  manifest.push(...referenceKeys.filter((name) => /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name)).map((name) => ({ name, type: "string" as const, required: false })));
  roadmapSettings.secret_references = Object.fromEntries(referenceKeys.map((key) => [key, "${param:token}"]));
  Object.defineProperty(template.options, "__proto__", { value: "public-own-data", enumerable: true, configurable: true, writable: true });
  const lines: string[] = [], savedConsole = [console.log, console.error, console.warn];
  console.log = console.error = console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try {
    const invalidBefore = trackerBytes(pmRoot);
    for (const json of [false, true]) {
      await assert.rejects(() => harness.runCommand({ command: "roadmap-setup", args: [], options: { param: "token=@PRESET_OWN_KEY_TOKEN" }, pmRoot, sdk, global: { json } }), { code: "invalid_manifest", exitCode: 2 });
      await assert.rejects(() => harness.runCommand({ command: "presets apply", args: ["startup-roadmap"], options: { param: "token=@PRESET_OWN_KEY_TOKEN", withSeeds: true }, pmRoot, sdk, global: { json } }), { code: "invalid_manifest", exitCode: 2 });
      assert.equal(trackerBytes(pmRoot), invalidBefore);
    }
    if (savedOption) Object.defineProperty(template.options, "__proto__", savedOption); else delete template.options.__proto__;
    const expectedOptions = JSON.parse(JSON.stringify(template.options).replaceAll("${param:projectKey}", "road"));
    for (const json of [false, true]) {
      for (const [command, args, options] of [["roadmap-setup", [], { param: "token=@PRESET_OWN_KEY_TOKEN", force: true }],
        ["presets apply", ["startup-roadmap"], { param: "token=@PRESET_OWN_KEY_TOKEN", withSeeds: true, force: true }]] as const) {
        await harness.runCommand({ command, args: [...args], options, pmRoot, sdk, global: { json } });
        const stored = JSON.parse(readFileSync(join(pmRoot, "settings.json"), "utf8"));
        assert.deepEqual(stored.secret_references, Object.fromEntries(referenceKeys.map((key) => [key, "@PRESET_OWN_KEY_TOKEN"])));
        assert.deepEqual(JSON.parse(readFileSync(join(pmRoot, "templates", `${template.name}.json`), "utf8")).options, expectedOptions);
        assertNoCredentials(trackerBytes(pmRoot), credentials);
      }
      const before = trackerBytes(pmRoot);
      const show = (await harness.runCommand({ command: "presets show", args: ["startup-roadmap"], pmRoot, sdk, global: { json } })).result as any;
      assert.deepEqual(Object.keys(show.settings.secret_references), referenceKeys);
      for (const [command, args, options] of [["presets diff", ["startup-roadmap"], { param: "token=@PRESET_OWN_KEY_TOKEN" }],
        ["presets", [], { diff: "startup-roadmap", param: "token=@PRESET_OWN_KEY_TOKEN" }]] as const) {
        const diff = (await harness.runCommand({ command, args: [...args], options, pmRoot, sdk, global: { json } })).result as any;
        assert.ok(referenceKeys.every((key) => diff.settings.some((entry: any) => entry.path === `secret_references.${key}` && entry.preset === "@PRESET_OWN_KEY_TOKEN")));
        lines.push(JSON.stringify(diff));
      }
      const exported = (await harness.runCommand({ command: "presets export", args: ["own-key-copy"], pmRoot, sdk, global: { json } })).result as any;
      assert.deepEqual(Object.keys(exported.settings.secret_references), referenceKeys);
      const shownTemplate = await harness.runCommand({ command: "templates show", args: [template.name], pmRoot, sdk, global: { json } });
      assert.deepEqual((shownTemplate.result as any).options, expectedOptions);
      assert.equal(trackerBytes(pmRoot), before);
    }
    const history = readFileSync(join(pmRoot, "history", "_workspace.jsonl"), "utf8");
    for (const key of referenceKeys) assert.ok(history.includes(JSON.stringify(key)));
    assertNoCredentials(lines.join("\n") + trackerBytes(pmRoot), credentials);
    assert.ok(!lines.join("\n").includes("[native code]"), "unanswered parameters must not read inherited values into summaries");
    assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), prototype);
  } finally {
    [console.log, console.error, console.warn] = savedConsole;
    manifest.splice(0, Infinity, ...savedManifest);
    if (savedReferences) Object.defineProperty(SETTINGS, "secret_references", savedReferences); else delete roadmapSettings.secret_references;
    if (savedOption) Object.defineProperty(template.options, "__proto__", savedOption); else delete template.options.__proto__;
    if (oldEnv === undefined) delete process.env.PRESET_OWN_KEY_TOKEN; else process.env.PRESET_OWN_KEY_TOKEN = oldEnv;
  }
});

test("legacy template projections and read races refuse before returning or exporting partial data", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-key-read-boundary-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm"), client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const sdk = createExtensionCommandSdk(pmRoot, client);
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  const templatePath = join(pmRoot, "templates", "initiative.json"), output = join(pmRoot, "refused-export.json");
  mkdirSync(join(pmRoot, "templates"), { recursive: true });
  for (const key of ["__proto__", " body "]) {
    writeFileSync(templatePath, JSON.stringify(storedTemplate("initiative", Object.fromEntries([[key, "public-data"], ["title", "Safe"]]))));
    const before = trackerBytes(pmRoot);
    for (const json of [false, true]) {
      for (const [command, args, options] of [["templates show", ["initiative"], {}], ["presets export", ["refused-copy"], { output }], ["presets", [], { custom: "refused-copy", output }]] as const) {
        await assert.rejects(() => harness.runCommand({ command, args: [...args], options, pmRoot, sdk, global: { json } }), { code: "invalid_manifest", exitCode: 2 });
        assert.ok(!existsSync(output));
        assert.equal(trackerBytes(pmRoot), before);
      }
    }
    await assert.rejects(() => planPresetStack(pmRoot, sdk, { selections: [{ preset: "startup-roadmap", settings: false }] }), { code: "invalid_manifest", exitCode: 2 });
    assert.equal(trackerBytes(pmRoot), before);
  }
  writeFileSync(templatePath, JSON.stringify(storedTemplate("initiative", { body: "safe" })));
  const originalRead = fs.readFileSync;
  for (const fault of [new Error("synthetic-private-read-marker"), "{", '{"options":null}']) {
    const mock = t.mock.method(fs, "readFileSync", ((file: any, ...args: any[]) => {
      if (file === templatePath) { if (fault instanceof Error) throw fault; return fault; }
      return (originalRead as any)(file, ...args);
    }) as any);
    syncBuiltinESMExports();
    try {
      for (const run of [() => runTemplatesShow({ command: "templates show", args: ["initiative"], options: {}, global: {}, pm_root: pmRoot, sdk }), () => readWorkspaceTemplates(pmRoot)]) {
        await assert.rejects(run, (error: any) => { assert.equal(error.code, "invalid_manifest"); assert.equal(error.exitCode, 2); assert.ok(!String(error).includes("synthetic-private-read-marker")); return true; });
      }
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  }
});

test("native template inventory lookups never inherit phantom builtin names", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-own-template-name-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm"), client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const sdk = createExtensionCommandSdk(pmRoot, client);
  const context = { command: "templates show", args: [], options: {}, global: {}, pm_root: pmRoot, sdk };
  const before = trackerBytes(pmRoot);
  for (const name of referenceKeys.filter((key) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(key))) {
    await assert.rejects(() => runTemplatesShow({ ...context, args: [name] }), (error: any) => error.exitCode === 3);
  }
  assert.equal(trackerBytes(pmRoot), before);
  mkdirSync(join(pmRoot, "templates"), { recursive: true });
  writeFileSync(join(pmRoot, "templates", "constructor.json"), JSON.stringify(storedTemplate("constructor", { body: "Own user template" })));
  const own = await runTemplatesShow({ ...context, args: ["constructor"] });
  assert.equal(own.source, "user");
  assert.equal(own.options.body, "Own user template");
});

test("property: stack reconstruction never traverses inherited prototypes and refuses lossy host normalization", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-own-key-stack-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm"); const client = new PmClient({ cwd: root, pmRoot, noExtensions: true }); await client.init();
  const before = trackerBytes(pmRoot), sdk = createExtensionCommandSdk(pmRoot, client);
  const rootDescriptor = Object.getOwnPropertyDescriptor(SETTINGS, "__proto__");
  const refsDescriptor = Object.getOwnPropertyDescriptor(SETTINGS, "secret_references");
  const canary = "preset_stack_own_key_canary", prior = Object.getOwnPropertyDescriptor(Object.prototype, canary);
  try {
    Object.defineProperty(SETTINGS, "__proto__", { value: { [canary]: "own-data" }, enumerable: true, configurable: true, writable: true });
    roadmapSettings.secret_references = Object.fromEntries(referenceKeys.map((key) => [key, "@KEY_TOKEN"]));
    // The pinned host's typed preview omits extension settings. Its existing
    // canonical check must refuse rather than claiming those values survived.
    let refusal: any;
    try { await planPresetStack(pmRoot, sdk, { selections: [{ preset: "startup-roadmap", templates: false }] }); }
    catch (error) { refusal = error; }
    assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, canary), prior);
    assert.equal(refusal?.code, "normalization_conflict");
    assert.equal(refusal.exitCode, 2);
    assert.equal(trackerBytes(pmRoot), before);
  } finally {
    if (prior) Object.defineProperty(Object.prototype, canary, prior); else delete (Object.prototype as any)[canary];
    if (rootDescriptor) Object.defineProperty(SETTINGS, "__proto__", rootDescriptor); else delete (SETTINGS as any).__proto__;
    if (refsDescriptor) Object.defineProperty(SETTINGS, "secret_references", refsDescriptor); else delete roadmapSettings.secret_references;
  }
});

test("property: dictionary lookups require own keys while guarded upgrade inputs retain explicit refusals", () => {
  for (const name of referenceKeys.filter((key) => /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(key))) {
    const manifest = [{ name, type: "string" as const, required: true }];
    const values = Object.fromEntries([[name, "safe-value"]]);
    assert.throws(() => assertResolvedParameterValues(manifest, { values, sources: Object.create(Object.fromEntries([[name, "supplied"]])), unanswered: [] }), { code: "invalid_value", exitCode: 2 });
    assert.doesNotThrow(() => assertResolvedParameterValues(manifest, { values, sources: Object.fromEntries([[name, "supplied"]]), unanswered: [] }));
  }
  for (const key of Object.getOwnPropertyNames(Object.prototype)) {
    assert.deepEqual(seedsForPreset(key), []);
    assert.deepEqual(resolvedSeedsForPreset(key), []);
    assert.deepEqual(planSeeds("unused", key), []);
    assert.throws(() => presetTemplateEntries(key as PresetId), /No definition exports/);
    PRESET_REGISTRY.push({ ...descriptor, id: key as PresetId });
    try { assert.throws(() => requirePresetDefinition(key), /No definition exports/); }
    finally { PRESET_REGISTRY.pop(); }
    const old = Object.getOwnPropertyDescriptor(PRESET_SEEDS, key);
    try {
      Object.defineProperty(PRESET_SEEDS, key, { value: [{ type: "Task", title: "Own seed" }], enumerable: true, configurable: true, writable: true });
      assert.equal(resolvedSeedsForPreset(key)[0].title, "Own seed");
      for (const value of [null, undefined]) {
        Object.defineProperty(PRESET_SEEDS, key, { value, enumerable: true, configurable: true, writable: true });
        assert.deepEqual(seedsForPreset(key), []);
      }
    } finally { if (old) Object.defineProperty(PRESET_SEEDS, key, old); else delete PRESET_SEEDS[key]; }
  }
  const registry = PRESET_PARAMETERS as unknown as Record<string, unknown>;
  const oldSeeds = Object.getOwnPropertyDescriptor(PRESET_SEEDS, "nullable-manifest");
  const oldManifest = Object.getOwnPropertyDescriptor(registry, "nullable-manifest");
  try {
    PRESET_SEEDS["nullable-manifest"] = [{ type: "Task", title: "Own seed" }];
    registry["nullable-manifest"] = undefined;
    assert.equal(resolvedSeedsForPreset("nullable-manifest")[0].title, "Own seed");
  } finally {
    if (oldSeeds) Object.defineProperty(PRESET_SEEDS, "nullable-manifest", oldSeeds); else delete PRESET_SEEDS["nullable-manifest"];
    if (oldManifest) Object.defineProperty(registry, "nullable-manifest", oldManifest); else delete registry["nullable-manifest"];
  }
  for (const key of ["__proto__", "constructor", "prototype"]) {
    assert.throws(() => comparePresetUpgrade({}, { nested: [Object.fromEntries([[key, "value"]])] }, {}), { code: "invalid_input", exitCode: 2 });
  }
});
