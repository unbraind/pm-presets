/**
 * Compare every controlled artifact against the same desired-state plan apply uses.
 * Settings keys, complete template documents and managed seed contents all count.
 * Captured snapshots use read-only public SDK readers; replacement normalization
 * runs only against isolated synthetic public settings, never the target tracker.
 */
import type { PresetArtifactRecord, SeedTypeDefinition } from "./desired-state.ts";
import type { PmClient } from "@unbrained/pm-cli/sdk";
import type { PresetDefinition } from "./catalog.ts";
import { type PresetParameterManifest } from "./params.ts";
type JsonValue = unknown;
type JsonObject = Record<string, unknown>;
/**
 * The slice of a workspace a preset diff compares against: the parsed
 * `settings.json` (or `undefined` when it is absent or unreadable) and the
 * template file names present under `templates/`. Captured once so the diff is
 * computed against a stable snapshot rather than re-reading disk mid-compare.
 */
export interface WorkspaceSnapshot {
    /** Parsed settings.json (or `undefined` if absent/unreadable). */
    settings: JsonObject | undefined;
    /** Template names present in the workspace `templates/` directory. */
    templateNames: string[];
    /** Complete parsed documents; missing or unreadable contents cannot match. */
    templateDocuments?: Record<string, unknown>;
    /** Authoritatively read managed seed items keyed by their stable id. */
    seeds?: Record<string, Record<string, unknown>>;
    /** Active native aliases captured alongside managed seed contents. */
    seedTypes?: readonly SeedTypeDefinition[];
    /** Unverifiable ownership records remain named drift, never synchronization. */
    artifactErrors?: string[];
    /** Ownership recovered from the last verified package application in native history. */
    applicationRecords?: Record<string, PresetArtifactRecord | null>;
}
export interface SettingDiffEntry {
    /** Dotted path into settings.json, e.g. "governance.preset". */
    path: string;
    status: "add" | "change" | "match";
    preset: JsonValue;
    workspace: JsonValue;
}
export interface PresetDiff {
    presetId: string;
    /** True when applying the preset would change nothing. */
    inSync: boolean;
    settings: SettingDiffEntry[];
    templates: {
        missing: string[];
        present: string[];
        changed: string[];
    };
    /** Managed starter-item content drift. */
    seeds: {
        missing: string[];
        changed: string[];
        present: string[];
    };
    /** Exact artifact paths whose desired state differs. */
    artifacts: string[];
    /** Custom item types the preset would register (informational). */
    itemTypes: string[];
    summary: {
        settingsToAdd: number;
        settingsToChange: number;
        templatesMissing: number;
        templatesChanged: number;
        seedsMissing: number;
        seedsChanged: number;
    };
}
/** Complete artifact diff against an already-read snapshot and selected apply options. */
export declare function computePresetDiff(definition: PresetDefinition, snapshot: WorkspaceSnapshot, options?: {
    withSeeds?: boolean;
    prefix?: string;
    replace?: boolean;
}): Promise<PresetDiff>;
/** Read the workspace snapshot from disk (the only impure part). */
export declare function readWorkspaceSnapshot(pmDir: string, client?: PmClient): Promise<WorkspaceSnapshot>;
/**
 * The parameterized diff surface both diff commands share.
 *
 * A diff is a preview of apply, so it resolves with the caller's supplied
 * values and refuses exactly like apply does: any required parameter still
 * unanswered refuses with the typed remedy before the workspace is read.
 * Because diff results are emitted (TOON/JSON or console), every value that
 * came from a secret-typed parameter is redacted on BOTH sides of each
 * settings entry — the preset side and the workspace side — so a diff can
 * never leak a secret into command output.
 */
export declare function computeParameterizedDiff(definition: PresetDefinition, manifest: PresetParameterManifest, supplied: Readonly<Record<string, string>>, snapshot: WorkspaceSnapshot, options?: {
    withSeeds?: boolean;
    prefix?: string;
    replace?: boolean;
}): Promise<PresetDiff>;
export {};
//# sourceMappingURL=diff.d.ts.map