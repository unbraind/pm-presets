/**
 * Tests for seed definitions and the pure dry-run plan / argv builder.
 * Run after `npm run build`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const seeds = await import("../dist/seeds.js");
const { PRESET_SEEDS, seedsForPreset, buildSeedCreateArgs, planSeeds } = seeds;

test("every preset id has a seed definition", () => {
  const ids = ["bug-triage", "indie-dev", "open-source", "software-sprint", "startup-roadmap", "kanban"];
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
