import { type PresetArtifactRecord } from "./desired-state.ts";
/** Verified last application ownership, or named uncertainty without exposing audit values. */
export interface PresetApplicationHistory {
    records: Record<string, PresetArtifactRecord | null>;
    errors: string[];
}
/** Read/replay through public SDK contracts; no history, usage or cache mutation. */
export declare function readPresetApplicationHistory(pmRoot: string): Promise<PresetApplicationHistory>;
//# sourceMappingURL=application-history.d.ts.map