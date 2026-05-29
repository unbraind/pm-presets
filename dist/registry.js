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
export const PRESET_REGISTRY = [
    {
        id: "bug-triage",
        displayName: "Bug Triage",
        description: "Strict governance for production incidents, hotfixes, and mandatory root-cause metadata.",
        command: "triage-setup",
        idPrefix: "bug-",
        governance: "custom",
        templates: ["incident", "hotfix-task", "regression"],
    },
    {
        id: "indie-dev",
        displayName: "Indie Dev",
        description: "Minimal-ceremony workspace for solo developers and personal projects.",
        command: "indie-setup",
        idPrefix: "indie-",
        governance: "minimal",
        templates: ["idea", "task"],
    },
    {
        id: "open-source",
        displayName: "Open Source",
        description: "Issue triage, milestone releases, and contributor-friendly templates for OSS maintainers.",
        command: "oss-setup",
        idPrefix: "oss-",
        governance: "default",
        templates: ["bug-report", "feature-request", "good-first-issue"],
    },
    {
        id: "software-sprint",
        displayName: "Software Sprint",
        description: "Sprint-based team workflow with epics, features, tasks, and bugs.",
        command: "sprint-setup",
        idPrefix: "sprint-",
        governance: "default",
        templates: ["epic", "feature", "task", "bug"],
    },
    {
        id: "startup-roadmap",
        displayName: "Startup Roadmap",
        description: "Investor-grade milestones, strategic initiatives, and quarterly planning for startups.",
        command: "roadmap-setup",
        idPrefix: "road-",
        governance: "custom",
        templates: ["initiative", "feature", "milestone"],
    },
];
//# sourceMappingURL=registry.js.map