/** Exercise the Windows npm shim and its behavioral revert in real OS processes. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEmptyToolConfig } from "../scripts/empty-tool-config.ts";

test("Windows closeout launcher rejects the legacy spawn and executes the npm shim", { skip: process.platform !== "win32" }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "closeout npm "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const helper = join(root, "closeout-spawn.ts");
  const fixed = readFileSync(new URL("./fixtures/closeout-spawn.ts", import.meta.url), "utf8");
  const selection = 'platform === "win32" && command === "npm"';
  assert.ok(fixed.includes(selection), "the revert must change the real launcher");
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  writeFileSync(join(root, "probe.mjs"), `
import assert from "node:assert/strict";
import { spawnCloseoutTool } from "./closeout-spawn.ts";
const result = spawnCloseoutTool("npm", ["--version"], {
  cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 30000,
});
assert.equal(result.status, 0, result.error?.message ?? result.stderr);
assert.match(result.stdout.trim(), /^\\d+\\.\\d+\\.\\d+/);
`);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|PRIVATE_KEY|NPM_MEDIA_SERVER/i.test(key)
      || key.toLowerCase() === "npm_config_userconfig") delete env[key];
  }
  Object.assign(env, { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root,
    NPM_CONFIG_USERCONFIG: createEmptyToolConfig(root), NPM_CONFIG_UPDATE_NOTIFIER: "false" });
  /** Run the copied launcher in a fresh Node process with the actual Windows PATH. */
  function probe() {
    return spawnSync(process.execPath, [join(root, "probe.mjs")], { cwd: root, env, encoding: "utf8", timeout: 45_000 });
  }
  try {
    writeFileSync(helper, fixed.replace(selection, "false"));
    const reverted = probe();
    assert.notEqual(reverted.status, 0, "direct npm spawning must reproduce the Windows failure");
    assert.match(reverted.stderr, /spawnSync npm (?:EINVAL|ENOENT|UNKNOWN)/);
    console.log("Windows legacy npm spawn: expected failure verified");
  } finally {
    writeFileSync(helper, fixed);
  }
  const restored = probe();
  assert.equal(restored.status, 0, restored.stdout + restored.stderr);
  console.log("Windows restored npm shim: real process passed");
});
