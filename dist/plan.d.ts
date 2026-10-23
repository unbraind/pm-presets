/** Operational prerequisite negotiation, independent of storage and settings validation. */
import type { WorkspaceContracts } from "@unbrained/pm-cli/sdk";
/** A named operational prerequisite; command names are canonical activated extension paths. */
export interface PresetRequirement {
    /** Backend operations and host-resolved extension/schema surfaces are separate namespaces. */
    readonly kind: "capability" | "command" | "type" | "field" | "status";
    /** Exact, case-sensitive contract identifier. */
    readonly name: string;
}
/** An indivisible feature: all prerequisites must exist before it can be selected. */
export interface PresetPlanFeature {
    /** Stable reference to the composed preset's feature, not an executable command. */
    readonly id: string;
    /** Missing optional features are explicitly omitted; required features block the whole plan. */
    readonly optional: boolean;
    /** Conjunction of prerequisites; an empty list is supported everywhere. */
    readonly requires: readonly PresetRequirement[];
}
/** A composed preset declares prerequisites without exposing settings or tracker values. */
export interface PresetComposition {
    /** Stable preset identity. */
    readonly id: string;
    /** Ordered atomic features; dependencies belong in each feature's requirements. */
    readonly features: readonly PresetPlanFeature[];
}
/** Provider-supplied contract snapshot; credentials, URLs and database connections are excluded. */
export interface PresetPlanTarget {
    /** Transport label affects reporting only, never negotiation semantics. */
    readonly backend: "directory" | "database";
    /** Operations actually supported by the selected provider, not guessed from its label. */
    readonly capabilities: readonly string[];
    /** Unmodified workspace contracts from the host SDK or selected database provider. */
    readonly contracts: WorkspaceContracts;
}
/** Stable failure categories usable without parsing human messages. */
export type PlanRefusalCode = "invalid_input" | "contracts_unavailable" | "missing_capability";
/** Invalid inputs and unavailable contract readers fail closed before planning. */
export declare class PlanRefusal extends Error {
    /** Machine-readable reason for recovery decisions. */
    readonly code: PlanRefusalCode;
    /** Concrete next action, without private diagnostics. */
    readonly remedy: string;
    /** Host-recognized usage/refusal status. */
    readonly exitCode = 2;
    /** Construct a safe refusal for SDK and CLI consumers. */
    constructor(code: PlanRefusalCode, remedy: string);
}
/** A precise unsatisfied contract, including the affected feature and recovery action. */
export interface PresetPlanGap extends PresetRequirement {
    /** Feature whose atomic selection this prerequisite prevents. */
    readonly feature: string;
    /** Uniform code for both optional omissions and required refusals. */
    readonly code: "missing_capability";
    /** Provider/schema/extension action to take before replanning. */
    readonly remedy: string;
}
/** Bounded plan with no settings values; refused plans never authorize partial application. */
export interface PresetPlan {
    /** Version of this portable plan contract. */
    readonly schema: 1;
    /** Composed preset identity. */
    readonly preset: string;
    /** Selected provider label. */
    readonly backend: PresetPlanTarget["backend"];
    /** True only if all required features can run. */
    readonly ready: boolean;
    /** Supported feature identifiers, in composition order. */
    readonly selected: readonly string[];
    /** Optional features omitted atomically, in composition order. */
    readonly omitted: readonly string[];
    /** Required features whose missing prerequisites block execution. */
    readonly refused: readonly string[];
    /** Complete precise gaps; inputs are bounded to 32 features and 8 requirements each. */
    readonly gaps: readonly PresetPlanGap[];
}
/** Match operational prerequisites against host contracts; never read, write, activate or invoke Git. */
export declare function compilePresetPlan(composition: PresetComposition, target: PresetPlanTarget): PresetPlan;
/** Declare prerequisites of existing bundled apply primitives, without executing them. */
export declare function bundledPresetComposition(id: string, withSeeds?: boolean): PresetComposition;
/** Compact CLI view with complete counts and explicit truncation, never hidden gaps. */
export declare function summarizePresetPlan(plan: PresetPlan): {
    schema: 1;
    preset: string;
    backend: PresetPlanTarget["backend"];
    ready: boolean;
    selected: readonly string[];
    omitted: readonly string[];
    refused: readonly string[];
    gaps: PresetPlanGap[];
    gapCount: number;
    omittedGaps: number;
};
//# sourceMappingURL=plan.d.ts.map