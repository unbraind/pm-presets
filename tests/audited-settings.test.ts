/** Real workspace regressions for audited preset settings and read-only previews. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createExtensionCommandSdk, PmClient } from "@unbrained/pm-cli/sdk";
import { applyPreset, storedTemplate } from "../src/presets/shared.ts";
import { PRESET_REGISTRY } from "../src/registry.ts";
import { requirePresetDefinition } from "../src/catalog.ts";

test("all seven presets preserve audited settings history through merge, replace and preview", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pm-presets-audited-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  const cli = resolve("node_modules/@unbrained/pm-cli/dist/cli.js");
  const init = spawnSync(process.execPath, [cli, "--no-extensions", "init", "--yes"], { cwd: root, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const baseline = spawnSync(process.execPath, [cli, "--no-extensions", "create", "task", "Synthetic audit baseline", "--create-mode", "progressive"], { cwd: root, encoding: "utf8" });
  assert.equal(baseline.status, 0, baseline.stderr);
  const client = new PmClient({ pmRoot, noExtensions: true });
  const sdk = createExtensionCommandSdk(pmRoot, client, "preset-history-test", "presets apply");
  for (const preset of PRESET_REGISTRY) {
    const input = { label: preset.displayName, settings: requirePresetDefinition(preset.id).settings, templates: {}, nextSteps: [] };
    const context = { command: "presets apply", args: [preset.id], options: {}, global: { quiet: true }, pm_root: pmRoot, sdk };
    const before = readFileSync(join(pmRoot, "settings.json"), "utf8");
    const historyBefore = readdirSync(join(pmRoot, "history")).map((file) => [file, readFileSync(join(pmRoot, "history", file), "utf8")]);
    await applyPreset({ ...context, options: { dryRun: true, replace: true } }, input);
    assert.equal(readFileSync(join(pmRoot, "settings.json"), "utf8"), before);
    assert.deepEqual(readdirSync(join(pmRoot, "history")).map((file) => [file, readFileSync(join(pmRoot, "history", file), "utf8")]), historyBefore);
    for (const replace of [false, true]) {
      await applyPreset({ ...context, options: { replace } }, input);
      const history = readFileSync(join(pmRoot, "history", "_workspace.jsonl"), "utf8");
      assert.match(history, /pm-presets-/);
      assert.match(history, /preset-history-test/);
      const health = spawnSync(process.execPath, [cli, "--no-extensions", "health", "--strict-exit", "--json"], { cwd: root, encoding: "utf8" });
      assert.equal(health.status, 0, `${preset.id} replace=${replace}: ${health.stdout}\n${health.stderr}`);
    }
  }
  const preset = requirePresetDefinition("indie-dev");
  await Promise.all([
    sdk.mutateWorkspaceSettings({ operationId: "concurrent-other-setting", mutate: (current) => ({ ...current, author_default: "concurrent-test" }) }),
    applyPreset({ command: "presets apply", args: [], options: {}, global: {}, pm_root: pmRoot, sdk }, { label: "Indie", settings: preset.settings, templates: {}, nextSteps: [] }),
  ]);
  assert.equal(JSON.parse(readFileSync(join(pmRoot, "settings.json"), "utf8")).author_default, "concurrent-test");
});

test("a missing host settings capability refuses application before any write", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pm-presets-old-host-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cli = resolve("node_modules/@unbrained/pm-cli/dist/cli.js");
  const init = spawnSync(process.execPath, [cli, "--no-extensions", "init", "--yes"], { cwd: root, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const pmRoot = join(root, ".agents", "pm");
  const before = readFileSync(join(pmRoot, "settings.json"), "utf8");
  await assert.rejects(async () => applyPreset({ command: "presets apply", args: [], options: {}, global: {}, pm_root: pmRoot }, {
    label: "Indie", settings: { id_prefix: "indie-" }, templates: {}, nextSteps: [],
  }), /2026\.9\.30.*audited settings/i);
  assert.equal(readFileSync(join(pmRoot, "settings.json"), "utf8"), before);
});

/** Reject malformed template plans and invalid tracker state before creating templates. */
test("invalid templates and refused audited mutations leave settings and templates unchanged", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pm-presets-refusal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  const client = new PmClient({ pmRoot, cwd: root, noExtensions: true });
  await client.init();
  const sdk = createExtensionCommandSdk(pmRoot, client);
  const context = { command: "presets apply", args: [], options: {}, global: {}, pm_root: pmRoot, sdk };
  const before = readFileSync(join(pmRoot, "settings.json"), "utf8");
  const historyBefore = readdirSync(join(pmRoot, "history")).map((file) => [file, readFileSync(join(pmRoot, "history", file), "utf8")]);
  await assert.rejects(() => applyPreset(context, { label: "Invalid", settings: { id_prefix: "x-" }, templates: { "wrong.json": storedTemplate("idea", { type: "Task" }) }, nextSteps: [] }), /Template map key/);
  assert.equal(readFileSync(join(pmRoot, "settings.json"), "utf8"), before);
  assert.deepEqual(readdirSync(join(pmRoot, "history")).map((file) => [file, readFileSync(join(pmRoot, "history", file), "utf8")]), historyBefore);
  writeFileSync(join(pmRoot, "settings.json"), "{}\n");
  await assert.rejects(() => applyPreset(context, { label: "Invalid", settings: { id_prefix: "x-" }, templates: { "idea.json": storedTemplate("idea", { type: "Task" }) }, nextSteps: [] }), /Audited preset settings failed/);
  assert.equal(readFileSync(join(pmRoot, "settings.json"), "utf8"), "{}\n");
  assert.deepEqual(readdirSync(join(pmRoot, "history")).map((file) => [file, readFileSync(join(pmRoot, "history", file), "utf8")]), historyBefore);
  assert.throws(() => readdirSync(join(pmRoot, "templates")), /ENOENT/);
});
