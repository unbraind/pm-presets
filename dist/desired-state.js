import { replacementSettings } from "./settings-replacement.js";
import { ParameterRefusal, resolveParameterizedPreset } from "./params.js";
import { createRequire } from "node:module";
import { resolveSimulationSdk } from "./sdk-loader.js";
/** Normalize every controlled seed field with the native writer's public helpers. */
export function normalizeSeedArtifact(seed, types = []) {
    const sdk = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url, process.argv[1]]));
    const aliases = Object.fromEntries([
        ...Object.entries(sdk.resolveItemTypeRegistry(sdk.SETTINGS_DEFAULTS).alias_to_type),
        ...types.flatMap(({ name, aliases }) => [name, ...(aliases ?? [])].map((alias) => [alias.trim().toLowerCase(), name])),
    ]);
    const key = seed.type.trim().toLowerCase();
    // Older host synonym tables can inherit names such as constructor. Only a
    // string returned by the public contract can participate in a lookup.
    const candidate = sdk.resolveTypeSynonym(seed.type);
    const synonym = typeof candidate === "string" ? candidate.toLowerCase() : undefined;
    const type = ownArtifact(aliases, key) ?? (synonym === undefined ? undefined : ownArtifact(aliases, synonym)) ?? seed.type.trim();
    const title = seed.title.trim();
    if (!title)
        throw new ParameterRefusal("invalid_manifest", "Seed titles must contain non-whitespace text before planning or applying.");
    const document = sdk.emptyImportedDocument();
    document.body = seed.body ?? "";
    return {
        type, title,
        priority: String(sdk.resolvePriority(seed.priority ?? "2")),
        tags: JSON.stringify(sdk.parseTags(seed.tags ?? "")),
        body: sdk.canonicalDocument(document).body,
    };
}
/** Read only an artifact map's own entry, including when a prototype is polluted. */
export function ownArtifact(map, key) {
    return map && Object.hasOwn(map, key) ? map[key] : undefined;
}
/** Read package-owned application metadata without accepting malformed ownership. */
export function presetArtifactRecord(settings, presetId) {
    const records = ownArtifact(settings, "preset_artifacts");
    if (records === undefined)
        return undefined;
    if (typeof records !== "object" || records === null || Array.isArray(records))
        throw new ParameterRefusal("invalid_artifact_record", "Inspect settings.preset_artifacts; restore its versioned seed ownership records before applying or diffing.");
    if (!Object.hasOwn(records, presetId))
        return undefined;
    const record = records[presetId];
    if (typeof record !== "object" || record === null || Array.isArray(record)
        || Object.keys(record).sort().join(",") !== "seedIds,version"
        || record.version !== 1
        || !Array.isArray(record.seedIds)
        || Object.keys(record.seedIds).join(",") !== Array.from({ length: record.seedIds.length }, (_, index) => String(index)).join(",")
        || record.seedIds.some((id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(id))
        || new Set(record.seedIds).size !== record.seedIds.length) {
        throw new ParameterRefusal("invalid_artifact_record", "Restore the preset's version 1 seedIds ownership record; never substitute an unrelated item id.");
    }
    return record;
}
/** Compute settings, complete template files, stable seeds and ownership together. */
export async function computeDesiredPresetState(input) {
    if (Object.hasOwn(input.settings, "preset_artifacts") || Object.hasOwn(input.settings, "preset_ownership"))
        throw new ParameterRefusal("invalid_manifest", "settings.preset_artifacts is workspace-local ownership managed by apply; omit it from authored preset settings.");
    if (input.record)
        presetArtifactRecord({ preset_artifacts: { [input.presetId]: input.record } }, input.presetId);
    if (input.seeds?.length && !input.presetId)
        throw new ParameterRefusal("invalid_artifact_record", "Provide a preset id before enrolling managed seeds.");
    try {
        // Final prefix overrides and artifact payloads use the same strict binding
        // checks. Legacy sensitive settings remain available to the diff redactor;
        // application validates its entire settings patch before planning.
        resolveParameterizedPreset([], {}, { settings: { id_prefix: input.settings.id_prefix }, templates: input.templates, seeds: input.seeds });
        const settings = structuredClone(input.settings);
        if (input.replace) {
            const canonical = await replacementSettings(input.settings);
            for (const tree of ["governance", "validation", "testing"]) {
                delete settings[tree];
                Object.defineProperty(settings, tree, { value: canonical[tree], enumerable: true, configurable: true, writable: true });
            }
        }
        if (input.record && input.record.seedIds.some((id, index) => !id.endsWith(`preset-${input.presetId}-${index}`)))
            throw new ParameterRefusal("invalid_artifact_record", "Managed seed ids must retain their preset and slot identity; restore ownership before reconciling any item.");
        const seeds = (input.seeds ?? []).map((item, index) => ({
            id: input.record?.seedIds[index] ?? `${settings.id_prefix}preset-${input.presetId}-${index}`,
            item: normalizeSeedArtifact(item, input.seedTypes),
        }));
        if (seeds.some(({ id }) => !/^[a-z0-9][a-z0-9-]{0,127}$/.test(id)))
            throw new ParameterRefusal("invalid_artifact_record", "Use a lowercase letter/digit/hyphen prefix before enrolling managed seeds.");
        if (input.record && input.record.seedIds.length !== seeds.length)
            throw new ParameterRefusal("invalid_artifact_record", "The managed seed inventory changed; inspect the preset's seed ownership before migrating it.");
        const ownership = input.presetId && input.seeds !== undefined ? { presetId: input.presetId, record: { version: 1, seedIds: seeds.map(({ id }) => id) } } : undefined;
        if (ownership) {
            Object.defineProperty(settings, "preset_artifacts", { value: { [ownership.presetId]: ownership.record }, enumerable: true, configurable: true, writable: true });
        }
        return { settings, templates: Object.entries(input.templates).map(([filename, document]) => ({ filename, document: structuredClone(document) })), seeds, replace: input.replace === true, ownership };
    }
    catch (error) {
        if (error instanceof ParameterRefusal)
            throw error;
        throw new ParameterRefusal("invalid_manifest", "Desired artifacts must contain plain JSON data; remove functions and other uncloneable values before applying or diffing.");
    }
}
/** Structural JSON equality ignores object insertion order and retains own-key semantics. */
export function artifactValuesEqual(left, right) {
    if (Object.is(left, right))
        return true;
    if (typeof left !== "object" || left === null || typeof right !== "object" || right === null)
        return false;
    if (Array.isArray(left) || Array.isArray(right))
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length && Array.from({ length: left.length }, (_, index) => index).every((index) => Object.hasOwn(left, index) === Object.hasOwn(right, index) && (!Object.hasOwn(left, index) || artifactValuesEqual(left[index], right[index])));
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && artifactValuesEqual(left[key], right[key]));
}
/** Compare all seed fields application controls while preserving unrelated user metadata. */
export function seedArtifactMatches(seed, current, types = []) {
    const expected = normalizeSeedArtifact(seed, types);
    return current !== undefined && ownArtifact(current, "type") === expected.type && ownArtifact(current, "title") === expected.title
        && String(ownArtifact(current, "priority")) === expected.priority
        && artifactValuesEqual(ownArtifact(current, "tags") ?? [], JSON.parse(expected.tags))
        && (ownArtifact(current, "body") ?? "") === expected.body && ownArtifact(current, "parent") === undefined;
}
/** Name every controlled setting, complete template or seed that differs. */
export function compareDesiredPresetState(desired, current) {
    const changed = [...(current.artifactErrors ?? [])];
    /** Compare a partial settings tree without inheriting prototype properties. */
    function settings(value, actual, name) {
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
                changed.push(`settings.json#${name}`);
                return;
            }
            for (const [key, child] of Object.entries(value))
                settings(child, Object.hasOwn(actual, key) ? actual[key] : undefined, name ? `${name}.${key}` : key);
        }
        else if (!artifactValuesEqual(value, actual))
            changed.push(`settings.json#${name}`);
    }
    settings(desired.settings, current.settings, "");
    if (desired.replace)
        for (const tree of ["governance", "validation", "testing"]) {
            if (!artifactValuesEqual(desired.settings[tree], ownArtifact(current.settings, tree)))
                changed.push(`settings.json#${tree}`);
        }
    for (const template of desired.templates)
        if (!artifactValuesEqual(template.document, ownArtifact(current.templates, template.filename)))
            changed.push(`templates/${template.filename}`);
    for (const seed of desired.seeds)
        if (!seedArtifactMatches(seed.item, ownArtifact(current.seeds, seed.id)))
            changed.push(`items/${seed.id}`);
    if (desired.ownership && !artifactValuesEqual(desired.ownership.record, ownArtifact(current.applicationRecords, desired.ownership.presetId)))
        changed.push("history/_workspace.jsonl");
    return [...new Set(changed)];
}
//# sourceMappingURL=desired-state.js.map