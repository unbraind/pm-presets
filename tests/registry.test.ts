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
const registryMod = await import("../dist/registry.js");

test("PRESET_REGISTRY exports an array", () => {
  assert.ok(Array.isArray(PRESET_REGISTRY));
});

test("PRESET_REGISTRY contains exactly 6 presets", () => {
  assert.strictEqual(PRESET_REGISTRY.length, 6);
});

const EXPECTED_IDS = [
  "bug-triage",
  "indie-dev",
  "open-source",
  "software-sprint",
  "startup-roadmap",
  "kanban",
];

test("all expected preset IDs are present", () => {
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
    assert.ok(["minimal", "default", "strict", "custom"].includes(preset.governance), `preset.governance invalid on ${preset.id}: ${preset.governance}`);
    assert.ok(Array.isArray(preset.templates) && preset.templates.length > 0, `preset.templates missing/empty on ${preset.id}`);
  }
});

test("bug-triage uses custom strict-close governance", () => {
  const preset = PRESET_REGISTRY.find((p) => p.id === "bug-triage");
  assert.ok(preset, "bug-triage not found");
  assert.strictEqual(preset.governance, "custom");
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

test("startup-roadmap uses custom governance", () => {
  const preset = PRESET_REGISTRY.find((p) => p.id === "startup-roadmap");
  assert.ok(preset, "startup-roadmap not found");
  assert.strictEqual(preset.governance, "custom");
});

test("default export is an extension object with activate function", () => {
  const ext = mod.default;
  assert.ok(ext !== null && typeof ext === "object", "default export is not an object");
  assert.ok(typeof (ext as any).activate === "function", "default export.activate is not a function");
});

test("extension registers preset and template commands", () => {
  const ext = mod.default;
  const commands: Array<{ name: string; action?: string }> = [];
  ext.activate({
    registerCommand(command: { name: string; action?: string }) {
      commands.push(command);
    },
  });
  const commandNames = commands.map((command) => command.name);
  assert.ok(commandNames.includes("triage-setup"));
  assert.ok(commandNames.includes("templates show"));
  assert.ok(commands.some((command) => command.action === "templates-show"));
});

test("preset templates use current pm create template document shape", () => {
  const templateMaps = [
    registryMod.bugTriageTemplates,
    registryMod.indieDevTemplates,
    registryMod.openSourceTemplates,
    registryMod.softwareSprintTemplates,
    registryMod.startupRoadmapTemplates,
  ];

  for (const templates of templateMaps) {
    for (const [filename, template] of Object.entries(templates)) {
      const document = template as {
        name?: unknown;
        created_at?: unknown;
        updated_at?: unknown;
        options?: Record<string, unknown>;
      };
      assert.match(filename, /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.json$/);
      assert.strictEqual(typeof document.name, "string");
      assert.strictEqual(`${document.name}.json`, filename);
      assert.strictEqual(typeof document.created_at, "string");
      assert.strictEqual(typeof document.updated_at, "string");
      assert.ok(document.options && typeof document.options === "object");
      assert.ok(!Object.hasOwn(document.options, "typeOption"));
      for (const [key, value] of Object.entries(document.options)) {
        assert.ok(key.trim().length > 0);
        assert.ok(
          typeof value === "string" ||
            (Array.isArray(value) && value.every((entry) => typeof entry === "string")),
          `invalid option value for ${filename}:${key}`
        );
      }
    }
  }
});
