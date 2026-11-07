/** Property checks must survive script formatting without executing either CLI's filesystem setup. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { assertNamedResults } from "./fixtures/revert-evidence.ts";

const countNames = [
  "differential reports count completed comparisons for every tested inventory cardinality",
  "differential reporting never emits a completed snapshot or total after a failed comparison",
  "public plan counts equal verified backend pairs across varying preset subsets in a nongit tracker",
];

test("reporting properties survive line endings, brace layout and timing-local renaming", (t) => {
  const repo = resolve(import.meta.dirname, ".."), root = mkdtempSync(join(tmpdir(), "presets-report-formatting-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(repo, "src"), join(root, "src"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "tests/fixtures"), { recursive: true });
  for (const file of ["package.json", "scripts/main-invocation.ts", "tests/evidence-counts.test.ts", "tests/fixtures/params-secret-oracle.ts", "tests/fixtures/revert-evidence.ts"]) cpSync(join(repo, file), join(root, file));
  symlinkSync(realpathSync(join(repo, "node_modules")), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const scripts = ["scripts/sdk-seed-differential.ts", "scripts/validate-plan-public.ts"];
  const sources = scripts.map((file) => readFileSync(join(repo, file), "utf8"));
  const variants = [
    { name: "LF", change: (source: string) => source },
    { name: "CRLF", change: (source: string) => source.replace(/\r?\n/g, "\r\n") },
    { name: "alternate braces", change: (source: string) => source.replaceAll("try {", "try\n{").replaceAll("} finally {", "}\nfinally\n{") },
    { name: "renamed timing local", change: (source: string) => source.replace(/\bstarted\b/g, "observationStart") },
  ];
  for (const variant of variants) {
    for (let index = 0; index < scripts.length; index++) writeFileSync(join(root, scripts[index]), variant.change(sources[index]));
    const result = spawnSync(process.execPath, ["--test", "--test-concurrency=2", "--test-reporter=./tests/fixtures/revert-evidence.ts", "tests/evidence-counts.test.ts"], {
      cwd: root, env: childEnv, encoding: "utf8", timeout: 60_000,
    });
    assert.equal(result.error, undefined, `${variant.name}: property runner must complete`);
    assert.equal(result.status, 0, `${variant.name}: reporting properties must pass`);
    assert.equal(assertNamedResults(result, countNames), countNames.length, variant.name);
  }
});
