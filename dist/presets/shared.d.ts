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
export declare function applyPreset(context: CommandHandlerContext, input: {
    label: string;
    settings: PresetSettingsPatch;
    templates: PresetTemplateMap;
    nextSteps: string[];
    warning?: string;
}): void;
export declare function runTemplatesList(context: CommandHandlerContext): TemplatesListResult;
export declare function runTemplatesShow(context: CommandHandlerContext): TemplatesShowResult;
//# sourceMappingURL=shared.d.ts.map