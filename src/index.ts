/**
 * pm-presets — all 7 official pm-cli workspace presets in one package.
 *
 * Each preset registers a setup command with the pm CLI extension API.
 * Install this package once and get all presets:
 *
 *   pm install github.com/unbraind/pm-presets --project
 *
 * Available commands after installation:
 *   pm triage-setup      # bug-triage preset
 *   pm indie-setup       # indie-dev preset
 *   pm oss-setup         # open-source preset
 *   pm sprint-setup      # software-sprint preset
 *   pm roadmap-setup     # startup-roadmap preset
 *   pm kanban-setup      # kanban preset
 *   pm agent-setup       # agent-workflow preset
 *
 * Plus a unified, read-only management surface:
 *   pm presets list                 # enumerate presets + what each configures
 *   pm presets show <id>            # full definition of one preset
 *   pm presets diff <id>            # workspace vs preset differences
 *   pm presets validate             # validate all bundled presets parse/load
 *   pm presets apply <id>           # scaffold a preset into this workspace
 */

import type { ExtensionApi, ExtensionModule, FlagDefinition } from "@unbrained/pm-cli/sdk/authoring";
import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";

import { runBugTriageSetup } from "./presets/bug-triage/index.ts";
import { runIndieDevSetup } from "./presets/indie-dev/index.ts";
import { runKanbanSetup, ITEM_TYPES as kanbanItemTypes } from "./presets/kanban/index.ts";
import { runAgentWorkflowSetup, ITEM_TYPES as agentWorkflowItemTypes } from "./presets/agent-workflow/index.ts";
import { runOpenSourceSetup } from "./presets/open-source/index.ts";
import { resolvePmDir, readBooleanOption, readStringOption, runTemplatesList, runTemplatesShow } from "./presets/shared.ts";
import { runSoftwareSprintSetup } from "./presets/software-sprint/index.ts";
import { runStartupRoadmapSetup } from "./presets/startup-roadmap/index.ts";
import { PRESET_REGISTRY } from "./registry.ts";
import { registerPlanCommand } from "./plan-command.ts";
import { registerStackCommand } from "./stack-command.ts";
import { registerUpgradeCommands } from "./upgrade-command.ts";
import {
  buildListRows,
  requirePresetDefinition,
  requireValidPresets,
  validateAllPresets,
} from "./catalog.ts";
import { computeParameterizedDiff, readWorkspaceSnapshot } from "./diff.ts";
import {
  buildExportedPreset,
  readWorkspaceSettings,
  readWorkspaceTemplates,
} from "./export.ts";
import { runPresetSeeds } from "./seeds.ts";
import { parameterSafeApi } from "./command-errors.ts";
import { ParameterRefusal, parseParameterFlagEntries, readSuppliedParameterValues } from "./params.ts";
import { PRESET_PARAMETERS } from "./registry.ts";
import { resolvePresetApplication, contextWithResolvedParameters } from "./apply-command.ts";
import * as fs from "node:fs";
import { PRESET_HANDLERS } from "./setup.ts";
import { simulatePreset, type PresetScenarioId } from "./simulation.ts";

// Drift exit code for `presets diff --strict`. Distinct from GENERIC(1)/
// USAGE(2)/NOT_FOUND(3) so CI can tell "drifted" from "command failed".
const EXIT_CODE_DRIFT = 4;
// Mirror the SDK EXIT_CODE contract (see ./presets/shared.ts) so the unified
// `presets` command can throw clean, typed non-zero exits without importing it.
const EXIT_CODE_USAGE = 2;
const EXIT_CODE_NOT_FOUND = 3;


// A thrown error only yields a clean non-zero exit (no double-invocation) when
// it carries a numeric `exitCode`. Standalone-installed extensions can't import
// the SDK's EXIT_CODE at runtime, so mirror the contract locally.
class PresetError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "PresetError";
    this.exitCode = exitCode;
  }
}

// pm-cli's loose-option matcher (extension-command-options.ts) only recognizes
// flag definitions whose `long`/`short` include their dash prefixes. Declaring
// `long: "dry-run"` (no `--`) makes the flag invisible to `--help` AND rejected
// at parse time as "Unknown option". Always include the prefixes.
// Shared parameter flags: `--param` is repeatable (`k=v` entries accumulate) and
// `--params-file` reads a JSON object. Supplied names must be declared by the
// preset's typed parameter manifest; unknown or unanswered values refuse
// before any write with a typed exit-2 refusal.
const PARAM_FLAGS: FlagDefinition[] = [
  {
    long: "--param",
    value_name: "<name>=<value>",
    value_type: "string",
    repeatable: true,
    description: "Supply a declared preset parameter (repeatable); see `pm presets show <id>` for the manifest.",
  },
  {
    long: "--params-file",
    value_name: "<file>",
    value_type: "string",
    description: "Read supplied parameter values from a JSON object file (same names as --param).",
  },
];

const COMMON_FLAGS: FlagDefinition[] = [
  {
    long: "--force",
    short: "-f",
    value_type: "boolean",
    description: "Overwrite existing settings.json and template files without prompting.",
  },
  {
    long: "--dry-run",
    short: "-n",
    value_type: "boolean",
    description: "Preview what would be written without making any changes.",
  },
  {
    long: "--prefix",
    short: "-p",
    value_name: "<prefix>",
    value_type: "string",
    description: "Override the id_prefix written to settings.json.",
  },
  ...PARAM_FLAGS,
];

// `presets apply` additionally accepts --with-seeds to create starter items
// and --replace to full-replace (rather than deep-merge) the owned settings trees.
const APPLY_FLAGS: FlagDefinition[] = [
  ...COMMON_FLAGS,
  {
    long: "--with-seeds",
    short: "-s",
    value_type: "boolean",
    description: "Also create the preset's starter items (built-in fields only; see #97).",
  },
  {
    long: "--replace",
    value_type: "boolean",
    description:
      "Full-replace the governance/validation/testing settings trees with the preset's (clean reset) instead of deep-merging. Other settings are still preserved.",
  },
];

// `presets diff` additionally accepts --strict for CI drift detection and the
// parameter flags so the preview mirrors a parameterized apply.
const DIFF_FLAGS: FlagDefinition[] = [
  {
    long: "--strict",
    value_type: "boolean",
    description:
      "Exit non-zero (4) when the workspace is NOT in sync with the preset (drift detection for CI/compliance).",
  },
  ...PARAM_FLAGS,
];

// `presets export` writes to a file or stdout and can carry a display name.
const EXPORT_FLAGS: FlagDefinition[] = [
  {
    long: "--output",
    short: "-o",
    value_name: "<file>",
    value_type: "string",
    description: "Write the exported preset definition to a file instead of stdout.",
  },
  {
    long: "--display-name",
    value_name: "<name>",
    value_type: "string",
    description: "Human-readable display name for the exported preset (defaults to the id).",
  },
];

// The bare `presets` command unifies the read-only surfaces behind flags so
// users can run `pm presets --list`, `pm presets --diff <id>`, or `pm presets
// --custom <name>` from a single entry point. The subcommands (`presets list`,
// `presets diff`, `presets export`) remain available with identical behavior.
const PRESETS_FLAGS: FlagDefinition[] = [
  {
    long: "--list",
    value_type: "boolean",
    description: "List all bundled workspace presets with what each configures.",
  },
  {
    long: "--diff",
    value_name: "<preset>",
    value_type: "string",
    description: "Compare the current pm workspace against the named preset and report differences.",
  },
  {
    long: "--custom",
    value_name: "<name>",
    value_type: "string",
    description: "Export the current workspace config (settings + templates) as a new preset definition.",
  },
  {
    long: "--strict",
    value_type: "boolean",
    description:
      "With --diff: exit non-zero (4) when the workspace is NOT in sync with the preset.",
  },
  {
    long: "--output",
    short: "-o",
    value_name: "<file>",
    value_type: "string",
    description: "With --custom: write the exported preset definition to a file instead of stdout.",
  },
  {
    long: "--display-name",
    value_name: "<name>",
    value_type: "string",
    description: "With --custom: human-readable display name for the exported preset (defaults to the name).",
  },
  ...PARAM_FLAGS,
];

/**
 * Local stand-in for the SDK's `defineExtension` identity helper.
 *
 * Declared here rather than imported so this package keeps a type-only
 * dependency on `@unbrained/pm-cli` and adds no runtime module edge. The
 * generic constraint is the SDK's own, so the extension object is contract-
 * checked against {@link ExtensionModule} exactly as the imported helper would.
 */
const defineExtension = <TModule extends ExtensionModule>(module: TModule): TModule => module;

export default defineExtension({
  activate(api: ExtensionApi) {
    api = parameterSafeApi(api);
    registerUpgradeCommands(api);
    registerPlanCommand(api);
    registerStackCommand(api);
    // ── bug-triage ──────────────────────────────────────────────────────────
    api.registerCommand({
      name: "triage-setup",
      description:
        "Apply the bug-triage preset: strict governance for production incidents, hotfixes, and root-cause tracking.",
      flags: COMMON_FLAGS,
      run: runBugTriageSetup,
    });

    // ── indie-dev ───────────────────────────────────────────────────────────
    api.registerCommand({
      name: "indie-setup",
      description:
        "Apply the indie-dev preset: minimal-ceremony workspace for solo developers and personal projects.",
      flags: COMMON_FLAGS,
      run: runIndieDevSetup,
    });

    // ── open-source ─────────────────────────────────────────────────────────
    api.registerCommand({
      name: "oss-setup",
      description:
        "Apply the open-source preset: issue triage, milestone releases, and contributor-friendly templates.",
      flags: COMMON_FLAGS,
      run: runOpenSourceSetup,
    });

    // ── software-sprint ─────────────────────────────────────────────────────
    api.registerCommand({
      name: "sprint-setup",
      description:
        "Apply the software-sprint preset: sprint-based workflow with epics, features, tasks, and bugs.",
      flags: COMMON_FLAGS,
      run: runSoftwareSprintSetup,
    });

    // ── startup-roadmap ─────────────────────────────────────────────────────
    api.registerCommand({
      name: "roadmap-setup",
      description:
        "Apply the startup-roadmap preset: investor-grade milestones, strategic initiatives, and quarterly planning.",
      flags: COMMON_FLAGS,
      run: runStartupRoadmapSetup,
    });

    // ── kanban ──────────────────────────────────────────────────────────────
    api.registerCommand({
      name: "kanban-setup",
      description:
        "Apply the kanban preset: continuous-flow board (backlog/ready/in-progress/review/done) with card templates.",
      flags: COMMON_FLAGS,
      run: runKanbanSetup,
    });

    // ── agent-workflow ────────────────────────────────────────────────────
    api.registerCommand({
      name: "agent-setup",
      description:
        "Apply the agent-workflow preset: AI agent project management with delegated agent runs, prompt experiments, and eval suites.",
      flags: COMMON_FLAGS,
      run: runAgentWorkflowSetup,
    });

    // Register the kanban board columns as custom item types via the schema API.
    if (typeof api.registerItemTypes === "function") {
      api.registerItemTypes(kanbanItemTypes);
      api.registerItemTypes(agentWorkflowItemTypes);
    }

    // ── unified presets entry point: --list / --diff / --custom ────────────
    // A single command that dispatches to the read-only surfaces via flags,
    // complementing the dedicated `presets list|show|diff|export` subcommands.
    api.registerCommand({
      name: "presets",
      action: "presets",
      description:
        "Unified presets surface: --list shows presets, --diff <id> compares the workspace, --custom <name> exports the current workspace as a preset.",
      examples: [
        "pm presets --list",
        "pm presets --diff software-sprint",
        "pm presets --custom our-config",
        "pm presets --custom our-config --output our-config.preset.json",
      ],
      flags: PRESETS_FLAGS,
      run: (ctx: CommandHandlerContext) => {
        const options = ctx.options ?? {};
        const list = readBooleanOption(options, "list");
        const diffId = readStringOption(options, "diff");
        const customRaw = options["custom"];
        if (typeof customRaw === "string" && customRaw.trim().length === 0) {
          throw new PresetError(
            "presets --custom requires a non-empty preset name.",
            EXIT_CODE_USAGE,
          );
        }
        const customName = readStringOption(options, "custom");

        if (!list && !diffId && !customName) {
          throw new PresetError(
            "`presets` requires one of --list, --diff <preset>, or --custom <name>.",
            EXIT_CODE_USAGE,
          );
        }
        // Disallow mixing dispatch flags: the surfaces have different outputs.
        const chosen = [list, Boolean(diffId), Boolean(customName)].filter(Boolean).length;
        if (chosen > 1) {
          throw new PresetError(
            "Specify only one of --list, --diff, or --custom at a time.",
            EXIT_CODE_USAGE,
          );
        }

        if (!diffId && (parseParameterFlagEntries(options.param).length > 0
          || [options.paramsFile, options["params-file"]].some((value) => value !== undefined && value !== null))) {
          throw new ParameterRefusal("invalid_param_flag", "Use parameter inputs only with --diff <preset>, presets apply, or a setup command.");
        }

        if (list) {
          return {
            presets: buildListRows(),
            count: PRESET_REGISTRY.length,
          };
        }

        if (diffId) {
          const supplied = readSuppliedParameterValues(options);
          const definition = requirePresetDefinition(diffId, supplied);
          const snapshot = readWorkspaceSnapshot(resolvePmDir(ctx));
          const result = computeParameterizedDiff(definition, PRESET_PARAMETERS[definition.id], supplied, snapshot);
          const strict = readBooleanOption(options, "strict");
          if (strict && !result.inSync) {
            // `--json` is host-owned; read it from ctx.global.
            const json = ctx.global?.json === true;
            if (json) {
              console.log(JSON.stringify(result, null, 2));
            } else {
              const { settingsToAdd, settingsToChange, templatesMissing } = result.summary;
              console.error(
                "Workspace is NOT in sync with preset '" + definition.id + "': " +
                  settingsToAdd + " setting(s) to add, " + settingsToChange + " to change, " +
                  templatesMissing + " template(s) missing.",
              );
            }
            throw new PresetError(
              "Workspace drifted from preset '" + definition.id + "'.",
              EXIT_CODE_DRIFT,
            );
          }
          return result;
        }

        // --custom <name>: export the current workspace as a preset definition.
        // Whitespace-only names are rejected above (before readStringOption),
        // and readStringOption itself returns undefined for empty/whitespace, so
        // `customName` here is a non-empty trimmed string.
        const name = customName as string;
        const pmDir = resolvePmDir(ctx);
        const settings = readWorkspaceSettings(pmDir);
        if (!settings) {
          throw new PresetError(
            "No readable settings.json in " + pmDir + ". Run 'pm init' (and apply a preset) first.",
            EXIT_CODE_NOT_FOUND,
          );
        }
        return readWorkspaceTemplates(pmDir).then((templates) => {
          const exported = buildExportedPreset({
            name: name.trim(),
            displayName: readStringOption(options, "displayName", "display-name"),
            settings,
            templates,
          });
          const output = readStringOption(options, "output");
          if (output) {
            const serialized = JSON.stringify(exported, null, 2) + "\n";
            fs.writeFileSync(output, serialized, "utf8");
            console.log(
              "Exported preset '" + exported.id + "' (" + exported.templates.length + " template(s)) to " + output,
            );
            return undefined;
          }
          return exported;
        });
      },
    });

    // ── unified presets list / show / diff / validate / apply ────────────────
    api.registerCommand({
      name: "presets list",
      action: "presets-list",
      description:
        "List all bundled workspace presets with what each configures (governance, item types, templates).",
      examples: ["pm presets list", "pm presets list --json"],
      run: () => ({
        presets: buildListRows(),
        count: PRESET_REGISTRY.length,
      }),
    });

    api.registerCommand({
      name: "presets show",
      action: "presets-show",
      description:
        "Print the full definition of one preset: settings patch, templates, and custom item types.",
      examples: ["pm presets show software-sprint", "pm presets show kanban --json"],
      arguments: [
        { name: "preset", required: true, description: "Preset id (see `pm presets list`)." },
      ],
      run: (ctx: CommandHandlerContext) => requirePresetDefinition(ctx.args?.[0]),
    });

    api.registerCommand({
      name: "presets diff",
      action: "presets-diff",
      description:
        "Compare the current pm workspace (settings + installed templates) against a preset and report differences.",
      examples: [
        "pm presets diff software-sprint",
        "pm presets diff bug-triage --json",
        "pm presets diff bug-triage --strict",
      ],
      arguments: [
        { name: "preset", required: true, description: "Preset id (see `pm presets list`)." },
      ],
      flags: DIFF_FLAGS,
      run: (ctx: CommandHandlerContext) => {
        const supplied = readSuppliedParameterValues(ctx.options);
        const definition = requirePresetDefinition(ctx.args?.[0], supplied);
        const snapshot = readWorkspaceSnapshot(resolvePmDir(ctx));
        const result = computeParameterizedDiff(definition, PRESET_PARAMETERS[definition.id], supplied, snapshot);
        const strict = readBooleanOption(ctx.options, "strict");
        if (strict && !result.inSync) {
          // Drift detected. Print the diff (respecting --json) so CI logs show
          // WHAT drifted, then exit non-zero with a dedicated drift code (4).
          // `--json` is host-owned; read it from ctx.global.
          const json = ctx.global?.json === true;
          if (json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const { settingsToAdd, settingsToChange, templatesMissing } = result.summary;
            console.error(
              `Workspace is NOT in sync with preset '${definition.id}': ` +
                `${settingsToAdd} setting(s) to add, ${settingsToChange} to change, ` +
                `${templatesMissing} template(s) missing.`,
            );
          }
          throw new PresetError(
            `Workspace drifted from preset '${definition.id}'.`,
            EXIT_CODE_DRIFT,
          );
        }
        return result;
      },
    });

    api.registerCommand({
      name: "presets export",
      action: "presets-export",
      description:
        "Snapshot the CURRENT workspace's settings + templates as a reusable preset definition (JSON) to stdout or a file.",
      examples: [
        "pm presets export our-config",
        "pm presets export our-config --output our-config.preset.json",
        'pm presets export our-config --display-name "Our Team Config"',
      ],
      arguments: [
        {
          name: "name",
          required: true,
          description: "Id for the exported preset definition.",
        },
      ],
      flags: EXPORT_FLAGS,
      run: (ctx: CommandHandlerContext) => {
        const name = ctx.args?.[0];
        if (typeof name !== "string" || name.trim().length === 0) {
          throw new PresetError("presets export requires a preset name argument.", 2);
        }
        const pmDir = resolvePmDir(ctx);
        const settings = readWorkspaceSettings(pmDir);
        if (!settings) {
          throw new PresetError(
            `No readable settings.json in ${pmDir}. Run \`pm init\` (and apply a preset) first.`,
            3,
          );
        }
        return readWorkspaceTemplates(pmDir).then((templates) => {
          const exported = buildExportedPreset({
            name: name.trim(),
            displayName: readStringOption(ctx.options, "displayName", "display-name"),
            settings,
            templates,
          });

          const output = readStringOption(ctx.options, "output");
          if (output) {
            const serialized = `${JSON.stringify(exported, null, 2)}\n`;
            fs.writeFileSync(output, serialized, "utf8");
            console.log(
              `Exported preset '${exported.id}' (${exported.templates.length} template(s)) to ${output}`,
            );
            return undefined;
          }
          // No --output: return the definition so pm renders it as the command
          // result. With `--json` pm emits clean, pipeable JSON (no trailing
          // result block); use `--output` for a verbatim file on disk.
          return exported;
        });
      },
    });

    api.registerCommand({
      name: "presets validate",
      action: "presets-validate",
      description: "Validate that all bundled presets parse and load correctly.",
      examples: ["pm presets validate", "pm presets validate --json"],
      run: () => requireValidPresets(validateAllPresets()),
    });

    api.registerCommand({
      name: "presets simulate",
      action: "presets-simulate",
      description: "Execute reproducible agent workflows in an isolated synthetic tracker before applying a preset.",
      examples: ["pm presets simulate bug-triage", "pm presets simulate indie-dev --json"],
      arguments: [{ name: "preset", required: true, description: "Bundled preset id." }],
      flags: [{ long: "--scenarios", value_name: "<ids>", value_type: "string", description: "Comma-separated scenario ids; omitted workflows are explicit coverage gaps." }],
      run: (ctx: CommandHandlerContext) => {
        const selection = ctx.options?.["scenarios"];
        const report = simulatePreset({
          preset: ctx.args?.[0] ?? "",
          scenarios: typeof selection === "string" ? selection.split(",").map((id) => id.trim()).filter(Boolean) as PresetScenarioId[] : undefined,
        });
        if (!report.ok) {
          console.log(JSON.stringify(report));
          throw new PresetError("Simulation has mismatches or coverage gaps; run the complete suite and inspect the observations.", 4);
        }
        return report;
      },
    });

    api.registerCommand({
      name: "presets apply",
      action: "presets-apply",
      description:
        "Apply a workspace preset by id (e.g. `pm presets apply kanban`). Run `pm presets list` to see all ids.",
      examples: [
        "pm presets apply kanban",
        "pm presets apply software-sprint --dry-run",
        "pm presets apply bug-triage --with-seeds",
        "pm presets apply bug-triage --force",
      ],
      arguments: [
        { name: "preset", required: true, description: "Preset id (see `pm presets list`)." },
      ],
      flags: APPLY_FLAGS,
      run: async (ctx: CommandHandlerContext) => {
        // ONE boundary before any write: the preset id, every parameter value
        // AND the seed bindings resolve/refuse here — a bad seed can never
        // leave a half-applied preset, and the params file is read exactly once.
        const application = resolvePresetApplication(ctx);
        const handler = PRESET_HANDLERS[application.definition.id];
        await handler(contextWithResolvedParameters(ctx, application));

        if (!application.withSeeds) {
          return;
        }
        // Seeds use the SAME effective values that settings and templates
        // used (one value reaches every declared occurrence), never a re-read
        // of the caller's input.
        await runPresetSeeds(resolvePmDir(ctx), application.definition.id, {
          client: ctx.sdk?.client,
          dryRun: application.dryRun,
          parameterValues: application.parameters.values,
        });
      },
    });

    // ── create-template runtime ─────────────────────────────────────────────
    // pm create --template resolves through a package-owned "templates show"
    // command. pm-presets provides the handler for templates it installs so
    // presets work without requiring users to install a second package.
    api.registerCommand({
      name: "templates",
      action: "templates-list",
      description: "List create templates installed in this pm workspace.",
      run: runTemplatesList,
    });

    api.registerCommand({
      name: "templates list",
      action: "templates-list",
      description: "List create templates installed in this pm workspace.",
      run: runTemplatesList,
    });

    api.registerCommand({
      name: "templates show",
      action: "templates-show",
      description: "Show a create template installed in this pm workspace.",
      arguments: [
        {
          name: "name",
          required: true,
          description: "Template name.",
        },
      ],
      run: runTemplatesShow,
    });
  },
});

// Re-export public API
export { PRESET_REGISTRY } from "./registry.ts";
export { collectPresetParameterIssues, projectPresetDefinition } from "./catalog.ts";
export type { PresetDescriptor } from "./registry.ts";

export { simulatePreset, SimulationRefusal, PRESET_SCENARIOS } from "./simulation.ts";
export type { PresetSimulationOptions, PresetSimulationReport, PresetScenarioId, PresetScenarioResult, SimulationRefusalCode } from "./simulation.ts";

export { comparePresetUpgrade, planPresetUpgrade, executePresetUpgrade, parseUpgradeReceipt, summarizePresetUpgrade, UpgradeRefusal } from "./upgrade.ts";
export type { VersionedPreset, UpgradeSettings, UpgradeValue, UpgradeDecisions, UpgradeChange, PresetUpgradeReceipt, PresetUpgradeSummary, PresetUpgradeResult, UpgradeRefusalCode } from "./upgrade.ts";

export { compilePresetPlan, bundledPresetComposition, summarizePresetPlan, PlanRefusal } from "./plan.ts";
export type { PresetRequirement, PresetPlanFeature, PresetComposition, PresetPlanTarget, PresetPlanGap, PresetPlan, PlanRefusalCode } from "./plan.ts";

export { planPresetStack, summarizePresetStack, StackRefusal } from "./stack.ts";
export type { PresetStackSelection, PresetStackInput, PresetStackOwnership, PresetStackPlan, StackRefusalCode } from "./stack.ts";

export {
  ParameterRefusal,
  isSecretReference,
  resolveSecretReference,
  assertResolvedParameterValues,
  buildParameterViews,
  collectParameterValues,
  collectSecretSettingPaths,
  parseParameterFlagEntries,
  parseParamsFile,
  readSuppliedParameterValues,
  redactSecretValues,
  redactSecretValuesDeep,
  resolveParameterValues,
  resolveParameterizedPreset,
  resolveSeedsWithParameters,
  resolveSettingsWithParameters,
  resolveTemplatesWithParameters,
  validateParameterManifest,
} from "./params.ts";
export type {
  ParameterRefusalCode,
  ParameterBindingOccurrence,
  PresetParameter,
  PresetParameterManifest,
  PresetParameterType,
  PresetParameterView,
  ResolvedParameterValues,
} from "./params.ts";
export { PRESET_PARAMETERS } from "./registry.ts";
export { resolvePresetApplication, contextWithResolvedParameters } from "./apply-command.ts";
export type { ResolvedPresetApplication } from "./apply-command.ts";
export { resolvedSeedsForPreset } from "./seeds.ts";
