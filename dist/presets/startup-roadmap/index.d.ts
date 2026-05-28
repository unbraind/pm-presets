import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
export declare const SETTINGS: {
    readonly id_prefix: "road-";
    readonly governance: {
        readonly preset: "default";
        readonly ownership_enforcement: "warn";
        readonly create_mode_default: "progressive";
        readonly close_validation_default: "warn";
        readonly metadata_profile: "strict";
    };
    readonly validation: {
        readonly sprint_release_format: "warn";
        readonly parent_reference: "warn";
    };
    readonly item_types: {
        readonly definitions: readonly [{
            readonly name: "Epic";
            readonly description: "A top-level strategic initiative on the roadmap";
        }, {
            readonly name: "Feature";
            readonly description: "A product feature tied to a milestone";
        }, {
            readonly name: "Task";
            readonly description: "Execution-level work item";
        }];
    };
    readonly testing: {
        readonly record_results_to_items: false;
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
export declare function runStartupRoadmapSetup(context: CommandHandlerContext): Promise<void>;
//# sourceMappingURL=index.d.ts.map