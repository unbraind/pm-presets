/**
 * Tests for seed definitions and the pure dry-run plan / argv builder.
 * Imports the TypeScript sources directly so coverage is measured on the
 * lines an author edits.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/** Write an executable fake `pm` script and return its path. */
function writeFakePm(script: string): string {
  const directory = mkdtempSync(join(tmpdir(), "pm-presets-seed-bin-"));
  const bin = join(directory, "pm-fake");
  writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test("seedPresetItems counts successes and failures from the pm binary", (t) => {
  const okBin = writeFakePm("exit 0");
  const failBin = writeFakePm('echo "nope" >&2; exit 1');
  const stdoutBin = writeFakePm('echo "out only"; exit 2');
  t.after(() => {
    rmSync(join(okBin, ".."), { recursive: true, force: true });
    rmSync(join(failBin, ".."), { recursive: true, force: true });
    rmSync(join(stdoutBin, ".."), { recursive: true, force: true });
  });

  const ok = seedPresetItems("/ws", "indie-dev", okBin);
  assert.strictEqual(ok.created, 1);
  assert.strictEqual(ok.failed, 0);
  assert.deepStrictEqual(ok.details, [{ title: "Set up project skeleton", ok: true }]);

  const failed = seedPresetItems("/ws", "indie-dev", failBin);
  assert.strictEqual(failed.created, 0);
  assert.strictEqual(failed.failed, 1);
  assert.strictEqual(failed.details[0].ok, false);
  assert.strictEqual(failed.details[0].message, "nope");

  const stdout = seedPresetItems("/ws", "indie-dev", stdoutBin);
  assert.strictEqual(stdout.details[0].message, "out only");

  const missing = seedPresetItems("/ws", "indie-dev", join(tmpdir(), "pm-presets-no-such-pm"));
  assert.strictEqual(missing.created, 0);
  assert.strictEqual(missing.failed, 1);
  assert.equal(missing.details[0].ok, false);
  assert.ok((missing.details[0].message ?? "").length > 0);
});

test("seedPresetItems reports an empty message when the binary is silent", (t) => {
  const silent = writeFakePm("exit 1");
  t.after(() => rmSync(join(silent, ".."), { recursive: true, force: true }));
  const result = seedPresetItems("/ws", "indie-dev", silent);
  assert.strictEqual(result.failed, 1);
  assert.strictEqual(result.details[0].message, "");
});

test("runPresetSeeds logs the seedless case, a dry-run plan, successes, and failures", (t) => {
  const lines: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  t.mock.method(console, "warn", (...args: unknown[]) => {
    lines.push(`WARN ${args.map(String).join(" ")}`);
  });

  runPresetSeeds("/ws", "nope", { dryRun: false });
  assert.ok(lines.some((line) => line.includes("No starter seeds defined for 'nope'")));

  lines.length = 0;
  runPresetSeeds("/ws", "software-sprint", { dryRun: true });
  assert.ok(lines.some((line) => line.includes("Would seed 2 starter item(s)")));
  assert.ok(lines.some((line) => line.includes("Epic: First sprint epic")));

  const okBin = writeFakePm("exit 0");
  t.after(() => rmSync(join(okBin, ".."), { recursive: true, force: true }));
  lines.length = 0;
  runPresetSeeds("/ws", "indie-dev", { dryRun: false, pmBin: okBin });
  assert.ok(lines.some((line) => line.includes("Created: Set up project skeleton")));

  const failBin = writeFakePm('echo "boom" >&2; exit 1');
  t.after(() => rmSync(join(failBin, ".."), { recursive: true, force: true }));
  lines.length = 0;
  try {
    runPresetSeeds("/ws", "indie-dev", { dryRun: false, pmBin: failBin });
    assert.fail("expected throw");
  } catch (error) {
    assert.strictEqual((error as { exitCode?: number }).exitCode, 1);
    assert.match((error as Error).message, /Seeded 0 item\(s\) but 1 failed/);
    assert.ok(lines.some((line) => line.includes("Failed:  Set up project skeleton (boom)")));
  }

  const silent = writeFakePm("exit 1");
  t.after(() => rmSync(join(silent, ".."), { recursive: true, force: true }));
  lines.length = 0;
  try {
    runPresetSeeds("/ws", "indie-dev", { dryRun: false, pmBin: silent });
    assert.fail("expected throw");
  } catch {
    assert.ok(lines.some((line) => line === "WARN   Failed:  Set up project skeleton"));
  }
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
