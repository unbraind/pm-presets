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
import * as fs from "node:fs";
import * as path from "node:path";
// pm's extension command runtime only treats a thrown error as a cleanly
// handled non-zero exit when the error carries a numeric `exitCode` property
// (see @unbrained/pm-cli runCommandHandler). A plain `Error` makes the runtime
// fall through to its "unhandled" path, which RE-INVOKES the command handler a
// second time and exits with a generic code. We mirror the SDK's EXIT_CODE
// contract here rather than importing it: standalone-installed extensions load
// only their own `dist/`, so `@unbrained/pm-cli` is not resolvable at runtime.
export const EXIT_CODE = {
    GENERIC_FAILURE: 1,
    USAGE: 2,
    NOT_FOUND: 3,
};
export class CommandError extends Error {
    exitCode;
    constructor(message, exitCode = EXIT_CODE.GENERIC_FAILURE) {
        super(message);
        this.name = "CommandError";
        this.exitCode = exitCode;
    }
}
const TEMPLATE_DIRECTORY_NAME = "templates";
const TEMPLATE_FILE_EXTENSION = ".json";
const TEMPLATE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BUILTIN_TEMPLATE_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const BUILTIN_TEMPLATES = {
    bug: {
        type: "Issue",
        priority: "1",
        tags: "bug",
        acceptanceCriteria: "Bug no longer reproduces with the steps below and a regression test guards it.",
        expectedResult: "Describe the correct behavior.",
        actualResult: "Describe the observed behavior.",
        body: "## Repro steps\n1. \n2. \n3. \n\n## Expected\n\n## Actual\n",
    },
    feature: {
        type: "Feature",
        priority: "2",
        tags: "feature",
        acceptanceCriteria: "Feature is shipped behind agreed scope with tests and docs updated.",
        whyNow: "Explain impact, urgency, and why this is worth doing now.",
        body: "## Goal\n\n## Why now\n\n## Out of scope\n",
    },
    spike: {
        type: "Task",
        priority: "2",
        tags: "spike",
        estimatedMinutes: "120",
        acceptanceCriteria: "Timeboxed investigation complete; findings and a recommendation are recorded.",
        body: "## Question to answer\n\n## Timebox\n2h\n\n## Findings\n\n## Recommendation\n",
    },
    chore: {
        type: "Chore",
        priority: "3",
        tags: "chore",
        acceptanceCriteria: "Maintenance task done with no behavior change and green checks.",
        body: "## What\n\n## Why\n",
    },
};
/** Resolve the `.agents/pm` storage directory for the active workspace. */
export function resolvePmDir(context) {
    const pmRoot = context.pm_root?.trim();
    if (pmRoot && pmRoot.length > 0) {
        return path.resolve(pmRoot);
    }
    // Fallback when pm_root is somehow absent: assume the conventional layout.
    return path.resolve(process.cwd(), ".agents", "pm");
}
/** Read a boolean flag, tolerating both camelCase and kebab-case keys. */
export function readBooleanOption(options, ...keys) {
    for (const key of keys) {
        const value = options[key];
        if (value !== undefined && value !== null) {
            return value === true || value === "true" || value === "1";
        }
    }
    return false;
}
/** Read a string flag, tolerating both camelCase and kebab-case keys. */
export function readStringOption(options, ...keys) {
    for (const key of keys) {
        const value = options[key];
        if (typeof value === "string" && value.trim().length > 0) {
            return value.trim();
        }
    }
    return undefined;
}
export function normalizeTemplateName(rawName) {
    const name = rawName.trim();
    if (!TEMPLATE_NAME_PATTERN.test(name)) {
        throw new CommandError(`Invalid template name "${rawName}". Expected 1-64 characters matching [A-Za-z0-9][A-Za-z0-9._-]*.`, EXIT_CODE.USAGE);
    }
    return name;
}
export function storedTemplate(rawName, options) {
    const name = normalizeTemplateName(rawName);
    return {
        name,
        created_at: BUILTIN_TEMPLATE_TIMESTAMP,
        updated_at: BUILTIN_TEMPLATE_TIMESTAMP,
        options: sortTemplateOptions(options),
    };
}
/**
 * The settings-patch trees that `--replace` swaps out wholesale instead of
 * deep-merging. These are the governance / validation / testing config trees a
 * preset owns; replacing them gives a clean reset (drops keys the preset no
 * longer sets) while merge layers the preset over whatever is already there.
 * `id_prefix` and any unrelated top-level keys are always merge-preserved.
 */
const REPLACE_SETTINGS_TREES = ["governance", "validation", "testing"];
/**
 * Merge a preset settings patch, optionally full-replacing the governance /
 * validation / testing trees rather than deep-merging them.
 *
 * Pure and unit-tested. Other top-level keys (e.g. `id_prefix`, unrelated user
 * config) are always deep-merged so unrelated settings are never dropped.
 */
export function mergePresetSettings(existing, patch, replace) {
    if (!replace) {
        return deepMergeJson(existing, patch);
    }
    // Deep-merge everything first, then overwrite the owned trees with the
    // preset's exact tree (or remove them if the preset doesn't set them).
    const merged = deepMergeJson(existing, patch);
    for (const tree of REPLACE_SETTINGS_TREES) {
        if (Object.prototype.hasOwnProperty.call(patch, tree)) {
            merged[tree] = patch[tree];
        }
        else {
            delete merged[tree];
        }
    }
    return merged;
}
export function applyPreset(context, input) {
    const { options } = context;
    const pmDir = resolvePmDir(context);
    const settingsPath = path.join(pmDir, "settings.json");
    const templatesDir = templatesDirectory(pmDir);
    const dryRun = readBooleanOption(options, "dryRun", "dry-run");
    const force = readBooleanOption(options, "force");
    const replace = readBooleanOption(options, "replace");
    const prefixOverride = readStringOption(options, "prefix");
    if (!fs.existsSync(pmDir) || !fs.existsSync(settingsPath)) {
        throw new CommandError(`pm workspace not found. Expected settings file: ${settingsPath}\n` +
            `Run "pm init" first to initialize a pm workspace in this project.`, EXIT_CODE.NOT_FOUND);
    }
    const existingSettings = readJsonObject(settingsPath, "settings.json");
    const effectivePatch = {
        ...input.settings,
        id_prefix: prefixOverride ?? input.settings.id_prefix,
    };
    const mergedSettings = mergePresetSettings(existingSettings, effectivePatch, replace);
    const verb = replace ? "replace" : "merge";
    if (dryRun) {
        console.log(`[dry-run] Would ${verb} ${input.label} settings into ${settingsPath}:`);
        console.log(JSON.stringify(mergedSettings, null, 2));
    }
    else {
        fs.writeFileSync(settingsPath, `${JSON.stringify(mergedSettings, null, 2)}\n`, "utf8");
        console.log(`Updated settings.json at ${settingsPath} (${verb} mode)`);
    }
    if (dryRun) {
        console.log(`[dry-run] Would create directory: ${templatesDir}`);
    }
    else {
        fs.mkdirSync(templatesDir, { recursive: true });
    }
    for (const [filename, template] of Object.entries(input.templates)) {
        const normalizedName = normalizeTemplateName(template.name);
        const templatePath = path.join(templatesDir, `${normalizedName}${TEMPLATE_FILE_EXTENSION}`);
        if (filename !== `${normalizedName}${TEMPLATE_FILE_EXTENSION}`) {
            throw new CommandError(`Template map key "${filename}" must match document name "${normalizedName}".`);
        }
        if (!dryRun && fs.existsSync(templatePath) && !force) {
            console.warn(`Skipped existing template ${templatePath}. Use --force to overwrite.`);
            continue;
        }
        if (dryRun) {
            console.log(`[dry-run] Would write template: ${templatePath}`);
            console.log(JSON.stringify(template, null, 2));
            continue;
        }
        fs.writeFileSync(templatePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
        console.log(`Wrote template ${templatePath}`);
    }
    console.log("");
    console.log(`${input.label} preset applied. Next steps:`);
    for (const step of input.nextSteps) {
        console.log(`  ${step}`);
    }
    if (input.warning) {
        console.warn(input.warning);
    }
}
export function runTemplatesList(context) {
    const pmDir = resolvePmDir(context);
    ensureTrackerInitialized(pmDir);
    const userTemplates = readUserTemplateNames(pmDir);
    const userTemplateSet = new Set(userTemplates);
    const builtinTemplates = Object.keys(BUILTIN_TEMPLATES).filter((name) => !userTemplateSet.has(name));
    const sortedUser = [...userTemplates].sort((left, right) => left.localeCompare(right));
    const sortedBuiltin = [...builtinTemplates].sort((left, right) => left.localeCompare(right));
    const templates = [...new Set([...sortedUser, ...sortedBuiltin])].sort((left, right) => left.localeCompare(right));
    return {
        templates,
        count: templates.length,
        builtin_templates: sortedBuiltin,
        user_templates: sortedUser,
    };
}
export function runTemplatesShow(context) {
    const pmDir = resolvePmDir(context);
    ensureTrackerInitialized(pmDir);
    const rawTemplateName = context.args[0];
    if (typeof rawTemplateName !== "string" || rawTemplateName.trim().length === 0) {
        throw new CommandError("templates show requires a template name argument.", EXIT_CODE.USAGE);
    }
    const name = normalizeTemplateName(rawTemplateName);
    const templatePath = path.join(templatesDirectory(pmDir), `${name}${TEMPLATE_FILE_EXTENSION}`);
    if (fs.existsSync(templatePath)) {
        const document = parseStoredTemplateDocument(fs.readFileSync(templatePath, "utf8"), name);
        return {
            name: document.name,
            source: "user",
            created_at: document.created_at,
            updated_at: document.updated_at,
            path: templatePath,
            options: document.options,
        };
    }
    const builtinOptions = BUILTIN_TEMPLATES[name];
    if (builtinOptions) {
        const document = storedTemplate(name, builtinOptions);
        return {
            name: document.name,
            source: "builtin",
            created_at: document.created_at,
            updated_at: document.updated_at,
            path: `builtin:${name}`,
            options: document.options,
        };
    }
    throw new CommandError(`Template "${name}" not found.`, EXIT_CODE.NOT_FOUND);
}
function templatesDirectory(pmRoot) {
    return path.join(pmRoot, TEMPLATE_DIRECTORY_NAME);
}
function ensureTrackerInitialized(pmRoot) {
    const settingsPath = path.join(pmRoot, "settings.json");
    if (!fs.existsSync(settingsPath)) {
        throw new CommandError(`Tracker is not initialized at ${pmRoot}. Run pm init first.`, EXIT_CODE.NOT_FOUND);
    }
}
function readUserTemplateNames(pmRoot) {
    const dirPath = templatesDirectory(pmRoot);
    if (!fs.existsSync(dirPath)) {
        return [];
    }
    return fs
        .readdirSync(dirPath)
        .filter((entry) => entry.toLowerCase().endsWith(TEMPLATE_FILE_EXTENSION))
        .map((entry) => entry.slice(0, -TEMPLATE_FILE_EXTENSION.length))
        .filter((entry) => TEMPLATE_NAME_PATTERN.test(entry));
}
function parseStoredTemplateDocument(raw, normalizedName) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new CommandError(`Template "${normalizedName}" contains invalid JSON.`);
    }
    if (!isJsonObject(parsed)) {
        throw new CommandError(`Template "${normalizedName}" has invalid document shape.`);
    }
    const options = parseStoredTemplateOptions(parsed.options, normalizedName);
    return {
        name: typeof parsed.name === "string" && parsed.name.trim().length > 0
            ? normalizeTemplateName(parsed.name)
            : normalizedName,
        created_at: typeof parsed.created_at === "string"
            ? parsed.created_at
            : BUILTIN_TEMPLATE_TIMESTAMP,
        updated_at: typeof parsed.updated_at === "string"
            ? parsed.updated_at
            : BUILTIN_TEMPLATE_TIMESTAMP,
        options,
    };
}
function parseStoredTemplateOptions(rawOptions, templateName) {
    if (!isJsonObject(rawOptions)) {
        throw new CommandError(`Template "${templateName}" has invalid options payload.`);
    }
    const normalized = {};
    for (const [key, value] of Object.entries(rawOptions)) {
        const normalizedKey = key.trim();
        if (normalizedKey.length === 0) {
            throw new CommandError(`Template "${templateName}" contains an empty option key.`);
        }
        if (typeof value === "string") {
            normalized[normalizedKey] = value;
            continue;
        }
        if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
            normalized[normalizedKey] = [...value];
            continue;
        }
        throw new CommandError(`Template "${templateName}" contains invalid value for option "${normalizedKey}".`);
    }
    return sortTemplateOptions(normalized);
}
function readJsonObject(filePath, label) {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    catch (error) {
        throw new CommandError(`Failed to read ${label}: ${error.message}`);
    }
    if (!isJsonObject(parsed)) {
        throw new CommandError(`${label} must contain a JSON object.`);
    }
    return parsed;
}
function deepMergeJson(base, patch) {
    const result = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (isJsonObject(value) && isJsonObject(result[key])) {
            result[key] = deepMergeJson(result[key], value);
            continue;
        }
        result[key] = value;
    }
    return result;
}
function sortTemplateOptions(options) {
    return Object.fromEntries(Object.entries(options).sort(([left], [right]) => left.localeCompare(right)));
}
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=shared.js.map