import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
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
export declare const TEMPLATES: {
    "initiative.json": import("../shared.js").StoredCreateTemplateDocument;
    "feature.json": import("../shared.js").StoredCreateTemplateDocument;
    "milestone.json": import("../shared.js").StoredCreateTemplateDocument;
};
export declare function runStartupRoadmapSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map