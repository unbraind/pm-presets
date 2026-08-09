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
/**
 * Numeric exit codes mirroring the pm-cli SDK contract.
 *
 * Duplicated here rather than imported: a standalone-installed extension loads
 * only its own `dist/`, so `@unbrained/pm-cli` is not resolvable at runtime.
 * pm's command runtime only honours a thrown error's numeric `exitCode` (a plain
 * `Error` falls through to the unhandled path, which re-invokes the handler and
 * exits with a generic code), so these values are what make a clean non-zero
 * exit possible.
 */
export declare const EXIT_CODE: {
    readonly GENERIC_FAILURE: 1;
    readonly USAGE: 2;
    readonly NOT_FOUND: 3;
};
/**
 * Error whose `exitCode` pm's runtime treats as a handled non-zero exit.
 *
 * Extending `Error` with a numeric {@link exitCode} is the only shape the
 * runtime recognises as "cleanly handled"; throwing a plain `Error` instead
 * triggers the unhandled path that re-invokes the handler and exits with a
 * generic code. Defaults to {@link EXIT_CODE.GENERIC_FAILURE}.
 */
export declare class CommandError extends Error {
    /** Numeric exit code forwarded to `process.exitCode` by the pm runtime. */
    exitCode: number;
    constructor(message: string, exitCode?: number);
}
type JsonObject = Record<string, unknown>;
/** A single template option value: a literal, or a list of literals. */
export type TemplateOptionValue = string | string[];
/** Template options keyed by option name, each a string or string list. */
export type CreateTemplateOptions = Record<string, TemplateOptionValue>;
/**
 * The JSON shape of a template file written under `.agents/pm/templates/`, and
 * of the builtin templates defined in code. Timestamps are the epoch sentinel
 * for builtins so they sort below user-created templates.
 */
export interface StoredCreateTemplateDocument {
    name: string;
    created_at: string;
    updated_at: string;
    options: CreateTemplateOptions;
}
export type PresetTemplateMap = Record<string, StoredCreateTemplateDocument>;
/**
 * The settings fragment a preset layers onto a workspace's `settings.json`.
 *
 * The governance / validation / testing trees are owned by the preset and are
 * either deep-merged over the existing settings or, under `--replace`, swapped
 * out wholesale so stale keys a preset no longer sets are dropped.
 */
export interface PresetSettingsPatch {
    id_prefix: string;
    governance?: {
        preset?: "minimal" | "default" | "strict" | "custom";
        ownership_enforcement?: "none" | "warn" | "strict";
        create_mode_default?: "progressive" | "strict";
        close_validation_default?: "off" | "warn" | "strict";
        parent_reference?: "warn" | "strict_error";
        metadata_profile?: "core" | "strict" | "custom";
        force_required_for_stale_lock?: boolean;
        create_default_type?: string;
    };
    validation?: {
        sprint_release_format: "warn" | "strict_error";
        parent_reference?: "warn" | "strict_error";
        metadata_profile?: "core" | "strict" | "custom";
        metadata_required_fields?: string[];
    };
    testing?: {
        record_results_to_items: boolean;
    };
}
export interface TemplatesListResult {
    templates: string[];
    count: number;
    builtin_templates: string[];
    user_templates: string[];
}
export interface TemplatesShowResult {
    name: string;
    source: "builtin" | "user";
    created_at: string;
    updated_at: string;
    path: string;
    options: CreateTemplateOptions;
}
/** Resolve the `.agents/pm` storage directory for the active workspace. */
export declare function resolvePmDir(context: CommandHandlerContext): string;
/** Read a boolean flag, tolerating both camelCase and kebab-case keys. */
export declare function readBooleanOption(options: Record<string, unknown>, ...keys: string[]): boolean;
/** Read a string flag, tolerating both camelCase and kebab-case keys. */
export declare function readStringOption(options: Record<string, unknown>, ...keys: string[]): string | undefined;
/**
 * Trim a template name and reject anything outside the on-disk grammar.
 *
 * Names must match `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` because they become a file
 * name; a violation throws a `USAGE` {@link CommandError} quoting the bad input
 * rather than silently coercing it.
 *
 * @returns The trimmed name when it is valid.
 */
export declare function normalizeTemplateName(rawName: string): string;
/**
 * Build a {@link StoredCreateTemplateDocument} for a builtin template.
 *
 * Stamps both timestamps with the epoch sentinel (so builtins sort below
 * user-created templates) and runs the options through
 * {@link sortTemplateOptions} for a stable, diff-friendly key order.
 *
 * @param rawName - Unvalidated name; normalized here.
 * @param options - The template's option map.
 * @returns A builtin document with sentinel timestamps and sorted options.
 */
export declare function storedTemplate(rawName: string, options: CreateTemplateOptions): StoredCreateTemplateDocument;
/**
 * Merge a preset settings patch, optionally full-replacing the governance /
 * validation / testing trees rather than deep-merging them.
 *
 * Pure and unit-tested. Other top-level keys (e.g. `id_prefix`, unrelated user
 * config) are always deep-merged so unrelated settings are never dropped.
 */
export declare function mergePresetSettings(existing: JsonObject, patch: JsonObject, replace: boolean): JsonObject;
/**
 * Apply one preset's settings and templates to the workspace on disk.
 *
 * Reads the existing `settings.json`, merges (or, under `--replace`, swaps the
 * owned trees of) the preset's patch, and writes the templates the preset ships
 * — unless `--dry-run`, which prints the planned result instead. Honours
 * `--force` to overwrite an existing user template, and `--prefix` to override
 * the preset's `id_prefix`. Throws `NOT_FOUND` when no initialized pm workspace
 * is present, with the expected settings path in the message.
 */
export declare function applyPreset(context: CommandHandlerContext, input: {
    label: string;
    settings: PresetSettingsPatch;
    templates: PresetTemplateMap;
    nextSteps: string[];
    warning?: string;
}): void;
/**
 * List every template available to the workspace, builtin and user.
 *
 * A user template with the same name as a builtin shadows it, so the builtin is
 * omitted from the builtin list; both lists are sorted, and the combined
 * `templates` is the de-duplicated union.
 */
export declare function runTemplatesList(context: CommandHandlerContext): TemplatesListResult;
/**
 * Resolve one template by name, preferring a user file over the builtin.
 *
 * Requires a non-empty name argument (else `USAGE`), then looks on disk first;
 * a user file is reported with `source: "user"` and its real path, a matching
 * builtin with `source: "builtin"` and a `builtin:` path. A name found nowhere
 * throws `NOT_FOUND`.
 */
export declare function runTemplatesShow(context: CommandHandlerContext): TemplatesShowResult;
export {};
//# sourceMappingURL=shared.d.ts.map