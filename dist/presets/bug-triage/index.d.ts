import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
export declare const SETTINGS: {
    id_prefix: string;
    governance: {
        preset: "custom";
        ownership_enforcement: "strict";
        create_mode_default: "progressive";
        close_validation_default: "strict";
        parent_reference: "strict_error";
        metadata_profile: "strict";
        force_required_for_stale_lock: true;
        create_default_type: string;
    };
    validation: {
        sprint_release_format: "strict_error";
        parent_reference: "warn";
        metadata_profile: "strict";
    };
    testing: {
        record_results_to_items: true;
    };
};
export declare const TEMPLATES: {
    "incident.json": import("../shared.js").StoredCreateTemplateDocument;
    "hotfix-task.json": import("../shared.js").StoredCreateTemplateDocument;
    "regression.json": import("../shared.js").StoredCreateTemplateDocument;
};
export declare function runBugTriageSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map