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

test("listPresetDefinitions returns all 6 presets with structured fields", () => {
  const defs = listPresetDefinitions();
  assert.strictEqual(defs.length, 6);
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
  assert.strictEqual(rows.length, 6);
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
  assert.strictEqual(result.checked, 6);
  assert.strictEqual(result.ok, true, JSON.stringify(result.issues));
  assert.strictEqual(result.issues.length, 0);
});
