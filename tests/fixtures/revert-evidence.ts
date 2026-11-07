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

/** Identify trusted runner modules or required slots without echoing arbitrary names or private paths. */
function resultLocation(name: unknown, names: readonly string[]): string {
  if (typeof name !== "string") return `<${name === null ? "null" : typeof name} name>`;
  const slot = names.indexOf(name);
  if (slot >= 0) return `required test ${slot + 1}`;
  const normalized = name.replaceAll("\\", "/").toLowerCase();
  for (const file of ["tests/typed-binding-hardening.test.ts", "tests/evidence-counts.test.ts"]) {
    if (normalized === file || normalized.endsWith(`/${file}`) || normalized === file.slice("tests/".length)) return file;
  }
  return "<unregistered string name>";
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
    let row: unknown;
    try { row = JSON.parse(line); }
    catch { assert.fail("invalid structured test result JSON; inspect reporter encoding"); }
    const name = ownField(row, "name");
    const location = resultLocation(name, names);
    assert.ok(typeof name === "string" && expected.has(name), `unexpected test result: ${location}; module syntax/import failures are not regression evidence`);
    assert.ok(!seen.has(name), `duplicate test result: ${location}`);
    seen.add(name);
    assert.ok(Object.is(ownField(row, "nesting"), 0), `expected a top-level acceptance test: ${location}`);
    assert.ok(ownField(row, "skip") === false, `required test was skipped: ${location}`);
    assert.ok(ownField(row, "todo") === false, `required test was marked todo: ${location}`);
    assert.ok(ownField(row, "verdict") === (name === failingTest ? "fail" : "pass"), `wrong named test verdict: ${location}`);
    if (name === failingTest) {
      assert.ok(ownField(row, "errorCode") === "ERR_ASSERTION", `target test must fail its own regression assertion: ${location}`);
      assert.ok(ownField(row, "failureType") === "testCodeFailure", `target failure must come from test code: ${location}`);
    }
  }
  assert.equal(seen.size, expected.size, "required named tests are missing");
  return seen.size;
}
