/** Installed extension acceptance through the actual host parser and TOON/JSON renderers. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { PmClient } from "@unbrained/pm-cli/sdk";

test("installed commands parse flags, render compact output, and retry across independent host processes without git", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-upgrade-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  await new PmClient({ pmRoot, cwd: root, noExtensions: true }).init();
  const extension = join(pmRoot, "extensions", "pm-presets");
  mkdirSync(extension, { recursive: true });
  for (const source of ["package.json", "manifest.json", "dist"]) cpSync(resolve(source), join(extension, source), { recursive: true });
  writeFileSync(join(root, "v1.json"), JSON.stringify({ id: "vendor", version: "v1", settings: { id_prefix: "old-" } }));
  writeFileSync(join(root, "v2.json"), JSON.stringify({ id: "vendor", version: "v2", settings: { id_prefix: "next-" } }));
  writeFileSync(join(root, "decisions.json"), JSON.stringify({ "/id_prefix": "vendor" }));
  /** Invoke the installed host with isolated config and no Git executable available. */
  function run(args: string[], status = 0) {
    const child = spawnSync(process.execPath, [resolve("node_modules/@unbrained/pm-cli/dist/cli.js"), "--pm-path", pmRoot, ...args], {
      cwd: root, encoding: "utf8", env: { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, PATH: "", GIT_CEILING_DIRECTORIES: tmpdir(), PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
    });
    assert.equal(child.status, status, child.stdout + child.stderr);
    return status === 0 ? child.stdout : child.stdout + child.stderr;
  }
  const args = ["presets", "upgrade", "plan", "--from", "v1.json", "--to", "v2.json", "--receipt", "unresolved.json"];
  assert.match(run(args), /ready: false/);
  const blocked = run(["presets", "upgrade", "apply", "unresolved.json", "--json"], 2);
  assert.match(blocked, /conflicts/);
  const report = JSON.parse(run([...args.slice(0, -1), "resolved.json", "--decisions", "decisions.json", "--json"])) as { ready: boolean };
  assert.equal(report.ready, true);
  const apply = ["presets", "upgrade", "apply", "resolved.json", "--json"];
  assert.equal(JSON.parse(run(apply)).changed, true);
  assert.equal(JSON.parse(run(apply)).replayed, true);
  const rollback = ["presets", "upgrade", "rollback", "resolved.json", "--json"];
  assert.equal(JSON.parse(run(rollback)).changed, true);
  assert.equal(JSON.parse(run(rollback)).replayed, true);
  assert.equal(JSON.parse(readFileSync(join(pmRoot, "settings.json"), "utf8")).id_prefix, "pm-");
});
