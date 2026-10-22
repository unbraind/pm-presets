/** Reproducible agent lifecycle probes against disposable, integration-free trackers. */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PmClient as Client, createExtensionCommandSdk, readSettings } from "@unbrained/pm-cli/sdk";
import { findPresetDefinition, requirePresetDefinition } from "./catalog.ts";
import { PRESET_HANDLERS } from "./setup.ts";

/** Versioned, bounded probes; arbitrary commands and caller workspaces are never accepted. */
export const PRESET_SCENARIOS = Object.freeze(["create-task", "claim-start", "close-without-evidence", "close-with-evidence"] as const);
/** Identifies a built-in agent workflow, rather than executable user input. */
export type PresetScenarioId = typeof PRESET_SCENARIOS[number];
/** Failure categories agents can branch on before retrying. */
export type SimulationRefusalCode = "unknown_preset" | "unknown_scenario" | "duplicate_scenario" | "sdk_unavailable" | "simulation_failed";
/** Actionable refusal; internal paths and raw child diagnostics never escape. */
export class SimulationRefusal extends Error {
  /** Stable machine-readable category. */
  readonly code: SimulationRefusalCode;
  /** A concrete next action for the caller. */
  readonly remedy: string;
  /** Usage failures are distinct from execution failures. */
  readonly exitCode: number;
  /** Construct a refusal without exposing the caller's configuration or filesystem. */
  constructor(code: SimulationRefusalCode, remedy: string, exitCode = 2) {
    super(`${code}: ${remedy}`);
    this.name = "SimulationRefusal";
    this.code = code;
    this.remedy = remedy;
    this.exitCode = exitCode;
  }
}
/** Select a subset to inspect; omissions remain visible as coverage gaps. */
export interface PresetSimulationOptions {
  /** Bundled preset id (same names accepted by presets apply). */
  readonly preset: string;
  /** Defaults to the complete suite. An empty list explicitly measures no scenarios. */
  readonly scenarios?: readonly PresetScenarioId[];
}
/** Stable observations, excluding random ids, clock values, warnings and local paths. */
export interface PresetScenarioResult {
  /** Workflow that was executed. */
  readonly id: PresetScenarioId;
  /** Declared expected end state for this preset's governance. */
  readonly expected: "open" | "in_progress" | "closed" | "refused";
  /** Measured end state; unexpected failures remain visible. */
  readonly actual: "open" | "in_progress" | "closed" | "refused";
  /** Whether the observation matched the declared behavior. */
  readonly passed: boolean;
  /** Stable advice when the workflow was refused. */
  readonly remedy: string;
}
/** Compact SDK/TOON/JSON report; partial coverage can never look complete. */
export interface PresetSimulationReport {
  /** False for a mismatch or omitted workflow. */
  readonly ok: boolean;
  /** Contract version for comparing deterministic reports. */
  readonly suiteVersion: 1;
  /** Canonical preset identifier. */
  readonly preset: string;
  /** Execution boundary, independent of the invoking workspace. */
  readonly isolation: "synthetic-no-extensions";
  /** Number of workflows actually executed. */
  readonly checked: number;
  /** Number matching their declared expectations. */
  readonly passed: number;
  /** Omitted workflows, in canonical suite order. */
  readonly coverageGaps: readonly PresetScenarioId[];
  /** Limits that apply even when every declared scenario passes. */
  readonly limitations: readonly string[];
  /** Results in canonical suite order, independent of selection order. */
  readonly scenarios: readonly PresetScenarioResult[];
}

/** Resolve the peer from the package or the CLI host, including standalone extension copies. */
export function resolveSimulationSdk(anchors: readonly string[]): string {
  for (const anchor of anchors) {
    try {
      return createRequire(anchor).resolve("@unbrained/pm-cli/sdk");
    } catch {
      // The extension copy may have no node_modules; try the host next.
    }
  }
  throw new SimulationRefusal("sdk_unavailable", "Run with a pm CLI host >=2026.9.30 or install the declared peer dependency.", 1);
}

/** Apply settings and execute real SDK operations; called only inside the isolated process. */
export async function executeSyntheticScenarios(
  root: string,
  preset: string,
  scenarios: readonly PresetScenarioId[],
  sdkPath: string,
): Promise<PresetSimulationReport> {
  const sdk = createRequire(import.meta.url)(sdkPath) as {
    PmClient: typeof Client;
    readSettings: typeof readSettings;
    createExtensionCommandSdk: typeof createExtensionCommandSdk;
  };
  const definition = requirePresetDefinition(preset);
  const pmRoot = join(root, ".agents", "pm");
  mkdirSync(pmRoot, { recursive: true });
  writeFileSync(join(pmRoot, "settings.json"), JSON.stringify(await sdk.readSettings(pmRoot)), { flag: "wx", mode: 0o600 });
  const client = new sdk.PmClient({ pmRoot, cwd: root, author: "preset-simulation", noExtensions: true });
  const commandSdk = sdk.createExtensionCommandSdk(pmRoot, client, "preset-simulation", "presets simulate");
  // Audited SDK initialization avoids the host init command's optional Git discovery.
  await commandSdk.mutateWorkspaceSettings({
    operationId: "simulation-init", mutate: (current) => ({ ...current, id_prefix: "sim-" }),
  });
  await PRESET_HANDLERS[definition.id]({
    command: "presets simulate", args: [], options: {}, global: { quiet: true }, pm_root: pmRoot,
    sdk: commandSdk,
  });
  const results: PresetScenarioResult[] = [];
  for (const id of scenarios) {
    const expected = id === "create-task" ? "open" : id === "claim-start" ? "in_progress"
      : id === "close-without-evidence" && definition.id === "bug-triage" ? "refused" : "closed";
    const created = await client.create({
      type: "Task", title: `Synthetic ${id}`, createMode: "progressive", allowDuplicate: true,
      acceptanceCriteria: "The synthetic task has the declared final state.",
    });
    const itemId = created.item.id;
    if (id === "claim-start") {
      await client.claim(itemId);
      await client.update(itemId, { status: "in_progress" });
    }
    let refused = false;
    try {
      if (id === "close-without-evidence") {
        await client.close(itemId, "Synthetic completion");
      }
      if (id === "close-with-evidence") {
        await client.close(itemId, "Synthetic completion", {
          resolution: "Synthetic work completed.", expectedResult: "Declared final state reached.",
          actualResult: "Declared final state reached.",
        });
      }
    } catch (error) {
      if ((error as { code?: string }).code !== "close_validation_missing_fields") throw error;
      refused = true;
    }
    const observed = await client.get(itemId, { full: true });
    const actual = refused && observed.item.status === "open" ? "refused" : observed.item.status as PresetScenarioResult["actual"];
    results.push({ id, expected, actual, passed: expected === actual,
      remedy: actual === "refused" ? "Supply acceptance criteria and resolution/expected/actual evidence; rerun the complete suite." : "" });
  }
  const coverageGaps = PRESET_SCENARIOS.filter((id) => !scenarios.includes(id));
  const passed = results.filter((result) => result.passed).length;
  return {
    ok: passed === results.length && coverageGaps.length === 0,
    suiteVersion: 1, preset: definition.id, isolation: "synthetic-no-extensions", checked: results.length, passed,
    coverageGaps, limitations: ["Built-in Task lifecycle only; templates and custom item types are not exercised.", "External integrations, user configuration and real agent inference are not exercised."],
    scenarios: results,
  };
}

/** Simulate before installing: no caller tracker is read, copied, installed into, or mutated. */
export function simulatePreset(options: PresetSimulationOptions): PresetSimulationReport {
  const definition = findPresetDefinition(options.preset);
  if (!definition) {
    throw new SimulationRefusal("unknown_preset", "Choose a bundled id from pm presets list.");
  }
  const selected = options.scenarios ?? PRESET_SCENARIOS;
  if (selected.some((id) => !PRESET_SCENARIOS.includes(id))) {
    throw new SimulationRefusal("unknown_scenario", `Choose scenario ids from: ${PRESET_SCENARIOS.join(", ")}.`);
  }
  if (new Set(selected).size !== selected.length) {
    throw new SimulationRefusal("duplicate_scenario", "Select each scenario at most once.");
  }
  const sdkPath = resolveSimulationSdk([import.meta.url, pathToFileURL(process.argv[1] ?? process.execPath).href]);
  const root = mkdtempSync(join(tmpdir(), "pm-presets-simulation-"));
  try {
    const output = join(root, "report.json");
    const script = `import {executeSyntheticScenarios} from ${JSON.stringify(import.meta.url)};\nimport {writeFileSync} from 'node:fs';\nconst report = await executeSyntheticScenarios(${JSON.stringify(root)}, ${JSON.stringify(definition.id)}, ${JSON.stringify(PRESET_SCENARIOS.filter((id) => selected.includes(id)))}, ${JSON.stringify(sdkPath)});\nwriteFileSync(${JSON.stringify(output)}, JSON.stringify(report));`;
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024,
      env: { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, TMPDIR: root, TMP: root, TEMP: root,
        PATH: "", GIT_CEILING_DIRECTORIES: root, PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", CI: "true", TZ: "UTC" },
    });
    if (child.status !== 0) {
      throw new SimulationRefusal("simulation_failed", "Check the supported pm host and rerun; no caller workspace was changed.", 1);
    }
    return JSON.parse(readFileSync(output, "utf8")) as PresetSimulationReport;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
