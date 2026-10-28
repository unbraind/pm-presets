/** Packed commands protect defaults and secrets under both supported runtimes and renderers. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { PmClient } from "@unbrained/pm-cli/sdk";

test("packed parameter classes hold for npm/Node and Bun CLI in JSON and TOON on non-git trackers", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-parameters-packed-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  await new PmClient({ pmRoot, cwd: root, noExtensions: true }).init();
  const cli = resolve("node_modules/@unbrained/pm-cli/dist/cli.js");
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", root, "--json"], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const archive = join(root, JSON.parse(packed.stdout)[0].filename);
  const install = spawnSync(process.execPath, [cli, "--path", pmRoot, "package", "install", archive, "--project"], { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.equal(install.status, 0, install.stderr + install.stdout);
  const entry = join(pmRoot, "extensions", "pm-presets", "dist", "presets", "startup-roadmap", "index.js");
  assert.ok(existsSync(entry));
  // This synthetic authoring fixture exercises the published secret contract;
  // bundled presets intentionally ship no secrets. It also makes the bundled
  // default adversarial without changing any actual package source or tracker.
  appendFileSync(entry, '\nPARAMETERS[0] = { ...PARAMETERS[0], default: " \\u2003road\\u00a0 " };\nPARAMETERS.push({ name: "token", type: "secret", required: false });\nSETTINGS.validation = { ...SETTINGS.validation, synthetic_token: "${param:token}" };\n');
  const fixture = readFileSync(entry, "utf8");
  const settingsFile = join(pmRoot, "settings.json");
  const stored = 'old-synthetic"credential\\value';
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  settings.validation = { ...settings.validation, synthetic_token: { previous: [stored] } };
  writeFileSync(settingsFile, JSON.stringify(settings));
  const before = readFileSync(settingsFile, "utf8");
  const runtimes = [process.execPath];
  const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (bun.status === 0) runtimes.push("bun");
  else t.diagnostic("Bun unavailable; npm/Node packed consumer verified; Bun remains an external gate.");
  for (const runtime of runtimes) {
    /** Invoke the actual installed parser/renderer with isolated user state. */
    function run(args: string[]) {
      const result = spawnSync(runtime, [cli, "--path", pmRoot, ...(args[0].endsWith("-setup") ? args : ["presets", ...args])], { cwd: root, encoding: "utf8", timeout: 60_000,
        env: { ...process.env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, GIT_CEILING_DIRECTORIES: root, PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return result.stdout;
    }
    writeFileSync(entry, fixture);
    const secret = 'new-synthetic"credential\\value';
    const encoded = JSON.stringify(secret).slice(1, -1);
    for (const json of [[], ["--json"]]) {
      for (const args of [["diff", "startup-roadmap"], ["--diff", "startup-roadmap"]]) {
        const output = run([...args, "--param", `token=${secret}`, ...json]);
        assert.ok(output.includes("<redacted>"));
        for (const forbidden of [secret, encoded, stored, JSON.stringify(stored).slice(1, -1)]) assert.ok(!output.includes(forbidden));
        assert.ok(output.includes("road-"));
        assert.ok(!output.includes("${param:projectKey}"));
      }
    }
    const show = JSON.parse(run(["show", "startup-roadmap", "--json"]));
    assert.equal(show.settings.id_prefix, "road-");
    assert.equal(show.parameters[0].default, "road");
    const input = join(root, "stack.json");
    writeFileSync(input, JSON.stringify({ selections: [{ preset: "startup-roadmap", settings: false, templates: false, seeds: true }] }));
    for (const json of [[], ["--json"]]) {
      const output = run(["stack", "--input", input, ...json]);
      assert.ok(output.includes("Define the road first roadmap initiative"));
      assert.ok(!output.includes("${param:"));
    }
    // Rebind a native settings leaf for actual setup/apply dry-runs; settings
    // validation remains host-owned, and secret values still must never print.
    writeFileSync(entry, fixture + '\ndelete SETTINGS.validation.synthetic_token;\nSETTINGS.id_prefix = "${param:token}-";\n');
    for (const args of [["apply", "startup-roadmap"], ["roadmap-setup"]]) {
      const output = run([...args, "--dry-run", "--param", `token=${secret}`]);
      assert.ok(output.includes("<redacted>"));
      assert.ok(!output.includes(secret) && !output.includes(encoded));
    }

  }
  assert.equal(readFileSync(settingsFile, "utf8"), before, "read commands must preserve stored settings");
});
