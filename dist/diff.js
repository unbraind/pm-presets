/**
 * Compare every controlled artifact against the same desired-state plan apply uses.
 * Settings keys, complete template documents and managed seed contents all count.
 * Captured snapshots use read-only public SDK readers; replacement normalization
 * runs only against isolated synthetic public settings, never the target tracker.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { computeDesiredPresetState, compareDesiredPresetState, ownArtifact, presetArtifactRecord, artifactValuesEqual, seedArtifactMatches } from "./desired-state.js";
import { readPresetApplicationHistory } from "./application-history.js";
import { readSeedArtifacts } from "./artifact-reader.js";
import { isSecretReference, collectParameterValues, collectSecretSettingPaths, redactSecretValuesDeep, resolveSettingsWithParameters, ParameterRefusal } from "./params.js";
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Flatten a settings patch into dotted-path leaves, recursing into objects. */
function flattenLeaves(value, prefix = "") {
    const leaves = [];
    for (const [key, child] of Object.entries(value)) {
        const dotted = prefix ? `${prefix}.${key}` : key;
        if (child === undefined)
            continue;
        if (isJsonObject(child)) {
            leaves.push(...flattenLeaves(child, dotted));
        }
        else {
            leaves.push({ path: dotted, value: child });
        }
    }
    return leaves;
}
/** Read a dotted path out of a JSON object; returns `undefined` if any hop misses. */
function readPath(root, dotted) {
    if (!root) {
        return { found: false, value: undefined };
    }
    let current = root;
    for (const segment of dotted.split(".")) {
        if (!isJsonObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
            return { found: false, value: undefined };
        }
        current = current[segment];
    }
    return { found: true, value: current };
}
function valuesEqual(left, right) {
    return artifactValuesEqual(left, right);
}
/** Complete artifact diff against an already-read snapshot and selected apply options. */
export async function computePresetDiff(definition, snapshot, options = {}) {
    let record;
    const errors = (snapshot.artifactErrors ?? []).filter((name) => name === "history/_workspace.jsonl" || name === "settings.json#preset_artifacts" || name === `settings.json#preset_artifacts.${definition.id}`);
    // Keep legacy SDK projections available to destination redaction, while
    // refusing to call settings synchronized when application would reject them.
    try {
        resolveSettingsWithParameters([], {}, definition.settings);
    }
    catch {
        errors.push("settings.json");
    }
    try {
        record = presetArtifactRecord(snapshot.settings, definition.id);
    }
    catch (error) {
        errors.push(`settings.json#preset_artifacts.${definition.id}`);
    }
    const historical = ownArtifact(snapshot.applicationRecords, definition.id);
    if (record && historical === undefined)
        errors.push("history/_workspace.jsonl");
    if (historical !== undefined) {
        if (!artifactValuesEqual(record, historical ?? undefined))
            errors.push(`settings.json#preset_artifacts.${definition.id}`);
        record = historical ?? undefined;
    }
    if (definition.templates.some(({ name }) => ownArtifact(definition.templateDocuments, `${name}.json`) === undefined)) {
        throw new ParameterRefusal("invalid_manifest", "Supply complete templateDocuments for every declared template before computing desired artifact state.");
    }
    if ((options.withSeeds || record) && !Array.isArray(definition.seedItems)) {
        throw new ParameterRefusal("invalid_manifest", "Supply the complete seedItems inventory, including an explicit empty array for a seedless preset, before comparing managed seeds.");
    }
    const planInput = {
        presetId: definition.id,
        settings: { ...definition.settings, id_prefix: options.prefix ?? definition.settings.id_prefix },
        templates: definition.templateDocuments ?? {},
        seeds: options.withSeeds || record ? definition.seedItems ?? [] : undefined,
        record, replace: options.replace,
    };
    let desired;
    try {
        desired = await computeDesiredPresetState(planInput);
    }
    catch (error) {
        if (!(error instanceof ParameterRefusal) || error.code !== "invalid_artifact_record" || !record)
            throw error;
        errors.push(`settings.json#preset_artifacts.${definition.id}`);
        desired = await computeDesiredPresetState({ ...planInput, record: undefined });
    }
    const presetSettings = desired.settings;
    const settingLeaves = flattenLeaves(presetSettings);
    const settings = settingLeaves.map((leaf) => {
        const current = readPath(snapshot.settings, leaf.path);
        if (!current.found) {
            return { path: leaf.path, status: "add", preset: leaf.value, workspace: undefined };
        }
        if (valuesEqual(current.value, leaf.value)) {
            return { path: leaf.path, status: "match", preset: leaf.value, workspace: current.value };
        }
        return { path: leaf.path, status: "change", preset: leaf.value, workspace: current.value };
    });
    const workspaceTemplates = new Set(snapshot.templateNames);
    const missing = [];
    const present = [];
    const changed = [];
    for (const template of definition.templates) {
        if (workspaceTemplates.has(template.name)) {
            present.push(template.name);
            const document = desired.templates.find(({ document }) => document.name === template.name)?.document;
            if (document === undefined || !artifactValuesEqual(ownArtifact(snapshot.templateDocuments, `${template.name}.json`), document))
                changed.push(template.name);
        }
        else {
            missing.push(template.name);
        }
    }
    const seedDiff = { missing: [], changed: [], present: [] };
    for (const seed of desired.seeds) {
        const item = ownArtifact(snapshot.seeds, seed.id);
        if (item === undefined)
            seedDiff.missing.push(seed.id);
        else {
            seedDiff.present.push(seed.id);
            if (!seedArtifactMatches(seed.item, item))
                seedDiff.changed.push(seed.id);
        }
    }
    const artifacts = compareDesiredPresetState(desired, { settings: snapshot.settings, templates: snapshot.templateDocuments ?? {}, seeds: snapshot.seeds ?? {}, applicationRecords: snapshot.applicationRecords, artifactErrors: errors });
    const settingsToAdd = settings.filter((entry) => entry.status === "add").length;
    const settingsToChange = settings.filter((entry) => entry.status === "change").length;
    // Destination sensitivity is mandatory even for direct SDK definitions
    // without authored parameter provenance or with an empty manifest.
    const secretPaths = new Set([
        ...collectSecretSettingPaths(definition.settings, []),
        ...(definition.secretSettingPaths ?? []),
    ]);
    return {
        presetId: definition.id,
        inSync: artifacts.length === 0,
        settings: settings.map((entry) => secretPaths.has(entry.path) ? redactSettingEntry(entry) : entry),
        templates: { missing, present, changed },
        seeds: seedDiff,
        artifacts,
        itemTypes: definition.itemTypes.map((type) => type.name),
        summary: {
            settingsToAdd,
            settingsToChange,
            templatesMissing: missing.length,
            templatesChanged: changed.length,
            seedsMissing: seedDiff.missing.length,
            seedsChanged: seedDiff.changed.length,
        },
    };
}
/** Hide an entire sensitive location, including a stored value of a different shape. */
function redactSettingEntry(entry) {
    return {
        ...entry,
        preset: isSecretReference(entry.preset) ? entry.preset : "<redacted>",
        workspace: entry.workspace === undefined || isSecretReference(entry.workspace) ? entry.workspace : "<redacted>",
    };
}
/** Detect supplied secrets anywhere in a resolved leaf, including atomic arrays. */
function containsSecretValue(value, secrets) {
    if (typeof value === "string")
        return secrets.some((secret) => value.includes(secret));
    if (Array.isArray(value))
        return value.some((entry) => containsSecretValue(entry, secrets));
    if (isJsonObject(value))
        return Object.values(value).some((entry) => containsSecretValue(entry, secrets));
    return false;
}
/** Read the workspace snapshot from disk (the only impure part). */
export async function readWorkspaceSnapshot(pmDir, client) {
    const settingsPath = path.join(pmDir, "settings.json");
    let settings;
    if (fs.existsSync(settingsPath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
            if (isJsonObject(parsed)) {
                settings = parsed;
            }
        }
        catch {
            settings = undefined;
        }
    }
    const templatesDir = path.join(pmDir, "templates");
    let templateNames = [];
    if (fs.existsSync(templatesDir)) {
        try {
            templateNames = fs.readdirSync(templatesDir)
                .filter((entry) => entry.toLowerCase().endsWith(".json"))
                .map((entry) => entry.slice(0, -".json".length));
        }
        catch {
            templateNames = [];
        }
    }
    const templateDocuments = Object.fromEntries(templateNames.map((name) => {
        const filename = `${name}.json`;
        try {
            return [filename, JSON.parse(fs.readFileSync(path.join(templatesDir, filename), "utf8"))];
        }
        catch {
            return [filename, undefined];
        }
    }));
    const records = ownArtifact(settings, "preset_artifacts");
    const artifactErrors = [], ids = [];
    if (records !== undefined) {
        if (typeof records !== "object" || records === null || Array.isArray(records))
            artifactErrors.push("settings.json#preset_artifacts");
        else
            for (const id of Object.keys(records)) {
                try {
                    ids.push(...presetArtifactRecord(settings, id).seedIds);
                }
                catch (error) {
                    artifactErrors.push(`settings.json#preset_artifacts.${id}`);
                }
            }
    }
    const history = await readPresetApplicationHistory(pmDir);
    artifactErrors.push(...history.errors);
    for (const record of Object.values(history.records))
        if (record)
            ids.push(...record.seedIds);
    const seedEntries = [];
    for (const id of new Set(ids)) {
        try {
            seedEntries.push(...Object.entries(await readSeedArtifacts(pmDir, [id], client)));
        }
        catch {
            seedEntries.push([id, {}]);
        }
    }
    const seeds = Object.fromEntries(seedEntries);
    return { settings, templateNames, templateDocuments, seeds, artifactErrors, applicationRecords: history.records };
}
/**
 * The parameterized diff surface both diff commands share.
 *
 * A diff is a preview of apply, so it resolves with the caller's supplied
 * values and refuses exactly like apply does: any required parameter still
 * unanswered refuses with the typed remedy before the workspace is read.
 * Because diff results are emitted (TOON/JSON or console), every value that
 * came from a secret-typed parameter is redacted on BOTH sides of each
 * settings entry — the preset side and the workspace side — so a diff can
 * never leak a secret into command output.
 */
export async function computeParameterizedDiff(definition, manifest, supplied, snapshot, options = {}) {
    const unanswered = definition.parameters.filter((view) => view.unanswered).map((view) => view.name);
    if (unanswered.length > 0) {
        throw new ParameterRefusal("unanswered_parameter", `Unanswered required parameter(s): ${unanswered.join(", ")}. Supply --param <name>=<value> (or a --params-file) for each, or diff the default resolution by omitting --param.`);
    }
    const values = collectParameterValues(manifest, supplied).values;
    const diff = await computePresetDiff(definition, snapshot, options);
    const secrets = manifest
        .filter((parameter) => parameter.type === "secret" && Object.hasOwn(values, parameter.name))
        .map((parameter) => values[parameter.name]);
    if (secrets.length === 0) {
        return diff;
    }
    // Projected definitions retain authored provenance. For SDK callers that
    // construct resolved definitions directly, infer sensitive leaves from the
    // supplied values as well. In either case hide BOTH sides wholesale: stored
    // credentials can differ in value and JSON shape during rotation.
    const secretPaths = new Set(definition.secretSettingPaths ?? []);
    return {
        ...diff,
        settings: diff.settings.map((entry) => secretPaths.has(entry.path) || containsSecretValue(entry.preset, secrets)
            ? redactSettingEntry(entry) : {
            ...entry,
            preset: redactSecretValuesDeep(entry.preset, secrets),
            workspace: redactSecretValuesDeep(entry.workspace, secrets),
        }),
    };
}
//# sourceMappingURL=diff.js.map