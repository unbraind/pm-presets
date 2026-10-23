/** Actual parser, installed-extension resolution, renderers, exits and Git-free execution. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { PmClient, getWorkspaceContracts } from "@unbrained/pm-cli/sdk";

/** Hash-independent exact content snapshot for settings, items and history. */
function snapshot(root: string) {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && !entry.parentPath.includes("cache"))
    .map((entry) => [join(entry.parentPath, entry.name).slice(root.length), readFileSync(join(entry.parentPath, entry.name), "utf8")]));
}

test("installed plan commands negotiate real contracts, render TOON/JSON, and refuse before writes without git", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-plan-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  await new PmClient({ pmRoot, cwd: root, noExtensions: true }).init();
  const extension = join(pmRoot, "extensions", "pm-presets");
  mkdirSync(extension, { recursive: true });
  for (const source of ["package.json", "manifest.json", "dist"]) cpSync(resolve(source), join(extension, source), { recursive: true });
  /** Empty PATH proves the planner has no Git subprocess dependency. */
  function run(args: string[], status = 0) {
    const result = spawnSync(process.execPath, [resolve("node_modules/@unbrained/pm-cli/dist/cli.js"), "--pm-path", pmRoot, "presets", "plan", ...args], {
      cwd: root, encoding: "utf8", env: { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, PATH: "", GIT_CEILING_DIRECTORIES: tmpdir(), PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
    });
    assert.equal(result.status, status, result.stdout + result.stderr);
    return result;
  }
  const before = snapshot(pmRoot);
  for (const id of ["bug-triage", "indie-dev", "open-source", "software-sprint", "startup-roadmap", "kanban", "agent-workflow"]) {
    const report = JSON.parse(run([id, "--with-seeds", "--json"]).stdout);
    assert.equal(report.ready, true);
    assert.equal(report.backend, "directory");
    assert.deepEqual(report.selected, ["settings", "templates", "seeds"]);
    assert.equal(report.gapCount, 0);
  }
  assert.match(run(["kanban"]).stdout, /ready: true/);
  const composition = { id: "synthetic", features: [{ id: "settings", optional: false, requires: [{ kind: "capability", name: "settings.audit" }] },
    { id: "optional-sync", optional: true, requires: [{ kind: "command", name: "absent sync" }] }] };
  writeFileSync(join(root, "composition.json"), JSON.stringify(composition));
  const contracts = await getWorkspaceContracts(pmRoot, { cwd: root });
  writeFileSync(join(root, "target.json"), JSON.stringify({ backend: "database", capabilities: ["settings.audit"], contracts }));
  const args = ["--composition", "composition.json", "--target", "target.json"];
  const optional = JSON.parse(run([...args, "--json"]).stdout);
  assert.equal(optional.ready, true);
  assert.deepEqual(optional.omitted, ["optional-sync"]);
  assert.equal(optional.gaps[0].name, "absent sync");
  writeFileSync(join(root, "target.json"), JSON.stringify({ backend: "database", capabilities: [], contracts }));
  const refused = JSON.parse(run([...args, "--json"], 2).stdout);
  assert.equal(refused.ready, false);
  assert.equal(refused.code, "missing_capability");
  assert.equal(refused.gaps[0].feature, "settings");
  assert.match(refused.gaps[0].remedy, /settings.audit/);
  assert.match(run(args, 2).stdout, /ready: false/);
  assert.match(run(["--composition", "missing.json", "--json"], 2).stderr, /invalid_input/);
  assert.match(run(["--help"]).stdout, /--composition/);
  assert.deepEqual(snapshot(pmRoot), before, "all planning paths leave settings, items and history byte-identical");
});
