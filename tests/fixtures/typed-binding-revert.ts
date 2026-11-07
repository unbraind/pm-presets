/** Reproduce saved-hardening behavioral reverts exclusively in disposable package copies. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ACCEPTANCE_TEST_NAMES, assertNamedResults } from "./revert-evidence.ts";

const repo = resolve(import.meta.dirname, "../..");
const root = mkdtempSync(join(tmpdir(), "presets-hardening-reverts-"));
const testFile = "tests/typed-binding-hardening.test.ts";

/** Run the complete inventory in an independent Node test process, with structured evidence. */
function run() {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=2", "--test-reporter=./tests/fixtures/revert-evidence.ts", testFile], {
    cwd: root, encoding: "utf8", timeout: 120_000, env: childEnv,
  });
  assert.equal(result.error, undefined, "acceptance runner must start and complete");
  return result;
}

const mutations = [
  { name: "binding values alias caller state", file: "src/presets/shared.ts", testName: ACCEPTANCE_TEST_NAMES[0], from: "parameterValues = { ...resolved.values };", to: "parameterValues = resolved.values;" },
  { name: "settings payload aliases caller state", file: "src/desired-state.ts", testName: ACCEPTANCE_TEST_NAMES[1], from: "const settings = structuredClone(sourceSettings);", to: "const settings = sourceSettings;" },
  { name: "template payload aliases caller state", file: "src/desired-state.ts", testName: ACCEPTANCE_TEST_NAMES[1], from: "const templates = structuredClone(checked.templates!);", to: "const templates = sourceTemplates;" },
  { name: "seed payload aliases caller state", file: "src/desired-state.ts", testName: ACCEPTANCE_TEST_NAMES[1], from: "const seedItems = checked.seeds === undefined ? undefined : structuredClone(checked.seeds);", to: "const seedItems = sourceSeeds;" },
  { name: "ownership record aliases caller state", file: "src/desired-state.ts", testName: ACCEPTANCE_TEST_NAMES[1], from: "const record = sourceRecord === undefined ? undefined : structuredClone(sourceRecord);", to: "const record = sourceRecord;" },
  { name: "selected catalog membership guard removed", file: "src/presets/shared.ts", testName: ACCEPTANCE_TEST_NAMES[2], from: 'if (withSeeds && !(await import("../registry.ts")).PRESET_REGISTRY.some(({ id }) => id === presetId))', to: "if (false)" },
  { name: "replacement privacy guard removed", file: "src/diff.ts", testName: ACCEPTANCE_TEST_NAMES[3], from: 'if (replace && [...secretPaths].some((name) => /^(governance|validation|testing)(?:\\.|$)/.test(name)))', to: "if (false)" },
  { name: "seed identifier privacy guard removed", file: "src/diff.ts", testName: ACCEPTANCE_TEST_NAMES[3], from: 'if (includeSeeds && [...secretPaths].some((name) => /^id_prefix(?:\\.|$)/.test(name)))', to: "if (false)" },
];

try {
  cpSync(join(repo, "src"), join(root, "src"), { recursive: true });
  mkdirSync(join(root, "tests/fixtures"), { recursive: true });
  for (const file of ["package.json", testFile, "tests/fixtures/params-secret-oracle.ts", "tests/fixtures/revert-evidence.ts"]) cpSync(join(repo, file), join(root, file));
  symlinkSync(realpathSync(join(repo, "node_modules")), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const baselineCount = assertNamedResults(run(), ACCEPTANCE_TEST_NAMES);
  console.log(`baseline: ${baselineCount}/${ACCEPTANCE_TEST_NAMES.length} acceptance tests pass`);
  for (const mutation of mutations) {
    const file = join(root, mutation.file), source = readFileSync(file, "utf8");
    assert.equal(source.split(mutation.from).length, 2, `unique behavioral mutation: ${mutation.name}`);
    try {
      writeFileSync(file, source.replace(mutation.from, mutation.to));
      assertNamedResults(run(), ACCEPTANCE_TEST_NAMES, mutation.testName);
    } finally {
      writeFileSync(file, source);
    }
    assertNamedResults(run(), ACCEPTANCE_TEST_NAMES);
    console.log(`killed and restored: ${mutation.name}`);
  }
  console.log(`revert proofs: ${mutations.length}/${mutations.length} killed; ${mutations.length}/${mutations.length} restorations pass`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
