/** Native SDK regression boundaries, isolated from PATH and enclosing git state. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

for (const scenario of ["all-presets", "corrupt-after-cache"]) {
  test(`SDK seed ${scenario} works without git or a pm executable`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "presets-seeds-sdk-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, [join(import.meta.dirname, "fixtures", "seeds-sdk.ts"), scenario, root], {
      encoding: "utf8",
      env: { ...process.env, PATH: "", GIT_CEILING_DIRECTORIES: tmpdir() },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
