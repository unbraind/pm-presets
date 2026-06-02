/**
 * registry.ts — exposes all 5 presets to the pm CLI extension system.
 *
 * Each entry describes the preset's command name, flags, settings, and
 * templates so callers can enumerate them without running the command.
 */
export { SETTINGS as bugTriageSettings, TEMPLATES as bugTriageTemplates, runBugTriageSetup } from "./presets/bug-triage/index.js";
export { SETTINGS as indieDevSettings, TEMPLATES as indieDevTemplates, runIndieDevSetup } from "./presets/indie-dev/index.js";
export { SETTINGS as openSourceSettings, TEMPLATES as openSourceTemplates, runOpenSourceSetup } from "./presets/open-source/index.js";
export { SETTINGS as softwareSprintSettings, TEMPLATES as softwareSprintTemplates, runSoftwareSprintSetup } from "./presets/software-sprint/index.js";
export { SETTINGS as startupRoadmapSettings, TEMPLATES as startupRoadmapTemplates, runStartupRoadmapSetup } from "./presets/startup-roadmap/index.js";
export { SETTINGS as kanbanSettings, TEMPLATES as kanbanTemplates, ITEM_TYPES as kanbanItemTypes, runKanbanSetup } from "./presets/kanban/index.js";
export interface PresetDescriptor {
    /** Stable identifier used in pm CLI commands (e.g. "bug-triage") */
    id: string;
    /** Human-readable display name */
    displayName: string;
    /** Short description for `pm preset list` */
    description: string;
    /** The pm CLI command that applies this preset (e.g. "triage-setup") */
    command: string;
    /** Default id_prefix written to settings.json */
    idPrefix: string;
    /** Governance level: minimal | default | strict | custom */
    governance: "minimal" | "default" | "strict" | "custom";
    /** Template names this preset installs (without .json extension) */
    templates: string[];
}
export declare const PRESET_REGISTRY: PresetDescriptor[];
//# sourceMappingURL=registry.d.ts.map