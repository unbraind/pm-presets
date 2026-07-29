/**
 * Tests for the pure preset-export builder. Imports the TypeScript sources
 * directly so coverage is measured on the lines an author edits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildExportedPreset } from "../src/export.ts";

const NOW = new Date("2026-06-04T00:00:00.000Z");

test("buildExportedPreset captures settings + templates in a stable shape", () => {
  const result = buildExportedPreset({
    name: "our-config",
    settings: {
      id_prefix: "our-",
      governance: { preset: "strict" },
      testing: { record_results_to_items: true },
    },
    templates: [
      { name: "bug", options: { type: "Issue", priority: "1" } },
      { name: "task", options: { type: "Task" } },
    ],
    now: NOW,
  });

  assert.strictEqual(result.$schema, "pm-presets/exported-preset@1");
  assert.strictEqual(result.id, "our-config");
  assert.strictEqual(result.displayName, "our-config");
  assert.strictEqual(result.idPrefix, "our-");
  assert.deepStrictEqual(result.settings, {
    id_prefix: "our-",
    governance: { preset: "strict" },
    testing: { record_results_to_items: true },
  });
  assert.strictEqual(result.templates.length, 2);
  assert.strictEqual(result.meta.exportedAt, "2026-06-04T00:00:00.000Z");
  assert.match(result.meta.note, /#97/);
});

test("buildExportedPreset honors an explicit display name", () => {
  const result = buildExportedPreset({
    name: "team",
    displayName: "Team Config",
    settings: { id_prefix: "t-" },
    templates: [],
    now: NOW,
  });
  assert.strictEqual(result.displayName, "Team Config");
});

test("buildExportedPreset sorts templates by name", () => {
  const result = buildExportedPreset({
    name: "x",
    settings: { id_prefix: "x-" },
    templates: [
      { name: "zebra", options: {} },
      { name: "alpha", options: {} },
      { name: "mango", options: {} },
    ],
    now: NOW,
  });
  assert.deepStrictEqual(
    result.templates.map((t) => t.name),
    ["alpha", "mango", "zebra"],
  );
});

test("buildExportedPreset tolerates missing settings and missing id_prefix", () => {
  const result = buildExportedPreset({
    name: "empty",
    settings: undefined,
    templates: [],
    now: NOW,
  });
  assert.deepStrictEqual(result.settings, {});
  assert.strictEqual(result.idPrefix, "");
});
