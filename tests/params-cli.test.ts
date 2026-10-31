/**
 * params-cli.test.ts — end-to-end parameter binding behaviour through the real
 * extension harness and real (non-git) pm trackers.
 *
 * Proves the acceptance criteria through the CLI surface: one supplied project
 * parameter reaches every declared occurrence (settings, templates, seeds),
 * unknown/missing/invalid bindings refuse BEFORE any write, secrets cannot
 * enter public seed prose, and previews (diff) resolve with the same engine
 * and values as the apply path.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { createExtensionTestHarness, type ExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import { PmClient } from "@unbrained/pm-cli/sdk";

import mod from "../src/index.ts";

/** Activate pm-presets through pm's real extension loader, once per process. */
let cachedHarness: Promise<ExtensionTestHarness> | undefined;

/** Lazily start (or reuse) the shared extension harness. */
function activatePresets(): Promise<ExtensionTestHarness> {
  cachedHarness ??= (async () => {
    const harness = await createExtensionTestHarness(mod, {
      name: "pm-presets",
      capabilities: ["commands", "schema"],
    });
    assert.deepEqual(harness.activation.failed, []);
    return harness;
  })();
  return cachedHarness;
}

/** Create an initialized non-git temp pm root and clean it up afterwards. */
async function workspace(t: TestContext): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "pm-presets-params-cli-"));
  const pmDir = join(root, ".agents", "pm");
  await new PmClient({ pmRoot: pmDir, cwd: root, noExtensions: true }).init();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return pmDir;
}

/** Read the workspace settings.json as a plain record. */
function readSettings(pmDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(pmDir, "settings.json"), "utf8")) as Record<string, unknown>;
}

test("one supplied project parameter reaches settings, templates and seeds", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => logs.push(args.map(String).join(" ")));
  t.mock.method(console, "warn", () => {});
  const h = await activatePresets();
  const pmDir = await workspace(t);

  await h.runCommand({
    command: "presets apply",
    args: ["startup-roadmap"],
    options: { param: ["projectKey=acme"], withSeeds: true, force: true },
    pmRoot: pmDir,
  });

  // Settings: the id_prefix occurrence resolved.
  assert.equal(readSettings(pmDir).id_prefix, "acme-");
  // Templates: every declared body occurrence resolved; no binding syntax left.
  const initiative = readFileSync(join(pmDir, "templates", "initiative.json"), "utf8");
  const feature = readFileSync(join(pmDir, "templates", "feature.json"), "utf8");
  assert.ok(initiative.includes("## Project\\nacme"));
  assert.ok(feature.includes("## Project\\nacme"));
  assert.ok(!initiative.includes("${param:") && !feature.includes("${param:"));
  // Seeds: the public seed prose resolved through the SAME value.
  const items = (await new PmClient({ pmRoot: pmDir, noExtensions: true }).listAllComplete()).items;
  assert.equal(items.length, 1);
  assert.ok(items[0].title.includes("acme"), `seed title kept the binding or wrong value: ${items[0].title}`);
  assert.ok(items[0].tags.includes("roadmap"));
  // Compact agent output: one summary line with the resolved value and source.
  assert.ok(
    logs.some((line) => line.includes("Resolved 1 parameter(s), 3 binding occurrence(s): projectKey=acme (supplied)")),
    `missing parameter summary line; got: ${logs.join(" | ")}`,
  );
});

test("applying without parameters keeps the documented default resolution", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => logs.push(args.map(String).join(" ")));
  t.mock.method(console, "warn", () => {});
  const h = await activatePresets();
  const pmDir = await workspace(t);

  await h.runCommand({ command: "roadmap-setup", pmRoot: pmDir });
  assert.equal(readSettings(pmDir).id_prefix, "road-");
  const initiative = readFileSync(join(pmDir, "templates", "initiative.json"), "utf8");
  assert.ok(initiative.includes("## Project\\nroad"));
  assert.ok(
    logs.some((line) => line.includes("projectKey=road (default)")),
    `missing default summary line; got: ${logs.join(" | ")}`,
  );

  // The seed dry-run plan resolves with the same defaults.
  const planLogs: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => planLogs.push(args.map(String).join(" ")));
  await h.runCommand({
    command: "presets apply",
    args: ["startup-roadmap"],
    options: { withSeeds: true, dryRun: true },
    pmRoot: pmDir,
  });
  assert.ok(planLogs.some((line) => line.includes("Define the road first roadmap initiative")));
  assert.ok(!planLogs.some((line) => line.includes("${param:")));
});

test("invalid, unknown and unanswered parameters refuse before any write", async (t) => {
  const h = await activatePresets();
  const pmDir = await workspace(t);

  const before = readFileSync(join(pmDir, "settings.json"), "utf8");
  // Pattern violation.
  await assert.rejects(
    () => h.runCommand({
      command: "presets apply",
      args: ["startup-roadmap"],
      options: { param: ["projectKey=ACME"] },
      pmRoot: pmDir,
    }),
    (error: unknown) => {
      assert.match(String((error as { message: string }).message), /invalid_value: Parameter 'projectKey' must match/);
      return true;
    },
  );
  // Unknown parameter on a parameterized preset.
  await assert.rejects(
    () => h.runCommand({
      command: "presets apply",
      args: ["startup-roadmap"],
      options: { param: ["projectKey=acme", "other=1"] },
      pmRoot: pmDir,
    }),
    /unknown_parameter: Parameter 'other' is not declared/,
  );
  // Unknown parameter on a parameterless preset.
  await assert.rejects(
    () => h.runCommand({ command: "kanban-setup", options: { param: ["foo=bar"] }, pmRoot: pmDir }),
    /unknown_parameter: Parameter 'foo' is not declared/,
  );
  // Malformed flag entry.
  await assert.rejects(
    () => h.runCommand({
      command: "presets apply",
      args: ["startup-roadmap"],
      options: { param: ["projectKey"] },
      pmRoot: pmDir,
    }),
    /invalid_param_flag/,
  );
  // Refused before writes: settings untouched, no templates directory.
  assert.equal(readFileSync(join(pmDir, "settings.json"), "utf8"), before);
  assert.equal(existsSync(join(pmDir, "templates")), false);
});

test("a params file supplies values and colliding or malformed files refuse", async (t) => {
  const h = await activatePresets();
  const pmDir = await workspace(t);
  const paramsFile = join(pmDir, "..", "..", "params.json");
  writeFileSync(paramsFile, '{"projectKey":"acme"}', "utf8");
  t.after(() => rmSync(paramsFile, { force: true }));

  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  await h.runCommand({
    command: "presets apply",
    args: ["startup-roadmap"],
    options: { paramsFile },
    pmRoot: pmDir,
  });
  assert.equal(readSettings(pmDir).id_prefix, "acme-");

  // A collision between --param and the file refuses before any write.
  const before = readFileSync(join(pmDir, "settings.json"), "utf8");
  await assert.rejects(
    () => h.runCommand({
      command: "presets apply",
      args: ["startup-roadmap"],
      options: { param: ["projectKey=other"], paramsFile },
      pmRoot: pmDir,
    }),
    /invalid_param_flag: Parameter 'projectKey' supplied by both/,
  );
  assert.equal(readFileSync(join(pmDir, "settings.json"), "utf8"), before);

  // A malformed params file refuses with the typed file code.
  const badFile = join(paramsFile, "..", "params-bad.json");
  writeFileSync(badFile, "{not json", "utf8");
  t.after(() => rmSync(badFile, { force: true }));
  await assert.rejects(
    () => h.runCommand({
      command: "presets apply",
      args: ["startup-roadmap"],
      options: { paramsFile: badFile },
      pmRoot: pmDir,
    }),
    /invalid_params_file/,
  );
});

test("presets show returns the declared parameter views with unanswered choices", async () => {
  const h = await activatePresets();
  const shown = await h.runCommand({ command: "presets show", args: ["startup-roadmap"] });
  const definition = shown.result as {
    parameters: Array<{ name: string; default?: string; unanswered: boolean; hasDefault: boolean }>;
  };
  assert.equal(definition.parameters.length, 1);
  assert.equal(definition.parameters[0].name, "projectKey");
  assert.equal(definition.parameters[0].default, "road");
  assert.equal(definition.parameters[0].hasDefault, true);
  assert.equal(definition.parameters[0].unanswered, false);

  const plain = await h.runCommand({ command: "presets show", args: ["kanban"] });
  assert.deepEqual((plain.result as { parameters: unknown[] }).parameters, []);
});

test("diff resolves bindings with the same supplied values as apply", async (t) => {
  const h = await activatePresets();
  const pmDir = await workspace(t);

  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  await h.runCommand({
    command: "presets apply",
    args: ["startup-roadmap"],
    options: { param: ["projectKey=acme"] },
    pmRoot: pmDir,
  });
  // The parameterized preview is in sync.
  const synced = await h.runCommand({
    command: "presets diff",
    args: ["startup-roadmap"],
    options: { param: ["projectKey=acme"], strict: true },
    pmRoot: pmDir,
  });
  assert.equal((synced.result as { inSync: boolean }).inSync, true);
  // The default-resolution preview reports drift against the acme workspace.
  const drifted = await h.runCommand({
    command: "presets diff",
    args: ["startup-roadmap"],
    pmRoot: pmDir,
  });
  assert.equal((drifted.result as { inSync: boolean }).inSync, false);
});

test("--prefix keeps precedence over a parameterized id_prefix", async (t) => {
  const h = await activatePresets();
  const pmDir = await workspace(t);
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  await h.runCommand({
    command: "presets apply",
    args: ["startup-roadmap"],
    options: { param: ["projectKey=acme"], prefix: "fixed-" },
    pmRoot: pmDir,
  });
  assert.equal(readSettings(pmDir).id_prefix, "fixed-");
});

test("dry-run with parameters plans the resolved values without writing", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => logs.push(args.map(String).join(" ")));
  t.mock.method(console, "warn", () => {});
  const h = await activatePresets();
  const pmDir = await workspace(t);
  const before = readFileSync(join(pmDir, "settings.json"), "utf8");

  await h.runCommand({
    command: "presets apply",
    args: ["startup-roadmap"],
    options: { param: ["projectKey=acme"], dryRun: true },
    pmRoot: pmDir,
  });
  assert.ok(logs.some((line) => line.includes("acme-")));
  assert.ok(logs.some((line) => line.includes("## Project\\nacme")));
  assert.equal(readFileSync(join(pmDir, "settings.json"), "utf8"), before);
  assert.equal(existsSync(join(pmDir, "templates")), false);
});