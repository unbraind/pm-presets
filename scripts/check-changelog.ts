/** Check either canonical closeout history or prepared release notes without writing them. */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cli = createRequire(import.meta.url).resolve("pm-changelog/cli");

/** Ask the pinned generator to compare exact bytes in one supported projection. */
function check(extra: readonly string[]) {
  return spawnSync(process.execPath, [cli, ...process.argv.slice(2), "--check", ...extra], {
    encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
  });
}

let result = check([]);
if (result.status !== 0) {
  const historical = check(["--no-pending-release"]);
  if (historical.status !== 0) {
    process.stderr.write("Prepared-release changelog check failed:\n");
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    process.stderr.write("Historical-only changelog check failed:\n");
  }
  result = historical;
}
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) console.error("Could not execute the pinned changelog checker.");
process.exitCode = result.status ?? 1;
