import type { PmClient } from "@unbrained/pm-cli/sdk";
/** Read complete managed items; absent ids differ, and other read failures refuse. */
export declare function readSeedArtifacts(pmRoot: string, ids: readonly string[], client?: PmClient): Promise<Record<string, Record<string, unknown>>>;
//# sourceMappingURL=artifact-reader.d.ts.map