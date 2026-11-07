/** Launch real closeout fixture tools using the platform's npm entry point. */
import { spawnSync } from "node:child_process";
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";

/** Keep Git execution direct; the platform override exercises dispatch with real fixture processes. */
export function spawnCloseoutTool(command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding, platform: NodeJS.Platform = process.platform) {
  const windowsNpm = platform === "win32" && command === "npm";
  return spawnSync(windowsNpm ? "npm.cmd" : command, args, { ...options, shell: windowsNpm });
}
