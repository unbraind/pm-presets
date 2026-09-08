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

import type {
  CreateTemplateOptions,
  PresetSettingsPatch,
  PresetTemplateMap,
  StoredCreateTemplateDocument,
} from "./presets/shared.ts";
import { CommandError, EXIT_CODE } from "./presets/shared.ts";
import {
  bugTriageSettings,
  bugTriageTemplates,
  indieDevSettings,
  indieDevTemplates,
  openSourceSettings,
  openSourceTemplates,
  softwareSprintSettings,
  softwareSprintTemplates,
  startupRoadmapSettings,
  startupRoadmapTemplates,
  kanbanSettings,
  kanbanTemplates,
  kanbanItemTypes,
  agentWorkflowSettings,
  agentWorkflowTemplates,
  agentWorkflowItemTypes,
} from "./registry.ts";
import { PRESET_REGISTRY, type PresetDescriptor, type PresetId } from "./registry.ts";

/** A minimally-typed mirror of the SDK's SchemaItemTypeDefinition. */
export interface PresetItemTypeView {
  name: string;
  aliases: string[];
  options: Array<{ key: string; values: string[] }>;
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
  itemTypes?: readonly { name: string; aliases?: string[]; options?: Array<{ key: string; values?: string[] }> }[];
}

/**
 * Raw exports keyed by the closed {@link PresetId} union.
 *
 * Typing the map this way is what makes a missing export a compile error: every
 * {@link PRESET_REGISTRY} descriptor's id is a `PresetId`, so {@link buildDefinition}
 * and {@link validateAllPresets} can index without a runtime existence check.
 * Call sites are `listPresetDefinitions` (maps the registry), `findPresetDefinition`
 * (builds only after a registry hit), and `validateAllPresets` (iterates
 * `listPresetDefinitions()`). There is no other caller.
 */
const RAW_PRESETS: Record<PresetId, RawPreset> = {
  "bug-triage": { settings: bugTriageSettings, templates: bugTriageTemplates },
  "indie-dev": { settings: indieDevSettings, templates: indieDevTemplates },
  "open-source": { settings: openSourceSettings, templates: openSourceTemplates },
  "software-sprint": { settings: softwareSprintSettings, templates: softwareSprintTemplates },
  "startup-roadmap": { settings: startupRoadmapSettings, templates: startupRoadmapTemplates },
  "kanban": { settings: kanbanSettings, templates: kanbanTemplates, itemTypes: kanbanItemTypes },
  "agent-workflow": { settings: agentWorkflowSettings, templates: agentWorkflowTemplates, itemTypes: agentWorkflowItemTypes },
};

/**
 * Project a stored template into the compact view the catalog exposes.
 *
 * Extracts the `type` (defaulting to `"Task"` when the option is absent or not a
 * string) and the sorted option keys, so two templates with the same options in
 * different key order compare equal.
 */
export function projectTemplateView(document: StoredCreateTemplateDocument): PresetTemplateView {
  const options = document.options as CreateTemplateOptions;
  const type = typeof options.type === "string" ? options.type : "Task";
  const optionKeys = Object.keys(options).sort((left, right) => left.localeCompare(right));
  return { name: document.name, type, optionKeys };
}

/**
 * Project a preset's item-type definitions into plain view objects.
 *
 * Returns an empty array when the preset defines no item types. Every alias
 * list and option value list is copied, so the returned views never alias the
 * raw preset's internal arrays and cannot be mutated through the catalog.
 * Missing `aliases` / `options` / `values` become empty arrays rather than
 * throwing, so an incomplete host schema still produces a usable view.
 */
export function projectItemTypeViews(
  itemTypes: RawPreset["itemTypes"],
): PresetItemTypeView[] {
  if (!itemTypes) {
    return [];
  }
  return itemTypes.map((entry) => ({
    name: entry.name,
    aliases: Array.isArray(entry.aliases) ? [...entry.aliases] : [],
    options: Array.isArray(entry.options)
      ? entry.options.map((option) => ({
          key: option.key,
          values: Array.isArray(option.values) ? [...option.values] : [],
        }))
      : [],
  }));
}

/**
 * Build the full structured definition for a known descriptor.
 *
 * The `RAW_PRESETS` key type makes a missing export a compile error for any
 * descriptor this package itself registers. It does not make the lookup total
 * at runtime: {@link PRESET_REGISTRY} is an exported, mutable array, so a
 * consumer can append a descriptor whose id is outside the union (through a
 * cast, or from JavaScript, where the union does not exist at all). Without
 * this guard that appended descriptor reaches `raw.templates` and fails with
 * `Cannot read properties of undefined`, naming neither the preset nor the
 * cause. Keeping it turns registry drift into a diagnostic that says which
 * preset has no exports.
 *
 * @param descriptor - The registry descriptor to expand.
 * @returns The full preset definition.
 * @throws {CommandError} When no raw export exists for the descriptor's id.
 */
function buildDefinition(descriptor: PresetDescriptor): PresetDefinition {
  const raw = RAW_PRESETS[descriptor.id] as RawPreset | undefined;
  if (!raw) {
    throw new CommandError(`No definition exports for preset '${descriptor.id}'.`);
  }
  const templates = Object.values(raw.templates)
    .map(projectTemplateView)
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    id: descriptor.id,
    displayName: descriptor.displayName,
    description: descriptor.description,
    command: descriptor.command,
    idPrefix: descriptor.idPrefix,
    governance: descriptor.governance,
    settings: raw.settings,
    templates,
    itemTypes: projectItemTypeViews(raw.itemTypes),
  };
}

/** All preset definitions in registry order. */
export function listPresetDefinitions(): PresetDefinition[] {
  return PRESET_REGISTRY.map(buildDefinition);
}

/**
 * Find one preset definition by id (case-insensitive, trimmed).
 *
 * Returns `undefined` for unknown names so callers decide the error contract;
 * `requirePresetDefinition` is the throwing variant for command handlers.
 */
export function findPresetDefinition(id: string | undefined): PresetDefinition | undefined {
  if (typeof id !== "string") {
    return undefined;
  }
  const needle = id.trim().toLowerCase();
  if (needle.length === 0) {
    return undefined;
  }
  const descriptor = PRESET_REGISTRY.find((preset) => preset.id.toLowerCase() === needle);
  return descriptor ? buildDefinition(descriptor) : undefined;
}

/** Throwing lookup: NOT_FOUND (exit 3) for unknown names. */
export function requirePresetDefinition(id: string | undefined): PresetDefinition {
  const found = findPresetDefinition(id);
  if (!found) {
    const ids = PRESET_REGISTRY.map((preset) => preset.id).join(", ");
    throw new CommandError(
      `Unknown preset '${id ?? ""}'. Available: ${ids}. Run \`pm presets list\` for details.`,
      EXIT_CODE.NOT_FOUND,
    );
  }
  return found;
}

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

export function buildListRows(): PresetListRow[] {
  return listPresetDefinitions().map((definition) => {
    const builtinTypes = [...new Set(definition.templates.map((template) => template.type))].sort(
      (left, right) => left.localeCompare(right),
    );
    return {
      id: definition.id,
      name: definition.displayName,
      command: definition.command,
      governance: definition.governance,
      idPrefix: definition.idPrefix,
      templates: definition.templates.map((template) => template.name),
      templateCount: definition.templates.length,
      itemTypes: builtinTypes,
      customItemTypes: definition.itemTypes.map((type) => type.name),
      description: definition.description,
    };
  });
}

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

const GOVERNANCE_VALUES = new Set(["minimal", "default", "strict", "custom"]);
const TEMPLATE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

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
  readonly settings: { readonly id_prefix?: unknown };
  /** Catalog template views; an empty list is an issue. */
  readonly templates: readonly { readonly name: string }[];
}

/**
 * Collect validation issues for one preset against its raw template map.
 *
 * The checks are the same ones {@link validateAllPresets} runs on the bundled
 * catalog: known governance, present prefixes, valid template names and option
 * values, and agreement between advertised and exported template names.
 */
export function collectPresetIssues(
  definition: PresetValidationSubject,
  rawTemplates: PresetTemplateMap,
  advertisedTemplates?: readonly string[],
): PresetValidationIssue[] {
  const issues: PresetValidationIssue[] = [];
  const add = (message: string) => issues.push({ presetId: definition.id, message });

  if (!GOVERNANCE_VALUES.has(definition.governance)) {
    add(`invalid governance '${definition.governance}'`);
  }
  if (typeof definition.idPrefix !== "string" || definition.idPrefix.length === 0) {
    add("missing id_prefix");
  }
  if (typeof definition.settings.id_prefix !== "string" || definition.settings.id_prefix.length === 0) {
    add("settings patch is missing id_prefix");
  }
  if (definition.templates.length === 0) {
    add("has no templates");
  }

  for (const [filename, document] of Object.entries(rawTemplates)) {
    if (!TEMPLATE_NAME_PATTERN.test(document.name)) {
      add(`template name '${document.name}' is invalid`);
    }
    if (filename !== `${document.name}.json`) {
      add(`template map key '${filename}' does not match document name '${document.name}'`);
    }
    for (const [key, value] of Object.entries(document.options)) {
      const validValue =
        typeof value === "string" ||
        (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
      if (key.trim().length === 0) {
        add(`template '${document.name}' has an empty option key`);
      }
      if (!validValue) {
        add(`template '${document.name}' option '${key}' has a non-string value`);
      }
    }
  }

  const advertised = [...(advertisedTemplates ?? [])].sort((left, right) => left.localeCompare(right));
  const exported = definition.templates.map((template) => template.name).sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(advertised) !== JSON.stringify(exported)) {
    add(
      `registry templates [${advertised.join(", ")}] differ from exported [${exported.join(", ")}]`,
    );
  }

  return issues;
}

/**
 * Throw when a validation result is not clean, matching the `presets validate`
 * command's failure formatting.
 */
export function requireValidPresets(result: PresetValidationResult): PresetValidationResult {
  if (!result.ok) {
    const detail = result.issues
      .map((issue) => `  ${issue.presetId}: ${issue.message}`)
      .join("\n");
    throw new CommandError(
      `${result.issues.length} preset validation issue(s) across ${result.checked} preset(s):\n${detail}`,
    );
  }
  return result;
}

/**
 * Validate that every bundled preset parses/loads coherently:
 *  - registry descriptor and raw exports agree,
 *  - governance is a known enum value,
 *  - id_prefix is present,
 *  - templates have valid names and string/string[] option values,
 *  - the descriptor's advertised template list matches what is exported.
 */
export function validateAllPresets(): PresetValidationResult {
  const definitions = listPresetDefinitions();
  const issues: PresetValidationIssue[] = [];

  for (const definition of definitions) {
    const descriptor = PRESET_REGISTRY.find((preset) => preset.id === definition.id);
    issues.push(
      ...collectPresetIssues(definition, RAW_PRESETS[definition.id].templates, descriptor?.templates),
    );
  }

  return { ok: issues.length === 0, checked: definitions.length, issues };
}
