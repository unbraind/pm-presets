/**
 * seeds.ts — optional starter items for `presets apply <id> --with-seeds`.
 *
 * IMPORTANT (pm-cli issue #97): custom scalar fields registered via
 * `registerItemFields` have no `pm create --<field>` setter. Seed items
 * therefore set ONLY built-in fields (title, type, priority, tags, body). Any
 * preset-specific context lives in the body text, not in custom options.
 *
 * Seeding uses the invocation-bound SDK client so IDs, storage, schema and
 * governance stay host-owned. The argv builder below is presentation-only:
 * existing dry-run consumers can still display a manual create command.
 */
import type { PmClient } from "@unbrained/pm-cli/sdk";
/** A single starter item, restricted to built-in create fields. */
export interface SeedItem {
    type: string;
    title: string;
    priority?: string;
    tags?: string;
    body?: string;
}
/** Built-in-only seed items keyed by preset id. */
export declare const PRESET_SEEDS: Record<string, SeedItem[]>;
/**
 * Resolve a preset id to its starter seed items.
 *
 * Returns an empty array for an id with no seeds (including an unknown id),
 * so callers can iterate unconditionally and a preset that ships no seeds is
 * simply a no-op rather than an error.
 */
export declare function seedsForPreset(presetId: string): SeedItem[];
/** Build a manual command preview only; seed writes never execute these arguments. */
export declare function buildSeedCreateArgs(pmRoot: string, seed: SeedItem): string[];
/**
 * One entry in a seed dry-run plan: the item that would be created and the
 * exact `pm create` command that would create it, so an operator can review
 * before anything runs.
 */
export interface SeedPlanEntry {
    title: string;
    type: string;
    command: string;
}
/** Pure dry-run plan: what `--with-seeds` would create, without running anything. */
export declare function planSeeds(pmRoot: string, presetId: string): SeedPlanEntry[];
export interface SeedResult {
    created: number;
    failed: number;
    details: Array<{
        title: string;
        ok: boolean;
        message?: string;
    }>;
}
/**
 * Create independent starter items through the invocation-bound SDK client.
 * Non-throwing: native create failures retain the existing partial-result shape.
 * There is no batch/replay precondition: an invalid seed must not undo others.
 */
export declare function seedPresetItems(client: PmClient, presetId: string): Promise<SeedResult>;
/**
 * Options for {@link runPresetSeeds}: whether to print a plan instead of creating
 * items, and the host client used for writes.
 */
export interface RunPresetSeedsOptions {
    /** When true, print the plan without creating items. */
    readonly dryRun: boolean;
    /** Invocation-bound client; required only when creating seeds. */
    readonly client?: PmClient;
}
/**
 * Print a dry-run plan or create starter items for an already-applied preset.
 *
 * Logs the seedless case so `presets apply --with-seeds` on a preset with no
 * seeds is an explicit no-op rather than silence. Throws {@link CommandError}
 * when one or more creates fail, after reporting each outcome.
 */
export declare function runPresetSeeds(pmRoot: string, presetId: string, options: RunPresetSeedsOptions): Promise<void>;
//# sourceMappingURL=seeds.d.ts.map