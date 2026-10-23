/** Reproduce bounded, read-only plan validation using the committed public tracker snapshot. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { PmClient, getWorkspaceContracts } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import mod from "../src/index.ts";
import { PRESET_REGISTRY } from "../src/registry.ts";
import { bundledPresetComposition, compilePresetPlan, summarizePresetPlan } from "../src/plan.ts";

const ref = process.argv[2] ?? "origin/main";
const archive = spawnSync("git", ["archive", "--format=tar", ref, "--", ".agents/pm"], { maxBuffer: 32 * 1024 * 1024 });
assert.equal(archive.status, 0, "Public tracker archive must succeed");
const source = spawnSync("git", ["rev-parse", `${ref}^{commit}`], { encoding: "utf8" });
assert.equal(source.status, 0);
const root = mkdtempSync(join(tmpdir(), "presets-public-plan-"));
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
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  assert.deepEqual(harness.activation.failed, []);
  const contracts = await getWorkspaceContracts(pmRoot, { cwd: root, extensionRegistrations: harness.activation.registrations });
  const started = performance.now();
  let ready = 0, refused = 0, optional = 0, maxJsonBytes = 0;
  for (const descriptor of PRESET_REGISTRY) {
    const composition = bundledPresetComposition(descriptor.id, true);
    const paired = [];
    for (const backend of ["directory", "database"] as const) {
      const target = { backend, capabilities: ["settings.audit", "templates.write", "items.create"], contracts };
      const plan = compilePresetPlan(composition, target);
      assert.equal(plan.ready, true);
      ready++;
      paired.push({ ...plan, backend: "same" });
      const blocked = compilePresetPlan(composition, { ...target, capabilities: ["settings.audit", "items.create"] });
      assert.equal(blocked.ready, false);
      assert.deepEqual(blocked.refused, ["templates"]);
      refused++;
      const omitted = compilePresetPlan({ ...composition, features: [...composition.features, { id: "optional-integration", optional: true, requires: [{ kind: "command", name: "absent integration" }] }] }, target);
      assert.equal(omitted.ready, true);
      assert.deepEqual(omitted.omitted, ["optional-integration"]);
      optional++;
      for (const result of [plan, blocked, omitted]) maxJsonBytes = Math.max(maxJsonBytes, Buffer.byteLength(JSON.stringify(summarizePresetPlan(result))));
    }
    assert.deepEqual(paired[0], paired[1]);
  }
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  const after = fingerprint();
  assert.deepEqual(after, before, "Read-only source copy must remain byte-identical, including history");
  console.log(JSON.stringify({ source: source.stdout.trim(), items: census.items.length, snapshot: before,
    plans: ready + refused + optional, ready, refused, optionalOmissions: optional, pairedSemantics: 7,
    maxJsonBytes, elapsedMs, unchanged: true, gitDirectory: false }, null, 2));
} finally {
  chmodSync(root, 0o755);
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) chmodSync(join(entry.parentPath, entry.name), 0o755);
  }
  rmSync(root, { recursive: true, force: true });
}
