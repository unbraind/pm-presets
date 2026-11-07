/** Structured, named execution evidence shared by baseline, mutation and restoration checks. */
import assert from "node:assert/strict";
import type { SpawnSyncReturns } from "node:child_process";
import type { TestEvent } from "node:test/reporters";

/** Independent inventory: removing or renaming an acceptance test must invalidate its proof. */
export const ACCEPTANCE_TEST_NAMES = [
  "binding capture keeps settings, templates and seeds coherent during replacement",
  "desired artifact capture survives mutation of every public payload during normalization",
  "selected seeds require catalog membership before any tracker mutation",
  "legacy sensitive diffs refuse before normalization while external references remain usable",
] as const;

/** Read public error codes without serializing messages, stack traces or arbitrary diagnostics. */
function ownField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key] : undefined;
}

/** Emit only terminal Node test events; ordinary stdout/stderr cannot impersonate evidence. */
export default async function* evidenceReporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const error = event.type === "test:fail" ? event.data.details.error : undefined;
    yield JSON.stringify({
      name: event.data.name, nesting: event.data.nesting,
      verdict: event.type === "test:pass" ? "pass" : "fail",
      skip: event.data.skip !== undefined && event.data.skip !== false,
      todo: event.data.todo !== undefined && event.data.todo !== false,
      errorCode: ownField(ownField(error, "cause"), "code") ?? null,
      failureType: ownField(error, "failureType") ?? null,
    }) + "\n";
  }
}

/** Require every named test exactly once, with no incomplete verdict or unrelated failure. */
export function assertNamedResults(
  result: Pick<SpawnSyncReturns<string>, "status" | "signal" | "error" | "stdout" | "stderr">,
  names: readonly string[],
  failingTest?: string,
): number {
  assert.equal(result.error, undefined, "test runner must start and complete");
  assert.equal(result.signal, null, "test runner must not be interrupted");
  assert.equal(result.status, failingTest === undefined ? 0 : 1, "unexpected test runner exit status");
  const expected = new Set(names), seen = new Set<string>();
  assert.ok(expected.size > 0 && expected.size === names.length, "required test inventory must be nonempty and unique");
  assert.ok(failingTest === undefined || expected.has(failingTest), "failing test must belong to the required inventory");
  for (const line of result.stdout.split("\n").filter((line) => line.trim() !== "")) {
    const row: unknown = JSON.parse(line);
    const name = ownField(row, "name");
    assert.ok(typeof name === "string" && expected.has(name), "unexpected test result");
    assert.ok(!seen.has(name), "duplicate test result");
    seen.add(name);
    assert.equal(ownField(row, "nesting"), 0, "expected a top-level acceptance test");
    assert.equal(ownField(row, "skip"), false, "required test was skipped");
    assert.equal(ownField(row, "todo"), false, "required test was marked todo");
    assert.equal(ownField(row, "verdict"), name === failingTest ? "fail" : "pass", "wrong named test verdict");
    if (name === failingTest) {
      assert.equal(ownField(row, "errorCode"), "ERR_ASSERTION", "target test must fail its own regression assertion");
      assert.equal(ownField(row, "failureType"), "testCodeFailure", "target failure must come from test code");
    }
  }
  assert.equal(seen.size, expected.size, "required named tests are missing");
  return seen.size;
}
