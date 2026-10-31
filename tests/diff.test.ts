/**
 * Tests for the pure diff computation. Imports the TypeScript sources directly
 * so coverage is measured on the lines an author edits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { requirePresetDefinition } from "../src/catalog.ts";
import { computePresetDiff, readWorkspaceSnapshot } from "../src/diff.ts";

test("kanban diff lists the custom Card item type", async () => {
  const def = requirePresetDefinition("kanban");
  const result = await computePresetDiff(def, { settings: undefined, templateNames: [] });
  assert.deepStrictEqual(result.itemTypes, ["Card"]);
});

test("empty workspace -> everything is an add / missing, not in sync", async () => {
  const def = requirePresetDefinition("indie-dev");
  const result = await computePresetDiff(def, { settings: undefined, templateNames: [] });
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

test("workspace matching the preset settings -> those leaves report match", async () => {
  const def = requirePresetDefinition("indie-dev");
  const snapshot = {
    settings: def.settings as unknown as Record<string, unknown>,
    templateNames: def.templates.map((t) => t.name),
    templateDocuments: def.templateDocuments,
  };
  const result = await computePresetDiff(def, snapshot);
  assert.strictEqual(result.summary.settingsToAdd, 0);
  assert.strictEqual(result.summary.settingsToChange, 0);
  assert.strictEqual(result.summary.templatesMissing, 0);
  assert.strictEqual(result.inSync, true);
  assert.ok(result.settings.every((e) => e.status === "match"));
});

test("a differing leaf is reported as change with both values", async () => {
  const def = requirePresetDefinition("software-sprint");
  const result = await computePresetDiff(def, {
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

test("nested settings paths are flattened with dotted keys", async () => {
  const def = requirePresetDefinition("bug-triage");
  const result = await computePresetDiff(def, { settings: {}, templateNames: [] });
  assert.ok(result.settings.some((e) => e.path === "governance.preset"));
  assert.ok(result.settings.some((e) => e.path === "validation.metadata_profile"));
});

test("readWorkspaceSnapshot reads settings and template names from disk", async (t) => {
  const pmDir = mkdtempSync(join(tmpdir(), "pm-presets-diff-snap-"));
  t.after(() => rmSync(pmDir, { recursive: true, force: true }));

  const empty = await readWorkspaceSnapshot(pmDir);
  assert.equal(empty.settings, undefined);
  assert.deepStrictEqual(empty.templateNames, []);

  writeFileSync(join(pmDir, "settings.json"), "{not json");
  assert.equal((await readWorkspaceSnapshot(pmDir)).settings, undefined);

  writeFileSync(join(pmDir, "settings.json"), "[1]\n");
  assert.equal((await readWorkspaceSnapshot(pmDir)).settings, undefined);

  writeFileSync(join(pmDir, "settings.json"), '{"id_prefix":"snap-"}\n');
  mkdirSync(join(pmDir, "templates"));
  writeFileSync(join(pmDir, "templates", "idea.json"), "{}");
  writeFileSync(join(pmDir, "templates", "README.JSON"), "{}");
  writeFileSync(join(pmDir, "templates", "notes.txt"), "ignore");
  const snapshot = await readWorkspaceSnapshot(pmDir);
  assert.deepStrictEqual(snapshot.settings, { id_prefix: "snap-" });
  assert.deepStrictEqual([...snapshot.templateNames].sort(), ["README", "idea"]);
});

test("partially-applied workspace lists present and missing templates", async () => {
  const def = requirePresetDefinition("software-sprint");
  const [first] = def.templates;
  const result = await computePresetDiff(def, {
    settings: undefined,
    templateNames: [first.name],
  });
  assert.deepStrictEqual(result.templates.present, [first.name]);
  assert.ok(!result.templates.missing.includes(first.name));
});
