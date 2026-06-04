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
export declare const EXIT_CODE: {
    readonly GENERIC_FAILURE: 1;
    readonly USAGE: 2;
    readonly NOT_FOUND: 3;
};
export declare class CommandError extends Error {
    exitCode: number;
    constructor(message: string, exitCode?: number);
}
type JsonObject = Record<string, unknown>;
export type TemplateOptionValue = string | string[];
export type CreateTemplateOptions = Record<string, TemplateOptionValue>;
export interface StoredCreateTemplateDocument {
    name: string;
    created_at: string;
    updated_at: string;
    options: CreateTemplateOptions;
}
export type PresetTemplateMap = Record<string, StoredCreateTemplateDocument>;
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
export declare function normalizeTemplateName(rawName: string): string;
export declare function storedTemplate(rawName: string, options: CreateTemplateOptions): StoredCreateTemplateDocument;
/**
 * Merge a preset settings patch, optionally full-replacing the governance /
 * validation / testing trees rather than deep-merging them.
 *
 * Pure and unit-tested. Other top-level keys (e.g. `id_prefix`, unrelated user
 * config) are always deep-merged so unrelated settings are never dropped.
 */
export declare function mergePresetSettings(existing: JsonObject, patch: JsonObject, replace: boolean): JsonObject;
export declare function applyPreset(context: CommandHandlerContext, input: {
    label: string;
    settings: PresetSettingsPatch;
    templates: PresetTemplateMap;
    nextSteps: string[];
    warning?: string;
}): void;
export declare function runTemplatesList(context: CommandHandlerContext): TemplatesListResult;
export declare function runTemplatesShow(context: CommandHandlerContext): TemplatesShowResult;
export {};
//# sourceMappingURL=shared.d.ts.map