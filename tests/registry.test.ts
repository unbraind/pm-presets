/**
 * Tests for pm-presets registry and preset descriptors.
 * Uses Node.js built-in test runner (no extra deps).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// We import from dist since tsc compiles to dist/
// When run via `npm test` after `npm run build`, dist/ exists.
// Use dynamic import to avoid static analysis issues with .js extensions.

const mod = await import("../dist/index.js");
const { PRESET_REGISTRY } = mod;

test("PRESET_REGISTRY exports an array", () => {
  assert.ok(Array.isArray(PRESET_REGISTRY));
});

test("PRESET_REGISTRY contains exactly 5 presets", () => {
  assert.strictEqual(PRESET_REGISTRY.length, 5);
});

const EXPECTED_IDS = [
  "bug-triage",
  "indie-dev",
  "open-source",
  "software-sprint",
  "startup-roadmap",
];

test("all 5 expected preset IDs are present", () => {
  const ids = PRESET_REGISTRY.map((p) => p.id);
  for (const expected of EXPECTED_IDS) {
    assert.ok(ids.includes(expected), `Missing preset id: ${expected}`);
  }
});

test("each preset has required fields", () => {
  for (const preset of PRESET_REGISTRY) {
    assert.ok(typeof preset.id === "string" && preset.id.length > 0, `preset.id missing on ${JSON.stringify(preset)}`);
    assert.ok(typeof preset.displayName === "string" && preset.displayName.length > 0, `preset.displayName missing on ${preset.id}`);
    assert.ok(typeof preset.description === "string" && preset.description.length > 0, `preset.description missing on ${preset.id}`);
    assert.ok(typeof preset.command === "string" && preset.command.length > 0, `preset.command missing on ${preset.id}`);
    assert.ok(typeof preset.idPrefix === "string" && preset.idPrefix.length > 0, `preset.idPrefix missing on ${preset.id}`);
    assert.ok(["minimal", "default", "strict"].includes(preset.governance), `preset.governance invalid on ${preset.id}: ${preset.governance}`);
    assert.ok(Array.isArray(preset.templates) && preset.templates.length > 0, `preset.templates missing/empty on ${preset.id}`);
  }
});

test("bug-triage uses strict governance", () => {
  const preset = PRESET_REGISTRY.find((p) => p.id === "bug-triage");
  assert.ok(preset, "bug-triage not found");
  assert.strictEqual(preset.governance, "strict");
  assert.strictEqual(preset.idPrefix, "bug-");
});

test("indie-dev uses minimal governance", () => {
  const preset = PRESET_REGISTRY.find((p) => p.id === "indie-dev");
  assert.ok(preset, "indie-dev not found");
  assert.strictEqual(preset.governance, "minimal");
  assert.strictEqual(preset.idPrefix, "indie-");
});

test("software-sprint has 4 templates", () => {
  const preset = PRESET_REGISTRY.find((p) => p.id === "software-sprint");
  assert.ok(preset, "software-sprint not found");
  assert.strictEqual(preset.templates.length, 4);
});

test("default export is an extension object with activate function", () => {
  const ext = mod.default;
  assert.ok(ext !== null && typeof ext === "object", "default export is not an object");
  assert.ok(typeof (ext as any).activate === "function", "default export.activate is not a function");
});
