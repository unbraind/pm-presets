/**
 * seeds.ts — optional starter items for `presets apply <id> --with-seeds`.
 *
 * IMPORTANT (pm-cli issue #97): custom scalar fields registered via
 * `registerItemFields` have no `pm create --<field>` setter. Seed items
 * therefore set ONLY built-in fields (title, type, priority, tags, body). Any
 * preset-specific context lives in the body text, not in custom options.
 *
 * Seeding shells out to the `pm` binary so item IDs, the toon format, and
 * workspace governance are all handled by pm itself rather than re-implemented
 * here. The seed *definitions* and the dry-run plan are pure and unit-tested;
 * only `seedPresetItems` touches the process.
 */
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
export declare function seedsForPreset(presetId: string): SeedItem[];
/** Build the `pm create` argv for one seed item (built-in fields only). */
export declare function buildSeedCreateArgs(pmRoot: string, seed: SeedItem): string[];
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
 * Create the preset's starter items by shelling out to `pm create`.
 * Non-throwing: failures are collected so a partial seed still reports clearly.
 */
export declare function seedPresetItems(pmRoot: string, presetId: string, pmBin?: string): SeedResult;
//# sourceMappingURL=seeds.d.ts.map