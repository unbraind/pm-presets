/**
 * Behavioural tests for shared option helpers, applyPreset, and template commands.
 * Imports the TypeScript sources directly so coverage is measured on the lines
 * an author edits.
 */

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";

import {
  runAgentWorkflowSetup,
  runBugTriageSetup,
  runIndieDevSetup,
  runKanbanSetup,
  runOpenSourceSetup,
  runSoftwareSprintSetup,
  runStartupRoadmapSetup,
} from "../src/registry.ts";
import {
  CommandError,
  EXIT_CODE,
  applyPreset,
  normalizeTemplateName,
  readBooleanOption,
  readStringOption,
  resolvePmDir,
  runTemplatesList,
  runTemplatesShow,
  storedTemplate,
} from "../src/presets/shared.ts";

/** Create an initialized temp pm root and delete it after the test. */
function workspace(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "pm-presets-shared-"));
  const pmDir = join(root, ".agents", "pm");
  mkdirSync(pmDir, { recursive: true });
  writeFileSync(join(pmDir, "settings.json"), "{}\n");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return pmDir;
}

/** Build a command context pointed at `pmDir`, with optional field overrides. */
function context(
  pmDir: string,
  overrides: Partial<CommandHandlerContext> = {},
): CommandHandlerContext {
  return {
    command: "test",
    args: [],
    options: {},
    global: { json: true, quiet: true, noPager: true },
    pm_root: pmDir,
    ...overrides,
  };
}

test("resolvePmDir prefers pm_root and falls back to the conventional layout", () => {
  const resolved = resolvePmDir(context("/tmp/explicit-pm"));
  assert.ok(resolved.endsWith("explicit-pm"));
  const fallback = resolvePmDir(context("   ", { pm_root: "   " }));
  assert.strictEqual(fallback, join(process.cwd(), ".agents", "pm"));
  const missing = resolvePmDir({
    command: "test",
    args: [],
    options: {},
    global: { json: true, quiet: true, noPager: true },
    pm_root: "",
  });
  assert.strictEqual(missing, join(process.cwd(), ".agents", "pm"));
});

test("readBooleanOption and readStringOption tolerate camelCase, kebab-case, and stringly values", () => {
  assert.equal(readBooleanOption({}, "force"), false);
  assert.equal(readBooleanOption({ force: null, "dry-run": true }, "force", "dry-run"), true);
  assert.equal(readBooleanOption({ force: "true" }, "force"), true);
  assert.equal(readBooleanOption({ force: "1" }, "force"), true);
  assert.equal(readBooleanOption({ force: "yes" }, "force"), false);
  assert.equal(readBooleanOption({ force: undefined, extra: true }, "force"), false);
  assert.equal(readStringOption({ prefix: "  ab  " }, "prefix"), "ab");
  assert.equal(readStringOption({ prefix: "   ", "id-prefix": "x-" }, "prefix", "id-prefix"), "x-");
  assert.equal(readStringOption({ prefix: 1 }, "prefix"), undefined);
  assert.equal(readStringOption({}, "prefix"), undefined);
});

test("normalizeTemplateName rejects names outside the on-disk grammar", () => {
  assert.strictEqual(normalizeTemplateName(" idea "), "idea");
  try {
    normalizeTemplateName("bad name");
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof CommandError);
    assert.strictEqual(error.exitCode, EXIT_CODE.USAGE);
    assert.match(error.message, /Invalid template name "bad name"/);
  }
});

test("CommandError defaults to GENERIC_FAILURE", () => {
  const error = new CommandError("boom");
  assert.strictEqual(error.exitCode, EXIT_CODE.GENERIC_FAILURE);
  assert.strictEqual(error.name, "CommandError");
});

test("applyPreset refuses an uninitialized workspace", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pm-presets-missing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  try {
    applyPreset(context(join(root, ".agents", "pm")), {
      label: "Indie dev",
      settings: { id_prefix: "indie-" },
      templates: {},
      nextSteps: [],
    });
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof CommandError);
    assert.strictEqual(error.exitCode, EXIT_CODE.NOT_FOUND);
    assert.match(error.message, /pm workspace not found/);
  }
});

test("applyPreset dry-run previews merge output without writing templates", (t) => {
  const pmDir = workspace(t);
  const lines: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  applyPreset(context(pmDir, { options: { dryRun: true, prefix: "tmp-" } }), {
    label: "Indie dev",
    settings: { id_prefix: "indie-", governance: { preset: "minimal" } },
    templates: { "idea.json": storedTemplate("idea", { type: "Decision" }) },
    nextSteps: ["pm list"],
  });
  const settings = readFileSync(join(pmDir, "settings.json"), "utf8");
  assert.strictEqual(settings.trim(), "{}");
  assert.ok(lines.some((line) => line.includes("[dry-run] Would merge Indie dev settings")));
  assert.ok(lines.some((line) => line.includes('"id_prefix": "tmp-"')));
  assert.ok(lines.some((line) => line.includes("[dry-run] Would write template:")));
  assert.ok(lines.some((line) => line.includes("Indie dev preset applied. Next steps:")));
});

test("applyPreset replace mode and force overwrite, and skips without force", (t) => {
  const pmDir = workspace(t);
  writeFileSync(
    join(pmDir, "settings.json"),
    JSON.stringify({ governance: { preset: "default", leftover: true }, testing: { record_results_to_items: false } }, null, 2),
  );
  const warns: string[] = [];
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", (...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  });

  applyPreset(context(pmDir, { options: { replace: true } }), {
    label: "Indie dev",
    settings: { id_prefix: "indie-", governance: { preset: "minimal" } },
    templates: { "idea.json": storedTemplate("idea", { type: "Decision" }) },
    nextSteps: ["first"],
  });
  const afterReplace = JSON.parse(readFileSync(join(pmDir, "settings.json"), "utf8")) as {
    governance?: { leftover?: boolean; preset?: string };
    testing?: unknown;
  };
  assert.deepStrictEqual(afterReplace.governance, { preset: "minimal" });
  assert.equal(afterReplace.testing, undefined);

  applyPreset(context(pmDir), {
    label: "Indie dev",
    settings: { id_prefix: "indie-" },
    templates: { "idea.json": storedTemplate("idea", { type: "Decision", priority: "9" }) },
    nextSteps: [],
  });
  assert.ok(warns.some((line) => line.includes("Skipped existing template")));
  const skipped = JSON.parse(readFileSync(join(pmDir, "templates", "idea.json"), "utf8")) as {
    options: { priority?: string };
  };
  assert.notEqual(skipped.options.priority, "9");

  applyPreset(context(pmDir, { options: { force: true } }), {
    label: "Indie dev",
    settings: { id_prefix: "indie-" },
    templates: { "idea.json": storedTemplate("idea", { type: "Decision", priority: "9" }) },
    nextSteps: [],
    warning: "Strict governance is active.",
  });
  const overwritten = JSON.parse(readFileSync(join(pmDir, "templates", "idea.json"), "utf8")) as {
    options: { priority?: string };
  };
  assert.strictEqual(overwritten.options.priority, "9");
  assert.ok(warns.some((line) => line.includes("Strict governance is active.")));
});

test("applyPreset rejects a template map key that does not match the document name", (t) => {
  const pmDir = workspace(t);
  assert.throws(
    () =>
      applyPreset(context(pmDir), {
        label: "Broken",
        settings: { id_prefix: "x-" },
        templates: { "other.json": storedTemplate("idea", { type: "Task" }) },
        nextSteps: [],
      }),
    /Template map key "other.json" must match document name "idea"/,
  );
});

test("applyPreset reports unreadable and non-object settings.json", (t) => {
  const pmDir = workspace(t);
  writeFileSync(join(pmDir, "settings.json"), "{not json");
  try {
    applyPreset(context(pmDir), {
      label: "Indie dev",
      settings: { id_prefix: "indie-" },
      templates: {},
      nextSteps: [],
    });
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof CommandError);
    assert.match(error.message, /Failed to read settings.json/);
  }

  writeFileSync(join(pmDir, "settings.json"), "[1]\n");
  try {
    applyPreset(context(pmDir), {
      label: "Indie dev",
      settings: { id_prefix: "indie-" },
      templates: {},
      nextSteps: [],
    });
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof CommandError);
    assert.match(error.message, /settings.json must contain a JSON object/);
  }
});

test("every bundled setup handler writes its id_prefix", (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  const handlers: Array<{ idPrefix: string; run: (ctx: CommandHandlerContext) => void }> = [
    { idPrefix: "bug-", run: runBugTriageSetup },
    { idPrefix: "indie-", run: runIndieDevSetup },
    { idPrefix: "oss-", run: runOpenSourceSetup },
    { idPrefix: "sprint-", run: runSoftwareSprintSetup },
    { idPrefix: "road-", run: runStartupRoadmapSetup },
    { idPrefix: "kan-", run: runKanbanSetup },
    { idPrefix: "agent-", run: runAgentWorkflowSetup },
  ];
  for (const handler of handlers) {
    const pmDir = workspace(t);
    handler.run(context(pmDir));
    const settings = JSON.parse(readFileSync(join(pmDir, "settings.json"), "utf8")) as {
      id_prefix: string;
    };
    assert.strictEqual(settings.id_prefix, handler.idPrefix);
  }
});

test("runTemplatesList shadows builtins with user files and ignores stray names", (t) => {
  const pmDir = workspace(t);
  mkdirSync(join(pmDir, "templates"));
  writeFileSync(join(pmDir, "templates", "zebra.json"), "{\"name\":\"zebra\",\"options\":{}}\n");
  writeFileSync(join(pmDir, "templates", "bug.json"), "{\"name\":\"bug\",\"options\":{}}\n");
  writeFileSync(join(pmDir, "templates", "notes.txt"), "ignore");
  writeFileSync(join(pmDir, "templates", "not valid.json"), "{}\n");
  const result = runTemplatesList(context(pmDir));
  assert.deepStrictEqual(result.user_templates, ["bug", "zebra"]);
  assert.ok(!result.builtin_templates.includes("bug"));
  assert.ok(result.builtin_templates.includes("feature"));
  assert.ok(result.templates.includes("bug"));
  assert.ok(!result.templates.includes("not valid"));
});

test("runTemplatesList requires an initialized tracker and tolerates a missing templates directory", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pm-presets-uninit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  try {
    runTemplatesList(context(join(root, ".agents", "pm")));
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof CommandError);
    assert.strictEqual(error.exitCode, EXIT_CODE.NOT_FOUND);
  }

  const pmDir = workspace(t);
  const listed = runTemplatesList(context(pmDir));
  assert.ok(listed.builtin_templates.includes("spike"));
  assert.deepStrictEqual(listed.user_templates, []);
});

test("runTemplatesShow prefers user files, then builtins, and rejects bad input", (t) => {
  const pmDir = workspace(t);
  try {
    runTemplatesShow(context(pmDir, { args: [] }));
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof CommandError);
    assert.strictEqual(error.exitCode, EXIT_CODE.USAGE);
  }
  try {
    runTemplatesShow(context(pmDir, { args: ["   "] }));
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof CommandError);
    assert.strictEqual(error.exitCode, EXIT_CODE.USAGE);
  }

  const builtin = runTemplatesShow(context(pmDir, { args: ["feature"] }));
  assert.strictEqual(builtin.source, "builtin");
  assert.strictEqual(builtin.path, "builtin:feature");
  assert.strictEqual(builtin.options.type, "Feature");

  mkdirSync(join(pmDir, "templates"));
  writeFileSync(
    join(pmDir, "templates", "feature.json"),
    JSON.stringify({
      name: "feature",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      options: { type: "Feature", tags: ["user"] },
    }),
  );
  const user = runTemplatesShow(context(pmDir, { args: ["feature"] }));
  assert.strictEqual(user.source, "user");
  assert.deepStrictEqual(user.options.tags, ["user"]);
  assert.strictEqual(user.created_at, "2026-01-01T00:00:00.000Z");

  try {
    runTemplatesShow(context(pmDir, { args: ["missing-template"] }));
    assert.fail("expected throw");
  } catch (error) {
    assert.ok(error instanceof CommandError);
    assert.strictEqual(error.exitCode, EXIT_CODE.NOT_FOUND);
  }
});

test("runTemplatesShow recovers incomplete documents and rejects invalid ones", (t) => {
  const pmDir = workspace(t);
  mkdirSync(join(pmDir, "templates"));

  writeFileSync(join(pmDir, "templates", "bare.json"), "{\"options\":{\"type\":\"Task\",\"tags\":[\"a\"]}}\n");
  const bare = runTemplatesShow(context(pmDir, { args: ["bare"] }));
  assert.strictEqual(bare.name, "bare");
  assert.strictEqual(bare.created_at, "1970-01-01T00:00:00.000Z");
  assert.deepStrictEqual(bare.options.tags, ["a"]);

  writeFileSync(join(pmDir, "templates", "badjson.json"), "{not json");
  assert.throws(() => runTemplatesShow(context(pmDir, { args: ["badjson"] })), /invalid JSON/);

  writeFileSync(join(pmDir, "templates", "array.json"), "[1]\n");
  assert.throws(() => runTemplatesShow(context(pmDir, { args: ["array"] })), /invalid document shape/);

  writeFileSync(join(pmDir, "templates", "noopts.json"), "{\"name\":\"noopts\"}\n");
  assert.throws(() => runTemplatesShow(context(pmDir, { args: ["noopts"] })), /invalid options payload/);

  writeFileSync(join(pmDir, "templates", "emptykey.json"), "{\"name\":\"emptykey\",\"options\":{\"\":\"x\"}}\n");
  assert.throws(() => runTemplatesShow(context(pmDir, { args: ["emptykey"] })), /empty option key/);

  writeFileSync(join(pmDir, "templates", "badval.json"), "{\"name\":\"badval\",\"options\":{\"type\":1}}\n");
  assert.throws(() => runTemplatesShow(context(pmDir, { args: ["badval"] })), /invalid value for option "type"/);
});
