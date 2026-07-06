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
import { runBugTriageSetup } from "./presets/bug-triage/index.js";
import { runIndieDevSetup } from "./presets/indie-dev/index.js";
import { runKanbanSetup, ITEM_TYPES as kanbanItemTypes } from "./presets/kanban/index.js";
import { runAgentWorkflowSetup, ITEM_TYPES as agentWorkflowItemTypes } from "./presets/agent-workflow/index.js";
import { runOpenSourceSetup } from "./presets/open-source/index.js";
import { resolvePmDir, readBooleanOption, readStringOption, runTemplatesList, runTemplatesShow } from "./presets/shared.js";
import { runSoftwareSprintSetup } from "./presets/software-sprint/index.js";
import { runStartupRoadmapSetup } from "./presets/startup-roadmap/index.js";
import { PRESET_REGISTRY } from "./registry.js";
import { buildListRows, requirePresetDefinition, validateAllPresets, } from "./catalog.js";
import { computePresetDiff, readWorkspaceSnapshot } from "./diff.js";
import { buildExportedPreset, readWorkspaceSettings, readWorkspaceTemplates, } from "./export.js";
import { planSeeds, seedPresetItems, seedsForPreset } from "./seeds.js";
import * as fs from "node:fs";
// Drift exit code for `presets diff --strict`. Distinct from GENERIC(1)/
// USAGE(2)/NOT_FOUND(3) so CI can tell "drifted" from "command failed".
const EXIT_CODE_DRIFT = 4;
// Mirror the SDK EXIT_CODE contract (see ./presets/shared.ts) so the unified
// `presets` command can throw clean, typed non-zero exits without importing it.
const EXIT_CODE_USAGE = 2;
const EXIT_CODE_NOT_FOUND = 3;
const defineExtension = ((extension) => extension);
// A thrown error only yields a clean non-zero exit (no double-invocation) when
// it carries a numeric `exitCode`. Standalone-installed extensions can't import
// the SDK's EXIT_CODE at runtime, so mirror the contract locally.
class PresetError extends Error {
    exitCode;
    constructor(message, exitCode = 1) {
        super(message);
        this.name = "PresetError";
        this.exitCode = exitCode;
    }
}
// Dispatch table: preset id -> its setup handler. Powers `presets apply <id>`
// and keeps the individual *-setup commands as thin aliases.
const PRESET_HANDLERS = {
    "bug-triage": runBugTriageSetup,
    "indie-dev": runIndieDevSetup,
    "open-source": runOpenSourceSetup,
    "software-sprint": runSoftwareSprintSetup,
    "startup-roadmap": runStartupRoadmapSetup,
    "kanban": runKanbanSetup,
    "agent-workflow": runAgentWorkflowSetup,
};
// pm-cli's loose-option matcher (extension-command-options.ts) only recognizes
// flag definitions whose `long`/`short` include their dash prefixes. Declaring
// `long: "dry-run"` (no `--`) makes the flag invisible to `--help` AND rejected
// at parse time as "Unknown option". Always include the prefixes.
const COMMON_FLAGS = [
    {
        long: "--force",
        short: "-f",
        type: "boolean",
        description: "Overwrite existing settings.json and template files without prompting.",
    },
    {
        long: "--dry-run",
        short: "-n",
        type: "boolean",
        description: "Preview what would be written without making any changes.",
    },
    {
        long: "--prefix",
        short: "-p",
        value_name: "<prefix>",
        type: "string",
        description: "Override the id_prefix written to settings.json.",
    },
];
// `presets list`/`show`/`diff`/`validate`/`export` are JSON-friendly.
const JSON_FLAG = [
    {
        long: "--json",
        type: "boolean",
        description: "Emit machine-readable JSON instead of the human summary.",
    },
];
// `presets apply` additionally accepts --with-seeds to create starter items
// and --replace to full-replace (rather than deep-merge) the owned settings trees.
const APPLY_FLAGS = [
    ...COMMON_FLAGS,
    {
        long: "--with-seeds",
        short: "-s",
        type: "boolean",
        description: "Also create the preset's starter items (built-in fields only; see #97).",
    },
    {
        long: "--replace",
        type: "boolean",
        description: "Full-replace the governance/validation/testing settings trees with the preset's (clean reset) instead of deep-merging. Other settings are still preserved.",
    },
];
// `presets diff` additionally accepts --strict for CI drift detection.
const DIFF_FLAGS = [
    ...JSON_FLAG,
    {
        long: "--strict",
        type: "boolean",
        description: "Exit non-zero (4) when the workspace is NOT in sync with the preset (drift detection for CI/compliance).",
    },
];
// `presets export` writes to a file or stdout and can carry a display name.
const EXPORT_FLAGS = [
    ...JSON_FLAG,
    {
        long: "--output",
        short: "-o",
        value_name: "<file>",
        type: "string",
        description: "Write the exported preset definition to a file instead of stdout.",
    },
    {
        long: "--display-name",
        value_name: "<name>",
        type: "string",
        description: "Human-readable display name for the exported preset (defaults to the id).",
    },
];
// The bare `presets` command unifies the read-only surfaces behind flags so
// users can run `pm presets --list`, `pm presets --diff <id>`, or `pm presets
// --custom <name>` from a single entry point. The subcommands (`presets list`,
// `presets diff`, `presets export`) remain available with identical behavior.
const PRESETS_FLAGS = [
    {
        long: "--list",
        type: "boolean",
        description: "List all bundled workspace presets with what each configures.",
    },
    {
        long: "--diff",
        value_name: "<preset>",
        type: "string",
        description: "Compare the current pm workspace against the named preset and report differences.",
    },
    {
        long: "--custom",
        value_name: "<name>",
        type: "string",
        description: "Export the current workspace config (settings + templates) as a new preset definition.",
    },
    ...JSON_FLAG,
    {
        long: "--strict",
        type: "boolean",
        description: "With --diff: exit non-zero (4) when the workspace is NOT in sync with the preset.",
    },
    {
        long: "--output",
        short: "-o",
        value_name: "<file>",
        type: "string",
        description: "With --custom: write the exported preset definition to a file instead of stdout.",
    },
    {
        long: "--display-name",
        value_name: "<name>",
        type: "string",
        description: "With --custom: human-readable display name for the exported preset (defaults to the name).",
    },
];
export default defineExtension({
    activate(api) {
        // ── bug-triage ──────────────────────────────────────────────────────────
        api.registerCommand({
            name: "triage-setup",
            description: "Apply the bug-triage preset: strict governance for production incidents, hotfixes, and root-cause tracking.",
            flags: COMMON_FLAGS,
            run: runBugTriageSetup,
        });
        // ── indie-dev ───────────────────────────────────────────────────────────
        api.registerCommand({
            name: "indie-setup",
            description: "Apply the indie-dev preset: minimal-ceremony workspace for solo developers and personal projects.",
            flags: COMMON_FLAGS,
            run: runIndieDevSetup,
        });
        // ── open-source ─────────────────────────────────────────────────────────
        api.registerCommand({
            name: "oss-setup",
            description: "Apply the open-source preset: issue triage, milestone releases, and contributor-friendly templates.",
            flags: COMMON_FLAGS,
            run: runOpenSourceSetup,
        });
        // ── software-sprint ─────────────────────────────────────────────────────
        api.registerCommand({
            name: "sprint-setup",
            description: "Apply the software-sprint preset: sprint-based workflow with epics, features, tasks, and bugs.",
            flags: COMMON_FLAGS,
            run: runSoftwareSprintSetup,
        });
        // ── startup-roadmap ─────────────────────────────────────────────────────
        api.registerCommand({
            name: "roadmap-setup",
            description: "Apply the startup-roadmap preset: investor-grade milestones, strategic initiatives, and quarterly planning.",
            flags: COMMON_FLAGS,
            run: runStartupRoadmapSetup,
        });
        // ── kanban ──────────────────────────────────────────────────────────────
        api.registerCommand({
            name: "kanban-setup",
            description: "Apply the kanban preset: continuous-flow board (backlog/ready/in-progress/review/done) with card templates.",
            flags: COMMON_FLAGS,
            run: runKanbanSetup,
        });
        // ── agent-workflow ────────────────────────────────────────────────────
        api.registerCommand({
            name: "agent-setup",
            description: "Apply the agent-workflow preset: AI agent project management with delegated agent runs, prompt experiments, and eval suites.",
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
            description: "Unified presets surface: --list shows presets, --diff <id> compares the workspace, --custom <name> exports the current workspace as a preset.",
            examples: [
                "pm presets --list",
                "pm presets --diff software-sprint",
                "pm presets --custom our-config",
                "pm presets --custom our-config --output our-config.preset.json",
            ],
            flags: PRESETS_FLAGS,
            run: (ctx) => {
                const options = ctx.options ?? {};
                const list = readBooleanOption(options, "list");
                const diffId = readStringOption(options, "diff");
                const customName = readStringOption(options, "custom");
                if (!list && !diffId && !customName) {
                    throw new PresetError("`presets` requires one of --list, --diff <preset>, or --custom <name>.", EXIT_CODE_USAGE);
                }
                // Disallow mixing dispatch flags: the surfaces have different outputs.
                const chosen = [list, Boolean(diffId), Boolean(customName)].filter(Boolean).length;
                if (chosen > 1) {
                    throw new PresetError("Specify only one of --list, --diff, or --custom at a time.", EXIT_CODE_USAGE);
                }
                if (list) {
                    return {
                        presets: buildListRows(),
                        count: PRESET_REGISTRY.length,
                    };
                }
                if (diffId) {
                    const definition = requirePresetDefinition(diffId);
                    const snapshot = readWorkspaceSnapshot(resolvePmDir(ctx));
                    const result = computePresetDiff(definition, snapshot);
                    const strict = readBooleanOption(options, "strict");
                    if (strict && !result.inSync) {
                        const json = readBooleanOption(options, "json");
                        if (json) {
                            console.log(JSON.stringify(result, null, 2));
                        }
                        else {
                            const { settingsToAdd, settingsToChange, templatesMissing } = result.summary;
                            console.error("Workspace is NOT in sync with preset '" + definition.id + "': " +
                                settingsToAdd + " setting(s) to add, " + settingsToChange + " to change, " +
                                templatesMissing + " template(s) missing.");
                        }
                        throw new PresetError("Workspace drifted from preset '" + definition.id + "'.", EXIT_CODE_DRIFT);
                    }
                    return result;
                }
                // --custom <name>: export the current workspace as a preset definition.
                const name = customName;
                const pmDir = resolvePmDir(ctx);
                const settings = readWorkspaceSettings(pmDir);
                if (!settings) {
                    throw new PresetError("No readable settings.json in " + pmDir + ". Run 'pm init' (and apply a preset) first.", EXIT_CODE_NOT_FOUND);
                }
                const templates = readWorkspaceTemplates(pmDir);
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
                    console.log("Exported preset '" + exported.id + "' (" + exported.templates.length + " template(s)) to " + output);
                    return undefined;
                }
                return exported;
            },
        });
        // ── unified presets list / show / diff / validate / apply ────────────────
        api.registerCommand({
            name: "presets list",
            action: "presets-list",
            description: "List all bundled workspace presets with what each configures (governance, item types, templates).",
            examples: ["pm presets list", "pm presets list --json"],
            flags: JSON_FLAG,
            run: () => ({
                presets: buildListRows(),
                count: PRESET_REGISTRY.length,
            }),
        });
        api.registerCommand({
            name: "presets show",
            action: "presets-show",
            description: "Print the full definition of one preset: settings patch, templates, and custom item types.",
            examples: ["pm presets show software-sprint", "pm presets show kanban --json"],
            arguments: [
                { name: "preset", required: true, description: "Preset id (see `pm presets list`)." },
            ],
            flags: JSON_FLAG,
            run: (ctx) => requirePresetDefinition(ctx.args?.[0]),
        });
        api.registerCommand({
            name: "presets diff",
            action: "presets-diff",
            description: "Compare the current pm workspace (settings + installed templates) against a preset and report differences.",
            examples: [
                "pm presets diff software-sprint",
                "pm presets diff bug-triage --json",
                "pm presets diff bug-triage --strict",
            ],
            arguments: [
                { name: "preset", required: true, description: "Preset id (see `pm presets list`)." },
            ],
            flags: DIFF_FLAGS,
            run: (ctx) => {
                const definition = requirePresetDefinition(ctx.args?.[0]);
                const snapshot = readWorkspaceSnapshot(resolvePmDir(ctx));
                const result = computePresetDiff(definition, snapshot);
                const strict = readBooleanOption(ctx.options, "strict");
                if (strict && !result.inSync) {
                    // Drift detected. Print the diff (respecting --json) so CI logs show
                    // WHAT drifted, then exit non-zero with a dedicated drift code (4).
                    const json = readBooleanOption(ctx.options, "json");
                    if (json) {
                        console.log(JSON.stringify(result, null, 2));
                    }
                    else {
                        const { settingsToAdd, settingsToChange, templatesMissing } = result.summary;
                        console.error(`Workspace is NOT in sync with preset '${definition.id}': ` +
                            `${settingsToAdd} setting(s) to add, ${settingsToChange} to change, ` +
                            `${templatesMissing} template(s) missing.`);
                    }
                    throw new PresetError(`Workspace drifted from preset '${definition.id}'.`, EXIT_CODE_DRIFT);
                }
                return result;
            },
        });
        api.registerCommand({
            name: "presets export",
            action: "presets-export",
            description: "Snapshot the CURRENT workspace's settings + templates as a reusable preset definition (JSON) to stdout or a file.",
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
            run: (ctx) => {
                const name = ctx.args?.[0];
                if (typeof name !== "string" || name.trim().length === 0) {
                    throw new PresetError("presets export requires a preset name argument.", 2);
                }
                const pmDir = resolvePmDir(ctx);
                const settings = readWorkspaceSettings(pmDir);
                if (!settings) {
                    throw new PresetError(`No readable settings.json in ${pmDir}. Run \`pm init\` (and apply a preset) first.`, 3);
                }
                const templates = readWorkspaceTemplates(pmDir);
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
                    console.log(`Exported preset '${exported.id}' (${exported.templates.length} template(s)) to ${output}`);
                    return undefined;
                }
                // No --output: return the definition so pm renders it as the command
                // result. With `--json` pm emits clean, pipeable JSON (no trailing
                // result block); use `--output` for a verbatim file on disk.
                return exported;
            },
        });
        api.registerCommand({
            name: "presets validate",
            action: "presets-validate",
            description: "Validate that all bundled presets parse and load correctly.",
            examples: ["pm presets validate", "pm presets validate --json"],
            flags: JSON_FLAG,
            run: () => {
                const result = validateAllPresets();
                if (!result.ok) {
                    const detail = result.issues
                        .map((issue) => `  ${issue.presetId}: ${issue.message}`)
                        .join("\n");
                    throw new PresetError(`${result.issues.length} preset validation issue(s) across ${result.checked} preset(s):\n${detail}`, 1);
                }
                return result;
            },
        });
        api.registerCommand({
            name: "presets apply",
            action: "presets-apply",
            description: "Apply a workspace preset by id (e.g. `pm presets apply kanban`). Run `pm presets list` to see all ids.",
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
            run: (ctx) => {
                const id = ctx.args?.[0];
                // Validate the id up front (NOT_FOUND/exit 3 for unknown names).
                const definition = requirePresetDefinition(id);
                const handler = PRESET_HANDLERS[definition.id];
                handler(ctx);
                const withSeeds = readBooleanOption(ctx.options, "withSeeds", "with-seeds");
                if (!withSeeds) {
                    return;
                }
                const dryRun = readBooleanOption(ctx.options, "dryRun", "dry-run");
                const pmRoot = resolvePmDir(ctx);
                const seeds = seedsForPreset(definition.id);
                if (seeds.length === 0) {
                    console.log(`No starter seeds defined for '${definition.id}'.`);
                    return;
                }
                if (dryRun) {
                    console.log("");
                    console.log(`[dry-run] Would seed ${seeds.length} starter item(s):`);
                    for (const entry of planSeeds(pmRoot, definition.id)) {
                        console.log(`  - ${entry.type}: ${entry.title}`);
                    }
                    return;
                }
                console.log("");
                console.log(`Seeding ${seeds.length} starter item(s)...`);
                const seedResult = seedPresetItems(pmRoot, definition.id);
                for (const detail of seedResult.details) {
                    if (detail.ok) {
                        console.log(`  Created: ${detail.title}`);
                    }
                    else {
                        console.warn(`  Failed:  ${detail.title}${detail.message ? ` (${detail.message})` : ""}`);
                    }
                }
                if (seedResult.failed > 0) {
                    throw new PresetError(`Seeded ${seedResult.created} item(s) but ${seedResult.failed} failed.`, 1);
                }
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
export { PRESET_REGISTRY } from "./registry.js";
//# sourceMappingURL=index.js.map