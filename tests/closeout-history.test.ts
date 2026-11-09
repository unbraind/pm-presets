/** Preserve historical closeouts while keeping actual publication checks strict. */
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { PmClient } from "@unbrained/pm-cli/sdk";
import { spawnCloseoutTool } from "./fixtures/closeout-spawn.ts";
import { createEmptyToolConfig } from "../scripts/empty-tool-config.ts";

test("untagged closeouts generate and verify history without accepting it for publication", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-closeout-history-mode-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { version: string; scripts: Record<string, string> };
  manifest.version = "2026.12.1";
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  cpSync("scripts", join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "src"));
  cpSync("src/sdk-loader.ts", join(root, "src", "sdk-loader.ts"));
  // Keep the pinned packages available without giving the fixture a working pm
  // shim. Changelog must use its installed-host Node launcher on every OS.
  const modules = join(root, "node_modules");
  const bin = join(modules, ".bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(modules, "@unbrained"));
  for (const name of ["pm-changelog", "@unbrained/pm-cli"]) {
    symlinkSync(resolve("node_modules", name), join(modules, name), "junction");
  }
  const changelogCli = createRequire(import.meta.url).resolve("pm-changelog/cli");
  if (process.platform === "win32") {
    writeFileSync(join(bin, "pm-changelog.cmd"), `@"${process.execPath}" "${changelogCli}" %*\r\n`);
    writeFileSync(join(bin, "pm.cmd"), "@exit /b 79\r\n");
  } else {
    symlinkSync(changelogCli, join(bin, "pm-changelog"));
    writeFileSync(join(bin, "pm"), "#!/bin/sh\nexit 79\n", { mode: 0o755 });
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  const config = createEmptyToolConfig(root);
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") || /TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|PRIVATE_KEY|NPM_MEDIA_SERVER/i.test(key) || key.toLowerCase() === "npm_config_userconfig") delete env[key];
  Object.assign(env, { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root,
    GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1", NPM_CONFIG_USERCONFIG: config,
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    GIT_AUTHOR_NAME: "SteveBot", GIT_AUTHOR_EMAIL: "1153461+unbraind@users.noreply.github.com",
    GIT_COMMITTER_NAME: "SteveBot", GIT_COMMITTER_EMAIL: "1153461+unbraind@users.noreply.github.com",
    GIT_AUTHOR_DATE: "2026-11-05T23:00:00Z", GIT_COMMITTER_DATE: "2026-11-05T23:00:00Z",
    PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" });
  /** Run real tools only against the disposable fixture, preserving failure diagnostics. */
  function run(command: string, args: string[], status = 0) {
    const result = spawnCloseoutTool(command, args, { cwd: root, env, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, status, `${command}: ${result.error?.message ?? ""}\n${result.stdout}${result.stderr}`);
    return result;
  }
  const pmRoot = join(root, ".agents", "pm");
  const client = new PmClient({ cwd: root, pmRoot, noExtensions: true, author: "test-author" });
  await client.init();
  const historical = (await client.create({ type: "Issue", title: "Previously delivered package fix", status: "closed", closeReason: "Fixture delivery", release: "v2026.11.5", completedAt: "2026-11-05T12:00:00Z" })).item;
  run("git", ["init", "--quiet"]);
  run("git", ["add", "package.json", ".agents/pm/settings.json", `.agents/pm/issues/${historical.id}.toon`, `.agents/pm/history/${historical.id}.jsonl`]);
  run("git", ["-c", "user.name=SteveBot", "-c", "user.email=1153461+unbraind@users.noreply.github.com", "commit", "--quiet", "-m", "Synthetic historical fixture"]);
  // This tag exists only inside the disposable test repository.
  run("git", ["tag", "v2026.11.5"]);
  run("npm", ["run", "closeout:check"]);
  let notes = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  assert.ok(notes.includes(historical.title));
  assert.ok(!notes.includes("## 2026.12.1"));
  run("npm", ["run", "changelog:check"]);

  const pending = (await client.create({ type: "Issue", title: "Newly delivered package mitigation", status: "closed", closeReason: "Fixture closeout", completedAt: "2026-11-06T12:00:00Z" })).item;
  run("npm", ["run", "closeout:check"]);
  notes = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  assert.ok(notes.includes(pending.title));
  assert.ok(!notes.includes("## 2026.12.1"));
  run("npm", ["run", "changelog:check"]);
  run("npm", ["run", "changelog:check:release"], 1);
  assert.equal(readFileSync(join(root, "CHANGELOG.md"), "utf8"), notes, "checks never rewrite the historical artifact");

  run("npm", ["run", "changelog:full"]);
  const releaseNotes = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  assert.ok(releaseNotes.includes("## 2026.12.1"));
  run("npm", ["run", "changelog:check"]);
  run("npm", ["run", "changelog:check:release"]);
  assert.equal(manifest.scripts.prepublishOnly, "npm run release:check && npm run changelog:check:release");
  writeFileSync(join(root, "CHANGELOG.md"), releaseNotes.replace(pending.title, "Incorrect entry"));
  run("npm", ["run", "changelog:check"], 1);
});
