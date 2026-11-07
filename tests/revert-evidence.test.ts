/** Adversarial real-process checks for complete, correctly attributed behavioral evidence. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import test from "node:test";
import { ACCEPTANCE_TEST_NAMES as names, assertNamedResults } from "./fixtures/revert-evidence.ts";
import { assertNoCredentials } from "./fixtures/params-secret-oracle.ts";

const repo = resolve(import.meta.dirname, "..");
const reporter = pathToFileURL(join(repo, "tests/fixtures/revert-evidence.ts")).href;
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
const header = 'import test from "node:test"; import assert from "node:assert/strict"; import { existsSync, readFileSync, writeFileSync } from "node:fs"; import { join } from "node:path";\n';

/** Generate actual Node tests with an independent required-name inventory. */
function declarations(change = -1, mode = "pass"): string[] {
  return names.flatMap((name, index) => {
    if (index === change && mode === "missing") return [];
    const method = index === change && ["skip", "todo"].includes(mode) ? `test.${mode}` : "test";
    const body = index !== change ? "" : mode === "assert" ? 'assert.fail("regression");'
      : mode === "error" ? 'throw new Error("ERR_ASSERTION");' : "";
    const options = index === change && mode === "cancelled" ? "{ signal: AbortSignal.abort() }, " : "";
    return [`${method}(${JSON.stringify(name)}, ${options}() => { ${body} });`];
  });
}

/** Run synthetic test declarations through the same structured reporter as the verifier. */
function runFixture(root: string, source: readonly string[], args: string[] = []) {
  const file = join(root, "cases.test.ts");
  writeFileSync(file, header + source.join("\n"));
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=2", `--test-reporter=${reporter}`, ...args, file], {
    cwd: root, encoding: "utf8", timeout: 30_000, env: childEnv,
  });
  assert.equal(result.error, undefined);
  return result;
}

test("evidence requires every named test without skips, todo, cancellation or filtered omissions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "presets-evidence-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(assertNamedResults(runFixture(root, declarations()), names), 4);
  for (let slot = 0; slot < names.length; slot++) {
    for (const mode of ["missing", "skip", "todo", "assert", "error", "cancelled"]) {
      const result = runFixture(root, declarations(slot, mode));
      assert.throws(() => assertNamedResults(result, names), `accepted ${mode} at ${slot}`);
    }
  }
  for (const source of [[], [...declarations(), declarations()[0]], declarations().map((line) => line.replace(names[0], "unexpected"))]) {
    assert.throws(() => assertNamedResults(runFixture(root, source), names));
  }
  assert.throws(() => assertNamedResults(runFixture(root, declarations(), ["--test-name-pattern=^no-match$"]), names));
});

test("mutation evidence requires the intended named assertion and passes every other test", (t) => {
  const root = mkdtempSync(join(tmpdir(), "presets-evidence-origin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (let slot = 0; slot < names.length; slot++) {
    const failed = runFixture(root, declarations(slot, "assert"));
    assert.equal(assertNamedResults(failed, names, names[slot]), 4);
    assert.throws(() => assertNamedResults(failed, names, names[(slot + 1) % names.length]));
    assert.throws(() => assertNamedResults(failed, names), "restoration must not accept a remaining failure");
    const misleading = runFixture(root, declarations(slot, "error"));
    assert.throws(() => assertNamedResults(misleading, names, names[slot]), "assertion text is not an assertion cause");
    const incomplete = runFixture(root, declarations(slot, "skip"));
    assert.throws(() => assertNamedResults({ ...incomplete, status: 1, stderr: "ERR_ASSERTION" }, names, names[slot]));
  }
  const noise = [...declarations(), 'console.log(JSON.stringify({name:"forged",verdict:"fail",errorCode:"ERR_ASSERTION"}));'];
  assert.equal(assertNamedResults(runFixture(root, noise), names), 4, "ordinary stdout must not become test evidence");
});

test("evidence rejects malformed, duplicate, nested, interrupted and truncated terminal records", (t) => {
  const root = mkdtempSync(join(tmpdir(), "presets-evidence-records-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const baseline = runFixture(root, declarations());
  const rows = baseline.stdout.trim().split("\n").map((line): Record<string, unknown> => JSON.parse(line));
  for (let slot = 0; slot < names.length; slot++) {
    for (const patch of [{ skip: true }, { todo: "" }, { nesting: 1 }, { name: "unknown" }, { verdict: "fail" }, { skip: undefined }]) {
      const changed = rows.map((row, index) => index === slot ? { ...row, ...patch } : row);
      assert.throws(() => assertNamedResults({ ...baseline, stdout: changed.map((row) => JSON.stringify(row)).join("\n") }, names));
    }
    assert.throws(() => assertNamedResults({ ...baseline, stdout: rows.filter((_, index) => index !== slot).map((row) => JSON.stringify(row)).join("\n") }, names));
  }
  for (const stdout of ["", "{", "null", "false", baseline.stdout + JSON.stringify(rows[0])]) {
    assert.throws(() => assertNamedResults({ ...baseline, stdout }, names));
  }
  assert.throws(() => assertNamedResults({ ...baseline, status: null, signal: "SIGTERM" }, names));
  assert.throws(() => assertNamedResults({ ...baseline, error: new Error("runner failed") }, names));
  assert.throws(() => assertNamedResults(baseline, []));
  assert.throws(() => assertNamedResults(baseline, [...names, names[0]]));
  assert.throws(() => assertNamedResults(baseline, names, "unknown"));
});

test("evidence diagnostics identify public runner files and required slots without exposing private payloads", (t) => {
  const root = mkdtempSync(join(tmpdir(), "presets-evidence-diagnostics-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const baseline = runFixture(root, declarations());
  assert.equal(assertNamedResults(baseline, names), names.length);
  const rows = baseline.stdout.trim().split("\n").map((line): Record<string, unknown> => JSON.parse(line));
  const secret = "synthetic-private-diagnostic-value-0123456789";
  assert.throws(() => assertNamedResults({ ...baseline, stdout: baseline.stdout.replace('"nesting":0', '"nesting":-0') }, names));
  for (const stdout of [secret, `{"name":"${secret}`]) {
    assert.throws(() => assertNamedResults({ ...baseline, stdout }, names), (error: unknown) => {
      const message = inspect(error);
      assert.match(message, /invalid structured test result JSON/);
      assertNoCredentials(message, [secret]);
      return true;
    });
  }
  for (const name of [join(root, secret, "tests/typed-binding-hardening.test.ts"), `C:\\${secret}\\tests\\evidence-counts.test.ts`, secret, { private: secret }, [secret], null]) {
    const stdout = JSON.stringify({ ...rows[0], name });
    assert.throws(() => assertNamedResults({ ...baseline, stdout }, names), (error: unknown) => {
      const message = inspect(error);
      assert.match(message, /unexpected test result:/);
      if (typeof name === "string" && name.endsWith(".test.ts")) assert.match(message, /tests[\/]\w[\w-]*\.test\.ts/);
      assertNoCredentials(message, [secret]);
      assert.ok(!message.includes(root));
      return true;
    });
  }
  for (let slot = 0; slot < names.length; slot++) {
    for (const field of ["nesting", "skip", "todo", "verdict", "errorCode", "failureType"]) {
      const failing = field === "errorCode" || field === "failureType";
      const changed = rows.map((row, index) => index === slot ? { ...row, verdict: failing ? "fail" : row.verdict, errorCode: "ERR_ASSERTION", failureType: "testCodeFailure", [field]: secret } : row);
      const result = { ...baseline, status: failing ? 1 : 0, stdout: changed.map((row) => JSON.stringify(row)).join("\n") };
      assert.throws(() => assertNamedResults(result, names, failing ? names[slot] : undefined), (error: unknown) => {
        const message = inspect(error);
        assert.match(message, new RegExp(`required test ${slot + 1}`));
        assertNoCredentials(message, [secret]);
        return true;
      });
    }
  }
  const file = join(root, "tests/typed-binding-hardening.test.ts");
  mkdirSync(join(root, "tests"));
  for (const source of ['import "./missing-module.ts";', 'import test from "node:test"; test(']) {
    writeFileSync(file, source);
    const failed = spawnSync(process.execPath, ["--test", "--test-concurrency=2", `--test-reporter=${reporter}`, file], { cwd: root, env: childEnv, encoding: "utf8", timeout: 30_000 });
    assert.equal(failed.error, undefined);
    assert.equal(failed.status, 1);
    assert.throws(() => assertNamedResults(failed, names, names[0]), (error: unknown) => {
      const message = inspect(error);
      assert.match(message, /unexpected test result: tests\/typed-binding-hardening\.test\.ts/);
      assert.match(message, /syntax\/import failures are not regression evidence/);
      assert.ok(!message.includes(root));
      return true;
    });
  }
});

test("the actual verifier never prints success for incomplete baselines or unrelated assertion failures", (t) => {
  const root = mkdtempSync(join(tmpdir(), "presets-evidence-verifier-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(repo, "src"), join(root, "src"), { recursive: true });
  mkdirSync(join(root, "tests/fixtures"), { recursive: true });
  for (const file of ["package.json", "tests/fixtures/typed-binding-revert.ts", "tests/fixtures/revert-evidence.ts", "tests/fixtures/params-secret-oracle.ts"]) cpSync(join(repo, file), join(root, file));
  symlinkSync(realpathSync(join(repo, "node_modules")), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  /** Exercise the real entrypoint in a disposable package, including its output ordering. */
  function verify(source: readonly string[]) {
    writeFileSync(join(root, "tests/typed-binding-hardening.test.ts"), header + source.join("\n"));
    const result = spawnSync(process.execPath, ["tests/fixtures/typed-binding-revert.ts"], { cwd: root, encoding: "utf8", timeout: 30_000, env: childEnv });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, "adversarial verifier invocation must refuse");
    return result.stdout;
  }
  for (let slot = 0; slot < names.length; slot++) for (const mode of ["missing", "skip", "todo"]) {
    assert.doesNotMatch(verify(declarations(slot, mode)), /baseline:|killed and restored:|revert proofs:/);
  }
  const unrelated = declarations();
  unrelated[1] = `test(${JSON.stringify(names[1])}, () => { assert.ok(!readFileSync(join(import.meta.dirname, "../src/presets/shared.ts"), "utf8").includes("parameterValues = resolved.values;")); });`;
  const output = verify(unrelated);
  assert.match(output, /baseline: 4\/4/);
  assert.doesNotMatch(output, /killed and restored:|revert proofs:/);
  const skippedRestoration = declarations();
  skippedRestoration[0] = `test(${JSON.stringify(names[0])}, (t) => {
    const file = join(import.meta.dirname, "invocations");
    const count = existsSync(file) ? Number(readFileSync(file, "utf8")) : 0;
    writeFileSync(file, String(count + 1));
    if (count === 1) assert.fail("synthetic mutation assertion");
    if (count > 1) t.skip("synthetic missing restoration coverage");
  });`;
  const restored = verify(skippedRestoration);
  assert.match(restored, /baseline: 4\/4/);
  assert.doesNotMatch(restored, /killed and restored:|revert proofs:/);
});
