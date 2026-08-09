import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
/**
 * The settings patch for the open-source preset.
 *
 * Default governance with warn-level enforcement and core metadata, suited to
 * community contribution flow; the default create type is `Issue` and new items
 * are prefixed `oss-`. No testing block is set.
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
};
/**
 * The templates the open-source preset installs: a community `bug-report`, a
 * `feature-request`, and a `good-first-issue` scoped for a first-time
 * contributor.
 */
export declare const TEMPLATES: {
    "bug-report.json": import("../shared.ts").StoredCreateTemplateDocument;
    "feature-request.json": import("../shared.ts").StoredCreateTemplateDocument;
    "good-first-issue.json": import("../shared.ts").StoredCreateTemplateDocument;
};
/**
 * Command handler for the open-source setup command: delegates the settings,
 * templates, and next-steps to {@link applyPreset}.
 */
export declare function runOpenSourceSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map