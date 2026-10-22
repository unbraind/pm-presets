/** Regressions for immutable workflow dependencies and read-only CI checkouts. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const workflowsDir = resolve(import.meta.dirname, "../.github/workflows");

test("every external workflow action uses an immutable full commit SHA", () => {
  const files = readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = readFileSync(resolve(workflowsDir, file), "utf8");
    const references = [...source.matchAll(/^\s*(?:-\s+)?uses:\s*([^\s#]+)/gm)];
    assert.ok(references.length > 0, `${file}: expected workflow dependencies`);
    for (const [, reference] of references) {
      assert.match(reference, /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/, `${file}: mutable action ${reference}`);
    }
  }
});

test("every CI checkout disables persisted credentials before executing package code", () => {
  const source = readFileSync(resolve(workflowsDir, "ci.yml"), "utf8");
  const steps = source.split(/^      - /m);
  const checkouts = steps.filter((step) => /^\s*uses:\s*actions\/checkout@/m.test(step));
  assert.ok(checkouts.length > 0);
  for (const checkout of checkouts) {
    assert.match(checkout, /^        with:\s*\n(?:          [^\n]*\n)*?          persist-credentials: false\s*$/m);
  }
});
