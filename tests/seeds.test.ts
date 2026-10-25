/**
 * Tests for seed definitions and the pure dry-run plan / argv builder.
 * Imports the TypeScript sources directly so coverage is measured on the
 * lines an author edits.
 */

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PmClient } from "@unbrained/pm-cli/sdk";

import {
  PRESET_SEEDS,
  seedsForPreset,
  buildSeedCreateArgs,
  planSeeds,
  seedPresetItems,
  runPresetSeeds,
} from "../src/seeds.ts";

test("every preset id has a seed definition", () => {
  const ids = ["bug-triage", "indie-dev", "open-source", "software-sprint", "startup-roadmap", "kanban", "agent-workflow"];
  for (const id of ids) {
    assert.ok(Array.isArray(PRESET_SEEDS[id]) && PRESET_SEEDS[id].length > 0, `no seeds for ${id}`);
  }
});

test("seed items set only built-in fields (no custom scalar options, #97)", () => {
  const allowed = new Set(["type", "title", "priority", "tags", "body"]);
  for (const list of Object.values(PRESET_SEEDS)) {
    for (const seed of list) {
      for (const key of Object.keys(seed)) {
        assert.ok(allowed.has(key), `seed uses non-built-in field "${key}"`);
      }
      assert.ok(seed.type.length > 0);
      assert.ok(seed.title.length > 0);
    }
  }
});

test("buildSeedCreateArgs targets the workspace and uses built-in flags only", () => {
  const args = buildSeedCreateArgs("/ws/.agents/pm", {
    type: "Task",
    title: "Hello",
    priority: "2",
    tags: "a,b",
    body: "x",
  });
  assert.deepStrictEqual(args, [
    "--path",
    "/ws/.agents/pm",
    "create",
    "--type",
    "Task",
    "--title",
    "Hello",
    "--priority",
    "2",
    "--tags",
    "a,b",
    "--body",
    "x",
  ]);
});

test("buildSeedCreateArgs omits unset optional flags", () => {
  const args = buildSeedCreateArgs("/ws", { type: "Card", title: "T" });
  assert.ok(!args.includes("--priority"));
  assert.ok(!args.includes("--tags"));
  assert.ok(!args.includes("--body"));
});

test("planSeeds is pure and reflects the preset's seed list", () => {
  const plan = planSeeds("/ws", "software-sprint");
  assert.strictEqual(plan.length, seedsForPreset("software-sprint").length);
  for (const entry of plan) {
    assert.ok(entry.command.startsWith("pm --path /ws create"));
  }
});

test("unknown preset id yields no seeds", () => {
  assert.deepStrictEqual(seedsForPreset("nope"), []);
  assert.deepStrictEqual(planSeeds("/ws", "nope"), []);
});

/** Initialize a real tracker outside a git repository. */
async function workspace(t: TestContext): Promise<PmClient> {
  const root = mkdtempSync(join(tmpdir(), "pm-presets-seeds-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const client = new PmClient({ cwd: root, pmRoot: join(root, ".agents", "pm"), noExtensions: true, author: "seed-test" });
  await client.init();
  return client;
}

test("SDK seeds preserve author and ordered partial results without rolling back successes", async (t) => {
  const client = await workspace(t);
  PRESET_SEEDS["partial-test"] = [
    { type: "UnknownSeedType", title: "Refused seed" },
    { type: "Task", title: "Retained seed", tags: "starter,test", priority: "1", body: "Seed body" },
  ];
  t.after(() => { delete PRESET_SEEDS["partial-test"]; });
  const result = await seedPresetItems(client, "partial-test");
  assert.equal(result.created, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.details[0].ok, false);
  assert.match(result.details[0].message!, /UnknownSeedType/);
  assert.deepEqual(result.details[1], { title: "Retained seed", ok: true });
  const items = await client.listAllComplete();
  assert.equal(items.items.length, 1);
  assert.equal(items.items[0].title, "Retained seed");
  assert.equal(items.items[0].author, "seed-test");
  assert.deepEqual(items.items[0].tags, ["starter", "test"]);
  assert.equal((await client.get(items.items[0].id, { full: true })).item.body, "Seed body");
  assert.equal(items.items[0].priority, 1);
  assert.deepEqual(await seedPresetItems(client, "nope"), { created: 0, failed: 0, details: [] });
});

test("SDK seed failures tolerate thrown extension values and empty diagnostics", async (t) => {
  const client = await workspace(t);
  // Options are read by the real SDK. A provider's accessor can throw before
  // native validation; reporting must still finish the remaining seeds.
  // Keep the title readable for reporting; fail on the optional body accessor.
  PRESET_SEEDS["accessor-test"] = [
    { type: "Task", title: "Foreign refusal", get body(): string { throw "provider refusal\nextra detail"; } },
    { type: "Task", title: "Empty refusal", get body(): string { throw new Error(""); } },
  ];
  t.after(() => { delete PRESET_SEEDS["accessor-test"]; });
  const result = await seedPresetItems(client, "accessor-test");
  assert.equal(result.failed, 2);
  assert.deepEqual(result.details.map((entry) => entry.message), ["provider refusal", ""]);
});

test("runPresetSeeds logs seedless, preview, success and native failure outcomes", async (t) => {
  const client = await workspace(t);
  const lines: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
  t.mock.method(console, "warn", (...args: unknown[]) => { lines.push(`WARN ${args.map(String).join(" ")}`); });
  await runPresetSeeds("/ws", "nope", { dryRun: false });
  assert.ok(lines.some((line) => line.includes("No starter seeds defined for 'nope'")));
  lines.splice(0);
  await runPresetSeeds("/ws", "software-sprint", { dryRun: true });
  assert.ok(lines.some((line) => line.includes("Would seed 2 starter item(s)")));
  assert.ok(lines.some((line) => line.includes("Epic: First sprint epic")));
  assert.equal((await client.listAllComplete()).items.length, 0);
  lines.splice(0);
  await runPresetSeeds("/ws", "indie-dev", { dryRun: false, client });
  assert.ok(lines.some((line) => line.includes("Created: Set up project skeleton")));
  assert.equal((await client.listAllComplete()).items.length, 1);
  await assert.rejects(() => runPresetSeeds("/ws", "indie-dev", { dryRun: false }), /host SDK client.create/);
  PRESET_SEEDS["refusal-test"] = [
    { type: "UnknownSeedType", title: "Invalid seed" },
    { type: "Task", title: "Empty diagnostic", get body(): string { throw new Error(""); } },
  ];
  t.after(() => { delete PRESET_SEEDS["refusal-test"]; });
  lines.splice(0);
  await assert.rejects(() => runPresetSeeds("/ws", "refusal-test", { dryRun: false, client }), (error: unknown) => {
    assert.equal((error as { exitCode: number }).exitCode, 1);
    assert.match((error as Error).message, /Seeded 0 item\(s\) but 2 failed/);
    return true;
  });
  assert.ok(lines.some((line) => line.includes("Failed:  Invalid seed (") && line.includes("UnknownSeedType")));
  assert.ok(lines.some((line) => line === "WARN   Failed:  Empty diagnostic"));
});

test("agent-workflow has a starter AgentRun seed", () => {
  const list = seedsForPreset("agent-workflow");
  assert.ok(Array.isArray(list) && list.length > 0);
  assert.strictEqual(list[0].type, "AgentRun");
  const plan = planSeeds("/ws", "agent-workflow");
  assert.ok(plan.length === list.length);
  for (const entry of plan) {
    assert.ok(entry.command.startsWith("pm --path /ws create --type AgentRun"));
  }
});
