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
import * as path from "node:path";

/** Resolve the `.agents/pm` storage directory for the active workspace. */
export function resolvePmDir(context: CommandHandlerContext): string {
  const pmRoot = context.pm_root?.trim();
  if (pmRoot && pmRoot.length > 0) {
    return path.resolve(pmRoot);
  }
  // Fallback when pm_root is somehow absent: assume the conventional layout.
  return path.resolve(process.cwd(), ".agents", "pm");
}

/** Read a boolean flag, tolerating both camelCase and kebab-case keys. */
export function readBooleanOption(
  options: Record<string, unknown>,
  ...keys: string[]
): boolean {
  for (const key of keys) {
    const value = options[key];
    if (value !== undefined && value !== null) {
      return value === true || value === "true" || value === "1";
    }
  }
  return false;
}

/** Read a string flag, tolerating both camelCase and kebab-case keys. */
export function readStringOption(
  options: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}
