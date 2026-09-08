/**
 * Behavioural tests for the unified presets commands registered by the extension.
 * Imports the TypeScript sources directly so coverage is measured on the lines
 * an author edits.
 */

import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";

import { createExtensionTestHarness, type ExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import type { CommandHandlerContext, ExtensionCapability } from "@unbrained/pm-cli/sdk/authoring";

import mod from "../src/index.ts";
import { runIndieDevSetup } from "../src/registry.ts";

const MANIFEST_CAPABILITIES: readonly ExtensionCapability[] = (
  JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "manifest.json"), "utf8"),
  ) as { capabilities: ExtensionCapability[] }
).capabilities;

let cachedHarness: Promise<ExtensionTestHarness> | undefined;

/** Activate pm-presets through pm's real extension loader, once per test process. */
function activatePresets(): Promise<ExtensionTestHarness> {
  cachedHarness ??= (async () => {
    const harness = await createExtensionTestHarness(mod, {
      name: "pm-presets",
      capabilities: MANIFEST_CAPABILITIES,
    });
    assert.deepEqual(harness.activation.failed, [], "extension activation must not fail");
    return harness;
  })();
  return cachedHarness;
}

/** Create an initialized temp pm root and delete it after the test. */
function workspace(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "pm-presets-cmd-"));
  const pmDir = join(root, ".agents", "pm");
  mkdirSync(pmDir, { recursive: true });
  writeFileSync(join(pmDir, "settings.json"), "{}\n");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return pmDir;
}

test("activation skips item-type registration when the host omits the schema API", () => {
  const commands: string[] = [];
  const api = {
    registerCommand(definition: { name: string }) {
      commands.push(definition.name);
    },
  };
  mod.activate(api as never);
  assert.ok(commands.includes("triage-setup"));
  assert.ok(commands.includes("presets"));
  assert.ok(commands.includes("templates show"));
});

test("presets requires a dispatch flag and rejects mixing them", async () => {
  const h = await activatePresets();
  await assert.rejects(
    () => h.runCommand({ command: "presets", options: {}, pmRoot: "/missing" }),
    /requires one of --list, --diff <preset>, or --custom <name>/,
  );
  await assert.rejects(
    () => h.runCommand({ command: "presets", options: { list: true, diff: "indie-dev" }, pmRoot: "/missing" }),
    /Specify only one of --list, --diff, or --custom/,
  );
  await assert.rejects(
    () => h.runCommand({ command: "presets", options: { list: true, custom: "ours" }, pmRoot: "/missing" }),
    /Specify only one of --list, --diff, or --custom/,
  );
  await assert.rejects(
    () => h.runCommand({ command: "presets", options: { diff: "indie-dev", custom: "ours" }, pmRoot: "/missing" }),
    /Specify only one of --list, --diff, or --custom/,
  );
});

test("presets --list and presets list return the bundled catalog", async () => {
  const h = await activatePresets();
  const flagged = await h.runCommand({ command: "presets", options: { list: true } });
  const sub = await h.runCommand({ command: "presets list" });
  assert.equal(flagged.handled, true);
  const flaggedResult = flagged.result as { count: number; presets: Array<{ id: string }> };
  const subResult = sub.result as { count: number; presets: Array<{ id: string }> };
  assert.strictEqual(flaggedResult.count, 7);
  assert.strictEqual(subResult.count, 7);
  assert.ok(flaggedResult.presets.some((row) => row.id === "kanban"));
});

test("presets show returns a full definition", async () => {
  const h = await activatePresets();
  const shown = await h.runCommand({ command: "presets show", args: ["indie-dev"] });
  const definition = shown.result as { id: string; templates: unknown[] };
  assert.strictEqual(definition.id, "indie-dev");
  assert.ok(definition.templates.length > 0);
});

test("presets --diff and presets diff report drift, including --strict", async (t) => {
  const h = await activatePresets();
  const pmDir = workspace(t);
  const drifted = await h.runCommand({
    command: "presets",
    options: { diff: "indie-dev" },
    pmRoot: pmDir,
  });
  const result = drifted.result as { inSync: boolean };
  assert.equal(result.inSync, false);

  const errors: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  await assert.rejects(
    () =>
      h.runCommand({
        command: "presets diff",
        args: ["indie-dev"],
        options: { strict: true },
        global: { json: false },
        pmRoot: pmDir,
      }),
    /Workspace drifted from preset 'indie-dev'/,
  );
  assert.ok(errors.some((line) => line.includes("Workspace is NOT in sync with preset 'indie-dev'")));

  const jsonLines: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    jsonLines.push(args.map(String).join(" "));
  });
  await assert.rejects(
    () =>
      h.runCommand({
        command: "presets",
        options: { diff: "indie-dev", strict: true },
        global: { json: true },
        pmRoot: pmDir,
      }),
    /Workspace drifted from preset/,
  );
  assert.ok(jsonLines.some((line) => line.includes('"inSync"')));

  errors.length = 0;
  await assert.rejects(
    () =>
      h.runCommand({
        command: "presets",
        options: { diff: "indie-dev", strict: true },
        global: { json: false },
        pmRoot: pmDir,
      }),
    /Workspace drifted from preset 'indie-dev'/,
  );
  assert.ok(errors.some((line) => line.includes("setting(s) to add")));

  jsonLines.length = 0;
  await assert.rejects(
    () =>
      h.runCommand({
        command: "presets diff",
        args: ["indie-dev"],
        options: { strict: true },
        global: { json: true },
        pmRoot: pmDir,
      }),
    /Workspace drifted from preset/,
  );
  assert.ok(jsonLines.some((line) => line.includes('"presetId"')));

  t.mock.method(console, "log", () => {});
  runIndieDevSetup({
    command: "indie-setup",
    args: [],
    options: {},
    global: { json: true, quiet: true, noPager: true },
    pm_root: pmDir,
  });
  const synced = await h.runCommand({
    command: "presets diff",
    args: ["indie-dev"],
    options: { strict: true },
    pmRoot: pmDir,
  });
  assert.equal((synced.result as { inSync: boolean }).inSync, true);
});

test("presets --custom and presets export snapshot the workspace", async (t) => {
  const h = await activatePresets();
  const emptyDir = workspace(t);
  writeFileSync(join(emptyDir, "settings.json"), "[1]\n");
  await assert.rejects(
    () => h.runCommand({ command: "presets", options: { custom: "ours" }, pmRoot: emptyDir }),
    /No readable settings.json/,
  );
  await assert.rejects(
    () => h.runCommand({ command: "presets export", args: ["ours"], pmRoot: emptyDir }),
    /No readable settings.json/,
  );
  await assert.rejects(
    () => h.runCommand({ command: "presets export", args: ["   "], pmRoot: emptyDir }),
    /presets export requires a preset name argument/,
  );

  const pmDir = workspace(t);
  t.mock.method(console, "log", () => {});
  runIndieDevSetup({
    command: "indie-setup",
    args: [],
    options: {},
    global: { json: true, quiet: true, noPager: true },
    pm_root: pmDir,
  });

  const exported = await h.runCommand({
    command: "presets",
    options: { custom: "ours", displayName: "Ours" },
    pmRoot: pmDir,
  });
  const payload = exported.result as { id: string; displayName: string; templates: unknown[] };
  assert.strictEqual(payload.id, "ours");
  assert.strictEqual(payload.displayName, "Ours");
  assert.ok(payload.templates.length > 0);

  const output = join(pmDir, "ours.preset.json");
  const logs: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  const written = await h.runCommand({
    command: "presets export",
    args: ["ours"],
    options: { output, "display-name": "Team" },
    pmRoot: pmDir,
  });
  assert.equal(written.result, undefined);
  const onDisk = JSON.parse(readFileSync(output, "utf8")) as { displayName: string };
  assert.strictEqual(onDisk.displayName, "Team");
  assert.ok(logs.some((line) => line.includes("Exported preset 'ours'")));

  const flaggedOut = join(pmDir, "flagged.preset.json");
  await h.runCommand({
    command: "presets",
    options: { custom: "flagged", output: flaggedOut },
    pmRoot: pmDir,
  });
  assert.ok(readFileSync(flaggedOut, "utf8").includes("flagged"));

  const stdoutExport = await h.runCommand({
    command: "presets export",
    args: ["ours"],
    pmRoot: pmDir,
  });
  assert.strictEqual((stdoutExport.result as { id: string }).id, "ours");
});

test("presets validate returns the clean bundled catalog", async () => {
  const h = await activatePresets();
  const result = await h.runCommand({ command: "presets validate" });
  assert.deepEqual((result.result as { ok: boolean; checked: number }).ok, true);
  assert.strictEqual((result.result as { checked: number }).checked, 7);
});

test("presets apply writes the preset and optionally seeds", async (t) => {
  const h = await activatePresets();
  const pmDir = workspace(t);
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});

  await h.runCommand({ command: "presets apply", args: ["indie-dev"], pmRoot: pmDir });
  const settings = JSON.parse(readFileSync(join(pmDir, "settings.json"), "utf8")) as { id_prefix: string };
  assert.strictEqual(settings.id_prefix, "indie-");

  const dryLines: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => {
    dryLines.push(args.map(String).join(" "));
  });
  await h.runCommand({
    command: "presets apply",
    args: ["indie-dev"],
    options: { withSeeds: true, dryRun: true },
    pmRoot: pmDir,
  });
  assert.ok(dryLines.some((line) => line.includes("Would seed 1 starter item(s)")));

  const binDir = mkdtempSync(join(tmpdir(), "pm-presets-path-"));
  const bin = join(binDir, "pm");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  chmodSync(bin, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${previousPath ? `:${previousPath}` : ""}`;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(binDir, { recursive: true, force: true });
  });
  await h.runCommand({
    command: "presets apply",
    args: ["indie-dev"],
    options: { "with-seeds": true, force: true },
    pmRoot: pmDir,
  });

  await assert.rejects(
    () => h.runCommand({ command: "presets apply", args: ["nope"], pmRoot: pmDir }),
    /Unknown preset/,
  );
});

test("templates commands are wired through the extension", async (t) => {
  const h = await activatePresets();
  const pmDir = workspace(t);
  const listed = await h.runCommand({ command: "templates", pmRoot: pmDir });
  assert.ok(((listed.result as { builtin_templates: string[] }).builtin_templates).includes("bug"));
  const listedAlias = await h.runCommand({ command: "templates list", pmRoot: pmDir });
  assert.equal((listedAlias.result as { count: number }).count, (listed.result as { count: number }).count);
  const shown = await h.runCommand({ command: "templates show", args: ["chore"], pmRoot: pmDir });
  assert.equal((shown.result as { source: string }).source, "builtin");
});

test("presets handler treats missing options as an empty map", () => {
  let run: ((ctx: CommandHandlerContext) => unknown) | undefined;
  mod.activate({
    registerCommand(definition: { name: string; run?: (ctx: CommandHandlerContext) => unknown }) {
      if (definition.name === "presets") run = definition.run;
    },
  } as never);
  if (!run) {
    assert.fail("presets command did not register a run handler");
  }
  const presetsRun = run;
  assert.throws(
    () =>
      presetsRun({
        command: "presets",
        args: [],
        options: undefined as unknown as Record<string, unknown>,
        global: { json: true, quiet: true, noPager: true },
        pm_root: "/missing",
      }),
    /requires one of --list/,
  );
});
