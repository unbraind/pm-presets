/**
 * Tests for the read-only catalog views: list rows, show lookup, validation.
 * Imports the TypeScript sources directly so coverage is measured on the
 * lines an author edits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  listPresetDefinitions,
  findPresetDefinition,
  requirePresetDefinition,
  buildListRows,
  validateAllPresets,
  collectPresetIssues,
  requireValidPresets,
  projectTemplateView,
  projectItemTypeViews,
} from "../src/catalog.ts";
import type { StoredCreateTemplateDocument } from "../src/presets/shared.ts";

test("listPresetDefinitions returns all 7 presets with structured fields", () => {
  const defs = listPresetDefinitions();
  assert.strictEqual(defs.length, 7);
  for (const def of defs) {
    assert.ok(def.id.length > 0);
    assert.ok(def.settings && typeof def.settings === "object");
    assert.ok(Array.isArray(def.templates) && def.templates.length > 0);
    for (const tpl of def.templates) {
      assert.ok(tpl.name.length > 0);
      assert.ok(tpl.type.length > 0);
      assert.ok(Array.isArray(tpl.optionKeys));
    }
  }
});

test("findPresetDefinition is case-insensitive and trims", () => {
  assert.ok(findPresetDefinition("Software-Sprint"));
  assert.ok(findPresetDefinition("  kanban  "));
  assert.strictEqual(findPresetDefinition("does-not-exist"), undefined);
  assert.strictEqual(findPresetDefinition(""), undefined);
  assert.strictEqual(findPresetDefinition(undefined), undefined);
});

test("requirePresetDefinition throws NOT_FOUND (exit 3) for unknown name", () => {
  try {
    requirePresetDefinition("nope");
    assert.fail("expected throw");
  } catch (error) {
    assert.strictEqual((error as { exitCode?: number }).exitCode, 3);
    assert.match((error as Error).message, /Unknown preset/);
  }
});

test("kanban definition exposes its custom item type", () => {
  const kanban = requirePresetDefinition("kanban");
  assert.ok(kanban.itemTypes.some((t) => t.name === "Card"));
  const card = kanban.itemTypes.find((t) => t.name === "Card");
  assert.ok(card?.options.some((o) => o.key === "column"));
});

test("non-kanban presets register no custom item types", () => {
  const sprint = requirePresetDefinition("software-sprint");
  assert.strictEqual(sprint.itemTypes.length, 0);
});

test("buildListRows enriches each row with item types and template counts", () => {
  const rows = buildListRows();
  assert.strictEqual(rows.length, 7);
  const sprint = rows.find((r) => r.id === "software-sprint");
  assert.ok(sprint);
  assert.strictEqual(sprint.templateCount, 4);
  assert.ok(sprint.itemTypes.includes("Epic"));
  assert.deepStrictEqual(sprint.customItemTypes, []);
  const kanban = rows.find((r) => r.id === "kanban");
  assert.deepStrictEqual(kanban?.customItemTypes, ["Card"]);
});

test("validateAllPresets reports all bundled presets as valid", () => {
  const result = validateAllPresets();
  assert.strictEqual(result.checked, 7);
  assert.strictEqual(result.ok, true, JSON.stringify(result.issues));
  assert.strictEqual(result.issues.length, 0);
});

test("agent-workflow definition exposes its custom AgentRun item type", () => {
  const def = requirePresetDefinition("agent-workflow");
  assert.ok(def.itemTypes.some((t) => t.name === "AgentRun"));
  const run = def.itemTypes.find((t) => t.name === "AgentRun");
  assert.ok(run?.options.some((o) => o.key === "phase"));
  assert.ok(run?.options.some((o) => o.key === "mode"));
  assert.ok(run?.options.some((o) => o.key === "model"));
});

test("projectTemplateView defaults a missing or non-string type to Task", () => {
  const base = {
    name: "orphan",
    created_at: "1970-01-01T00:00:00.000Z",
    updated_at: "1970-01-01T00:00:00.000Z",
  };
  assert.strictEqual(
    projectTemplateView({ ...base, options: { priority: "1" } }).type,
    "Task",
  );
  assert.strictEqual(
    projectTemplateView({ ...base, options: { type: ["Issue"] } }).type,
    "Task",
  );
  assert.strictEqual(
    projectTemplateView({ ...base, options: { type: "Issue", priority: "1" } }).type,
    "Issue",
  );
});

test("projectItemTypeViews copies arrays and fills in missing schema pieces", () => {
  assert.deepStrictEqual(projectItemTypeViews(undefined), []);
  assert.deepStrictEqual(projectItemTypeViews([]), []);
  const views = projectItemTypeViews([
    { name: "Card" },
    { name: "Run", aliases: "agent", options: { key: "phase" } },
    {
      name: "Typed",
      aliases: ["typed"],
      options: [{ key: "phase" }, { key: "mode", values: ["auto"] }],
    },
  ] as Parameters<typeof projectItemTypeViews>[0]);
  assert.deepStrictEqual(views[0], { name: "Card", aliases: [], options: [] });
  assert.deepStrictEqual(views[1], { name: "Run", aliases: [], options: [] });
  assert.deepStrictEqual(views[2], {
    name: "Typed",
    aliases: ["typed"],
    options: [
      { key: "phase", values: [] },
      { key: "mode", values: ["auto"] },
    ],
  });
  views[2].aliases.push("mutated");
  assert.deepStrictEqual(
    projectItemTypeViews([
      {
        name: "Typed",
        aliases: ["typed"],
        options: [{ key: "mode", values: ["auto"] }],
      },
    ])[0].aliases,
    ["typed"],
  );
});

test("collectPresetIssues reports every malformed-preset class", () => {
  const stored = (name: string, options: StoredCreateTemplateDocument["options"]): StoredCreateTemplateDocument => ({
    name,
    created_at: "1970-01-01T00:00:00.000Z",
    updated_at: "1970-01-01T00:00:00.000Z",
    options,
  });
  const issues = collectPresetIssues(
    {
      id: "broken",
      governance: "unknown",
      idPrefix: "",
      settings: { id_prefix: 1 },
      templates: [],
    },
    {
      "other.json": stored("bad name", {
        "": "x",
        "  ": "y",
        type: "Task",
        tags: [1, 2] as unknown as string[],
        ok: ["a"],
      }),
    },
  );
  const messages = issues.map((issue) => issue.message);
  assert.ok(messages.includes("invalid governance 'unknown'"));
  assert.ok(messages.includes("missing id_prefix"));
  assert.ok(messages.includes("settings patch is missing id_prefix"));
  assert.ok(messages.includes("has no templates"));
  assert.ok(messages.some((message) => message.includes("template name 'bad name' is invalid")));
  assert.ok(messages.some((message) => message.includes("does not match document name")));
  assert.ok(messages.some((message) => message.includes("empty option key")));
  assert.ok(messages.some((message) => message.includes("option 'tags' has a non-string value")));
});

test("collectPresetIssues flags advertised template drift and a missing settings prefix", () => {
  const issues = collectPresetIssues(
    {
      id: "drift",
      governance: "strict",
      idPrefix: 12,
      settings: {},
      templates: [{ name: "task" }],
    },
    {
      "task.json": {
        name: "task",
        created_at: "1970-01-01T00:00:00.000Z",
        updated_at: "1970-01-01T00:00:00.000Z",
        options: { type: "Task" },
      },
    },
    ["other"],
  );
  const messages = issues.map((issue) => issue.message);
  assert.ok(messages.includes("missing id_prefix"));
  assert.ok(messages.includes("settings patch is missing id_prefix"));
  assert.ok(
    messages.includes("registry templates [other] differ from exported [task]"),
  );
});

test("requireValidPresets throws a formatted CommandError and returns a clean result", () => {
  const clean = requireValidPresets({ ok: true, checked: 7, issues: [] });
  assert.strictEqual(clean.ok, true);
  try {
    requireValidPresets({
      ok: false,
      checked: 2,
      issues: [
        { presetId: "a", message: "missing id_prefix" },
        { presetId: "b", message: "has no templates" },
      ],
    });
    assert.fail("expected throw");
  } catch (error) {
    assert.strictEqual((error as { exitCode?: number }).exitCode, 1);
    assert.match((error as Error).message, /2 preset validation issue\(s\) across 2 preset\(s\)/);
    assert.match((error as Error).message, /a: missing id_prefix/);
    assert.match((error as Error).message, /b: has no templates/);
  }
});

test("agent-workflow list row reports the AgentRun custom item type and 3 templates", () => {
  const rows = buildListRows();
  const agent = rows.find((r) => r.id === "agent-workflow");
  assert.ok(agent);
  assert.strictEqual(agent.templateCount, 3);
  assert.deepStrictEqual(agent.customItemTypes, ["AgentRun"]);
  assert.ok(agent.templates.includes("agent-task"));
  assert.ok(agent.templates.includes("prompt-experiment"));
  assert.ok(agent.templates.includes("eval-run"));
});
