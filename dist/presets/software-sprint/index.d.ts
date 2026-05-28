import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
export declare const SETTINGS: {
    readonly id_prefix: "sprint-";
    readonly governance: {
        readonly preset: "default";
        readonly ownership_enforcement: "warn";
        readonly create_mode_default: "progressive";
        readonly close_validation_default: "warn";
        readonly metadata_profile: "core";
    };
    readonly search: {
        readonly mode: "keyword";
    };
    readonly calendar: {
        readonly default_view: "week";
        readonly first_day_of_week: 1;
    };
    readonly telemetry: {
        readonly enabled: false;
    };
};
export declare const TEMPLATES: Record<string, object>;
export declare function runSoftwareSprintSetup(context: CommandHandlerContext): Promise<void>;
//# sourceMappingURL=index.d.ts.map