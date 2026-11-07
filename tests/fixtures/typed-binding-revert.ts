/** Reproduce saved-hardening behavioral reverts exclusively in disposable package copies. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const root = mkdtempSync(join(tmpdir(), "presets-hardening-reverts-"));
const testFile = "tests/typed-binding-hardening.test.ts";

/** Run a selected acceptance scenario and retain safe diagnostics for unexpected outcomes. */
function run(pattern: string) {
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=2", `--test-name-pattern=${pattern}`, testFile], {
    cwd: root, encoding: "utf8", timeout: 120_000,
  });
  assert.equal(result.error, undefined, "acceptance runner must start and complete");
  return result;
}

const mutations = [
  { name: "binding values alias caller state", file: "src/presets/shared.ts", pattern: "^binding capture", from: "parameterValues = { ...resolved.values };", to: "parameterValues = resolved.values;" },
  { name: "settings payload aliases caller state", file: "src/desired-state.ts", pattern: "^desired artifact capture", from: "const settings = structuredClone(sourceSettings);", to: "const settings = sourceSettings;" },
  { name: "template payload aliases caller state", file: "src/desired-state.ts", pattern: "^desired artifact capture", from: "const templates = structuredClone(checked.templates!);", to: "const templates = sourceTemplates;" },
  { name: "seed payload aliases caller state", file: "src/desired-state.ts", pattern: "^desired artifact capture", from: "const seedItems = checked.seeds === undefined ? undefined : structuredClone(checked.seeds);", to: "const seedItems = sourceSeeds;" },
  { name: "ownership record aliases caller state", file: "src/desired-state.ts", pattern: "^desired artifact capture", from: "const record = sourceRecord === undefined ? undefined : structuredClone(sourceRecord);", to: "const record = sourceRecord;" },
  { name: "selected catalog membership guard removed", file: "src/presets/shared.ts", pattern: "^selected seeds", from: 'if (withSeeds && !(await import("../registry.ts")).PRESET_REGISTRY.some(({ id }) => id === presetId))', to: "if (false)" },
  { name: "replacement privacy guard removed", file: "src/diff.ts", pattern: "^legacy sensitive diffs", from: 'if (replace && [...secretPaths].some((name) => /^(governance|validation|testing)(?:\\.|$)/.test(name)))', to: "if (false)" },
  { name: "seed identifier privacy guard removed", file: "src/diff.ts", pattern: "^legacy sensitive diffs", from: 'if (includeSeeds && [...secretPaths].some((name) => /^id_prefix(?:\\.|$)/.test(name)))', to: "if (false)" },
];

try {
  cpSync(join(repo, "src"), join(root, "src"), { recursive: true });
  mkdirSync(join(root, "tests/fixtures"), { recursive: true });
  for (const file of ["package.json", testFile, "tests/fixtures/params-secret-oracle.ts"]) cpSync(join(repo, file), join(root, file));
  symlinkSync(realpathSync(join(repo, "node_modules")), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const baseline = run(".");
  assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  console.log("baseline: 4/4 acceptance tests pass");
  for (const mutation of mutations) {
    const file = join(root, mutation.file), source = readFileSync(file, "utf8");
    assert.equal(source.split(mutation.from).length, 2, `unique behavioral mutation: ${mutation.name}`);
    try {
      writeFileSync(file, source.replace(mutation.from, mutation.to));
      const reverted = run(mutation.pattern);
      assert.equal(reverted.status, 1, `revert must fail: ${mutation.name}\n${reverted.stdout}${reverted.stderr}`);
      assert.match(reverted.stdout + reverted.stderr, /ERR_ASSERTION/, "failure must come from a regression assertion");
    } finally {
      writeFileSync(file, source);
    }
    const restored = run(mutation.pattern);
    assert.equal(restored.status, 0, `restoration must pass: ${mutation.name}\n${restored.stdout}${restored.stderr}`);
    console.log(`killed and restored: ${mutation.name}`);
  }
  console.log(`revert proofs: ${mutations.length}/${mutations.length} killed; ${mutations.length}/${mutations.length} restorations pass`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
