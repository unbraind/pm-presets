import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

for (const scenario of ["parity", "refusal", "export-refusal", "presets"]) {
  test(`SDK template ${scenario} works without git or an enclosing repository`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "presets-template-sdk-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, [join(import.meta.dirname, "fixtures", "templates-sdk.ts"), scenario, root], {
      encoding: "utf8",
      env: { ...process.env, PATH: "", GIT_CEILING_DIRECTORIES: tmpdir() },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
