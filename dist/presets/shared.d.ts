/**
 * shared.ts — option/path helpers shared by every preset setup handler.
 *
 * These centralize two pm-cli integration details that are easy to get wrong:
 *
 *  1. `context.pm_root` already points at the `<project>/.agents/pm` storage
 *     directory (pm-cli's PM_DIRNAME is ".agents/pm"). Handlers must use it
 *     directly — joining another ".agents/pm" doubles the path.
 *
 *  2. pm-cli's loose extension-option parser camelCases flag long-names, so
 *     `--dry-run` arrives in `options` as `dryRun` (not `dry-run`). We read the
 *     camelCase key first and fall back to the kebab-case key for safety.
 */
import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
/** Resolve the `.agents/pm` storage directory for the active workspace. */
export declare function resolvePmDir(context: CommandHandlerContext): string;
/** Read a boolean flag, tolerating both camelCase and kebab-case keys. */
export declare function readBooleanOption(options: Record<string, unknown>, ...keys: string[]): boolean;
/** Read a string flag, tolerating both camelCase and kebab-case keys. */
export declare function readStringOption(options: Record<string, unknown>, ...keys: string[]): string | undefined;
//# sourceMappingURL=shared.d.ts.map