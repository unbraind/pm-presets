/**
 * params-property.test.ts — seeded model-based property test for the parameter
 * round-trip paths.
 *
 * Runs 520+ random operation sequences against real, non-git temp pm trackers
 * (in-process SDK, no pm executable, no git), including replays of older
 * inputs, whitespace/CRLF/unicode value variants, secret containment and
 * invalid-input refusals. Every state comparison reads the tracker back
 * THROUGH THE SDK (readSettings, loadCreateTemplateOptions, PmClient) and
 * checks it against a simple reference model built from the generator's own
 * expectations — never against a second hand-written normalizer.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { createExtensionCommandSdk, loadCreateTemplateOptions, PmClient, readSettings, runTemplatesList } from "@unbrained/pm-cli/sdk";
import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk/authoring";

import {
  buildExportedPreset,
  readWorkspaceSettings,
  readWorkspaceTemplates,
} from "../src/export.ts";
import { computePresetDiff, readWorkspaceSnapshot } from "../src/diff.ts";
import { applyPreset } from "../src/presets/shared.ts";
import {
  ParameterRefusal,
  resolveParameterValues,
  resolveParameterizedPreset,
  type PresetParameter,
  type PresetParameterManifest,
} from "../src/params.ts";
import { runPresetSeeds, type SeedItem } from "../src/seeds.ts";
import { SETTINGS, TEMPLATES, PARAMETERS } from "../src/presets/startup-roadmap/index.ts";

/** Reproducible PRNG (mulberry32) so every failure can be replayed by seed. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = Number(process.env.PM_PRESETS_PROPERTY_SEED ?? "20261027");
const SEQUENCE_COUNT = 520;
const TRACKER_BATCH = 20;

/** One successful application recorded for later replays. */
interface AppliedInput {
  readonly raw: string;
  readonly value: string;
}

/** Snapshot of tracker bytes used to prove refusals write nothing. */
interface StateSnapshot {
  readonly settings: string;
  readonly templates: Record<string, string>;
  readonly itemCount: number;
}

/** Build a command context bound to the tracker's shared SDK client. */
function context(pmDir: string, client: PmClient, options: Record<string, unknown>): CommandHandlerContext {
  return {
    command: "property-test",
    args: [],
    options,
    global: { json: true, quiet: true, noPager: true },
    pm_root: pmDir,
    sdk: createExtensionCommandSdk(pmDir, client),
  };
}

/** Apply the bundled parameterized preset with the given raw supplied value. */
async function applyRoadmap(pmDir: string, client: PmClient, raw: string): Promise<void> {
  await applyPreset(context(pmDir, client, { param: [`projectKey=${raw}`], force: true }), {
    label: "Startup roadmap",
    settings: SETTINGS,
    templates: TEMPLATES,
    parameters: PARAMETERS,
    nextSteps: [],
  });
}

/** Capture the raw tracker bytes for refusal no-write proofs. */
function snapshot(pmDir: string, itemCount: number): StateSnapshot {
  const templates: Record<string, string> = {};
  const templatesDir = join(pmDir, "templates");
  if (existsSync(templatesDir)) {
    for (const entry of readdirSync(templatesDir)) {
      templates[entry] = readFileSync(join(templatesDir, entry), "utf8");
    }
  }
  return { settings: readFileSync(join(pmDir, "settings.json"), "utf8"), templates, itemCount };
}

/** Assert the snapshot is byte-identical (a refusal wrote nothing). */
function assertUnchanged(before: StateSnapshot, after: StateSnapshot): void {
  assert.equal(after.settings, before.settings);
  assert.deepEqual(after.templates, before.templates);
  assert.equal(after.itemCount, before.itemCount);
}

/** Reference-model check: the value reached every declared occurrence, read back through the SDK. */
async function assertValueReachedEveryOccurrence(pmDir: string, value: string): Promise<void> {
  const settings = await readSettings(pmDir);
  assert.equal(settings.id_prefix, `${value}-`, "settings.id_prefix occurrence must carry the value");
  const inventory = await runTemplatesList({ path: pmDir, noExtensions: true });
  for (const name of ["initiative", "feature", "milestone"]) {
    assert.ok(inventory.user_templates.includes(name), `template ${name} must be installed`);
    const options = await loadCreateTemplateOptions(pmDir, name);
    const serialized = JSON.stringify(options);
    assert.ok(!serialized.includes("${param:"), `template ${name} must not keep binding syntax: ${serialized}`);
    if (name !== "milestone") {
      assert.ok(String(options.body ?? "").includes(`## Project\n${value}`), `template ${name} body occurrence must carry ${value}`);
    }
  }
}

/** A random valid project key: lowercase start, [a-z0-9-], 1-6 chars. */
function randomKey(rng: () => number): string {
  const alphabet = "abcdefghij0123456789-";
  const length = 1 + Math.floor(rng() * 6);
  let key = "k";
  for (let index = 1; index < length; index += 1) {
    key += alphabet[Math.floor(rng() * alphabet.length)];
  }
  return key;
}

test("model-based property sequences round-trip parameters through the SDK against a reference model", async (t) => {
  const rng = mulberry32(SEED);
  const history: AppliedInput[] = [];
  const logs: string[] = [];
  // Replace (rather than t.mock) the process-wide log/warn: applyPreset logs
  // ~a dozen lines per apply and test-runner mock interception per call is the
  // single largest cost in a 500-sequence run.
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.warn = () => {};
  t.after(() => {
    console.log = originalLog;
    console.warn = originalWarn;
  });
  let root: string | undefined;
  let pmDir: string | undefined;
  let client: PmClient | undefined;
  let modelItemCount = 0;

  /** Create the next non-git tracker (batches keep the run time bounded). */
  async function nextTracker(): Promise<void> {
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
    root = mkdtempSync(join(tmpdir(), "pm-presets-prop-"));
    pmDir = join(root, ".agents", "pm");
    client = new PmClient({ pmRoot: pmDir, cwd: root, noExtensions: true });
    await client.init();
    modelItemCount = (await client.listAllItemMetadataLight()).length;
  }

  t.after(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await nextTracker();
  for (let sequence = 0; sequence < SEQUENCE_COUNT; sequence += 1) {
    if (sequence % TRACKER_BATCH === 0 && sequence > 0) {
      await nextTracker();
    }
    const activePmDir = pmDir as string;
    const activeClient = client as PmClient;
    const op = rng();

    if (op < 0.5) {
      // APPLY: a fresh (possibly whitespace-padded) value must reach every occurrence.
      const base = randomKey(rng);
      const padded = rng() < 0.3;
      const raw = padded ? `  ${base} ` : base;
      await applyRoadmap(activePmDir, activeClient, raw);
      await assertValueReachedEveryOccurrence(activePmDir, base);
      history.push({ raw, value: base });
    } else if (op < 0.65 && history.length > 0) {
      // REPLAY: an older input must overwrite every occurrence again.
      const older = history[Math.floor(rng() * history.length)];
      await applyRoadmap(activePmDir, activeClient, older.raw);
      await assertValueReachedEveryOccurrence(activePmDir, older.value);
    } else if (op < 0.85) {
      // REFUSE: invalid input must refuse before writes with a typed code, and
      // leave every tracker byte (settings, templates, items) untouched.
      const invalid: Array<[string, string]> = [
        ["ACME", "invalid_value"],
        ["ünïcode", "invalid_value"],
        ["a\nb", "invalid_value"],
        ["a\rb", "invalid_value"],
        ["", "invalid_param_flag"],
        ["x".repeat(20), "invalid_value"],
        ["  ", "invalid_param_flag"],
      ];
      const [raw, code] = invalid[Math.floor(rng() * invalid.length)];
      const before = snapshot(activePmDir, modelItemCount);
      await assert.rejects(() => applyRoadmap(activePmDir, activeClient, raw), (error: unknown) => {
        assert.ok(error instanceof ParameterRefusal, `expected ParameterRefusal, got ${String(error)}`);
        assert.equal(error.code, code);
        return true;
      });
      assertUnchanged(before, snapshot(activePmDir, (await activeClient.listAllItemMetadataLight()).length));
      if (rng() < 0.3) {
        // Unknown supplied names refuse as well, also without writes.
        await assert.rejects(
          () => applyPreset(context(activePmDir, activeClient, { param: ["ghost=1"], force: true }), {
            label: "Startup roadmap",
            settings: SETTINGS,
            templates: TEMPLATES,
            parameters: PARAMETERS,
            nextSteps: [],
          }),
          /unknown_parameter/,
        );
        assertUnchanged(before, snapshot(activePmDir, (await activeClient.listAllItemMetadataLight()).length));
      }
    } else if (op < 0.95) {
      // SEEDS: create a starter item under random ambient session focus; the
      // resolved prose must match and the focus must NOT be inherited as parent.
      const value = history.length > 0 ? history[Math.floor(rng() * history.length)].value : randomKey(rng);
      const items = await activeClient.listAllItemMetadataLight();
      if (items.length > 0) {
        const focusId = items[Math.floor(rng() * items.length)].id;
        await activeClient.focus(focusId);
      }
      const beforeIds = new Set(items.map((item) => item.id));
      const seedLogStart = logs.length;
      await runPresetSeeds(activePmDir, "startup-roadmap", {
        dryRun: false,
        client: activeClient,
        suppliedParameters: { projectKey: value },
      });
      const afterSeeds = await activeClient.listAllItemMetadataLight();
      const created = afterSeeds.filter((item) => !beforeIds.has(item.id));
      assert.equal(created.length, 1, "exactly one seed item must be created");
      assert.equal(created[0].title, `Define the ${value} first roadmap initiative`);
      assert.equal(created[0].parent, undefined, "ambient session focus must not become the seed's parent");
      const full = (await activeClient.run("get", { id: created[0].id, full: true })) as { item: { body?: string } };
      assert.equal(
        full.item.body,
        `Starter initiative for the ${value} project seeded by pm-presets. Replace with a real initiative.`,
        "the seed body occurrence must carry the value",
      );
      assert.ok(logs.slice(seedLogStart).some((line) => line.includes("Seeding 1 starter item")));
      modelItemCount += 1;
    } else {
      // EXPORT + DIFF: the export path must snapshot exactly what the SDK reads
      // back, and the diff preview must agree with the model's in-sync verdict.
      const value = history.length > 0 ? history[history.length - 1].value : "road";
      const settings = await readWorkspaceSettings(activePmDir);
      assert.ok(settings, "an applied tracker must export its settings");
      const templates = await readWorkspaceTemplates(activePmDir);
      const exported = buildExportedPreset({ name: "prop", displayName: "Prop", settings, templates });
      const sdkSettings = await readSettings(activePmDir);
      assert.equal(exported.settings.id_prefix, sdkSettings.id_prefix);
      for (const template of exported.templates) {
        assert.deepEqual(
          template.options,
          await loadCreateTemplateOptions(activePmDir, template.name),
          "exported template options must equal the SDK read-back",
        );
      }
      const definition = {
        id: "startup-roadmap" as const,
        displayName: "Startup roadmap",
        description: "",
        command: "roadmap-setup",
        idPrefix: `${value}-`,
        governance: "custom" as const,
        settings: { id_prefix: `${value}-` },
        templates: ["initiative", "feature", "milestone"].map((name) => ({ name, type: "Feature", optionKeys: [] })),
        itemTypes: [],
        parameters: [],
      };
      const result = computePresetDiff(definition, readWorkspaceSnapshot(activePmDir));
      assert.equal(result.inSync, sdkSettings.id_prefix === `${value}-`, "diff preview must agree with the reference model");
    }
  }
  assert.ok(history.length > 50, `expected many applied sequences, got ${history.length}`);
});

test("synthetic manifests resolve to the generator's expected strings or typed refusals", () => {
  const rng = mulberry32(SEED ^ 0x5f5f);
  for (let sequence = 0; sequence < 600; sequence += 1) {
    const nameCount = 1 + Math.floor(rng() * 3);
    const declared: PresetParameter[] = [];
    const expectedValues: Record<string, string> = {};
    for (let index = 0; index < nameCount; index += 1) {
      const parameter: PresetParameter =
        index % 3 === 0
          ? { name: `key${index}`, type: "string", required: true, pattern: "[a-z][a-z0-9-]{0,7}", maxLength: 8 }
          : index % 3 === 1
            ? { name: `mode${index}`, type: "enum", required: true, values: ["core", "community"] }
            : { name: `secret${index}`, type: "secret", required: false };
      declared.push(parameter);
      if (rng() < 0.2 && parameter.required) {
        // Leave this one unanswered: the manifest must refuse resolution.
      } else if (parameter.type === "enum") {
        expectedValues[parameter.name] = rng() < 0.5 ? "core" : "community";
      } else {
        expectedValues[parameter.name] = randomKey(rng);
      }
    }
    const manifest: PresetParameterManifest = declared;
    const unansweredRequired = manifest.filter(
      (parameter) => parameter.required && !Object.hasOwn(expectedValues, parameter.name),
    );
    if (unansweredRequired.length > 0) {
      assert.throws(() => resolveParameterValues(manifest, expectedValues), /unanswered_parameter|invalid_manifest/);
      continue;
    }
    const values = resolveParameterValues(manifest, expectedValues).values;
    // The generator's own expectation (string concatenation, not the engine):
    const settingsTemplate = `prefix ${"$"}{param:key0}-`;
    const seeds: SeedItem[] = manifest
      .filter((parameter) => parameter.type !== "secret")
      .map((parameter) => ({ type: "Task", title: `Run ${"$"}{param:${parameter.name}} now` }));
    const resolved = resolveParameterizedPreset(manifest, values, {
      settings: { id_prefix: settingsTemplate },
      seeds,
    });
    assert.equal(resolved.settings?.id_prefix, `prefix ${expectedValues["key0"]}-`);
    assert.deepEqual(
      resolved.seeds?.map((seed) => seed.title),
      manifest
        .filter((parameter) => parameter.type !== "secret")
        .map((parameter) => `Run ${values[parameter.name]} now`),
    );
    // Secrets never reach public seed prose: binding one refuses without echo.
    if (manifest.some((parameter) => parameter.type === "secret")) {
      const secretName = (manifest.find((parameter) => parameter.type === "secret") as PresetParameter).name;
      assert.throws(
        () => resolveParameterizedPreset(manifest, values, {
          seeds: [{ type: "Task", title: `Token ${"$"}{param:${secretName}}` }],
        }),
        (error: unknown) => {
          assert.ok(error instanceof ParameterRefusal);
          assert.equal(error.code, "secret_in_public_prose");
          assert.ok(!error.message.includes(values[secretName]));
          return true;
        },
      );
    }
  }
});

test("concurrent parameterized applies on one non-git tracker stay consistent with some serial order", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pm-presets-concurrent-"));
  const pmDir = join(root, ".agents", "pm");
  const client = new PmClient({ pmRoot: pmDir, cwd: root, noExtensions: true });
  await client.init();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  const left = randomKey(mulberry32(SEED ^ 0x1234)) + "aa";
  const right = randomKey(mulberry32(SEED ^ 0x5678)) + "bb";
  const outcomes = await Promise.allSettled([
    applyRoadmap(pmDir, client, left),
    applyRoadmap(pmDir, client, right),
    runPresetSeeds(pmDir, "startup-roadmap", { dryRun: false, client, suppliedParameters: { projectKey: left } }),
    runPresetSeeds(pmDir, "startup-roadmap", { dryRun: false, client, suppliedParameters: { projectKey: right } }),
  ]);
  // The audited settings mutation and item locks serialize; at least one of
  // each pair must have committed, and nothing may corrupt the tracker.
  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
  assert.ok(fulfilled >= 2, `expected at least one apply and one seed run to commit: ${outcomes.map((outcome) => outcome.status).join(",")}`);
  const settings = await readSettings(pmDir);
  assert.ok(
    settings.id_prefix === `${left}-` || settings.id_prefix === `${right}-`,
    `final prefix must match one of the concurrent applies: ${settings.id_prefix}`,
  );
  const items = await client.listAllItemMetadataLight();
  for (const item of items) {
    assert.ok(
      item.title === `Define the ${left} first roadmap initiative` || item.title === `Define the ${right} first roadmap initiative`,
      `seed title must match its own invocation's value: ${item.title}`,
    );
    assert.equal(item.parent, undefined);
  }
  // Template writes happen outside the audited settings transaction, so the
  // surviving content must match SOME concurrent invocation's value.
  for (const name of ["initiative", "feature"]) {
    const options = await loadCreateTemplateOptions(pmDir, name);
    const body = String(options.body ?? "");
    assert.ok(!body.includes("${param:"), `template ${name} must never keep unresolved binding syntax`);
    assert.ok(
      body.includes(`## Project\n${left}`) || body.includes(`## Project\n${right}`),
      `template ${name} must carry one of the concurrent values`,
    );
  }
});