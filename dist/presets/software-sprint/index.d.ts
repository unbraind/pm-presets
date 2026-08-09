import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
/**
 * The settings patch for the software-sprint preset.
 *
 * Default governance with warn-level enforcement and test results recorded to
 * items, suited to a sprint cadence; the default create type is `Task` and new
 * items are prefixed `sprint-`.
 */
export declare const SETTINGS: {
    id_prefix: string;
    governance: {
        preset: "default";
        ownership_enforcement: "warn";
        create_mode_default: "progressive";
        close_validation_default: "warn";
        parent_reference: "warn";
        metadata_profile: "core";
        create_default_type: string;
    };
    validation: {
        sprint_release_format: "warn";
        parent_reference: "warn";
        metadata_profile: "core";
    };
    testing: {
        record_results_to_items: true;
    };
};
/**
 * The templates the software-sprint preset installs: a sprint `bug`, an `epic`,
 * a `feature`, and a `task`, covering the work-item shapes a sprint board
 * needs.
 */
export declare const TEMPLATES: {
    "bug.json": import("../shared.ts").StoredCreateTemplateDocument;
    "epic.json": import("../shared.ts").StoredCreateTemplateDocument;
    "feature.json": import("../shared.ts").StoredCreateTemplateDocument;
    "task.json": import("../shared.ts").StoredCreateTemplateDocument;
};
/**
 * Command handler for the software-sprint setup command: delegates the
 * settings, templates, and next-steps to {@link applyPreset}.
 */
export declare function runSoftwareSprintSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map