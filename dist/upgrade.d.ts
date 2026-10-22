import type { ExtensionCommandSdk } from "@unbrained/pm-cli/sdk/authoring";
/** JSON settings patches accept nested objects and treat arrays as indivisible values. */
export type UpgradeSettings = {
    readonly [key: string]: UpgradeValue;
};
/** JSON-only values exclude executable inputs and ambiguous undefined properties. */
export type UpgradeValue = null | boolean | number | string | readonly UpgradeValue[] | UpgradeSettings;
/** A caller supplies the original vendor patch, not an export of locally customized settings. */
export interface VersionedPreset {
    /** Stable vendor identity, identical across the two versions. */
    readonly id: string;
    /** Explicit immutable vendor revision or release label. */
    readonly version: string;
    /** Only vendor-owned settings, without templates or tracker items. */
    readonly settings: UpgradeSettings;
}
/** Explicit choices use RFC 6901 JSON pointers; missing decisions never default to vendor. */
export type UpgradeDecisions = Readonly<Record<string, "local" | "vendor">>;
/** A compact observation reveals paths and choices, never previous setting values. */
export interface UpgradeChange {
    /** Unambiguous JSON pointer, with escaped slashes and tildes. */
    readonly path: string;
    /** Unchanged vendor settings preserve local customizations automatically. */
    readonly kind: "vendor" | "local" | "already" | "conflict";
    /** Empty for automatic choices or an unresolved conflict. */
    readonly decision: "local" | "vendor" | "";
}
/** Private recovery artifact; persist before applying and keep outside version control. */
export interface PresetUpgradeReceipt {
    /** Version of the receipt contract, independent of vendor versions. */
    readonly schema: 1;
    /** Content digest binding the plan, choices and normalized snapshots. */
    readonly id: string;
    /** Explicit retry generation; increment only to start a new migration after rollback. */
    readonly generation: string;
    /** Original vendor patch and revision. */
    readonly from: VersionedPreset;
    /** Target vendor patch and revision. */
    readonly to: VersionedPreset;
    /** Explicit decisions, including decisions to preserve conflicting local edits. */
    readonly decisions: UpgradeDecisions;
    /** Normalized inline settings observed under the host settings lock. */
    readonly before: UpgradeSettings;
    /** Canonical settings preview returned by the host serializer. */
    readonly after: UpgradeSettings;
    /** Paths requiring attention or recording preserved local intent. */
    readonly changes: readonly UpgradeChange[];
}
/** Agents can branch on these categories without parsing raw SDK diagnostics. */
export type UpgradeRefusalCode = "invalid_input" | "invalid_receipt" | "sdk_required" | "conflicts" | "stale_settings" | "normalization_changed" | "mutation_refused";
/** Typed failure with a stable remedy; user settings and raw SDK messages stay private. */
export declare class UpgradeRefusal extends Error {
    /** Stable category suitable for programmatic handling. */
    readonly code: UpgradeRefusalCode;
    /** Concrete corrective action, excluding private diagnostics. */
    readonly remedy: string;
    /** Expected usage/conflict failure, recognized by the pm extension host. */
    readonly exitCode = 2;
    /** Construct a safe, machine-readable refusal. */
    constructor(code: UpgradeRefusalCode, remedy: string);
}
/** Compare JSON settings without a host; arrays and structural type changes require atomic choices. */
export declare function comparePresetUpgrade(from: UpgradeSettings, to: UpgradeSettings, local: UpgradeSettings, decisions?: UpgradeDecisions): {
    after: UpgradeSettings;
    changes: readonly UpgradeChange[];
};
/** Plan against the locked inline snapshot; dry-run never changes settings or history. */
export declare function planPresetUpgrade(sdk: ExtensionCommandSdk, from: VersionedPreset, to: VersionedPreset, decisions?: UpgradeDecisions, generation?: string): Promise<PresetUpgradeReceipt>;
/** Validate private artifacts received from JSON before any host mutation. Digests detect edits, not authorship. */
export declare function parseUpgradeReceipt(value: unknown): PresetUpgradeReceipt;
/** Compact plan report; retrieve all paths from the private receipt when conflicts are truncated. */
export interface PresetUpgradeSummary {
    /** Full digest to identify the saved artifact. */
    readonly id: string;
    /** Vendor identity retained across versions. */
    readonly preset: string;
    /** Original vendor revision. */
    readonly from: string;
    /** Target vendor revision. */
    readonly to: string;
    /** True only when every conflict has an explicit decision. */
    readonly ready: boolean;
    /** Whether normalized settings differ. */
    readonly changed: boolean;
    /** Total path observations in the private receipt. */
    readonly paths: number;
    /** At most twenty conflicts in canonical path order, within a 4 KiB detail budget. */
    readonly conflicts: readonly UpgradeChange[];
    /** Number of conflicts omitted from this compact view. */
    readonly omittedConflicts: number;
    /** Total observations by classification, including omitted conflicts. */
    readonly counts: Readonly<Record<UpgradeChange["kind"], number>>;
}
/** Successful execution acknowledgement; the host history is the durable commit receipt. */
export interface PresetUpgradeResult extends PresetUpgradeSummary {
    /** Forward migration or restoration of the recorded settings. */
    readonly direction: "apply" | "rollback";
    /** Whether the SDK recognized an already committed operation identity. */
    readonly replayed: boolean;
}
/** Bounded result emitted by CLI renderers; full settings stay in the private receipt file. */
export declare function summarizePresetUpgrade(receipt: PresetUpgradeReceipt): PresetUpgradeSummary;
/** Apply or roll back exactly once through the host audit lock, refusing stale state and unresolved choices. */
export declare function executePresetUpgrade(sdk: ExtensionCommandSdk, input: PresetUpgradeReceipt, direction: "apply" | "rollback"): Promise<PresetUpgradeResult>;
//# sourceMappingURL=upgrade.d.ts.map