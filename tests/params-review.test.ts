/**
 * params-review.test.ts — adversarial regression tests for the re-review
 * findings, one per violated rule, each written to catch ANY instance of its
 * class (not just the reported line):
 *
 *  1. Secret parameter values never enter ANY emitted surface (dry-run patch
 *     dumps, diff results, show output) — only the settings file apply writes.
 *  2. Read surfaces display declarations; a required parameter without a
 *     default must not break `show`, and apply must honor `--param`.
 *  3. Seed bindings validate before the setup handler writes anything.
 *  4. Resolved parameter values are retained and threaded through settings,
 *     templates and seeds; the params file is read exactly once.
 *  5. Settings mutation and template writes serialize under the workspace
 *     apply lock, so concurrent parameterized applies stay consistent.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { createExtensionTestHarness, type ExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import { PmClient as Client, readSettings, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk/authoring";

import mod from "../src/index.ts";
import { applyPreset } from "../src/presets/shared.ts";
import { computeParameterizedDiff } from "../src/diff.ts";
import { collectPresetParameterIssues, projectPresetDefinition, requirePresetDefinition, type PresetDefinition } from "../src/catalog.ts";
import { resolvePresetApplication, contextWithResolvedParameters } from "../src/apply-command.ts";
import { PRESET_PARAMETERS } from "../src/registry.ts";
import { PRESET_SEEDS } from "../src/seeds.ts";
import { SETTINGS as ROADMAP_SETTINGS, TEMPLATES as ROADMAP_TEMPLATES, PARAMETERS as ROADMAP_PARAMETERS } from "../src/presets/startup-roadmap/index.ts";
import { storedTemplate, type PresetSettingsPatch, type PresetTemplateMap } from "../src/presets/shared.ts";
import type { PresetParameter, PresetParameterManifest, ResolvedParameterValues } from "../src/params.ts";

/** Activate pm-presets through pm's real extension loader, once per process. */
let cachedHarness: Promise<ExtensionTestHarness> | undefined;

/** Lazily start (or reuse) the shared extension harness. */
function activatePresets(): Promise<ExtensionTestHarness> {
  cachedHarness ??= (async () => {
    const harness = await createExtensionTestHarness(mod, {
      name: "pm-presets",
      capabilities: ["commands", "schema"],
    });
    assert.deepEqual(harness.activation.failed, []);
    return harness;
  })();
  return cachedHarness;
}

/** Create an initialized non-git temp pm root and clean it up afterwards. */
async function workspace(t: TestContext): Promise<{ root: string; pmDir: string }> {
  const root = mkdtempSync(join(tmpdir(), "pm-presets-review-"));
  const pmDir = join(root, ".agents", "pm");
  await new Client({ pmRoot: pmDir, cwd: root, noExtensions: true }).init();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, pmDir };
}

/** Build a command context bound to a real SDK client on `pmDir`. */
function context(pmDir: string, client: Client, options: Record<string, unknown>, args: readonly string[] = ["startup-roadmap"]): CommandHandlerContext {
  return {
    command: "review-test",
    args: [...args],
    options,
    global: { json: true, quiet: true, noPager: true },
    pm_root: pmDir,
    sdk: createExtensionCommandSdk(pmDir, client),
  };
}

/** A parameterized preset shape for direct applyPreset calls. */
const SECRET_PRESET = {
  label: "Review",
  settings: { id_prefix: "${param:token}-" } as PresetSettingsPatch,
  templates: {} as PresetTemplateMap,
  parameters: [{ name: "token", type: "secret", required: true }] as PresetParameterManifest,
  nextSteps: [],
};

/** Replace one bundled preset's manifest IN PLACE (catalog, boundary and handlers alias the same array). */
function replaceManifest(id: keyof typeof PRESET_PARAMETERS, manifest: PresetParameterManifest): PresetParameterManifest {
  const saved = [...PRESET_PARAMETERS[id]];
  const entries = PRESET_PARAMETERS[id] as unknown as PresetParameter[];
  entries.length = 0;
  entries.push(...manifest);
  return saved;
}

/** Restore a manifest saved by {@link replaceManifest}. */
function restoreManifest(id: keyof typeof PRESET_PARAMETERS, saved: PresetParameterManifest): void {
  const entries = PRESET_PARAMETERS[id] as unknown as PresetParameter[];
  entries.length = 0;
  entries.push(...saved);
}

/** Capture console output while an async run executes. */
async function captureOutput(run: () => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    await run();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
  return logs;
}

test("dry-run apply redacts secret values from every emitted line", async (t) => {
  const { pmDir } = await workspace(t);
  const client = new Client({ pmRoot: pmDir, noExtensions: true });
  const logs = await captureOutput(() =>
    applyPreset(context(pmDir, client, { param: ["token=hunter-two"], dryRun: true }), SECRET_PRESET));
  const joined = logs.join("\n");
  assert.ok(!joined.includes("hunter-two"), `the secret leaked into dry-run output: ${joined}`);
  assert.ok(logs.some((line) => line.includes("<redacted>")), "the patch dump must show the redaction marker");
  assert.ok(!existsSync(join(pmDir, "templates")), "dry-run must not write");
});

test("non-dry-run apply writes the secret only into settings, never output", async (t) => {
  const { pmDir } = await workspace(t);
  const client = new Client({ pmRoot: pmDir, noExtensions: true });
  const logs = await captureOutput(() =>
    applyPreset(context(pmDir, client, { param: ["token=hunter-two"] }), SECRET_PRESET));
  assert.ok(!logs.join("\n").includes("hunter-two"), "the secret leaked into apply output");
  const settings = await readSettings(pmDir);
  assert.equal(settings.id_prefix, "hunter-two-", "the secret belongs only in the private settings file");
});

test("diff results redact secret values on both sides of every settings entry", () => {
  const definition = {
    id: "startup-roadmap" as const,
    displayName: "Startup roadmap",
    description: "",
    command: "roadmap-setup",
    idPrefix: "rev-",
    governance: "custom" as const,
    settings: { id_prefix: "rev-", validation: { webhook_secret: "hunter2-secret" }, testing: { record_results_to_items: false } },
    templates: [],
    itemTypes: [],
    parameters: [{ name: "token", type: "secret", required: true, hasDefault: false, unanswered: false }],
  } as unknown as PresetDefinition;
  const manifest: PresetParameterManifest = [{ name: "token", type: "secret", required: true }];
  const snapshot = {
    settings: { validation: { webhook_secret: "hunter2-secret" } } as Record<string, unknown>,
    templateNames: [],
  };
  const result = computeParameterizedDiff(definition, manifest, { token: "hunter2-secret" }, snapshot);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("hunter2-secret"), `the secret leaked into diff output: ${serialized}`);
  assert.ok(serialized.includes("<redacted>"), "diff entries must carry the redaction marker");
  assert.ok(
    result.settings.some((entry) => entry.path === "validation.webhook_secret" && entry.workspace === "<redacted>" && entry.preset === "<redacted>"),
    "both sides of a secret-derived entry must be redacted",
  );
  assert.ok(
    result.settings.some((entry) => entry.path === "testing.record_results_to_items" && entry.preset === false),
    "non-string leaves must pass through the redaction untouched",
  );
});

test("diff refuses unanswered required parameters with the typed remedy before reading the workspace", () => {
  const definition = {
    id: "startup-roadmap" as const,
    displayName: "Startup roadmap",
    description: "",
    command: "roadmap-setup",
    idPrefix: "rev-",
    governance: "custom" as const,
    settings: { id_prefix: "rev-" },
    templates: [],
    itemTypes: [],
    parameters: [{ name: "teamKey", type: "string", required: true, hasDefault: false, unanswered: true }],
  } as unknown as PresetDefinition;
  assert.throws(
    () => computeParameterizedDiff(definition, [{ name: "teamKey", type: "string", required: true }], {}, { settings: undefined, templateNames: [] }),
    (error: unknown) => {
      assert.match(String((error as { message: string }).message), /unanswered_parameter: .*teamKey/);
      return true;
    },
  );
});

test("catalog projection displays declarations for required parameters without defaults", () => {
  const descriptor = {
    id: "startup-roadmap" as const,
    displayName: "Startup roadmap",
    description: "test",
    command: "roadmap-setup",
    idPrefix: "rev-",
    governance: "custom" as const,
    templates: ["card"],
  };
  const manifest: PresetParameterManifest = [
    { name: "teamKey", type: "string", required: true, pattern: "[a-z]+" } as PresetParameter,
  ];
  const raw = {
    settings: { id_prefix: "${param:teamKey}-" } as PresetSettingsPatch,
    templates: { "card.json": storedTemplate("card", { body: "Team ${param:teamKey}" }) } as PresetTemplateMap,
    parameters: manifest,
  };
  // Declaration mode: no throw, the authored occurrence stays, the view flags it.
  const declared = projectPresetDefinition(descriptor, raw);
  assert.equal(declared.parameters.length, 1);
  assert.equal(declared.parameters[0].unanswered, true);
  assert.equal(declared.settings.id_prefix, "${param:teamKey}-");
  // Answered: the same projection resolves through the apply engine.
  const answered = projectPresetDefinition(descriptor, raw, { teamKey: "acme" });
  assert.equal(answered.parameters[0].unanswered, false);
  assert.equal(answered.settings.id_prefix, "acme-");
  // Validation still fails an unresolved bundled preset: defaults must apply.
  const issues = collectPresetParameterIssues(answered, raw, ["card"]);
  assert.ok(issues.some((issue) => /required parameter 'teamKey' has no default/.test(issue.message)), JSON.stringify(issues));
});

test("apply honors --param when a bundled parameter has no default, and refuses without it before any write", async (t) => {
  const h = await activatePresets();
  const { pmDir } = await workspace(t);
  const savedManifest = replaceManifest("startup-roadmap",
    PRESET_PARAMETERS["startup-roadmap"].map((parameter) => ({ ...parameter, default: undefined })));
  try {
    const logs: string[] = [];
    t.mock.method(console, "log", (...args: unknown[]) => logs.push(args.map(String).join(" ")));
    t.mock.method(console, "warn", () => {});

    // show keeps working (declaration surface) and lists the unanswered choice.
    const shown = await h.runCommand({ command: "presets show", args: ["startup-roadmap"] });
    const views = (shown.result as { parameters: Array<{ name: string; unanswered: boolean }> }).parameters;
    assert.equal(views.find((view) => view.name === "projectKey")?.unanswered, true);

    // diff without --param refuses with the typed remedy.
    await assert.rejects(
      () => h.runCommand({ command: "presets diff", args: ["startup-roadmap"], pmRoot: pmDir }),
      /unanswered_parameter/,
    );

    // apply without --param refuses before any write.
    const before = readFileSync(join(pmDir, "settings.json"), "utf8");
    await assert.rejects(
      () => h.runCommand({ command: "presets apply", args: ["startup-roadmap"], pmRoot: pmDir }),
      /unanswered_parameter/,
    );
    assert.equal(readFileSync(join(pmDir, "settings.json"), "utf8"), before);
    assert.equal(existsSync(join(pmDir, "templates")), false);

    // apply WITH --param succeeds, exactly as before the finding.
    await h.runCommand({
      command: "presets apply",
      args: ["startup-roadmap"],
      options: { param: ["projectKey=acme"] },
      pmRoot: pmDir,
    });
    const settings = await readSettings(pmDir);
    assert.equal(settings.id_prefix, "acme-");
    assert.ok(logs.some((line) => line.includes("projectKey=acme (supplied)")));
  } finally {
    restoreManifest("startup-roadmap", savedManifest);
  }
});

test("seed bindings validate before the setup handler writes anything", async (t) => {
  const h = await activatePresets();
  const { pmDir } = await workspace(t);
  const originalSeeds = PRESET_SEEDS["startup-roadmap"];
  try {
    // Malformed seed binding: refuse before writes, not after a partial apply.
    PRESET_SEEDS["startup-roadmap"] = [
      { type: "Feature", title: "Broken ${param:projectKey seed", priority: "2", tags: "roadmap", body: "x" },
    ];
    const before = readFileSync(join(pmDir, "settings.json"), "utf8");
    await assert.rejects(
      () => h.runCommand({
        command: "presets apply",
        args: ["startup-roadmap"],
        options: { withSeeds: true },
        pmRoot: pmDir,
      }),
      (error: unknown) => {
        assert.match(String((error as { message: string }).message), /malformed_binding/);
        return true;
      },
    );
    assert.equal(readFileSync(join(pmDir, "settings.json"), "utf8"), before, "a bad seed must leave settings untouched");
    assert.equal(existsSync(join(pmDir, "templates")), false, "a bad seed must leave templates unwritten");

    // Secret seed binding: same pre-write refusal.
    PRESET_SEEDS["startup-roadmap"] = [
      { type: "Feature", title: "Token ${param:ghost}", priority: "2", tags: "roadmap", body: "x" },
    ];
    await assert.rejects(
      () => h.runCommand({
        command: "presets apply",
        args: ["startup-roadmap"],
        options: { withSeeds: true, param: ["projectKey=acme"] },
        pmRoot: pmDir,
      }),
      /unknown_binding/,
    );
    assert.equal(readFileSync(join(pmDir, "settings.json"), "utf8"), before);
    assert.equal(existsSync(join(pmDir, "templates")), false);
  } finally {
    PRESET_SEEDS["startup-roadmap"] = originalSeeds;
  }
});

test("a valid secret seed binding refuses before writes when secrets are bound", async (t) => {
  const h = await activatePresets();
  const { pmDir } = await workspace(t);
  const originalSeeds = [...PRESET_SEEDS["startup-roadmap"]];
  const savedManifest = replaceManifest("startup-roadmap", [
    ...PRESET_PARAMETERS["startup-roadmap"],
    { name: "deployToken", type: "secret", required: false },
  ]);
  try {
    PRESET_SEEDS["startup-roadmap"] = [
      { type: "Feature", title: "Deploy ${param:deployToken}", priority: "2", tags: "roadmap", body: "x" },
    ];
    const before = readFileSync(join(pmDir, "settings.json"), "utf8");
    await assert.rejects(
      () => h.runCommand({
        command: "presets apply",
        args: ["startup-roadmap"],
        options: { withSeeds: true, param: ["projectKey=acme", "deployToken=hunter2-secret"] },
        pmRoot: pmDir,
      }),
      /secret_in_public_prose/,
    );
    assert.equal(readFileSync(join(pmDir, "settings.json"), "utf8"), before);
    assert.equal(existsSync(join(pmDir, "templates")), false);
  } finally {
    PRESET_SEEDS["startup-roadmap"] = originalSeeds;
    restoreManifest("startup-roadmap", savedManifest);
  }
});

test("resolved values are retained: an injected resolution beats a changed params file", async (t) => {
  const { pmDir, root } = await workspace(t);
  const client = new Client({ pmRoot: pmDir, noExtensions: true });
  const paramsFile = join(root, "params.json");
  writeFileSync(paramsFile, '{"projectKey":"stale-file-value"}', "utf8");

  const options = { param: ["projectKey=acme"], paramsFile, force: true };
  const supplied = {
    values: { projectKey: "acme" },
    sources: { projectKey: "supplied" },
    unanswered: [],
  } as ResolvedParameterValues;
  const logs = await captureOutput(() =>
    applyPreset(
      context(pmDir, client, { ...options, resolvedParameterValues: supplied }),
      {
        label: "Startup roadmap",
        settings: ROADMAP_SETTINGS,
        templates: ROADMAP_TEMPLATES,
        parameters: ROADMAP_PARAMETERS,
        nextSteps: [],
      },
    ));
  const settings = await readSettings(pmDir);
  assert.equal(settings.id_prefix, "acme-", `the injected values must win over the params file: ${settings.id_prefix}`);
  assert.ok(logs.some((line) => line.includes("projectKey=acme (supplied)")));
  assert.ok(!logs.join("\n").includes("stale-file-value"));
});

test("the unified apply threads one resolution into seeds even when the params file changes", async (t) => {
  const h = await activatePresets();
  const { pmDir, root } = await workspace(t);
  const paramsFile = join(root, "params.json");
  writeFileSync(paramsFile, '{"projectKey":"acme"}', "utf8");
  const logs: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => logs.push(args.map(String).join(" ")));
  t.mock.method(console, "warn", () => {});

  await h.runCommand({
    command: "presets apply",
    args: ["startup-roadmap"],
    options: { withSeeds: true, force: true, paramsFile },
    pmRoot: pmDir,
  });
  const items = (await new Client({ pmRoot: pmDir, noExtensions: true }).listAllComplete()).items;
  assert.equal(items.length, 1);
  assert.ok(items[0].title.includes("acme"), `the seed must carry the single resolved value: ${items[0].title}`);
  const settings = await readSettings(pmDir);
  assert.equal(settings.id_prefix, "acme-");
  assert.ok(logs.some((line) => line.includes("projectKey=acme (supplied)")));
});

test("resolvePresetApplication refuses before any write and never re-reads input for seeds", async (t) => {
  const { pmDir, root } = await workspace(t);
  const client = new Client({ pmRoot: pmDir, noExtensions: true });
  const paramsFile = join(root, "params.json");
  writeFileSync(paramsFile, '{"projectKey":"acme","ghost":"1"}', "utf8");
  // Unknown parameter: the boundary refuses before the definition is even used.
  assert.throws(
    () => resolvePresetApplication(context(pmDir, client, { paramsFile, withSeeds: true })),
    /unknown_parameter/,
  );
  // A valid resolution carries the values and pre-validated seeds.
  writeFileSync(paramsFile, '{"projectKey":"acme"}', "utf8");
  const application = resolvePresetApplication(context(pmDir, client, { paramsFile, withSeeds: true }));
  assert.equal(application.parameters.values.projectKey, "acme");
  assert.equal(application.seeds?.length, 1);
  assert.ok(application.seeds?.[0].title.includes("acme"));
  // The threaded context carries exactly this resolution for the handler.
  const threaded = contextWithResolvedParameters(context(pmDir, client, { paramsFile, withSeeds: true }), application);
  assert.equal((threaded.options.resolvedParameterValues as ResolvedParameterValues).values.projectKey, "acme");
});

test("a stale apply lock is stolen; a held lock serializes settings and templates consistently", async (t) => {
  const { pmDir } = await workspace(t);
  const client = new Client({ pmRoot: pmDir, noExtensions: true });
  const locksDir = join(pmDir, "locks");
  const lockPath = join(locksDir, "pm-presets-apply.lock");

  // Stale lock: apply proceeds by stealing it.
  const { mkdirSync } = await import("node:fs");
  mkdirSync(locksDir, { recursive: true });
  writeFileSync(lockPath, "dead-owner-token", "utf8");
  const stale = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(lockPath, stale, stale);
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  await applyPreset(context(pmDir, client, { param: ["projectKey=acme"], force: true }), {
    label: "Startup roadmap",
    settings: ROADMAP_SETTINGS,
    templates: ROADMAP_TEMPLATES,
    parameters: ROADMAP_PARAMETERS,
    nextSteps: [],
  });
  assert.equal((await readSettings(pmDir)).id_prefix, "acme-");
  assert.equal(existsSync(lockPath), false, "the owner must release its lock");

  // Held lock: a real apply waits and then completes with consistent state.
  writeFileSync(lockPath, "foreign-owner-token", "utf8");
  const settingsPath = join(pmDir, "settings.json");
  const beforeHeld = readFileSync(settingsPath, "utf8");
  const pending = applyPreset(context(pmDir, client, { param: ["projectKey=second"], force: true }), {
    label: "Startup roadmap",
    settings: ROADMAP_SETTINGS,
    templates: ROADMAP_TEMPLATES,
    parameters: ROADMAP_PARAMETERS,
    nextSteps: [],
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(readFileSync(settingsPath, "utf8"), beforeHeld, "the apply must wait while the lock is held");
  rmSync(lockPath, { force: true });
  await pending;
  const settings = await readSettings(pmDir);
  assert.equal(settings.id_prefix, "second-");
  const initiative = JSON.parse(readFileSync(join(pmDir, "templates", "initiative.json"), "utf8")) as { options: { body: string } };
  assert.ok(initiative.options.body.includes("## Project\nsecond"), "settings and templates must describe the same invocation");
  assert.equal(existsSync(lockPath), false);

  // Vanished lock at release time: the owner completes and the best-effort
  // release tolerates the missing file.
  const third = applyPreset(context(pmDir, client, { param: ["projectKey=third"], force: true }), {
    label: "Startup roadmap",
    settings: ROADMAP_SETTINGS,
    templates: ROADMAP_TEMPLATES,
    parameters: ROADMAP_PARAMETERS,
    nextSteps: [],
  });
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      readFileSync(lockPath, "utf8");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  rmSync(lockPath, { force: true });
  await third;
  assert.equal((await readSettings(pmDir)).id_prefix, "third-");
  assert.equal(existsSync(lockPath), false, "a vanished lock leaves nothing to release");

  // Foreign lock at release time: an owner whose lock file was replaced
  // mid-run still completes, and must not delete the replacement owner's lock.
  const fourth = applyPreset(context(pmDir, client, { param: ["projectKey=fourth"], force: true }), {
    label: "Startup roadmap",
    settings: ROADMAP_SETTINGS,
    templates: ROADMAP_TEMPLATES,
    parameters: ROADMAP_PARAMETERS,
    nextSteps: [],
  });
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      readFileSync(lockPath, "utf8");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  writeFileSync(lockPath, "reaper-owner-token", "utf8");
  await fourth;
  assert.equal((await readSettings(pmDir)).id_prefix, "fourth-");
  assert.equal(readFileSync(lockPath, "utf8"), "reaper-owner-token", "the apply must not delete another owner's lock");
  rmSync(lockPath, { force: true });
  t.after(() => rmSync(lockPath, { force: true }));
});

test("concurrent parameterized applies stay fully consistent under the lock", async (t) => {
  const { pmDir } = await workspace(t);
  const client = new Client({ pmRoot: pmDir, noExtensions: true });
  const logs: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => logs.push(args.map(String).join(" ")));
  t.mock.method(console, "warn", () => {});
  const left = "left-team";
  const right = "right-team";
  const outcomes = await Promise.allSettled([
    applyPreset(context(pmDir, client, { param: ["projectKey=left-team"], force: true }), {
      label: "Startup roadmap", settings: ROADMAP_SETTINGS, templates: ROADMAP_TEMPLATES, parameters: ROADMAP_PARAMETERS, nextSteps: [],
    }),
    applyPreset(context(pmDir, client, { param: ["projectKey=right-team"], force: true }), {
      label: "Startup roadmap", settings: ROADMAP_SETTINGS, templates: ROADMAP_TEMPLATES, parameters: ROADMAP_PARAMETERS, nextSteps: [],
    }),
  ]);
  assert.ok(outcomes.every((outcome) => outcome.status === "fulfilled"), "serialized applies must both succeed");
  const settings = await readSettings(pmDir);
  const winner = settings.id_prefix === `${left}-` ? left : right;
  assert.ok(settings.id_prefix === `${left}-` || settings.id_prefix === `${right}-`);
  for (const name of ["initiative", "feature"]) {
    const template = JSON.parse(readFileSync(join(pmDir, "templates", `${name}.json`), "utf8")) as { options: { body: string } };
    assert.ok(
      template.options.body.includes(`## Project\n${winner}`),
      `template ${name} must describe the same invocation as the settings (${winner})`,
    );
    assert.ok(!template.options.body.includes("${param:"));
  }
});