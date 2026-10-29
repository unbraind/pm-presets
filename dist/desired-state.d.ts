/** One complete artifact plan shared by preset application and synchronization. */
import type { PresetSettingsPatch, PresetTemplateMap, StoredCreateTemplateDocument } from "./presets/shared.ts";
import type { SeedItem } from "./seeds.ts";
/** Durable seed ownership; item ids survive later parameter/prefix changes. */
export interface PresetArtifactRecord {
    version: 1;
    seedIds: string[];
}
/** Every semantic artifact one application owns, excluding host audit timestamps. */
export interface DesiredPresetState {
    settings: PresetSettingsPatch;
    templates: Array<{
        filename: string;
        document: StoredCreateTemplateDocument;
    }>;
    seeds: Array<{
        id: string;
        item: SeedItem;
    }>;
    /** Replacement owns all three settings trees, including omitted raw keys. */
    replace: boolean;
    /** Native audited ownership must agree with the generated settings record. */
    ownership?: {
        presetId: string;
        record: PresetArtifactRecord;
    };
}
/** Read only an artifact map's own entry, including when a prototype is polluted. */
export declare function ownArtifact<T>(map: Record<string, T> | undefined, key: string): T | undefined;
/** Read package-owned application metadata without accepting malformed ownership. */
export declare function presetArtifactRecord(settings: Record<string, unknown> | undefined, presetId: string): PresetArtifactRecord | undefined;
/** Compute settings, complete template files, stable seeds and ownership together. */
export declare function computeDesiredPresetState(input: {
    settings: PresetSettingsPatch;
    templates: PresetTemplateMap;
    presetId?: string;
    seeds?: readonly SeedItem[];
    record?: PresetArtifactRecord;
    replace?: boolean;
}): Promise<DesiredPresetState>;
/** Structural JSON equality ignores object insertion order and retains own-key semantics. */
export declare function artifactValuesEqual(left: unknown, right: unknown): boolean;
/** Compare all seed fields application controls while preserving unrelated user metadata. */
export declare function seedArtifactMatches(seed: SeedItem, current: Record<string, unknown> | undefined): boolean;
/** Name every controlled setting, complete template or seed that differs. */
export declare function compareDesiredPresetState(desired: DesiredPresetState, current: {
    settings: Record<string, unknown> | undefined;
    templates: Record<string, unknown>;
    seeds: Record<string, Record<string, unknown>>;
    applicationRecords?: Record<string, PresetArtifactRecord | null>;
    artifactErrors?: readonly string[];
}): string[];
//# sourceMappingURL=desired-state.d.ts.map