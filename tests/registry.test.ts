/**
 * Tests for pm-presets registry and preset descriptors.
 * Uses Node.js built-in test runner (no extra deps). Imports the TypeScript
 * sources directly so coverage is measured on the lines an author edits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createExtensionTestHarness, type ExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import type { ExtensionCapability } from "@unbrained/pm-cli/sdk/authoring";

import mod, { PRESET_REGISTRY } from "../src/index.ts";
import * as registryMod from "../src/registry.ts";
import type { PresetId } from "../src/registry.ts";

/**
 * Capabilities the on-disk `manifest.json` declares.
 *
 * Read from the manifest so activation runs under the exact grant the published
 * package ships with: a surface registered without a matching capability fails
 * here the same way it would in the CLI, instead of passing against a stub.
 */
const MANIFEST_CAPABILITIES: readonly ExtensionCapability[] = (
  JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "manifest.json"), "utf8"),
  ) as { capabilities: ExtensionCapability[] }
).capabilities;

let cachedHarness: Promise<ExtensionTestHarness> | undefined;

/** Activate pm-presets through pm's real extension loader, once per test process. */
function activatePresets(): Promise<ExtensionTestHarness> {
  cachedHarness ??= (async () => {
    const harness = await createExtensionTestHarness(mod, {
      name: "pm-presets",
      capabilities: MANIFEST_CAPABILITIES,
    });
    assert.deepEqual(harness.activation.failed, [], "extension activation must not fail");
    return harness;
  })();
  return cachedHarness;
}

test("PRESET_REGISTRY exports an array", () => {
  assert.ok(Array.isArray(PRESET_REGISTRY));
});

test("PRESET_REGISTRY contains exactly 7 presets", () => {
  assert.strictEqual(PRESET_REGISTRY.length, 7);
});

const EXPECTED_IDS: PresetId[] = [
  "bug-triage",
  "indie-dev",
  "open-source",
  "software-sprint",
  "startup-roadmap",
  "kanban",
  "agent-workflow",
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

test("kanban registry metadata matches the bundled settings", () => {
  const preset = PRESET_REGISTRY.find((p) => p.id === "kanban");
  assert.ok(preset, "kanban not found");
  assert.strictEqual(preset.idPrefix, registryMod.kanbanSettings.id_prefix);
  assert.deepStrictEqual(preset.templates, ["card", "expedite", "blocked"]);
});

test("bundled preset catalog stays in sync with the registry", async () => {
  const { readFileSync } = await import("node:fs");
  // The preset catalog lives in its own `presets.json`, not in `manifest.json`:
  // the CLI's extension-manifest vocabulary is a closed key set and silently
  // ignores (and since pm-cli 2026.8.19, warns about) any other key.
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf-8")) as {
    description?: string;
  };
  const bundled = JSON.parse(readFileSync(new URL("../presets.json", import.meta.url), "utf-8")) as {
    presets?: Array<{ id: string; command: string; idPrefix: string; templates: string[] }>;
  };
  assert.match(manifest.description ?? "", /All 7 official/);
  assert.strictEqual(bundled.presets?.length, PRESET_REGISTRY.length);
  for (const preset of PRESET_REGISTRY) {
    const bundledPreset = bundled.presets?.find((entry) => entry.id === preset.id) as
      | { id: string; command: string; idPrefix: string; templates: string[] }
      | undefined;
    assert.ok(bundledPreset, `presets.json missing preset ${preset.id}`);
    assert.strictEqual(bundledPreset.command, preset.command);
    assert.strictEqual(bundledPreset.idPrefix, preset.idPrefix);
    assert.deepStrictEqual(bundledPreset.templates, preset.templates);
  }
});

test("default export is an extension object with activate function", () => {
  const ext = mod as { activate?: unknown };
  assert.ok(ext !== null && typeof ext === "object", "default export is not an object");
  assert.ok(typeof ext.activate === "function", "default export.activate is not a function");
});

test("extension registers preset and template commands", async () => {
  const h = await activatePresets();
  const { registrations } = h.activation;
  const commandNames = registrations.commands.map((entry) => entry.command);
  assert.ok(commandNames.includes("triage-setup"));
  const templatesShow = registrations.commands.find((entry) => entry.command === "templates show");
  assert.ok(templatesShow, "templates show command should be registered");
  assert.equal(templatesShow.action, "templates-show");
});

test("no command redeclares a host-owned global flag", async () => {
  // Guards the whole surface, not just the one command that regressed:
  // registering any of these makes the host reject the command outright, and
  // the value must be read from ctx.global instead.
  const hostOwned = new Set([
    "--json",
    "--quiet",
    "--path",
    "--lean",
    "--id-only",
    "--author",
    "--no-changed-fields",
    "--full-changed-fields",
    "--pm-path",
  ]);
  const h = await activatePresets();
  const { registrations } = h.activation;
  for (const registration of registrations.flags) {
    for (const flag of registration.flags) {
      assert.ok(
        flag.long === undefined || !hostOwned.has(flag.long),
        `${registration.target_command} must not redeclare host-owned global flag ${flag.long}`,
      );
    }
  }
});

test("preset templates use current pm create template document shape", () => {
  const templateMaps = [
    registryMod.bugTriageTemplates,
    registryMod.indieDevTemplates,
    registryMod.openSourceTemplates,
    registryMod.softwareSprintTemplates,
    registryMod.startupRoadmapTemplates,
    registryMod.agentWorkflowTemplates,
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

test("agent-workflow registry metadata matches the bundled settings", () => {
  const preset = PRESET_REGISTRY.find((p) => p.id === "agent-workflow");
  assert.ok(preset, "agent-workflow not found");
  assert.strictEqual(preset.idPrefix, registryMod.agentWorkflowSettings.id_prefix);
  assert.strictEqual(preset.governance, "default");
  assert.deepStrictEqual(preset.templates, ["agent-task", "prompt-experiment", "eval-run"]);
  assert.strictEqual(preset.command, "agent-setup");
});

test("extension registers the agent-setup command and the unified presets command", async () => {
  const h = await activatePresets();
  const { registrations } = h.activation;
  const commandNames = registrations.commands.map((entry) => entry.command);
  assert.ok(commandNames.includes("agent-setup"));
  assert.ok(commandNames.includes("presets"));
  const presetsFlags = registrations.flags.find((entry) => entry.target_command === "presets");
  assert.ok(presetsFlags, "presets command should register flags");
  const flagLongs = presetsFlags.flags.map((flag) => flag.long);
  assert.ok(flagLongs.includes("--list"));
  assert.ok(flagLongs.includes("--diff"));
  assert.ok(flagLongs.includes("--custom"));
});

test("unified presets command rejects a whitespace-only custom name", async () => {
  const h = await activatePresets();
  await assert.rejects(
    () => h.runCommand({
      command: "presets",
      options: { custom: "   " },
      pmRoot: "/missing",
    }),
    /--custom requires a non-empty preset name/,
  );
});

test("agent-workflow templates store lifecycle data as type options", () => {
  for (const template of Object.values(registryMod.agentWorkflowTemplates)) {
    const options = (template as { options: Record<string, unknown> }).options;
    assert.ok(!Object.hasOwn(options, "status"), "core status must not carry agent lifecycle values");
    assert.ok(!Object.hasOwn(options, "mode"), "custom mode must be stored through typeOption");
    assert.ok(!Object.hasOwn(options, "model"), "custom model must be stored through typeOption");
    const typeOptions = options.typeOption;
    assert.ok(Array.isArray(typeOptions));
    assert.ok(typeOptions.some((entry) => typeof entry === "string" && entry.startsWith("phase=")));
    assert.ok(typeOptions.some((entry) => typeof entry === "string" && entry.startsWith("mode=")));
    assert.ok(typeOptions.some((entry) => typeof entry === "string" && entry.startsWith("model=")));
  }
});
