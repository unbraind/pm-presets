/** Reproduce bounded, read-only stack validation using the committed public tracker snapshot. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import { PRESET_REGISTRY } from "../src/registry.ts";
import { planPresetStack, summarizePresetStack, StackRefusal, type PresetStackInput } from "../src/stack.ts";

const ref = process.argv[2] ?? "origin/main";
const archive = spawnSync("git", ["archive", "--format=tar", ref, "--", ".agents/pm"], { maxBuffer: 32 * 1024 * 1024 });
assert.equal(archive.status, 0, "Public tracker archive must succeed");
const source = spawnSync("git", ["rev-parse", `${ref}^{commit}`], { encoding: "utf8" });
assert.equal(source.status, 0);
const root = mkdtempSync(join(tmpdir(), "presets-public-stack-"));
const pmRoot = join(root, ".agents", "pm");
/** Retain relative content fingerprints, never private item values. */
function fingerprint() {
  const files = readdirSync(pmRoot, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name)).sort();
  const hash = createHash("sha256");
  let bytes = 0;
  for (const file of files) {
    const data = readFileSync(file);
    bytes += data.length;
    hash.update(file.slice(pmRoot.length)).update(data);
  }
  return { files: files.length, bytes, sha256: hash.digest("hex") };
}
try {
  const unpack = spawnSync("tar", ["-xf", "-", "-C", root], { input: archive.stdout });
  assert.equal(unpack.status, 0, "Public tracker extraction must succeed");
  const entries = readdirSync(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) chmodSync(join(entry.parentPath, entry.name), entry.isDirectory() ? 0o555 : 0o444);
  chmodSync(root, 0o555);
  const before = fingerprint();
  const client = new PmClient({ pmRoot, cwd: root, noExtensions: true });
  const census = await client.listAllComplete();
  const sdk = createExtensionCommandSdk(pmRoot, client, "public-stack-validation");
  const started = performance.now();
  let ready = 0, conflicts = 0, normalizationRefusals = 0, canonicalPairs = 0, maxJsonBytes = 0;
  /** Observe complete plans and account for typed normalization refusals. */
  async function observe(input: PresetStackInput) {
    try {
      const plan = await planPresetStack(pmRoot, sdk, input);
      maxJsonBytes = Math.max(maxJsonBytes, Buffer.byteLength(JSON.stringify(summarizePresetStack(plan))));
      if (plan.ready) ready++; else conflicts++;
      return plan;
    } catch (error) {
      assert.ok(error instanceof StackRefusal && error.code === "normalization_conflict");
      normalizationRefusals++;
      return null;
    }
  }
  for (const { id } of PRESET_REGISTRY) assert.ok((await observe({ selections: [{ preset: id, seeds: true }] }))?.ready);
  for (let left = 0; left < PRESET_REGISTRY.length; left++) {
    for (let right = left + 1; right < PRESET_REGISTRY.length; right++) {
      const a = PRESET_REGISTRY[left].id, b = PRESET_REGISTRY[right].id;
      const selections = [{ preset: a, seeds: true }, { preset: b, seeds: true }];
      const pending = await observe({ selections });
      assert.ok(pending && !pending.ready);
      const choices = Object.fromEntries(pending.ownership.filter((entry) => entry.conflict).map((entry) => [entry.path, entry.owners.includes(a) ? a : entry.owners[0]]));
      const forward = await observe({ selections, choices });
      const reverse = await observe({ selections: [...selections].reverse(), choices });
      assert.deepEqual(forward, reverse);
      canonicalPairs++;
      assert.ok((await observe({ selections: [{ preset: a }, { preset: b, settings: false, templates: false, seeds: true }] }))?.ready);
    }
  }
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  const after = fingerprint();
  assert.deepEqual(after, before, "Read-only source copy must remain byte-identical, including history");
  console.log(JSON.stringify({ source: source.stdout.trim(), items: census.items.length, snapshot: before,
    plans: ready + conflicts + normalizationRefusals, ready, conflicts, normalizationRefusals, canonicalPairs,
    maxJsonBytes, elapsedMs, unchanged: true, gitDirectory: false }, null, 2));
} finally {
  chmodSync(root, 0o755);
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) chmodSync(join(entry.parentPath, entry.name), 0o755);
  }
  rmSync(root, { recursive: true, force: true });
}
