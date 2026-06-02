/**
 * catalog.ts — structured, read-only views over the bundled presets.
 *
 * The individual preset modules export their SETTINGS / TEMPLATES (and, for
 * kanban, ITEM_TYPES). This module joins those raw exports with the
 * PRESET_REGISTRY descriptors and derives the higher-level views consumed by
 * the read-only commands `presets show`, `presets diff`, and `presets validate`
 * (plus the enriched `presets list`).
 *
 * Everything here is pure: no filesystem, no process exit, no SDK runtime. That
 * keeps it unit-testable with `node --test` and side-effect free.
 */
import type { PresetSettingsPatch } from "./presets/shared.js";
import { type PresetDescriptor } from "./registry.js";
/** A minimally-typed mirror of the SDK's SchemaItemTypeDefinition. */
export interface PresetItemTypeView {
    name: string;
    aliases: string[];
    options: Array<{
        key: string;
        values: string[];
    }>;
}
/** A single template summarized for human and JSON consumption. */
export interface PresetTemplateView {
    name: string;
    /** The built-in pm item type the template creates (e.g. "Issue"). */
    type: string;
    /** All `pm create` option keys the template sets (sorted). */
    optionKeys: string[];
}
/** The full, structured definition of one preset. */
export interface PresetDefinition {
    id: string;
    displayName: string;
    description: string;
    command: string;
    idPrefix: string;
    governance: PresetDescriptor["governance"];
    /** The settings.json patch this preset deep-merges on apply. */
    settings: PresetSettingsPatch;
    /** Templates this preset installs. */
    templates: PresetTemplateView[];
    /** Custom item types registered at activation (kanban only today). */
    itemTypes: PresetItemTypeView[];
}
/** All preset definitions in registry order. */
export declare function listPresetDefinitions(): PresetDefinition[];
/**
 * Find one preset definition by id (case-insensitive, trimmed).
 *
 * Returns `undefined` for unknown names so callers decide the error contract;
 * `requirePresetDefinition` is the throwing variant for command handlers.
 */
export declare function findPresetDefinition(id: string | undefined): PresetDefinition | undefined;
/** Throwing lookup: NOT_FOUND (exit 3) for unknown names. */
export declare function requirePresetDefinition(id: string | undefined): PresetDefinition;
/** A compact row for `presets list`, enriched with what each preset configures. */
export interface PresetListRow {
    id: string;
    name: string;
    command: string;
    governance: PresetDescriptor["governance"];
    idPrefix: string;
    templates: string[];
    templateCount: number;
    /** Distinct built-in item types the templates create. */
    itemTypes: string[];
    /** Names of custom item types registered via the schema API. */
    customItemTypes: string[];
    description: string;
}
export declare function buildListRows(): PresetListRow[];
/** One validation problem found in a bundled preset. */
export interface PresetValidationIssue {
    presetId: string;
    message: string;
}
export interface PresetValidationResult {
    ok: boolean;
    checked: number;
    issues: PresetValidationIssue[];
}
/**
 * Validate that every bundled preset parses/loads coherently:
 *  - registry descriptor and raw exports agree,
 *  - governance is a known enum value,
 *  - id_prefix is present,
 *  - templates have valid names and string/string[] option values,
 *  - the descriptor's advertised template list matches what is exported.
 */
export declare function validateAllPresets(): PresetValidationResult;
//# sourceMappingURL=catalog.d.ts.map