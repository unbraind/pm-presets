import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
export declare const SETTINGS: {
    readonly id_prefix: "oss-";
    readonly governance: {
        readonly preset: "default";
        readonly ownership_enforcement: "off";
        readonly create_mode_default: "progressive";
        readonly close_validation_default: "warn";
        readonly metadata_profile: "core";
    };
    readonly validation: {
        readonly sprint_release_format: "off";
        readonly parent_reference: "warn";
    };
    readonly item_types: {
        readonly definitions: readonly [{
            readonly name: "Epic";
            readonly description: "A major feature or milestone release";
        }, {
            readonly name: "Feature";
            readonly description: "A user-facing improvement or addition";
        }, {
            readonly name: "Issue";
            readonly description: "A bug or regression report";
        }, {
            readonly name: "Task";
            readonly description: "A contributor task or good-first-issue";
        }];
    };
    readonly search: {
        readonly mode: "keyword";
    };
    readonly calendar: {
        readonly default_view: "month";
        readonly first_day_of_week: 1;
    };
    readonly telemetry: {
        readonly enabled: false;
    };
};
export declare const TEMPLATES: Record<string, unknown>;
export declare function runOpenSourceSetup(context: CommandHandlerContext): Promise<void>;
//# sourceMappingURL=index.d.ts.map