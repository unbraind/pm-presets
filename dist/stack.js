/** Catalog ownership adapter; host profile planning and settings normalization own target semantics. */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requirePresetDefinition, presetTemplateEntries } from "./catalog.js";
import { PRESET_REGISTRY } from "./registry.js";
import { resolvedSeedsForPreset } from "./seeds.js";
import { mergePresetSettings } from "./presets/shared.js";
import { resolveSimulationSdk } from "./sdk-loader.js";
/** A usage refusal carries a stable category and a concrete corrective action. */
export class StackRefusal extends Error {
    /** Machine-readable failure category. */
    code;
    /** Action to take before retrying. */
    remedy;
    /** Expected failure recognized by the extension host. */
    exitCode = 2;
    /** Construct a privacy-safe diagnostic. */
    constructor(code, remedy) {
        super(`${code}: ${remedy}`);
        this.name = "StackRefusal";
        this.code = code;
        this.remedy = remedy;
    }
}
/** Recognize plain JSON objects, excluding custom prototypes. */
function object(value) {
    return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
/** Fail the single request schema before any provider or filesystem access. */
function invalid() {
    throw new StackRefusal("invalid_input", "Use {selections:[{preset,settings?,templates?,seeds?}],choices?:{conflictPointer:preset}}; select 1-7 unique bundled ids, boolean flags, and at most 128 choices. See the stack example.");
}
/** Strict boundary: reject accessors, hidden properties, sparse arrays, extra keys and unbounded inputs. */
function parseInput(input) {
    if (!object(input))
        invalid();
    const own = Reflect.ownKeys(input);
    if (own.some((key) => typeof key !== "string" || !["selections", "choices"].includes(key)
        || !Object.getOwnPropertyDescriptor(input, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), "value")))
        invalid();
    const selections = input.selections;
    if (!Array.isArray(selections) || selections.length < 1 || selections.length > 7
        || Reflect.ownKeys(selections).length !== selections.length + 1)
        invalid();
    const seen = new Set();
    const parsed = [];
    for (let index = 0; index < selections.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(selections, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value"))
            invalid();
        const entry = descriptor.value;
        if (!object(entry) || Reflect.ownKeys(entry).some((key) => typeof key !== "string"
            || !["preset", "settings", "templates", "seeds"].includes(key)
            || !Object.getOwnPropertyDescriptor(entry, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(entry, key), "value")))
            invalid();
        if (typeof entry.preset !== "string" || !PRESET_REGISTRY.some(({ id }) => id === entry.preset) || seen.has(entry.preset))
            invalid();
        for (const key of ["settings", "templates", "seeds"])
            if (Object.hasOwn(entry, key) && typeof entry[key] !== "boolean")
                invalid();
        const selection = { preset: entry.preset, settings: entry.settings !== false, templates: entry.templates !== false, seeds: entry.seeds === true };
        if (!selection.settings && !selection.templates && !selection.seeds)
            invalid();
        seen.add(selection.preset);
        parsed.push(selection);
    }
    const choices = input.choices === undefined ? {} : input.choices;
    if (!object(choices) || Reflect.ownKeys(choices).length > 128)
        invalid();
    for (const key of Reflect.ownKeys(choices)) {
        if (typeof key !== "string" || key.length > 512 || !/^\/(settings|templates|seeds)\/.+/.test(key))
            invalid();
        const descriptor = Object.getOwnPropertyDescriptor(choices, key);
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value") || !seen.has(descriptor.value))
            invalid();
    }
    return { selections: parsed.sort((a, b) => a.preset < b.preset ? -1 : 1), choices: { ...choices } };
}
/** Stable key-order comparison for bundled JSON values and host canonical snapshots. */
function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(",")}]`;
    if (object(value))
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return String(JSON.stringify(value));
}
/** Encode one JSON pointer segment without conflating slashes or tildes. */
function escape(value) { return value.replaceAll("~", "~0").replaceAll("/", "~1"); }
/** Flatten settings leaves only; arrays and empty objects remain atomic. */
function leaves(value, prefix = "") {
    if (object(value) && Object.keys(value).length > 0) {
        return new Map(Object.keys(value).sort().flatMap((key) => [...leaves(value[key], `${prefix}/${escape(key)}`)]));
    }
    return new Map([[prefix, value]]);
}
/** Install a trusted bundled setting leaf into a fresh patch. */
function put(patch, path, value) {
    const keys = path.slice("/settings/".length).split("/").map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
    let cursor = patch;
    for (const key of keys.slice(0, -1)) {
        cursor[key] ??= {};
        cursor = cursor[key];
    }
    cursor[keys[keys.length - 1]] = structuredClone(value);
}
/** Require the host's canonical preview; ordinary replay receipts cannot substitute for settings. */
export function stackSettingsPreview(result) {
    if (!result.preview)
        throw new StackRefusal("sdk_required", "Use a host that returns canonical inline previews.");
    return result.preview;
}
/** Adapt bundled contributions into a canonical host profile preview; never apply or persist a plan. */
export async function planPresetStack(pmRoot, sdk, input) {
    const request = parseInput(input);
    const candidates = new Map();
    /** Accumulate catalog ownership without assigning precedence to selection order. */
    function add(path, owner, value) {
        const entries = candidates.get(path) ?? [];
        entries.push({ owner, value });
        candidates.set(path, entries);
    }
    for (const selection of request.selections) {
        const id = selection.preset;
        if (selection.settings)
            for (const [path, value] of leaves(requirePresetDefinition(id).settings))
                add(`/settings${path}`, id, value);
        if (selection.templates)
            for (const template of presetTemplateEntries(id))
                add(`/templates/${escape(template.name)}`, id, template.options);
        if (selection.seeds)
            for (const seed of resolvedSeedsForPreset(id))
                add(`/seeds/${escape(`${seed.type}:${seed.title}`)}`, id, seed);
    }
    const ownership = [];
    const resolved = new Map();
    for (const [path, entries] of [...candidates].sort(([a], [b]) => a < b ? -1 : 1)) {
        const conflict = new Set(entries.map(({ value }) => canonical(value))).size > 1;
        const choice = request.choices[path];
        if (choice && (!conflict || !entries.some(({ owner }) => owner === choice)))
            invalid();
        const selected = choice ? entries.find(({ owner }) => owner === choice) : entries[0];
        ownership.push({ path, owners: entries.map(({ owner }) => owner), conflict, choice: choice ?? "" });
        if (!conflict || choice)
            resolved.set(path, selected);
    }
    if (Object.keys(request.choices).some((path) => !candidates.has(path)))
        invalid();
    const unresolved = ownership.filter((entry) => entry.conflict && !entry.choice).length;
    const base = { schema: 1, ready: unresolved === 0, selections: request.selections, ownership, unresolved };
    if (unresolved)
        return { ...base, profile: null, hostPlan: null, settingsPatch: {}, settingsChanges: [], seeds: [] };
    if (typeof sdk?.mutateWorkspaceSettings !== "function")
        throw new StackRefusal("sdk_required", "Use a pm host with canonical includePreview settings support (2026.10.17+).");
    const patch = {};
    const templates = [];
    const seeds = [];
    for (const [path, { owner, value }] of resolved) {
        if (path.startsWith("/settings/"))
            put(patch, path, value);
        else if (path.startsWith("/templates/"))
            templates.push({ name: path.slice(11).replaceAll("~1", "/").replaceAll("~0", "~"), options: structuredClone(value) });
        else
            seeds.push({ identity: path.slice(7).replaceAll("~1", "/").replaceAll("~0", "~"), owner, item: structuredClone(value) });
    }
    const profile = {
        name: "preset-stack", title: "Preset stack", summary: request.selections.map(({ preset }) => preset).join(" + "),
        types: [], statuses: [], fields: [], workflows: [], packages: [], templates,
        config: Object.hasOwn(patch, "id_prefix") ? [{ key: "id_prefix", value: String(patch.id_prefix), summary: "Selected preset ID prefix" }] : [],
    };
    try {
        const host = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url, join(process.cwd(), "package.json"), process.argv[1]]));
        const currentTemplates = new Map();
        const inventory = await host.runTemplatesList({ path: pmRoot, noExtensions: true });
        for (const name of inventory.user_templates)
            if (templates.some((template) => template.name === name))
                currentTemplates.set(name, await host.loadCreateTemplateOptions(pmRoot, name));
        const sourceSettings = await host.readFileIfExists(join(pmRoot, "settings.json"));
        // Host dry-runs acquire a workspace lock. Normalize an isolated settings copy
        // so a read-only source needs no lock directory, receipt or runtime writes.
        const scratch = await mkdtemp(join(tmpdir(), "preset-stack-normalize-"));
        let preview;
        let before;
        try {
            // An absent/invalid source remains invalid; permissive readSettings defaults
            // must not turn an uninitialized tracker into an apparently valid plan.
            await writeFile(join(scratch, "settings.json"), sourceSettings, { mode: 0o600 });
            const isolated = host.createExtensionCommandSdk(scratch, new host.PmClient({ pmRoot: scratch, noExtensions: true }), "preset-stack-preview");
            preview = await isolated.mutateWorkspaceSettings({
                operationId: `preset-stack-preview-${randomUUID()}`, dryRun: true, includePreview: true,
                mutate: (current) => { before = structuredClone(current); return mergePresetSettings(current, patch, false); },
            });
        }
        finally {
            await rm(scratch, { recursive: true, force: true });
        }
        const normalized = leaves(stackSettingsPreview(preview), "/settings");
        if ([...resolved].some(([path, { value }]) => path.startsWith("/settings/") && canonical(normalized.get(path)) !== canonical(value))) {
            throw new StackRefusal("normalization_conflict", "Host governance normalization changes a selected setting. Choose coherent owners for governance and mirrored validation leaves, or select settings from just one preset, then replan.");
        }
        const old = leaves(before, "/settings");
        const settingsChanges = [...new Set([...old.keys(), ...normalized.keys()])].sort().filter((path) => canonical(old.get(path)) !== canonical(normalized.get(path)));
        const hostPlan = host.planProfileApplication(profile, { typesRaw: null, statusesRaw: null, fieldsRaw: null, workflows: [], settings: before, templates: currentTemplates, installedPackages: new Set() });
        return { ...base, profile, hostPlan, settingsPatch: patch, settingsChanges, seeds };
    }
    catch (error) {
        if (error instanceof StackRefusal)
            throw error;
        throw new StackRefusal("target_unavailable", "Initialize a tracker, check pm health and template validity, and retry with a compatible host. Preview never applies a partial stack.");
    }
}
/** Compact agent output excludes all stored values and complete template/seed bodies. */
export function summarizePresetStack(plan) {
    const counts = { settings: plan.ownership.filter(({ path }) => path.startsWith("/settings/")).length,
        templates: plan.ownership.filter(({ path }) => path.startsWith("/templates/")).length,
        seeds: plan.ownership.filter(({ path }) => path.startsWith("/seeds/")).length, unresolved: plan.unresolved };
    if (Object.values(counts).some((count) => !Number.isSafeInteger(count) || count < 0 || count > 1024))
        throw new StackRefusal("invalid_input", "Regenerate a bounded stack plan before summarizing it.");
    return { schema: 1, ready: plan.ready, presets: plan.selections.map(({ preset }) => preset), counts, ownership: plan.ownership,
        settingsChanges: plan.settingsChanges, templates: plan.hostPlan?.templates.changes.map(({ name, status }) => ({ name, status })) ?? [],
        ...(plan.ready ? {} : { code: "conflicts", remedy: "Set choices for every unresolved conflict pointer to one listed owner, then replan.", exit_code: 2 }) };
}
//# sourceMappingURL=stack.js.map