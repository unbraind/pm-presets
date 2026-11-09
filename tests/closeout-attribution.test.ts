/** Keep unresolved upstream work distinct from delivered adapter mitigations. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { PmClient } from "@unbrained/pm-cli/sdk";
import { generateChangelog } from "pm-changelog";
import { verifyCloseoutAttribution } from "../scripts/verify-closeout-attribution.ts";

/** Copy persisted tracker data without local runtime state. */
function copyTracker(sourceRoot: string, pmRoot: string): void {
  cpSync(sourceRoot, pmRoot, { recursive: true, filter: (source) => !/(?:^|[\\/])(locks|runtime|search|extensions|transactions)(?:[\\/]|$)/.test(relative(sourceRoot, source)) });
}

test("tracker copies ignore excluded parent names while preserving persisted SDK data", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-closeout-copy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const excluded = ["locks", "runtime", "search", "extensions", "transactions"];
  for (const parent of excluded) {
    const project = join(root, parent, "package");
    mkdirSync(project, { recursive: true });
    const sourceRoot = join(project, ".agents", "pm");
    const client = new PmClient({ cwd: project, pmRoot: sourceRoot, noExtensions: true, author: "test-author" });
    await client.init();
    const { item } = await client.create({ type: "Issue", title: `Persisted tracker under ${parent}` });
    for (const name of excluded) {
      for (const prefix of [sourceRoot, join(sourceRoot, "nested")]) {
        mkdirSync(join(prefix, name), { recursive: true });
        writeFileSync(join(prefix, name, "ephemeral.txt"), "local runtime state");
        mkdirSync(join(prefix, `${name}-data`), { recursive: true });
        writeFileSync(join(prefix, `${name}-data`, "retained.txt"), "persisted fixture data");
      }
    }
    const pmRoot = join(root, `copy-${parent}`);
    copyTracker(sourceRoot, pmRoot);
    assert.ok(existsSync(pmRoot), `the ${parent} ancestor must not exclude the tracker root`);
    for (const name of excluded) {
      for (const prefix of [pmRoot, join(pmRoot, "nested")]) {
        assert.ok(!existsSync(join(prefix, name)), `${name} must be excluded within the tracker`);
        assert.equal(readFileSync(join(prefix, `${name}-data`, "retained.txt"), "utf8"), "persisted fixture data");
      }
    }
    for (const file of ["settings.json", join("issues", `${item.id}.toon`), join("history", `${item.id}.jsonl`)]) {
      assert.deepEqual(readFileSync(join(pmRoot, file)), readFileSync(join(sourceRoot, file)));
    }
    const copied = new PmClient({ cwd: root, pmRoot, noExtensions: true });
    const { items } = await copied.listAllComplete();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, item.id);
    assert.equal(items[0].title, item.title);
  }
});

test("the canonical upstream follow-up stays open and out of generated Fixed entries", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-closeout-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, "tracker");
  copyTracker(resolve(".agents/pm"), pmRoot);
  const client = new PmClient({ cwd: root, pmRoot, noExtensions: true });
  const { items } = await client.listAllComplete();
  const followup = items.find(({ id }) => id === "pm-7km8");
  assert.ok(followup);
  assert.equal(followup.status, "open", "adapter PR 170 does not repair the host SDK");
  assert.equal(followup.closed_at, undefined);
  assert.equal(followup.completed_at, undefined);
  assert.ok(!followup.resolution?.includes("Delivered by PR #170"));
  assert.ok(!generateChangelog({ items, version: "2026.11.5", date: "2026-11-05" }).includes(followup.title));
  assert.ok(!readFileSync("CHANGELOG.md", "utf8").includes(followup.title));
});

test("closeout rejects mitigation-only completion for every explicitly unresolved upstream item", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-closeout-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const client = new PmClient({ cwd: root, pmRoot: root, noExtensions: true, author: "test-author" });
  await client.init();
  const { item } = await client.create({ type: "Issue", title: "Synthetic unresolved host defect", tags: "upstream:unresolved" });
  assert.deepEqual(await verifyCloseoutAttribution(root), []);
  await client.update(item.id, { status: "closed", resolution: "Delivered by adapter mitigation PR", closeReason: "Adapter-only merge" });
  assert.equal((await verifyCloseoutAttribution(root)).length, 1);
  const generated = generateChangelog({ items: (await client.listAllComplete()).items, version: "2026.11.5", date: "2026-11-05" });
  assert.ok(generated.includes(item.title), "fixture must reproduce false Fixed attribution");
  const run = spawnSync(process.execPath, [resolve("scripts/verify-closeout-attribution.ts"), root], { encoding: "utf8" });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stderr, /unresolved upstream work cannot be attributed as delivered/);
  await client.schemaAddStatus("delivered", { role: ["terminal", "terminal_done"], alias: ["finished"] });
  await client.update(item.id, { status: "finished" });
  assert.equal((await verifyCloseoutAttribution(root)).length, 1, "custom done roles cannot bypass the gate");
  await client.update(item.id, { status: "open" });
  assert.deepEqual(await verifyCloseoutAttribution(root), []);
  assert.ok(!generateChangelog({ items: (await client.listAllComplete()).items, version: "2026.11.5", date: "2026-11-05" }).includes(item.title));
  await client.update(item.id, { status: "canceled", closeReason: "Duplicate upstream follow-up" });
  assert.deepEqual(await verifyCloseoutAttribution(root), [], "cancellation makes no delivered-fix claim");
  const workflow = readFileSync(".github/workflows/pm-github-closeout.yml", "utf8");
  assert.match(workflow, /post-closeout-script: "closeout:check"/);
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  assert.equal(manifest.scripts["closeout:check"], "npm run verify:closeout-attribution && npm run changelog:full -- --no-pending-release");
  assert.ok(manifest.scripts["release:check"].includes("npm run verify:closeout-attribution"));
});

test("all release-note generators exclude foreign upstream work, including historical snapshots", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-closeout-history-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const client = new PmClient({ cwd: root, pmRoot: root, noExtensions: true });
  await client.init();
  const upstream = (await client.create({ type: "Issue", title: "Synthetic host-only defect", tags: "upstream", status: "closed", closeReason: "Incorrect adapter-only attribution" })).item;
  const mitigation = (await client.create({ type: "Issue", title: "Package compatibility mitigation", status: "closed", closeReason: "Package guard delivered" })).item;
  const items = [upstream, mitigation];
  assert.ok(generateChangelog({ items }).includes(upstream.title));
  const corrected = generateChangelog({ items, excludeTags: ["upstream"] });
  assert.ok(!corrected.includes(upstream.title));
  assert.ok(corrected.includes(mitigation.title), "package mitigation remains visible");
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
  for (const command of Object.values(manifest.scripts).filter((command) => command.startsWith("pm-changelog "))) {
    assert.match(command, /--exclude-tag upstream(?:\s|$)/);
  }
  const release = readFileSync(".github/workflows/release.yml", "utf8");
  for (const command of release.split("\n").filter((line) => line.trim().startsWith("npx pm-changelog "))) {
    assert.match(command, /--exclude-tag upstream(?:\s|$)/);
  }
});
