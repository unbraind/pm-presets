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
import { runOpenSourceSetup } from "./presets/open-source/index.js";
import { runTemplatesList, runTemplatesShow } from "./presets/shared.js";
import { runSoftwareSprintSetup } from "./presets/software-sprint/index.js";
import { runStartupRoadmapSetup } from "./presets/startup-roadmap/index.js";

const defineExtension: typeof defineExtensionType = ((extension: any) => extension) as any;

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
