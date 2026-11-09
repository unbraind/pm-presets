/** Audit public production dependencies without loading user credentials or config. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmptyToolConfig } from "./empty-tool-config.ts";

const root = mkdtempSync(join(tmpdir(), "preset-audit-config-"));
try {
  const config = createEmptyToolConfig(root);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE|PRIVATE_KEY|NPM_MEDIA_SERVER/i.test(key)
      || key.toLowerCase() === "npm_config_allow_scripts"
      || key.toLowerCase() === "npm_config_userconfig") delete env[key];
  }
  Object.assign(env, { npm_config_userconfig: config, NPM_CONFIG_USERCONFIG: config });
  const windows = process.platform === "win32";
  const result = spawnSync(windows ? "npm.cmd" : "npm", ["audit", "--omit=dev", "--ignore-scripts"], {
    stdio: "inherit", env, shell: windows,
  });
  if (result.error) console.error("Could not execute the production dependency audit.");
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
