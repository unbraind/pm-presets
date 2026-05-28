import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
export declare const SETTINGS: {
    readonly id_prefix: "indie-";
    readonly governance: {
        readonly preset: "minimal";
        readonly ownership_enforcement: "off";
        readonly create_mode_default: "progressive";
        readonly close_validation_default: "off";
        readonly metadata_profile: "core";
    };
    readonly validation: {
        readonly sprint_release_format: "off";
        readonly parent_reference: "off";
    };
    readonly testing: {
        readonly record_results_to_items: false;
    };
    readonly telemetry: {
        readonly enabled: false;
    };
};
export declare const TEMPLATES: Record<string, object>;
export declare function runIndieDevSetup(context: CommandHandlerContext): Promise<void>;
//# sourceMappingURL=index.d.ts.map