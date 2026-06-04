/**
 * Tests for mergePresetSettings: deep-merge (default) vs --replace behavior
 * on the governance/validation/testing trees. Run after `npm run build`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const shared = await import("../dist/presets/shared.js");
const { mergePresetSettings } = shared;

const existing = {
  id_prefix: "old-",
  // A key the preset does NOT set inside governance — merge must keep it,
  // replace must drop it.
  governance: { preset: "default", legacy_only: true },
  // An unrelated top-level key the preset never touches — both modes keep it.
  telemetry: { enabled: false },
  testing: { record_results_to_items: false, custom_extra: 1 },
};

const patch = {
  id_prefix: "new-",
  governance: { preset: "strict", ownership_enforcement: "strict" },
  validation: { sprint_release_format: "strict_error" },
  testing: { record_results_to_items: true },
};

test("default (merge) layers preset keys and preserves unrelated subkeys", () => {
  const merged = mergePresetSettings(existing, patch, false);
  // governance is deep-merged: legacy_only survives, preset upgraded
  assert.deepStrictEqual(merged.governance, {
    preset: "strict",
    ownership_enforcement: "strict",
    legacy_only: true,
  });
  // testing deep-merged: custom_extra survives
  assert.deepStrictEqual(merged.testing, {
    record_results_to_items: true,
    custom_extra: 1,
  });
  assert.strictEqual(merged.id_prefix, "new-");
  assert.deepStrictEqual(merged.telemetry, { enabled: false });
});

test("--replace swaps owned trees wholesale (drops keys preset omits)", () => {
  const replaced = mergePresetSettings(existing, patch, true);
  // governance fully replaced: legacy_only is GONE
  assert.deepStrictEqual(replaced.governance, {
    preset: "strict",
    ownership_enforcement: "strict",
  });
  // testing fully replaced: custom_extra is GONE
  assert.deepStrictEqual(replaced.testing, { record_results_to_items: true });
  // validation set by the preset
  assert.deepStrictEqual(replaced.validation, { sprint_release_format: "strict_error" });
  // unrelated top-level key preserved in BOTH modes
  assert.deepStrictEqual(replaced.telemetry, { enabled: false });
  assert.strictEqual(replaced.id_prefix, "new-");
});

test("--replace removes an owned tree the preset does not set", () => {
  const base = { governance: { preset: "default" }, testing: { record_results_to_items: false } };
  // Patch sets only governance; testing should be removed under replace.
  const patchNoTesting = { id_prefix: "p-", governance: { preset: "minimal" } };
  const replaced = mergePresetSettings(base, patchNoTesting, true);
  assert.deepStrictEqual(replaced.governance, { preset: "minimal" });
  assert.ok(!Object.prototype.hasOwnProperty.call(replaced, "testing"));
});

test("merge and replace agree when the preset sets every owned subkey", () => {
  const base = { id_prefix: "b-" };
  const full = {
    id_prefix: "f-",
    governance: { preset: "strict" },
    validation: { sprint_release_format: "warn" },
    testing: { record_results_to_items: true },
  };
  assert.deepStrictEqual(
    mergePresetSettings(base, full, false),
    mergePresetSettings(base, full, true),
  );
});
