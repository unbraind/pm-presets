/** Exercise real Git/npm config reads and audit isolation without network access. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { createEmptyToolConfig } from "../scripts/empty-tool-config.ts";
import { spawnCloseoutTool } from "./fixtures/closeout-spawn.ts";
import { stripToolEnv } from "../scripts/tool-env.ts";

/** Strip inherited credentials and config routing before running disposable tools. */
function fixtureEnv(root: string): NodeJS.ProcessEnv {
  const env = stripToolEnv(process.env, (key) => key.startsWith("GIT_"));
  return { ...env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, NPM_CONFIG_UPDATE_NOTIFIER: "false" };
}

test("Git and npm consume a real empty config file in a directory with spaces", (t) => {
  const root = mkdtempSync(join(tmpdir(), "tool config "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = createEmptyToolConfig(root);
  assert.ok(statSync(config).isFile(), "tool configs must be ordinary files, not null devices");
  assert.equal(readFileSync(config, "utf8"), "");
  const env = { ...fixtureEnv(root), GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: config,
    GIT_CONFIG_NOSYSTEM: "1", NPM_CONFIG_USERCONFIG: config };
  const options = { cwd: root, env, encoding: "utf8" as const, timeout: 30_000 };
  const git = spawnCloseoutTool("git", ["config", "--global", "--list"], options);
  assert.equal(git.status, 0, git.error?.message ?? git.stderr);
  assert.equal(git.stdout, "");
  const npm = spawnCloseoutTool("npm", ["config", "get", "userconfig"], options);
  assert.equal(npm.status, 0, npm.error?.message ?? npm.stderr);
  assert.equal(npm.stdout.trim(), config);
  assert.equal(readFileSync(config, "utf8"), "", "tools must leave the empty config unchanged");
});

test("production audit uses an empty regular config, strips credentials and cleans up on either outcome", (t) => {
  const root = mkdtempSync(join(tmpdir(), "audit tool "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const probe = join(root, "probe.mjs");
  writeFileSync(probe, `
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
assert.deepEqual(process.argv.slice(2), ["audit", "--omit=dev", "--ignore-scripts"]);
const config = process.env.NPM_CONFIG_USERCONFIG;
assert.ok(statSync(config).isFile(), "audit config must be a regular file");
assert.equal(readFileSync(config, "utf8"), "");
assert.equal(process.env.npm_config_userconfig, config);
for (const key of Object.keys(process.env)) {
  assert.ok(!["TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "AUTH", "COOKIE", "PRIVATE_KEY", "NPM_MEDIA_SERVER"].some((part) => key.toUpperCase().includes(part)));
  assert.notEqual(key.toLowerCase(), "npm_config_allow_scripts");
}
for (const key of JSON.parse(process.env.AUDIT_FIXTURE_EXCLUDED_KEYS)) assert.ok(!Object.hasOwn(process.env, key));
console.log(JSON.stringify({ config }));
process.exitCode = Number(process.env.AUDIT_FIXTURE_STATUS);
`);
  if (process.platform === "win32") {
    writeFileSync(join(root, "npm.cmd"), `@"${process.execPath}" "${probe}" %*\r\n`);
  } else {
    /** Quote generated paths for the fixture's POSIX launcher. */
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    writeFileSync(join(root, "npm"), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(probe)} "$@"\n`, { mode: 0o755 });
  }
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  const [runtime, ...args] = manifest.scripts["audit:prod"].split(" ");
  assert.equal(runtime, "node");
  for (const status of [0, 7]) {
    const excluded = ["TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "AUTH", "COOKIE", "PRIVATE_KEY", "NPM_MEDIA_SERVER"]
      .flatMap((part) => [part, `prefix_${part.toLowerCase()}_suffix`, `Mixed_${part.toLowerCase()}_Value`]);
    const env: NodeJS.ProcessEnv = { ...fixtureEnv(root), PATH: root + delimiter + (process.env.PATH ?? ""),
      ...Object.fromEntries(excluded.map((key) => [key, "synthetic-fixture"])),
      AUDIT_FIXTURE_EXCLUDED_KEYS: JSON.stringify([...excluded, "npm_config_allow_scripts"]),
      NPM_CONFIG_USERCONFIG: "invalid inherited config", npm_config_userconfig: "invalid inherited config",
      NPM_TOKEN: "synthetic-fixture", NODE_AUTH_TOKEN: "synthetic-fixture", NPM_MEDIA_SERVER: "synthetic-fixture",
      npm_config_allow_scripts: "true", AUDIT_FIXTURE_STATUS: String(status) };
    for (const key of Object.keys(env)) if (key.toLowerCase() === "path" && key !== "PATH") delete env[key];
    const result = spawnSync(process.execPath, args, { cwd: resolve("."), env, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, status, result.error?.message ?? result.stdout + result.stderr);
    const { config } = JSON.parse(result.stdout.trim()) as { config: string };
    assert.ok(!existsSync(dirname(config)), "audit must remove its temporary directory after success or failure");
  }
});
