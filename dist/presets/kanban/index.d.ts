import type { CommandHandlerContext, SchemaItemTypeDefinition } from "@unbrained/pm-cli/sdk";
export declare const SETTINGS: {
    id_prefix: string;
    governance: {
        preset: "minimal";
        ownership_enforcement: "warn";
        create_mode_default: "progressive";
        close_validation_default: "off";
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
        record_results_to_items: false;
    };
};
export declare const ITEM_TYPES: SchemaItemTypeDefinition[];
export declare const TEMPLATES: {
    "card.json": import("../shared.js").StoredCreateTemplateDocument;
    "expedite.json": import("../shared.js").StoredCreateTemplateDocument;
    "blocked.json": import("../shared.js").StoredCreateTemplateDocument;
};
export declare function runKanbanSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map