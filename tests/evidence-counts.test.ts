/** Call the same reporting functions as both CLIs, independently of filesystem setup and cleanup. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PmClient, getWorkspaceContracts } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import mod from "../src/index.ts";
import { PRESET_REGISTRY } from "../src/registry.ts";
import { reportSeedComparisons } from "../scripts/sdk-seed-differential.ts";
import { reportPublicPlans } from "../scripts/validate-plan-public.ts";
import { trackerBytes } from "./fixtures/params-secret-oracle.ts";

test("differential reports count completed comparisons for every tested inventory cardinality", async () => {
  for (const size of [0, 1, 2, 5, 7, 9]) for (const snapshotCount of [1, 2]) {
    const output: string[] = [], observations: string[] = [];
    const context = {
      baseline: "baseline", candidate: "candidate",
      snapshots: Array.from({ length: snapshotCount }, (_, index) => `synthetic-${index}`),
      presets: Array.from({ length: size }, (_, index) => ({ id: `case-${index}` })),
      snapshotDigest: () => "unchanged-public-bytes",
      observe: async (packageRoot: string, snapshot: string, preset: string, dryRun: boolean) => {
        observations.push(packageRoot);
        return { snapshot, preset, dryRun };
      },
      comparePartialFailure: async () => {},
      log: (line: string) => output.push(line),
    };
    const count = await reportSeedComparisons(context);
    assert.equal(count, size * snapshotCount * 2);
    assert.equal(observations.length, size * snapshotCount * 4);
    assert.equal(output.length, snapshotCount + 1);
    for (const line of output.slice(0, -1)) assert.match(line, new RegExp(`; ${size * 2} matching command observations$`));
    assert.match(output.at(-1)!, new RegExp(`^${size * snapshotCount * 2} differential cases passed;`));
  }
});

test("differential reporting never emits a completed snapshot or total after a failed comparison", async () => {
  for (const failAt of [0, 1, 3]) {
    const output: string[] = [];
    let calls = 0;
    const running = reportSeedComparisons({
      baseline: "baseline", candidate: "candidate", snapshots: ["synthetic"],
      presets: [{ id: "first" }, { id: "second" }], snapshotDigest: () => "unchanged",
      observe: async () => { if (calls++ === failAt) throw new Error("synthetic comparison refusal"); return {}; },
      comparePartialFailure: async () => {}, log: (line: string) => output.push(line),
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
  for (const size of [0, 1, 3, 7, 9]) {
    const output: string[] = [];
    const actual = reportPublicPlans({
      contracts, source: "synthetic-commit", items: census.items.length, before: initial,
      presets: Array.from({ length: size }, (_, index) => PRESET_REGISTRY[index % PRESET_REGISTRY.length]),
      fingerprint: () => trackerBytes(root),
      log: (line: string) => output.push(line),
    });
    assert.equal(output.length, 1);
    const report: { pairedSemantics: number; plans: number; ready: number; refused: number; optionalOmissions: number } = JSON.parse(output[0]);
    assert.deepEqual(report, actual);
    assert.equal(report.pairedSemantics, size);
    assert.equal(report.plans, size * 6);
    assert.equal(report.ready, size * 2);
    assert.equal(report.refused, size * 2);
    assert.equal(report.optionalOmissions, size * 2);
    assert.equal(trackerBytes(root), initial);
  }
});
