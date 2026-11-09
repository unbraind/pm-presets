/** Exercise launcher selection and argument handling with real disposable processes. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { spawnCloseoutTool } from "./fixtures/closeout-spawn.ts";
import { createEmptyToolConfig } from "../scripts/empty-tool-config.ts";

test("closeout tools preserve direct process arguments and failure diagnostics", () => {
  const args = ["space separated", "$literal", "%literal%", "semi;colon"];
  const result = spawnCloseoutTool(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...args], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
  const failure = spawnCloseoutTool(process.execPath, ["-e", "process.stderr.write('fixture refusal');process.exit(7)"], {
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(failure.status, 7);
  assert.equal(failure.stderr, "fixture refusal");
});

test("Windows dispatch selects the npm shim and shell while other tools stay direct", { skip: process.platform === "win32" }, (t) => {
  // These are POSIX fixture tools, not a claim about the Windows command parser.
  // The Windows integration suite independently exercises the actual npm.cmd.
  const root = mkdtempSync(join(tmpdir(), "closeout launcher "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const tool of ["npm", "npm.cmd", "git"]) {
    writeFileSync(join(root, tool), `#!/bin/sh\nprintf '%s:%s' '${tool}' "$1"\n`, { mode: 0o755 });
  }
  const env: NodeJS.ProcessEnv = { PATH: root + delimiter + (process.env.PATH ?? ""),
    HOME: root, NPM_CONFIG_USERCONFIG: createEmptyToolConfig(root), CLOSEOUT_LAUNCHER_PROBE: "expanded-fixture-argument" };
  const options = { cwd: root, env, encoding: "utf8" as const, timeout: 30_000 };
  const windows = spawnCloseoutTool("npm", ["$CLOSEOUT_LAUNCHER_PROBE"], options, "win32");
  assert.equal(windows.status, 0, windows.error?.message ?? windows.stderr);
  // Shell expansion proves shell:true; the executable name proves npm.cmd selection.
  assert.equal(windows.stdout, "npm.cmd:expanded-fixture-argument");
  for (const platform of ["linux", "darwin"] as const) {
    const native = spawnCloseoutTool("npm", ["$CLOSEOUT_LAUNCHER_PROBE"], options, platform);
    assert.equal(native.status, 0, native.error?.message ?? native.stderr);
    assert.equal(native.stdout, "npm:$CLOSEOUT_LAUNCHER_PROBE");
  }
  const git = spawnCloseoutTool("git", ["$CLOSEOUT_LAUNCHER_PROBE"], options, "win32");
  assert.equal(git.status, 0, git.error?.message ?? git.stderr);
  assert.equal(git.stdout, "git:$CLOSEOUT_LAUNCHER_PROBE");
});
