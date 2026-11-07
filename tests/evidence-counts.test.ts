/** Execute actual reporting blocks with varying inventories, independent of CLI setup and cleanup. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInThisContext } from "node:vm";
import test from "node:test";
import { PmClient, getWorkspaceContracts } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import mod from "../src/index.ts";
import { PRESET_REGISTRY } from "../src/registry.ts";
import { bundledPresetComposition, compilePresetPlan, summarizePresetPlan } from "../src/plan.ts";
import { trackerBytes } from "./fixtures/params-secret-oracle.ts";

/** Read the explicit top-level reporting block without executing filesystem admission or cleanup. */
function reportingBlock(file: string, from?: string): string {
  const source = readFileSync(resolve(import.meta.dirname, "..", file), "utf8");
  const opening = "\ntry {\n", closing = "\n} finally {";
  const start = source.lastIndexOf(opening), end = source.lastIndexOf(closing);
  assert.ok(start >= 0 && end > start, "script must retain its top-level reporting/cleanup boundary");
  let block = source.slice(start + opening.length, end);
  if (from !== undefined) {
    const entry = block.indexOf(from);
    assert.ok(entry >= 0, "reporting block must retain its entry statement");
    block = block.slice(entry);
  }
  return stripTypeScriptTypes(`(async () => { ${block} })()`);
}

/** Execute trusted reporting code in the SDK's realm with explicitly supplied observation inputs. */
function runReporting(block: string, context: Record<string, unknown>): Promise<unknown> {
  const execute = runInThisContext(`((${Object.keys(context).join(",")}) => ${block})`) as (...args: unknown[]) => Promise<unknown>;
  return execute(...Object.values(context));
}

test("differential reports count completed comparisons for every tested inventory cardinality", async () => {
  const block = reportingBlock("scripts/sdk-seed-differential.ts");
  for (const size of [0, 1, 2, 5, 7, 9]) for (const snapshotCount of [1, 2]) {
    const output: string[] = [], observations: string[] = [];
    const context = {
      assert, resolve, baseline: "baseline", candidate: "candidate",
      snapshots: Array.from({ length: snapshotCount }, (_, index) => `synthetic-${index}`),
      PRESET_REGISTRY: Array.from({ length: size }, (_, index) => ({ id: `case-${index}` })),
      snapshotDigest: () => "unchanged-public-bytes",
      observe: async (packageRoot: string, snapshot: string, preset: string, dryRun: boolean) => {
        observations.push(packageRoot);
        return { snapshot, preset, dryRun };
      },
      comparePartialFailure: async () => {},
      console: { log: (line: string) => output.push(line) },
    };
    await runReporting(block, context);
    assert.equal(observations.length, size * snapshotCount * 4);
    assert.equal(output.length, snapshotCount + 1);
    for (const line of output.slice(0, -1)) assert.match(line, new RegExp(`; ${size * 2} matching command observations$`));
    assert.match(output.at(-1)!, new RegExp(`^${size * snapshotCount * 2} differential cases passed;`));
  }
});

test("differential reporting never emits a completed snapshot or total after a failed comparison", async () => {
  const block = reportingBlock("scripts/sdk-seed-differential.ts");
  for (const failAt of [0, 1, 3]) {
    const output: string[] = [];
    let calls = 0;
    const running = runReporting(block, {
      assert, resolve, baseline: "baseline", candidate: "candidate", snapshots: ["synthetic"],
      PRESET_REGISTRY: [{ id: "first" }, { id: "second" }], snapshotDigest: () => "unchanged",
      observe: async () => { if (calls++ === failAt) throw new Error("synthetic comparison refusal"); return {}; },
      comparePartialFailure: async () => {}, console: { log: (line: string) => output.push(line) },
    });
    await assert.rejects(running, /synthetic comparison refusal/);
    assert.deepEqual(output, []);
  }
});

test("public plan counts equal verified backend pairs across varying preset subsets in a nongit tracker", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "presets-plan-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const client = new PmClient({ pmRoot: root, noExtensions: true });
  await client.init();
  const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  assert.deepEqual(harness.activation.failed, []);
  const contracts = await getWorkspaceContracts(root, { extensionRegistrations: harness.activation.registrations });
  const census = await client.listAllComplete(), initial = trackerBytes(root);
  const block = reportingBlock("scripts/validate-plan-public.ts", "const started");
  for (const size of [0, 1, 3, 7, 9]) {
    const output: string[] = [];
    await runReporting(block, {
      assert, performance, Buffer, contracts, census, source: { stdout: "synthetic-commit" }, before: initial,
      PRESET_REGISTRY: Array.from({ length: size }, (_, index) => PRESET_REGISTRY[index % PRESET_REGISTRY.length]),
      bundledPresetComposition, compilePresetPlan, summarizePresetPlan, fingerprint: () => trackerBytes(root),
      console: { log: (line: string) => output.push(line) },
    });
    assert.equal(output.length, 1);
    const report: { pairedSemantics: number; plans: number; ready: number; refused: number; optionalOmissions: number } = JSON.parse(output[0]);
    assert.equal(report.pairedSemantics, size);
    assert.equal(report.plans, size * 6);
    assert.equal(report.ready, size * 2);
    assert.equal(report.refused, size * 2);
    assert.equal(report.optionalOmissions, size * 2);
    assert.equal(trackerBytes(root), initial);
  }
});
