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

test("test depth defaults to full and quick retains a deterministic prefix of at least 25", async () => {
  const { testDepth } = await import("./support/depth.ts");
  const original = process.env.PM_TEST_DEPTH;
  try {
    for (const depth of [undefined, "full", "unknown", "quick"]) {
      if (depth === undefined) delete process.env.PM_TEST_DEPTH;
      else process.env.PM_TEST_DEPTH = depth;
      for (const count of [20, 32, 40, 120, 180, 500, 520, 600]) {
        const actual = testDepth(count);
        assert.ok(actual <= count);
        if (depth === "quick") assert.equal(actual, Math.min(count, Math.max(25, Math.ceil(count / 10))));
        else assert.equal(actual, count);
      }
    }
  } finally {
    if (original === undefined) delete process.env.PM_TEST_DEPTH;
    else process.env.PM_TEST_DEPTH = original;
  }
});

test("slow-runner safety budgets remain finite and reject invalid scales", async () => {
  const { testTime } = await import("./support/depth.ts");
  assert.equal(testTime(60_000, "1"), 60_000);
  assert.equal(testTime(60_000, "3"), 180_000);
  for (const value of ["", "0", "-1", "NaN", "Infinity", "100000000"]) {
    assert.throws(() => testTime(60_000, value), /PM_TEST_TIME_SCALE/);
  }
});
