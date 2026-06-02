/**
 * diff.ts — compare a pm workspace against a bundled preset definition.
 *
 * The comparison is split in two so the interesting logic stays pure and
 * unit-testable:
 *
 *   - `computePresetDiff(definition, snapshot)` is pure: it takes an already-read
 *     workspace snapshot and the preset definition and returns a structured diff.
 *   - `readWorkspaceSnapshot(pmDir)` is the only filesystem-touching part.
 *
 * What we compare:
 *   - settings.json: every leaf in the preset's settings patch (added vs changed
 *     vs already-matching),
 *   - templates: which of the preset's templates are missing / present in the
 *     workspace `templates/` directory,
 *   - item types: the custom item types the preset registers (informational —
 *     they are registered in-memory at activation, not written to disk).
 */
import * as fs from "node:fs";
import * as path from "node:path";
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Flatten a settings patch into dotted-path leaves, recursing into objects. */
function flattenLeaves(value, prefix = "") {
    const leaves = [];
    for (const [key, child] of Object.entries(value)) {
        const dotted = prefix ? `${prefix}.${key}` : key;
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
    return JSON.stringify(left) === JSON.stringify(right);
}
/** Pure diff: preset definition vs an already-read workspace snapshot. */
export function computePresetDiff(definition, snapshot) {
    const presetSettings = definition.settings;
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
    for (const template of definition.templates) {
        if (workspaceTemplates.has(template.name)) {
            present.push(template.name);
        }
        else {
            missing.push(template.name);
        }
    }
    const settingsToAdd = settings.filter((entry) => entry.status === "add").length;
    const settingsToChange = settings.filter((entry) => entry.status === "change").length;
    return {
        presetId: definition.id,
        inSync: settingsToAdd === 0 && settingsToChange === 0 && missing.length === 0,
        settings,
        templates: { missing, present },
        itemTypes: definition.itemTypes.map((type) => type.name),
        summary: {
            settingsToAdd,
            settingsToChange,
            templatesMissing: missing.length,
        },
    };
}
/** Read the workspace snapshot from disk (the only impure part). */
export function readWorkspaceSnapshot(pmDir) {
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
        templateNames = fs
            .readdirSync(templatesDir)
            .filter((entry) => entry.toLowerCase().endsWith(".json"))
            .map((entry) => entry.slice(0, -".json".length));
    }
    return { settings, templateNames };
}
//# sourceMappingURL=diff.js.map