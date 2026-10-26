import type * as Host from "@unbrained/pm-cli/sdk";
import type { ExtensionCommandSdk } from "@unbrained/pm-cli/sdk/authoring";
import { type PresetId } from "./registry.ts";
import { type SeedItem } from "./seeds.ts";
/** Select whole catalog surfaces; omitted flags select settings/templates but omit seeds. */
export interface PresetStackSelection {
    readonly preset: PresetId;
    readonly settings?: boolean;
    readonly templates?: boolean;
    readonly seeds?: boolean;
}
/** Bounded JSON request. Choices map an ownership JSON pointer to a competing preset id. */
export interface PresetStackInput {
    readonly selections: readonly PresetStackSelection[];
    readonly choices?: Readonly<Record<string, PresetId>>;
}
/** Ownership is independent of current tracker values; identical contributions share ownership. */
export interface PresetStackOwnership {
    readonly path: string;
    readonly owners: readonly PresetId[];
    readonly conflict: boolean;
    readonly choice: PresetId | "";
}
/** Safe failures omit user settings and raw provider diagnostics. */
export type StackRefusalCode = "invalid_input" | "sdk_required" | "target_unavailable" | "normalization_conflict";
/** A usage refusal carries a stable category and a concrete corrective action. */
export declare class StackRefusal extends Error {
    /** Machine-readable failure category. */
    readonly code: StackRefusalCode;
    /** Action to take before retrying. */
    readonly remedy: string;
    /** Expected failure recognized by the extension host. */
    readonly exitCode = 2;
    /** Construct a privacy-safe diagnostic. */
    constructor(code: StackRefusalCode, remedy: string);
}
/** Complete preview; profile is the host-native portion, settingsPatch covers additional preset knobs. */
export interface PresetStackPlan {
    readonly schema: 1;
    readonly ready: boolean;
    readonly selections: readonly PresetStackSelection[];
    readonly ownership: readonly PresetStackOwnership[];
    readonly unresolved: number;
    readonly profile: Host.ProjectProfileDefinition | null;
    readonly hostPlan: Host.ProfileApplicationPlan | null;
    readonly settingsPatch: Readonly<Record<string, unknown>>;
    /** Paths changed by host normalization, including derived governance leaves; values stay private. */
    readonly settingsChanges: readonly string[];
    /** Catalog seed identities only; no item creation or deduplication against tracker titles is attempted. */
    readonly seeds: readonly {
        readonly identity: string;
        readonly owner: PresetId;
        readonly item: SeedItem;
    }[];
}
/** Require the host's canonical preview; ordinary replay receipts cannot substitute for settings. */
export declare function stackSettingsPreview(result: Awaited<ReturnType<ExtensionCommandSdk["mutateWorkspaceSettings"]>>): Host.PmSettings;
/** Adapt bundled contributions into a canonical host profile preview; never apply or persist a plan. */
export declare function planPresetStack(pmRoot: string, sdk: ExtensionCommandSdk, input: PresetStackInput): Promise<PresetStackPlan>;
/** Compact agent output excludes all stored values and complete template/seed bodies. */
export declare function summarizePresetStack(plan: PresetStackPlan): {
    schema: number;
    ready: boolean;
    presets: PresetId[];
    counts: {
        settings: number;
        templates: number;
        seeds: number;
        unresolved: number;
    };
    ownership: readonly PresetStackOwnership[];
    settingsChanges: readonly string[];
    templates: {
        name: string;
        status: Host.ProfileChangeStatus;
    }[];
    code?: string | undefined;
    remedy?: string | undefined;
    exit_code?: number | undefined;
};
//# sourceMappingURL=stack.d.ts.map