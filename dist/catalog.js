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
import { CommandError, EXIT_CODE } from "./presets/shared.js";
import { PRESET_REGISTRY, PRESET_PARAMETERS, bugTriageSettings, bugTriageTemplates, indieDevSettings, indieDevTemplates, openSourceSettings, openSourceTemplates, softwareSprintSettings, softwareSprintTemplates, startupRoadmapSettings, startupRoadmapTemplates, kanbanSettings, kanbanTemplates, kanbanItemTypes, agentWorkflowSettings, agentWorkflowTemplates, agentWorkflowItemTypes, } from "./registry.js";
import { buildParameterViews, resolveParameterValues, resolveParameterizedPreset, } from "./params.js";
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
const RAW_PRESETS = {
    "bug-triage": { settings: bugTriageSettings, templates: bugTriageTemplates, parameters: PRESET_PARAMETERS["bug-triage"] },
    "indie-dev": { settings: indieDevSettings, templates: indieDevTemplates, parameters: PRESET_PARAMETERS["indie-dev"] },
    "open-source": { settings: openSourceSettings, templates: openSourceTemplates, parameters: PRESET_PARAMETERS["open-source"] },
    "software-sprint": { settings: softwareSprintSettings, templates: softwareSprintTemplates, parameters: PRESET_PARAMETERS["software-sprint"] },
    "startup-roadmap": { settings: startupRoadmapSettings, templates: startupRoadmapTemplates, parameters: PRESET_PARAMETERS["startup-roadmap"] },
    "kanban": { settings: kanbanSettings, templates: kanbanTemplates, parameters: PRESET_PARAMETERS["kanban"], itemTypes: kanbanItemTypes },
    "agent-workflow": { settings: agentWorkflowSettings, templates: agentWorkflowTemplates, parameters: PRESET_PARAMETERS["agent-workflow"], itemTypes: agentWorkflowItemTypes },
};
/**
 * Resolve one bundled preset's raw exports against its typed parameter manifest.
 *
 * The single resolution path for every catalog consumer: bindings are
 * substituted with default or caller-supplied values through the same engine
 * the apply path uses, so previews (`show`, `diff`, `stack`) never display or
 * compare unresolved binding syntax.
 */
function resolveRawPreset(raw, supplied) {
    const manifest = raw.parameters;
    const resolved = resolveParameterValues(manifest, supplied ?? {});
    const substitution = resolveParameterizedPreset(manifest, resolved.values, {
        settings: raw.settings,
        templates: raw.templates,
    });
    return {
        settings: substitution.settings,
        templates: substitution.templates,
        parameterViews: buildParameterViews(manifest, supplied),
    };
}
/** Copy bundled template payloads for adaptation into host profile definitions. */
export function presetTemplateEntries(id) {
    const raw = RAW_PRESETS[id];
    if (!raw) {
        throw new CommandError(`No definition exports for preset '${id}'.`);
    }
    if (raw.parameters.length === 0) {
        return structuredClone(Object.values(raw.templates));
    }
    const substitution = resolveRawPreset(raw);
    return Object.values(substitution.templates).map((document) => structuredClone(document));
}
/**
 * Project a stored template into the compact view the catalog exposes.
 *
 * Extracts the `type` (defaulting to `"Task"` when the option is absent or not a
 * string) and the sorted option keys, so two templates with the same options in
 * different key order compare equal.
 */
export function projectTemplateView(document) {
    const options = document.options;
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
export function projectItemTypeViews(itemTypes) {
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
function buildDefinition(descriptor, supplied) {
    const raw = RAW_PRESETS[descriptor.id];
    if (!raw) {
        throw new CommandError(`No definition exports for preset '${descriptor.id}'.`);
    }
    const resolved = resolveRawPreset(raw, supplied);
    const templates = Object.values(resolved.templates)
        .map(projectTemplateView)
        .sort((left, right) => left.name.localeCompare(right.name));
    return {
        id: descriptor.id,
        displayName: descriptor.displayName,
        description: descriptor.description,
        command: descriptor.command,
        idPrefix: descriptor.idPrefix,
        governance: descriptor.governance,
        settings: resolved.settings,
        templates,
        itemTypes: projectItemTypeViews(raw.itemTypes),
        parameters: resolved.parameterViews,
    };
}
/** All preset definitions in registry order. */
export function listPresetDefinitions() {
    return PRESET_REGISTRY.map((descriptor) => buildDefinition(descriptor));
}
/**
 * Find one preset definition by id (case-insensitive, trimmed).
 *
 * Returns `undefined` for unknown names so callers decide the error contract;
 * `requirePresetDefinition` is the throwing variant for command handlers.
 * Parameter bindings resolve with defaults unless caller-supplied values are
 * passed (the diff preview mirrors a parameterized apply that way).
 */
export function findPresetDefinition(id, supplied) {
    if (typeof id !== "string") {
        return undefined;
    }
    const needle = id.trim().toLowerCase();
    if (needle.length === 0) {
        return undefined;
    }
    const descriptor = PRESET_REGISTRY.find((preset) => preset.id.toLowerCase() === needle);
    return descriptor ? buildDefinition(descriptor, supplied) : undefined;
}
/** Throwing lookup: NOT_FOUND (exit 3) for unknown names. */
export function requirePresetDefinition(id, supplied) {
    const found = findPresetDefinition(id, supplied);
    if (!found) {
        const ids = PRESET_REGISTRY.map((preset) => preset.id).join(", ");
        throw new CommandError(`Unknown preset '${id ?? ""}'. Available: ${ids}. Run \`pm presets list\` for details.`, EXIT_CODE.NOT_FOUND);
    }
    return found;
}
export function buildListRows() {
    return listPresetDefinitions().map((definition) => {
        const builtinTypes = [...new Set(definition.templates.map((template) => template.type))].sort((left, right) => left.localeCompare(right));
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
const GOVERNANCE_VALUES = new Set(["minimal", "default", "strict", "custom"]);
const TEMPLATE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/**
 * Collect validation issues for one preset against its raw template map.
 *
 * The checks are the same ones {@link validateAllPresets} runs on the bundled
 * catalog: known governance, present prefixes, valid template names and option
 * values, and agreement between advertised and exported template names.
 */
export function collectPresetIssues(definition, rawTemplates, advertisedTemplates) {
    const issues = [];
    const add = (message) => issues.push({ presetId: definition.id, message });
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
            const validValue = typeof value === "string" ||
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
        add(`registry templates [${advertised.join(", ")}] differ from exported [${exported.join(", ")}]`);
    }
    return issues;
}
/**
 * Throw when a validation result is not clean, matching the `presets validate`
 * command's failure formatting.
 */
export function requireValidPresets(result) {
    if (!result.ok) {
        const detail = result.issues
            .map((issue) => `  ${issue.presetId}: ${issue.message}`)
            .join("\n");
        throw new CommandError(`${result.issues.length} preset validation issue(s) across ${result.checked} preset(s):\n${detail}`);
    }
    return result;
}
/**
 * Validate one bundled preset's parameter manifest and resolved native fields.
 *
 * Producer/validator agreement: resolves every binding occurrence with the
 * SAME engine the apply path uses, then runs the existing preset issue checks
 * on the resolved settings/templates. A manifest, binding or resolution failure
 * is captured as one issue naming the preset (a bad record fails alone, never
 * the whole validation run).
 */
export function collectPresetParameterIssues(definition, raw, advertisedTemplates) {
    try {
        const resolved = resolveRawPreset({ settings: raw.settings, templates: raw.templates, parameters: raw.parameters ?? [] });
        return collectPresetIssues(definition, resolved.templates, advertisedTemplates);
    }
    catch (error) {
        return [{ presetId: definition.id, message: `parameter resolution failed: ${String(error)}` }];
    }
}
/**
 * Validate that every bundled preset parses/loads coherently:
 *  - registry descriptor and raw exports agree,
 *  - parameter manifests are well-formed and every binding resolves,
 *  - governance is a known enum value,
 *  - id_prefix is present,
 *  - templates have valid names and string/string[] option values,
 *  - the descriptor's advertised template list matches what is exported.
 */
export function validateAllPresets() {
    const definitions = listPresetDefinitions();
    const issues = [];
    for (const definition of definitions) {
        const descriptor = PRESET_REGISTRY.find((preset) => preset.id === definition.id);
        // This lookup is unchecked on purpose, and it is safe for a reason that is
        // not local: every `definition` here came from `listPresetDefinitions()`,
        // which maps `buildDefinition` over the registry, and `buildDefinition`
        // throws on a descriptor with no raw exports. A drifted registry entry can
        // therefore never reach this line — `listPresetDefinitions()` above raises
        // the actionable error first. Adding a second guard here would be
        // unreachable code, so the invariant is recorded instead. If
        // `buildDefinition`'s guard is ever removed, this line becomes a
        // `Cannot read properties of undefined`.
        issues.push(...collectPresetParameterIssues(definition, RAW_PRESETS[definition.id], descriptor?.templates));
    }
    return { ok: issues.length === 0, checked: definitions.length, issues };
}
//# sourceMappingURL=catalog.js.map