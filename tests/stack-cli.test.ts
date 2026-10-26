/** Installed parser, host rendering, structured exits and Git-free preview on a real tracker. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { PmClient } from "@unbrained/pm-cli/sdk";

/** Compare every preview-visible file without ignoring history or foreign content. */
function snapshot(root: string) {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    .map((entry) => [join(entry.parentPath, entry.name).slice(root.length), readFileSync(join(entry.parentPath, entry.name), "utf8")]));
}

test("installed stack command uses TOON/JSON and actionable refusals without git or writes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-stack-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  await new PmClient({ pmRoot, cwd: root, noExtensions: true }).init();
  const extension = join(pmRoot, "extensions", "pm-presets");
  mkdirSync(extension, { recursive: true });
  for (const file of ["package.json", "manifest.json", "dist"]) cpSync(resolve(file), join(extension, file), { recursive: true });
  /** Empty PATH proves no git or pm executable is needed by the planner. */
  function run(args: string[], status = 0) {
    const result = spawnSync(process.execPath, [resolve("node_modules/@unbrained/pm-cli/dist/cli.js"), "--pm-path", pmRoot, "presets", "stack", ...args], {
      cwd: root, encoding: "utf8", env: { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, PATH: "", GIT_CEILING_DIRECTORIES: tmpdir(), PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
    });
    assert.equal(result.status, status, result.stdout + result.stderr);
    return result;
  }
  const before = snapshot(pmRoot);
  const file = join(root, "stack.json");
  writeFileSync(file, JSON.stringify({ selections: [{ preset: "indie-dev" }, { preset: "open-source", settings: false, seeds: true }] }, null, 2).replaceAll("\n", "\r\n"));
  const ready = JSON.parse(run(["--input", file, "--json"]).stdout);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.counts, { settings: 5, templates: 5, seeds: 1, unresolved: 0 });
  assert.match(run(["--input", file]).stdout, /ready: true/);
  writeFileSync(file, JSON.stringify({ selections: [{ preset: "indie-dev" }, { preset: "software-sprint" }] }));
  const pending = JSON.parse(run(["--input", file, "--json"], 2).stdout);
  assert.equal(pending.code, "conflicts");
  assert.equal(pending.counts.unresolved, 4);
  const choices = Object.fromEntries(pending.ownership.filter((entry: { conflict: boolean }) => entry.conflict).map((entry: { path: string }) => [entry.path, "software-sprint"]));
  writeFileSync(file, JSON.stringify({ selections: [{ preset: "software-sprint" }, { preset: "indie-dev" }], choices }));
  assert.equal(JSON.parse(run(["--input", file, "--json"]).stdout).ready, true);
  for (const args of [[], ["--input", "missing.json"]]) assert.match(run(args, 2).stderr, /invalid_input/);
  writeFileSync(file, "{bad json");
  assert.match(run(["--input", file], 2).stderr, /invalid_input/);
  writeFileSync(file, JSON.stringify({ selections: Array(8).fill({ preset: "indie-dev" }) }));
  assert.match(run(["--input", file], 2).stderr, /invalid_input/);
  assert.match(run(["--help"]).stdout, /--input/);
  assert.deepEqual(snapshot(pmRoot), before);
});
