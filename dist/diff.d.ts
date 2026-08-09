/**
 * diff.ts — compare a pm workspace against a bundled preset definition.
 *
 * The comparison is split in two so the interesting logic stays pure and
 * unit-testable:
 *
 *   - `computePresetDiff(definition, snapshot)` is pure: it takes an already-read
 *     workspace snapshot and the preset definition and returns a structured diff.
 *   - `readWorkspaceSnapshot(pmDir)` is the only filesystem-touching part.
 *
 * What we compare:
 *   - settings.json: every leaf in the preset's settings patch (added vs changed
 *     vs already-matching),
 *   - templates: which of the preset's templates are missing / present in the
 *     workspace `templates/` directory,
 *   - item types: the custom item types the preset registers (informational —
 *     they are registered in-memory at activation, not written to disk).
 */
import type { PresetDefinition } from "./catalog.ts";
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
    };
    /** Custom item types the preset would register (informational). */
    itemTypes: string[];
    summary: {
        settingsToAdd: number;
        settingsToChange: number;
        templatesMissing: number;
    };
}
/** Pure diff: preset definition vs an already-read workspace snapshot. */
export declare function computePresetDiff(definition: PresetDefinition, snapshot: WorkspaceSnapshot): PresetDiff;
/** Read the workspace snapshot from disk (the only impure part). */
export declare function readWorkspaceSnapshot(pmDir: string): WorkspaceSnapshot;
export {};
//# sourceMappingURL=diff.d.ts.map