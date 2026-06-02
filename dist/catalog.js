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
import { bugTriageSettings, bugTriageTemplates, indieDevSettings, indieDevTemplates, openSourceSettings, openSourceTemplates, softwareSprintSettings, softwareSprintTemplates, startupRoadmapSettings, startupRoadmapTemplates, kanbanSettings, kanbanTemplates, kanbanItemTypes, } from "./registry.js";
import { PRESET_REGISTRY } from "./registry.js";
/** Raw exports keyed by preset id. */
const RAW_PRESETS = {
    "bug-triage": { settings: bugTriageSettings, templates: bugTriageTemplates },
    "indie-dev": { settings: indieDevSettings, templates: indieDevTemplates },
    "open-source": { settings: openSourceSettings, templates: openSourceTemplates },
    "software-sprint": { settings: softwareSprintSettings, templates: softwareSprintTemplates },
    "startup-roadmap": { settings: startupRoadmapSettings, templates: startupRoadmapTemplates },
    "kanban": { settings: kanbanSettings, templates: kanbanTemplates, itemTypes: kanbanItemTypes },
};
function templateView(document) {
    const options = document.options;
    const type = typeof options.type === "string" ? options.type : "Task";
    const optionKeys = Object.keys(options).sort((left, right) => left.localeCompare(right));
    return { name: document.name, type, optionKeys };
}
function itemTypeViews(raw) {
    if (!raw.itemTypes) {
        return [];
    }
    return raw.itemTypes.map((entry) => ({
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
/** Build the full structured definition for a known descriptor. */
function buildDefinition(descriptor) {
    const raw = RAW_PRESETS[descriptor.id];
    if (!raw) {
        // Registry and raw exports are compile-time bound, so this is a guard for
        // future drift rather than a runtime-reachable path.
        throw new CommandError(`No definition exports for preset '${descriptor.id}'.`);
    }
    const templates = Object.values(raw.templates)
        .map(templateView)
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
        itemTypes: itemTypeViews(raw),
    };
}
/** All preset definitions in registry order. */
export function listPresetDefinitions() {
    return PRESET_REGISTRY.map(buildDefinition);
}
/**
 * Find one preset definition by id (case-insensitive, trimmed).
 *
 * Returns `undefined` for unknown names so callers decide the error contract;
 * `requirePresetDefinition` is the throwing variant for command handlers.
 */
export function findPresetDefinition(id) {
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
export function requirePresetDefinition(id) {
    const found = findPresetDefinition(id);
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
 * Validate that every bundled preset parses/loads coherently:
 *  - registry descriptor and raw exports agree,
 *  - governance is a known enum value,
 *  - id_prefix is present,
 *  - templates have valid names and string/string[] option values,
 *  - the descriptor's advertised template list matches what is exported.
 */
export function validateAllPresets() {
    const issues = [];
    const definitions = listPresetDefinitions();
    for (const definition of definitions) {
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
        const raw = RAW_PRESETS[definition.id];
        for (const [filename, document] of Object.entries(raw.templates)) {
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
        // The registry descriptor advertises a template list; confirm it matches
        // what the preset module actually exports (drift would mislead `list`).
        const descriptor = PRESET_REGISTRY.find((preset) => preset.id === definition.id);
        const advertised = [...(descriptor?.templates ?? [])].sort((a, b) => a.localeCompare(b));
        const exported = definition.templates.map((template) => template.name).sort((a, b) => a.localeCompare(b));
        if (JSON.stringify(advertised) !== JSON.stringify(exported)) {
            add(`registry templates [${advertised.join(", ")}] differ from exported [${exported.join(", ")}]`);
        }
    }
    return { ok: issues.length === 0, checked: definitions.length, issues };
}
//# sourceMappingURL=catalog.js.map