/** Real SDK and subprocess regressions for isolated preset workflow simulation. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import { PmClient } from "@unbrained/pm-cli/sdk";
import mod from "../src/index.ts";
import { PRESET_REGISTRY } from "../src/registry.ts";
import { executeSyntheticScenarios, PRESET_SCENARIOS, resolveSimulationSdk, simulatePreset, SimulationRefusal } from "../src/simulation.ts";
import { packedArchiveFilename } from "./fixtures/npm-pack.ts";

const sdkPath = resolveSimulationSdk([import.meta.url]);

/** Stable filesystem census for checking immutability without reading runtime caches. */
function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => [join(entry.parentPath, entry.name).slice(root.length), readFileSync(join(entry.parentPath, entry.name), "utf8")]));
}

test("all bundled presets execute declared workflows with real SDK state and installed templates", async (t) => {
  for (const preset of PRESET_REGISTRY) {
    const root = mkdtempSync(join(tmpdir(), "preset-suite-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const report = await executeSyntheticScenarios(root, preset.id, PRESET_SCENARIOS, sdkPath);
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.equal(report.checked, 4);
    assert.equal(report.passed, 4);
    assert.deepEqual(report.coverageGaps, []);
    const close = report.scenarios.find((row) => row.id === "close-without-evidence");
    assert.equal(close?.actual, preset.id === "bug-triage" ? "refused" : "closed");
    const pmRoot = join(root, ".agents", "pm");
    const client = new PmClient({ pmRoot, cwd: root, noExtensions: true });
    const census = await client.listAllComplete();
    assert.equal(census.items.length, 4);
    const templateFiles = readdirSync(join(pmRoot, "templates"));
    assert.ok(templateFiles.length >= preset.templates.length);
    assert.equal(readFileSync(join(pmRoot, "settings.json"), "utf8").includes(preset.idPrefix), true);
  }
});

test("simulation is reproducible, independent of selection order, and leaves the caller untouched without git", (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-caller-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".agents", "pm"), { recursive: true });
  writeFileSync(join(root, ".agents", "pm", "settings.json"), "invalid caller settings must never be parsed");
  const cwd = process.cwd();
  const oldPath = process.env.PM_PATH;
  const oldHome = process.env.HOME;
  const oldNodeOptions = process.env.NODE_OPTIONS;
  const canary = join(root, "inherited-code.cjs");
  writeFileSync(canary, `require("node:fs").writeFileSync(${JSON.stringify(join(root, "canary-fired"))}, "unexpected"); throw new Error("inherited startup code ran");`);
  const before = snapshot(root);
  try {
    process.env.NODE_OPTIONS = `--require=${canary}`;
    process.chdir(root);
    process.env.PM_PATH = join(root, ".agents", "pm");
    process.env.HOME = root;
    const first = simulatePreset({ preset: " BUG-TRIAGE " });
    const second = simulatePreset({ preset: "bug-triage", scenarios: [...PRESET_SCENARIOS].reverse() });
    assert.deepEqual(first, second);
    assert.equal(first.ok, true);
    assert.equal(first.isolation, "synthetic-no-extensions");
    assert.ok(JSON.stringify(first).length < 2000);
    assert.doesNotMatch(JSON.stringify(first), /preset-caller-|20\d\d-\d\d-\d\d|\.agents/);
    assert.deepEqual(snapshot(root), before);
  } finally {
    process.chdir(cwd);
    if (oldPath === undefined) delete process.env.PM_PATH; else process.env.PM_PATH = oldPath;
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldNodeOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = oldNodeOptions;
  }
});

test("empty and partial selections expose every missing workflow", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-empty-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const empty = await executeSyntheticScenarios(root, "indie-dev", [], sdkPath);
  assert.equal(empty.ok, false);
  assert.equal(empty.checked, 0);
  assert.deepEqual(empty.coverageGaps, PRESET_SCENARIOS);
  const partial = simulatePreset({ preset: "indie-dev", scenarios: ["create-task"] });
  assert.equal(partial.ok, false);
  assert.equal(partial.checked, 1);
  assert.deepEqual(partial.coverageGaps, PRESET_SCENARIOS.slice(1));
});

test("refusals carry stable codes, exit statuses and remedies", () => {
  for (const [options, code] of [
    [{ preset: "unknown" }, "unknown_preset"],
    [{ preset: "indie-dev", scenarios: ["shell-command"] }, "unknown_scenario"],
    [{ preset: "indie-dev", scenarios: ["create-task", "create-task"] }, "duplicate_scenario"],
  ] as const) {
    assert.throws(() => simulatePreset(options as never), (error: unknown) => {
      assert.ok(error instanceof SimulationRefusal);
      assert.equal(error.code, code);
      assert.equal(error.exitCode, 2);
      assert.ok(error.remedy.length > 20);
      return true;
    });
  }
  assert.throws(() => resolveSimulationSdk([]), (error: unknown) => {
    assert.ok(error instanceof SimulationRefusal);
    assert.equal(error.code, "sdk_unavailable");
    assert.equal(error.exitCode, 1);
    return true;
  });
  assert.equal(resolveSimulationSdk(["invalid anchor", import.meta.url]), sdkPath);
});

test("failed worker startup refuses and removes its disposable workspace", (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-failure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previousTmp = process.env.TMPDIR;
  const executable = process.execPath;
  const arg = process.argv[1];
  try {
    process.env.TMPDIR = root;
    process.execPath = join(root, "missing-node");
    delete process.argv[1];
    assert.throws(() => simulatePreset({ preset: "indie-dev" }), (error: unknown) => {
      assert.ok(error instanceof SimulationRefusal);
      assert.equal(error.code, "simulation_failed");
      assert.equal(error.exitCode, 1);
      return true;
    });
    assert.deepEqual(readdirSync(root), []);
  } finally {
    process.execPath = executable;
    process.argv[1] = arg;
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
  }
});

test("CLI command returns compact results and refuses incomplete coverage with exit 4", async (t) => {
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  const complete = await harness.runCommand({ command: "presets simulate", args: ["indie-dev"] });
  assert.equal((complete.result as { ok: boolean }).ok, true);
  const output = t.mock.method(console, "log");
  for (const selected of [["create-task"], []]) {
    output.mock.resetCalls();
    await assert.rejects(() => harness.runCommand({ command: "presets simulate", args: ["indie-dev"], options: { scenarios: selected.join(",") } }), { exitCode: 4 });
    assert.equal(output.mock.callCount(), 1);
    const report = JSON.parse(output.mock.calls[0].arguments[0]) as {
      ok: boolean; checked: number; passed: number; coverageGaps: string[]; scenarios: { id: string }[];
    };
    assert.equal(report.ok, false);
    assert.equal(report.checked, selected.length);
    assert.equal(report.passed, selected.length);
    assert.deepEqual(report.coverageGaps, PRESET_SCENARIOS.filter((id) => !selected.includes(id)));
    assert.deepEqual(report.scenarios.map((row) => row.id), selected);
  }
  output.mock.restore();
  await assert.rejects(() => harness.runCommand({ command: "presets simulate" }), { code: "unknown_preset" });
});

test("built output works through the real CLI in a non-git tracker with git absent from PATH", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  await new PmClient({ pmRoot, cwd: root, noExtensions: true }).init();
  const cli = resolve("node_modules/@unbrained/pm-cli/dist/cli.js");
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", root, "--json"], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const archive = packedArchiveFilename(packed.stdout);
  const install = spawnSync(process.execPath, [cli, "--path", pmRoot, "package", "install", join(root, archive), "--project"], { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.equal(install.status, 0, install.stderr + install.stdout);
  const before = snapshot(pmRoot);
  const result = spawnSync(process.execPath, [cli, "--path", pmRoot, "presets", "simulate", "bug-triage", "--json"], {
    cwd: root, encoding: "utf8", env: { ...process.env, PATH: "", GIT_CEILING_DIRECTORIES: root, DO_NOT_TRACK: "1" },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout) as { ok: boolean; checked: number };
  assert.equal(report.ok, true);
  assert.equal(report.checked, 4);
  // The host may update ignored runtime caches; settings, items and history stay identical.
  const after = snapshot(pmRoot);
  for (const [file, content] of Object.entries(before)) {
    if (!/^\/(runtime|locks|search)\//.test(file)) assert.equal(after[file], content, file);
  }
  const toon = spawnSync(process.execPath, [cli, "--path", pmRoot, "presets", "simulate", "indie-dev"], { cwd: root, encoding: "utf8" });
  assert.equal(toon.status, 0, toon.stderr);
  assert.match(toon.stdout, /scenarios\[4\]/);
  assert.ok(toon.stdout.length < 2500);
});
