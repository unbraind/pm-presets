import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
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
export declare const TEMPLATES: {
    "idea.json": import("../shared.js").StoredCreateTemplateDocument;
    "task.json": import("../shared.js").StoredCreateTemplateDocument;
};
export declare function runIndieDevSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map