/**
 * Tests for the pure diff computation. Run after `npm run build`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const catalog = await import("../dist/catalog.js");
const diff = await import("../dist/diff.js");
const { requirePresetDefinition } = catalog;
const { computePresetDiff } = diff;

test("empty workspace -> everything is an add / missing, not in sync", () => {
  const def = requirePresetDefinition("indie-dev");
  const result = computePresetDiff(def, { settings: undefined, templateNames: [] });
  assert.strictEqual(result.inSync, false);
  assert.ok(result.summary.settingsToAdd > 0);
  assert.strictEqual(result.summary.settingsToChange, 0);
  assert.deepStrictEqual(
    result.templates.missing.sort(),
    def.templates.map((t) => t.name).sort(),
  );
  assert.deepStrictEqual(result.templates.present, []);
  assert.ok(result.settings.every((e) => e.status === "add"));
});

test("workspace matching the preset settings -> those leaves report match", () => {
  const def = requirePresetDefinition("indie-dev");
  const snapshot = {
    settings: def.settings as unknown as Record<string, unknown>,
    templateNames: def.templates.map((t) => t.name),
  };
  const result = computePresetDiff(def, snapshot);
  assert.strictEqual(result.summary.settingsToAdd, 0);
  assert.strictEqual(result.summary.settingsToChange, 0);
  assert.strictEqual(result.summary.templatesMissing, 0);
  assert.strictEqual(result.inSync, true);
  assert.ok(result.settings.every((e) => e.status === "match"));
});

test("a differing leaf is reported as change with both values", () => {
  const def = requirePresetDefinition("software-sprint");
  const result = computePresetDiff(def, {
    settings: { id_prefix: "other-" },
    templateNames: [],
  });
  const prefixEntry = result.settings.find((e) => e.path === "id_prefix");
  assert.ok(prefixEntry);
  assert.strictEqual(prefixEntry.status, "change");
  assert.strictEqual(prefixEntry.workspace, "other-");
  assert.strictEqual(prefixEntry.preset, "sprint-");
  assert.strictEqual(result.summary.settingsToChange, 1);
});

test("nested settings paths are flattened with dotted keys", () => {
  const def = requirePresetDefinition("bug-triage");
  const result = computePresetDiff(def, { settings: {}, templateNames: [] });
  assert.ok(result.settings.some((e) => e.path === "governance.preset"));
  assert.ok(result.settings.some((e) => e.path === "validation.metadata_profile"));
});

test("partially-applied workspace lists present and missing templates", () => {
  const def = requirePresetDefinition("software-sprint");
  const [first] = def.templates;
  const result = computePresetDiff(def, {
    settings: undefined,
    templateNames: [first.name],
  });
  assert.deepStrictEqual(result.templates.present, [first.name]);
  assert.ok(!result.templates.missing.includes(first.name));
});
