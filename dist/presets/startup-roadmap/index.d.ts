import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
/**
 * The settings patch for the startup-roadmap preset.
 *
 * Custom governance with strict metadata and stale-lock force required, tuned
 * for roadmap planning; the default create type is `Feature` and new items are
 * prefixed `road-`.
 */
export declare const SETTINGS: {
    id_prefix: string;
    governance: {
        preset: "custom";
        ownership_enforcement: "warn";
        create_mode_default: "progressive";
        close_validation_default: "warn";
        parent_reference: "warn";
        metadata_profile: "strict";
        force_required_for_stale_lock: true;
        create_default_type: string;
    };
    validation: {
        sprint_release_format: "warn";
        parent_reference: "warn";
        metadata_profile: "strict";
    };
    testing: {
        record_results_to_items: false;
    };
};
/**
 * The templates the startup-roadmap preset installs: an `initiative`, a roadmap
 * `feature`, and a `milestone` (the last with a `+90d` deadline default).
 */
export declare const TEMPLATES: {
    "initiative.json": import("../shared.ts").StoredCreateTemplateDocument;
    "feature.json": import("../shared.ts").StoredCreateTemplateDocument;
    "milestone.json": import("../shared.ts").StoredCreateTemplateDocument;
};
/**
 * Command handler for the startup-roadmap setup command: delegates the
 * settings, templates, and next-steps to {@link applyPreset}.
 */
export declare function runStartupRoadmapSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map