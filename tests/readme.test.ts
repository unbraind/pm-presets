/** Preserve repository setup and reconciliation guidance beside non-git usage. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("README explains merge installation and reconciliation alongside non-git use", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const merge = readme.match(/## Multi-agent merge safety\n([\s\S]*?)\n## Without git\n/);
  assert.ok(merge, "merge safety must remain adjacent to non-git guidance");
  for (const instruction of ["npm run merge:install", "prepare", "scripts/prepare-merge-driver.ts", "pm merge reconcile --dry-run", "pm merge reconcile --message", "pm validate"]) {
    assert.ok(merge[1].includes(instruction), `missing merge guidance: ${instruction}`);
  }
  assert.match(readme, /## Without git\n[\s\S]*simulation work in plain directories/);
});
