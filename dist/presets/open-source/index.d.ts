import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
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
export declare const TEMPLATES: {
    "bug-report.json": import("../shared.js").StoredCreateTemplateDocument;
    "feature-request.json": import("../shared.js").StoredCreateTemplateDocument;
    "good-first-issue.json": import("../shared.js").StoredCreateTemplateDocument;
};
export declare function runOpenSourceSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map