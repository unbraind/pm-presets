import type { PmClient } from "@unbrained/pm-cli/sdk";
import type { SeedTypeDefinition } from "./desired-state.ts";
/** Capture complete active native names and aliases, including extension-defined types. */
export declare function readSeedTypes(pmRoot: string, client?: PmClient): Promise<SeedTypeDefinition[]>;
/** Read complete managed items; absent ids differ, and other read failures refuse. */
export declare function readSeedArtifacts(pmRoot: string, ids: readonly string[], client?: PmClient): Promise<Record<string, Record<string, unknown>>>;
//# sourceMappingURL=artifact-reader.d.ts.map