/** Exercise validated seed selection in one real runtime and nongit SDK tracker. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import { requirePresetDefinition } from "../../src/catalog.ts";
import { computePresetDiff, readWorkspaceSnapshot } from "../../src/diff.ts";
import { applyPreset } from "../../src/presets/shared.ts";
import { SETTINGS, TEMPLATES, PARAMETERS } from "../../src/presets/startup-roadmap/index.ts";

const [root, order] = process.argv.slice(2);
assert.ok(root);
mkdirSync(root, { recursive: true });
const pmRoot = join(root, "tracker");
const client = new PmClient({ cwd: root, pmRoot, noExtensions: true });
await client.init();
const definition = requirePresetDefinition("startup-roadmap");
const snapshot = await readWorkspaceSnapshot(pmRoot, client);
for (const selected of order === "selected-first" ? [true, false] : [false, true]) {
  const diff = await computePresetDiff({ ...definition, seedItems: [] }, snapshot, { withSeeds: selected });
  assert.deepEqual(diff.seeds, { missing: [], changed: [], present: [] });
  for (const inventory of [undefined, null, {}, "invalid"]) {
    const invalid = { ...definition };
    Object.defineProperty(invalid, "seedItems", { value: inventory });
    if (selected) await assert.rejects(() => computePresetDiff(invalid, snapshot, { withSeeds: true }), { code: "invalid_manifest", exitCode: 2 });
    else assert.deepEqual((await computePresetDiff(invalid, snapshot)).seeds, { missing: [], changed: [], present: [] });
  }
}
const sdk = createExtensionCommandSdk(pmRoot, client);
await applyPreset({ command: "coverage-regression", args: [], options: { withSeeds: true, force: true }, global: { quiet: true }, pm_root: pmRoot, sdk }, {
  label: "Seed coverage", presetId: "startup-roadmap", settings: SETTINGS, templates: TEMPLATES, parameters: PARAMETERS, nextSteps: [],
});
const enrolled = await readWorkspaceSnapshot(pmRoot, client);
assert.equal((await computePresetDiff(definition, enrolled)).inSync, true);
await assert.rejects(() => computePresetDiff({ ...definition, seedItems: undefined }, enrolled), { code: "invalid_manifest", exitCode: 2 });
assert.equal((await client.listAllComplete()).items.length, definition.seedItems!.length);
