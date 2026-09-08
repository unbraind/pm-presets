/**
 * Tests for the pure preset-export builder. Imports the TypeScript sources
 * directly so coverage is measured on the lines an author edits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildExportedPreset, readWorkspaceSettings, readWorkspaceTemplates } from "../src/export.ts";

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

test("buildExportedPreset stamps exportedAt from the clock when now is omitted", () => {
  const before = Date.now();
  const result = buildExportedPreset({
    name: "clock",
    settings: { id_prefix: 12 },
    templates: [],
  });
  const after = Date.now();
  const stamped = Date.parse(result.meta.exportedAt);
  assert.ok(stamped >= before - 1000 && stamped <= after + 1000);
  assert.strictEqual(result.idPrefix, "");
});

test("readWorkspaceSettings returns undefined for missing, unreadable, or non-object files", (t) => {
  const pmDir = mkdtempSync(join(tmpdir(), "pm-presets-settings-"));
  t.after(() => rmSync(pmDir, { recursive: true, force: true }));
  assert.equal(readWorkspaceSettings(pmDir), undefined);

  writeFileSync(join(pmDir, "settings.json"), "{not json");
  assert.equal(readWorkspaceSettings(pmDir), undefined);

  writeFileSync(join(pmDir, "settings.json"), "[]\n");
  assert.equal(readWorkspaceSettings(pmDir), undefined);

  writeFileSync(join(pmDir, "settings.json"), '{"id_prefix":"x-"}\n');
  assert.deepStrictEqual(readWorkspaceSettings(pmDir), { id_prefix: "x-" });
});

test("readWorkspaceTemplates skips junk and recovers names from files", (t) => {
  const pmDir = mkdtempSync(join(tmpdir(), "pm-presets-templates-"));
  t.after(() => rmSync(pmDir, { recursive: true, force: true }));
  assert.deepStrictEqual(readWorkspaceTemplates(pmDir), []);

  const templatesDir = join(pmDir, "templates");
  mkdirSync(templatesDir);
  writeFileSync(join(templatesDir, "notes.txt"), "ignore");
  writeFileSync(join(templatesDir, "broken.json"), "{not json");
  writeFileSync(join(templatesDir, "list.json"), "[]\n");
  writeFileSync(join(templatesDir, "unnamed.json"), "{\"options\":{\"type\":\"Task\"}}\n");
  writeFileSync(join(templatesDir, "blank-name.json"), "{\"name\":\"  \",\"options\":[]}\n");
  writeFileSync(
    join(templatesDir, "named.json"),
    '{"name":"named","options":{"type":"Issue","tags":["a"]}}\n',
  );

  const templates = readWorkspaceTemplates(pmDir).sort((left, right) => left.name.localeCompare(right.name));
  assert.deepStrictEqual(
    templates.map((template) => template.name),
    ["blank-name", "named", "unnamed"],
  );
  const named = templates.find((template) => template.name === "named");
  assert.deepStrictEqual(named?.options, { type: "Issue", tags: ["a"] });
  const unnamed = templates.find((template) => template.name === "unnamed");
  assert.deepStrictEqual(unnamed?.options, { type: "Task" });
  const blank = templates.find((template) => template.name === "blank-name");
  assert.deepStrictEqual(blank?.options, {});
});
