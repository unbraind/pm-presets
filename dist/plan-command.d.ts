import type { CommandHandlerContext, ExtensionApi } from "@unbrained/pm-cli/sdk/authoring";
import type { PresetPlanTarget } from "./plan.ts";
/** Resolve the host's real activated contracts, preserving standalone extension loading. */
export declare function readDirectoryPlanTarget(ctx: CommandHandlerContext): Promise<PresetPlanTarget>;
/** Compile a bundled or composed preset; failed required prerequisites request a structured nonzero exit. */
export declare function runPresetPlan(ctx: CommandHandlerContext): Promise<{
    schema: 1;
    preset: string;
    backend: PresetPlanTarget["backend"];
    ready: boolean;
    selected: readonly string[];
    omitted: readonly string[];
    refused: readonly string[];
    gaps: import("./plan.ts").PresetPlanGap[];
    gapCount: number;
    omittedGaps: number;
} | {
    schema: 1;
    preset: string;
    backend: PresetPlanTarget["backend"];
    ready: boolean;
    selected: readonly string[];
    omitted: readonly string[];
    refused: readonly string[];
    gaps: import("./plan.ts").PresetPlanGap[];
    gapCount: number;
    omittedGaps: number;
    exit_code: number;
    code: string;
    remediation: string;
}>;
/** Register a first-class read surface so host TOON/JSON projection and budgets remain available. */
export declare function registerPlanCommand(api: ExtensionApi): void;
//# sourceMappingURL=plan-command.d.ts.map