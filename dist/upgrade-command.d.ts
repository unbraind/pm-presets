import type { ExtensionApi } from "@unbrained/pm-cli/sdk/authoring";
/** Read one bounded JSON artifact, suppressing filesystem paths and private parser diagnostics. */
export declare function readPresetArtifact(file: string | undefined): unknown;
/** Register settings-only migration commands; no workspace discovery or Git subprocess is needed. */
export declare function registerUpgradeCommands(api: ExtensionApi): void;
//# sourceMappingURL=upgrade-command.d.ts.map