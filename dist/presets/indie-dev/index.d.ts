import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
/**
 * The settings patch for the indie-dev preset.
 *
 * Minimal governance (`metadata_profile: core`, no close validation, no test
 * recording) for a solo developer; the default create type is `Task` and new
 * items are prefixed `indie-`.
 */
export declare const SETTINGS: {
    id_prefix: string;
    governance: {
        preset: "minimal";
        ownership_enforcement: "none";
        create_mode_default: "progressive";
        close_validation_default: "off";
        metadata_profile: "core";
        create_default_type: string;
    };
    validation: {
        sprint_release_format: "warn";
        parent_reference: "warn";
        metadata_profile: "core";
    };
    testing: {
        record_results_to_items: false;
    };
};
/**
 * The templates the indie-dev preset installs: an `idea` decision record and a
 * solo `task`, keeping the surface small for a one-person workspace.
 */
export declare const TEMPLATES: {
    "idea.json": import("../shared.ts").StoredCreateTemplateDocument;
    "task.json": import("../shared.ts").StoredCreateTemplateDocument;
};
/**
 * Command handler for the indie-dev setup command: delegates the settings,
 * templates, and next-steps to {@link applyPreset}.
 */
export declare function runIndieDevSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map