/**
 * Tests for the read-only catalog views: list rows, show lookup, validation.
 * Run after `npm run build` (imports from dist/).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const catalog = await import("../dist/catalog.js");
const {
  listPresetDefinitions,
  findPresetDefinition,
  requirePresetDefinition,
  buildListRows,
  validateAllPresets,
} = catalog;

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
  assert.ok(run?.options.some((o) => o.key === "status"));
  assert.ok(run?.options.some((o) => o.key === "mode"));
  assert.ok(run?.options.some((o) => o.key === "model"));
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
