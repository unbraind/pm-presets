/** Keep unresolved upstream work distinct from delivered adapter mitigations. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { PmClient } from "@unbrained/pm-cli/sdk";
import { generateChangelog } from "pm-changelog";
import { verifyCloseoutAttribution } from "../scripts/verify-closeout-attribution.ts";

test("the canonical upstream follow-up stays open and out of generated Fixed entries", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-closeout-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, "tracker");
  cpSync(resolve(".agents/pm"), pmRoot, { recursive: true, filter: (source) => !/[\\/](locks|runtime|search|extensions|transactions)([\\/]|$)/.test(source) });
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
