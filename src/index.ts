/**
 * pm-presets — all 5 official pm-cli workspace presets in one package.
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
 */

import type { defineExtension as defineExtensionType } from "@unbrained/pm-cli/sdk";

import { runBugTriageSetup } from "./presets/bug-triage/index.js";
import { runIndieDevSetup } from "./presets/indie-dev/index.js";
import { runKanbanSetup, ITEM_TYPES as kanbanItemTypes } from "./presets/kanban/index.js";
import { runOpenSourceSetup } from "./presets/open-source/index.js";
import { runTemplatesList, runTemplatesShow } from "./presets/shared.js";
import { runSoftwareSprintSetup } from "./presets/software-sprint/index.js";
import { runStartupRoadmapSetup } from "./presets/startup-roadmap/index.js";
import { PRESET_REGISTRY } from "./registry.js";

const defineExtension: typeof defineExtensionType = ((extension: any) => extension) as any;

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

// Dispatch table: preset id -> its setup handler. Powers `presets apply <id>`
// and keeps the individual *-setup commands as thin aliases.
const PRESET_HANDLERS: Record<string, (ctx: any) => unknown> = {
  "bug-triage": runBugTriageSetup,
  "indie-dev": runIndieDevSetup,
  "open-source": runOpenSourceSetup,
  "software-sprint": runSoftwareSprintSetup,
  "startup-roadmap": runStartupRoadmapSetup,
  "kanban": runKanbanSetup,
};

// pm-cli's loose-option matcher (extension-command-options.ts) only recognizes
// flag definitions whose `long`/`short` include their dash prefixes. Declaring
// `long: "dry-run"` (no `--`) makes the flag invisible to `--help` AND rejected
// at parse time as "Unknown option". Always include the prefixes.
const COMMON_FLAGS = [
  {
    long: "--force",
    short: "-f",
    type: "boolean" as const,
    description: "Overwrite existing settings.json and template files without prompting.",
  },
  {
    long: "--dry-run",
    short: "-n",
    type: "boolean" as const,
    description: "Preview what would be written without making any changes.",
  },
  {
    long: "--prefix",
    short: "-p",
    value_name: "<prefix>",
    type: "string" as const,
    description: "Override the id_prefix written to settings.json.",
  },
];

export default defineExtension({
  activate(api) {
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

    // Register the kanban board columns as custom item types via the schema API.
    if (typeof api.registerItemTypes === "function") {
      api.registerItemTypes(kanbanItemTypes);
    }

    // ── unified presets list / apply ────────────────────────────────────────
    api.registerCommand({
      name: "presets list",
      action: "presets-list",
      description: "List all available workspace presets bundled in pm-presets.",
      examples: ["pm presets list"],
      run: () => ({
        presets: PRESET_REGISTRY.map((p) => ({
          id: p.id,
          name: p.displayName,
          command: p.command,
          governance: p.governance,
          templates: p.templates,
          description: p.description,
        })),
        count: PRESET_REGISTRY.length,
      }),
    });

    api.registerCommand({
      name: "presets apply",
      action: "presets-apply",
      description:
        "Apply a workspace preset by id (e.g. `pm presets apply kanban`). Run `pm presets list` to see all ids.",
      examples: [
        "pm presets apply kanban",
        "pm presets apply software-sprint --dry-run",
        "pm presets apply bug-triage --force",
      ],
      arguments: [
        { name: "preset", required: true, description: "Preset id (see `pm presets list`)." },
      ],
      flags: COMMON_FLAGS,
      run: (ctx: any) => {
        const id = ctx.args?.[0];
        const handler = id ? PRESET_HANDLERS[id] : undefined;
        if (!handler) {
          const ids = Object.keys(PRESET_HANDLERS).join(", ");
          throw new PresetError(
            `Unknown preset '${id ?? ""}'. Available: ${ids}. Run \`pm presets list\` for details.`,
            2,
          );
        }
        return handler(ctx);
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
export type { PresetDescriptor } from "./registry.js";
