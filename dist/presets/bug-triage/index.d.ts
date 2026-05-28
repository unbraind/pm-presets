import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
export declare const SETTINGS: {
    readonly id_prefix: "bug-";
    readonly governance: {
        readonly preset: "strict";
        readonly ownership_enforcement: "strict";
        readonly create_mode_default: "strict";
        readonly close_validation_default: "strict";
        readonly metadata_profile: "strict";
    };
    readonly validation: {
        readonly sprint_release_format: "strict_error";
        readonly parent_reference: "warn";
    };
    readonly item_types: {
        readonly definitions: readonly [{
            readonly name: "Issue";
            readonly description: "A defect, incident, or regression requiring investigation and resolution";
        }, {
            readonly name: "Task";
            readonly description: "A remediation, hotfix, or follow-up task linked to an incident";
        }];
    };
    readonly testing: {
        readonly record_results_to_items: true;
    };
    readonly search: {
        readonly mode: "keyword";
    };
    readonly calendar: {
        readonly default_view: "agenda";
        readonly first_day_of_week: 1;
    };
    readonly telemetry: {
        readonly enabled: false;
    };
};
export declare const TEMPLATES: Record<string, unknown>;
export declare function runBugTriageSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map