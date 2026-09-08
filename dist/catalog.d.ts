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
import type { PresetSettingsPatch, PresetTemplateMap, StoredCreateTemplateDocument } from "./presets/shared.ts";
import { type PresetDescriptor } from "./registry.ts";
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
    id: PresetDescriptor["id"];
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
interface RawPreset {
    settings: PresetSettingsPatch;
    templates: PresetTemplateMap;
    itemTypes?: readonly {
        name: string;
        aliases?: string[];
        options?: Array<{
            key: string;
            values?: string[];
        }>;
    }[];
}
/**
 * Project a stored template into the compact view the catalog exposes.
 *
 * Extracts the `type` (defaulting to `"Task"` when the option is absent or not a
 * string) and the sorted option keys, so two templates with the same options in
 * different key order compare equal.
 */
export declare function projectTemplateView(document: StoredCreateTemplateDocument): PresetTemplateView;
/**
 * Project a preset's item-type definitions into plain view objects.
 *
 * Returns an empty array when the preset defines no item types. Every alias
 * list and option value list is copied, so the returned views never alias the
 * raw preset's internal arrays and cannot be mutated through the catalog.
 * Missing `aliases` / `options` / `values` become empty arrays rather than
 * throwing, so an incomplete host schema still produces a usable view.
 */
export declare function projectItemTypeViews(itemTypes: RawPreset["itemTypes"]): PresetItemTypeView[];
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
 * The loosely-typed slice of a preset that {@link collectPresetIssues} inspects.
 *
 * Production {@link PresetDefinition} already excludes many of the states this
 * validator exists to reject (invalid governance, a missing prefix). Tests feed
 * this looser shape so those failure paths stay reachable without corrupting
 * the bundled catalog.
 */
export interface PresetValidationSubject {
    /** Preset id reported on each issue. */
    readonly id: string;
    /** Governance value; must be one of the known enum strings. */
    readonly governance: string;
    /** Descriptor-level id prefix; must be a non-empty string. */
    readonly idPrefix: unknown;
    /** Settings patch; must carry a non-empty string `id_prefix`. */
    readonly settings: {
        readonly id_prefix?: unknown;
    };
    /** Catalog template views; an empty list is an issue. */
    readonly templates: readonly {
        readonly name: string;
    }[];
}
/**
 * Collect validation issues for one preset against its raw template map.
 *
 * The checks are the same ones {@link validateAllPresets} runs on the bundled
 * catalog: known governance, present prefixes, valid template names and option
 * values, and agreement between advertised and exported template names.
 */
export declare function collectPresetIssues(definition: PresetValidationSubject, rawTemplates: PresetTemplateMap, advertisedTemplates?: readonly string[]): PresetValidationIssue[];
/**
 * Throw when a validation result is not clean, matching the `presets validate`
 * command's failure formatting.
 */
export declare function requireValidPresets(result: PresetValidationResult): PresetValidationResult;
/**
 * Validate that every bundled preset parses/loads coherently:
 *  - registry descriptor and raw exports agree,
 *  - governance is a known enum value,
 *  - id_prefix is present,
 *  - templates have valid names and string/string[] option values,
 *  - the descriptor's advertised template list matches what is exported.
 */
export declare function validateAllPresets(): PresetValidationResult;
export {};
//# sourceMappingURL=catalog.d.ts.map