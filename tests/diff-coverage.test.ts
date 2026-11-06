/** Verify every seed-selection branch is executable after its inventory guard. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

/** The raw V8 fields needed to audit one selected expression without percentage rounding. */
interface V8Script {
  url: string;
  functions: Array<{ functionName: string; isBlockCoverage: boolean; ranges: Array<{ startOffset: number; endOffset: number; count: number }> }>;
}

test("validated seed selection has no unexecutable V8 branch in either invocation order", (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-diff-coverage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceFile = resolve("src/diff.ts");
  const text = readFileSync(sourceFile, "utf8");
  // Bound the selected expression without assuming a line number or operator.
  const planStart = text.indexOf("const planInput = {");
  assert.notEqual(planStart, -1, "locate the desired-state input");
  const property = /^\s+seeds:\s*(.*),$/m.exec(text.slice(planStart));
  assert.ok(property, "locate the seed projection passed to the desired-state planner");
  const start = planStart + property.index + property[0].indexOf(property[1]);
  const end = start + property[1].length;
  for (const order of ["selected-first", "unselected-first"]) {
    const coverage = join(root, order, "coverage");
    const run = spawnSync(process.execPath, [resolve("tests/fixtures/diff-coverage-worker.ts"), join(root, order), order], {
      encoding: "utf8", timeout: 30_000,
      env: { ...process.env, NODE_V8_COVERAGE: coverage, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const reports = readdirSync(coverage).filter((file) => file.endsWith(".json"));
    assert.ok(reports.length > 0, "the independent runtime must flush real V8 counters");
    const scripts = reports.flatMap((file) => (JSON.parse(readFileSync(join(coverage, file), "utf8")) as { result: V8Script[] }).result)
      .filter(({ url }) => url === pathToFileURL(sourceFile).href);
    const functions = scripts.flatMap(({ functions }) => functions).filter(({ functionName, isBlockCoverage }) => functionName === "computePresetDiff" && isBlockCoverage);
    assert.ok(functions.length > 0, "computePresetDiff must actually execute in the SDK fixture");
    const branches = functions.flatMap(({ ranges }) => ranges).filter(({ startOffset, endOffset }) => startOffset >= start && endOffset <= end);
    assert.ok(branches.length > 0, "measure the seed-selection arms, rather than passing vacuously");
    assert.deepEqual(branches.filter(({ count }) => count === 0).map(({ startOffset, endOffset }) => text.slice(startOffset, endOffset)), [], `${order}: every seed-selection arm must execute`);
  }
});
