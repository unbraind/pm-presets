/** Compare built seed commands on disposable overlays of public tracker snapshots.
 * Usage: node scripts/sdk-seed-differential.ts <baseline-package> <tracker>...
 * Snapshot arguments are read-only inputs. No original tracker is modified.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { PmClient } from "@unbrained/pm-cli/sdk";
import { PRESET_REGISTRY } from "../src/registry.ts";
import { PRESET_SEEDS, seedPresetItems, type SeedItem, type SeedResult } from "../src/seeds.ts";

const [baseline, ...snapshots] = process.argv.slice(2);
assert.ok(baseline && snapshots.length > 0, "Supply a built baseline package and public tracker snapshots");
const candidate = resolve(import.meta.dirname, "..");
const cli = join(candidate, "node_modules", "@unbrained", "pm-cli", "dist", "cli.js");
const scratch = mkdtempSync(join(tmpdir(), "presets-seed-differential-"));

/** Digest authoritative snapshot bytes, excluding clone-local runtime data. */
function snapshotDigest(root: string): string {
  const hash = createHash("sha256");
  /** Visit deterministic paths without following links or printing source records. */
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) hash.update(relative(root, path)).update(readFileSync(path));
    }
  }
  visit(root);
  return hash.digest("hex");
}

/** Run both built commands with the same host and compare stable user output and created records. */
async function observe(packageRoot: string, snapshot: string, preset: string, dryRun: boolean): Promise<unknown> {
  const root = mkdtempSync(join(scratch, "overlay-"));
  const pmRoot = join(root, ".agents", "pm");
  cpSync(snapshot, pmRoot, { recursive: true });
  const extension = join(pmRoot, "extensions", "pm-presets");
  mkdirSync(extension, { recursive: true });
  for (const source of ["package.json", "manifest.json", "dist"]) cpSync(join(packageRoot, source), join(extension, source), { recursive: true });
  const client = new PmClient({ pmRoot, cwd: root });
  const original = (await client.listAllComplete()).items;
  const bin = join(root, "bin");
  mkdirSync(bin);
  // The baseline still needs a pm executable. Both builds get the exact pinned
  // host; this wrapper invokes no shell and adds no semantic create options.
  const launcher = join(bin, "pm");
  writeFileSync(launcher, `#!${process.execPath}\nconst {spawnSync}=require('node:child_process'); const r=spawnSync(process.execPath, [${JSON.stringify(cli)}, ...process.argv.slice(2)], {stdio:'inherit', env:process.env}); process.exit(r.status ?? 1);\n`);
  chmodSync(launcher, 0o755);
  const args = [cli, "--author", "differential-test", "presets", "apply", preset, "--with-seeds", "--force", ...(dryRun ? ["--dry-run"] : [])];
  const env = { ...process.env, PM_AUTHOR: "differential-test", HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, PATH: bin, GIT_CEILING_DIRECTORIES: tmpdir() };
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, `${preset}: ${result.stdout}${result.stderr}`);
  const after = (await client.listAllComplete()).items;
  const oldIds = new Set(original.map((item) => item.id));
  assert.deepEqual(after.filter((item) => oldIds.has(item.id)), original, "Existing public items must remain unchanged");
  const created = [];
  for (const item of after.filter((item) => !oldIds.has(item.id))) {
    const { id, created_at, updated_at, ...stable } = (await client.get(item.id, { full: true })).item;
    void id; void created_at; void updated_at;
    created.push(stable);
  }
  created.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  assert.equal(created.length, dryRun ? 0 : preset === "software-sprint" ? 2 : 1);
  return { status: result.status, stdout: result.stdout.replaceAll(root, "<workspace>"), stderr: result.stderr.replaceAll(root, "<workspace>"), created };
}

/** Compare partial-failure semantics and name the intentional native diagnostic difference. */
async function comparePartialFailure(): Promise<void> {
  const legacy = createRequire(import.meta.url)(join(resolve(baseline), "dist", "seeds.js")) as {
    PRESET_SEEDS: Record<string, SeedItem[]>;
    seedPresetItems: (root: string, id: string, bin: string) => SeedResult;
  };
  const seeds: SeedItem[] = [{ type: "UnknownSeedType", title: "Invalid seed" }, { type: "Task", title: "Valid seed" }];
  legacy.PRESET_SEEDS["differential-failure"] = seeds;
  PRESET_SEEDS["differential-failure"] = seeds;
  const results: SeedResult[] = [];
  try {
    for (const stage of ["before", "after"]) {
      const root = mkdtempSync(join(scratch, "failure-"));
      const pmRoot = join(root, ".agents", "pm");
      const client = new PmClient({ cwd: root, pmRoot, noExtensions: true, author: "differential-test" });
      await client.init();
      const launcher = join(root, "pm");
      const env = { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, PM_AUTHOR: "differential-test", PATH: "", GIT_CEILING_DIRECTORIES: tmpdir() };
      writeFileSync(launcher, `#!${process.execPath}\nconst {spawnSync}=require('node:child_process'); const r=spawnSync(process.execPath, [${JSON.stringify(cli)}, ...process.argv.slice(2)], {stdio:'inherit', env:{...process.env, ...${JSON.stringify(env)}}}); process.exit(r.status ?? 1);\n`);
      chmodSync(launcher, 0o755);
      const result = stage === "before" ? legacy.seedPresetItems(pmRoot, "differential-failure", launcher) : await seedPresetItems(client, "differential-failure");
      assert.equal(result.created, 1);
      assert.equal(result.failed, 1);
      const items = (await client.listAllComplete()).items;
      assert.equal(items.length, 1);
      assert.equal(items[0].title, "Valid seed");
      results.push(result);
    }
    const [before, after] = results;
    assert.equal(before.details[0].message, "Error: Invalid argument value");
    assert.match(after.details[0].message!, /Invalid type value "UnknownSeedType"/);
    // Only the detailed SDK diagnostic is intentionally different.
    assert.deepEqual({ ...after, details: after.details.map(({ message, ...entry }) => { void message; return entry; }) },
      { ...before, details: before.details.map(({ message, ...entry }) => { void message; return entry; }) });
    console.log("partial-failure comparison passed: counts, order and retained items match; intentional diagnostic difference: generic CLI headline -> native SDK invalid-type detail");
  } finally {
    delete legacy.PRESET_SEEDS["differential-failure"];
    delete PRESET_SEEDS["differential-failure"];
  }
}

try {
  let cases = 0;
  for (const snapshot of snapshots.map((path) => resolve(path))) {
    const before = snapshotDigest(snapshot);
    for (const preset of PRESET_REGISTRY) {
      for (const dryRun of [true, false]) {
        const old = await observe(resolve(baseline), snapshot, preset.id, dryRun);
        const current = await observe(candidate, snapshot, preset.id, dryRun);
        assert.deepEqual(current, old, `${preset.id} dryRun=${dryRun}`);
        cases++;
      }
    }
    assert.equal(snapshotDigest(snapshot), before, "Public tracker snapshot is a read-only input");
    console.log(`snapshot: sha256=${before}; 14 matching command observations`);
  }
  await comparePartialFailure();
  console.log(`${cases} differential cases passed; zero output or item-content differences; input snapshots unchanged`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
