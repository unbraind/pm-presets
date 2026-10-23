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
import { createRequire } from "node:module";
import { resolveSimulationSdk } from "../sdk-loader.js";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
// pm's extension command runtime only treats a thrown error as a cleanly
// handled non-zero exit when the error carries a numeric `exitCode` property
// (see @unbrained/pm-cli runCommandHandler). A plain `Error` makes the runtime
// fall through to its "unhandled" path, which RE-INVOKES the command handler a
// second time and exits with a generic code. We mirror the SDK's EXIT_CODE
// contract here rather than importing it: standalone-installed extensions load
// only their own `dist/`, so `@unbrained/pm-cli` is not resolvable at runtime.
/**
 * Numeric exit codes mirroring the pm-cli SDK contract.
 *
 * Duplicated here rather than imported: a standalone-installed extension loads
 * only its own `dist/`, so `@unbrained/pm-cli` is not resolvable at runtime.
 * pm's command runtime only honours a thrown error's numeric `exitCode` (a plain
 * `Error` falls through to the unhandled path, which re-invokes the handler and
 * exits with a generic code), so these values are what make a clean non-zero
 * exit possible.
 */
export const EXIT_CODE = {
    GENERIC_FAILURE: 1,
    USAGE: 2,
    NOT_FOUND: 3,
};
/**
 * Error whose `exitCode` pm's runtime treats as a handled non-zero exit.
 *
 * Extending `Error` with a numeric {@link exitCode} is the only shape the
 * runtime recognises as "cleanly handled"; throwing a plain `Error` instead
 * triggers the unhandled path that re-invokes the handler and exits with a
 * generic code. Defaults to {@link EXIT_CODE.GENERIC_FAILURE}.
 */
export class CommandError extends Error {
    /** Numeric exit code forwarded to `process.exitCode` by the pm runtime. */
    exitCode;
    constructor(message, exitCode = EXIT_CODE.GENERIC_FAILURE) {
        super(message);
        this.name = "CommandError";
        this.exitCode = exitCode;
    }
}
const TEMPLATE_FILE_EXTENSION = ".json";
const TEMPLATE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BUILTIN_TEMPLATE_TIMESTAMP = "1970-01-01T00:00:00.000Z";
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
/**
 * Trim a template name and reject anything outside the on-disk grammar.
 *
 * Names must match `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` because they become a file
 * name; a violation throws a `USAGE` {@link CommandError} quoting the bad input
 * rather than silently coercing it.
 *
 * @returns The trimmed name when it is valid.
 */
export function normalizeTemplateName(rawName) {
    const name = rawName.trim();
    if (!TEMPLATE_NAME_PATTERN.test(name)) {
        throw new CommandError(`Invalid template name "${rawName}". Expected 1-64 characters matching [A-Za-z0-9][A-Za-z0-9._-]*.`, EXIT_CODE.USAGE);
    }
    return name;
}
/**
 * Build a {@link StoredCreateTemplateDocument} for a builtin template.
 *
 * Stamps both timestamps with the epoch sentinel (so builtins sort below
 * user-created templates) and runs the options through
 * {@link sortTemplateOptions} for a stable, diff-friendly key order.
 *
 * @param rawName - Unvalidated name; normalized here.
 * @param options - The template's option map.
 * @returns A builtin document with sentinel timestamps and sorted options.
 */
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
/**
 * Apply one preset's settings and templates to the workspace on disk.
 *
 * Merges (or, under `--replace`, swaps owned trees) against the settings read
 * under the host's audit lock, then writes the templates the preset ships
 * — unless `--dry-run`, which prints the planned result instead. Honours
 * `--force` to overwrite an existing user template, and `--prefix` to override
 * the preset's `id_prefix`. Throws `NOT_FOUND` when no initialized pm workspace
 * is present, with the expected settings path in the message.
 */
export async function applyPreset(context, input) {
    const { options } = context;
    const pmDir = resolvePmDir(context);
    const settingsPath = path.join(pmDir, "settings.json");
    const templatesDir = path.join(pmDir, "templates");
    const dryRun = readBooleanOption(options, "dryRun", "dry-run");
    const force = readBooleanOption(options, "force");
    const replace = readBooleanOption(options, "replace");
    const prefixOverride = readStringOption(options, "prefix");
    if (!fs.existsSync(pmDir) || !fs.existsSync(settingsPath)) {
        throw new CommandError(`pm workspace not found. Expected settings file: ${settingsPath}\n` +
            `Run "pm init" first to initialize a pm workspace in this project.`, EXIT_CODE.NOT_FOUND);
    }
    readJsonObject(settingsPath, "settings.json");
    const effectivePatch = {
        ...input.settings,
        id_prefix: prefixOverride ?? input.settings.id_prefix,
    };
    const templates = Object.entries(input.templates).map(([filename, template]) => {
        const normalizedName = normalizeTemplateName(template.name);
        if (filename !== `${normalizedName}${TEMPLATE_FILE_EXTENSION}`) {
            throw new CommandError(`Template map key "${filename}" must match document name "${normalizedName}".`);
        }
        return { template, templatePath: path.join(templatesDir, filename) };
    });
    if (typeof context.sdk?.mutateWorkspaceSettings !== "function") {
        throw new CommandError("Upgrade the host pm CLI to 2026.9.30 or newer: preset application requires its audited settings capability.");
    }
    const replacementResets = [];
    try {
        await context.sdk.mutateWorkspaceSettings({
            operationId: `pm-presets-${randomUUID()}`,
            dryRun,
            mutate: (current) => {
                const mergedSettings = mergePresetSettings(current, effectivePatch, replace);
                if (dryRun && replace) {
                    for (const tree of REPLACE_SETTINGS_TREES) {
                        const patch = effectivePatch[tree];
                        if (patch === undefined) {
                            replacementResets.push(tree);
                            continue;
                        }
                        for (const key of Object.keys(current[tree])) {
                            if (!Object.prototype.hasOwnProperty.call(patch, key)) {
                                replacementResets.push(`${tree}.${key}`);
                            }
                        }
                    }
                }
                return mergedSettings;
            },
        });
    }
    catch (error) {
        throw new CommandError(`Audited preset settings failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const verb = replace ? "replace" : "merge";
    if (dryRun) {
        console.log(`[dry-run] Would ${verb} ${input.label} settings into ${settingsPath}:`);
        console.log("Preset patch (the host derives governance policies and canonical storage):");
        console.log(JSON.stringify(effectivePatch, null, 2));
        if (replace) {
            console.log(`Replacement resets existing paths to host defaults/preset policy: ${JSON.stringify(replacementResets.sort())}`);
        }
    }
    else {
        console.log(`Updated settings.json at ${settingsPath} (${verb} mode)`);
    }
    if (dryRun) {
        console.log(`[dry-run] Would create directory: ${templatesDir}`);
    }
    else {
        fs.mkdirSync(templatesDir, { recursive: true });
    }
    for (const { template, templatePath } of templates) {
        if (fs.existsSync(templatePath) && !force) {
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
/** Resolve template reads through the existing package-or-host SDK loader. */
export function loadTemplateSdk() {
    const sdkPath = resolveSimulationSdk([import.meta.url, path.join(process.cwd(), "package.json"), process.argv[1]]);
    return createRequire(import.meta.url)(sdkPath);
}
/** List SDK templates with invocation globals and the active tracker taking precedence. */
export function runTemplatesList(context) {
    return loadTemplateSdk().runTemplatesList({ ...context.global, path: resolvePmDir(context) });
}
/** Show an SDK template without wrapping its expected-error refusal. */
export function runTemplatesShow(context) {
    return loadTemplateSdk().runTemplatesShow(context.args[0] ?? "", { ...context.global, path: resolvePmDir(context) });
}
/**
 * Read and parse a JSON file that must be a JSON object.
 *
 * Wraps both the read/parse step (reporting the underlying message) and the
 * shape check, so callers get a single thrown {@link CommandError} tagged with
 * a human `label` (e.g. "settings.json") instead of a raw `SyntaxError`.
 */
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
/**
 * Recursively merge two JSON objects, patch winning on conflict.
 *
 * Only plain objects recurse; arrays and scalars from `patch` replace the
 * `base` value wholesale (an array is treated as a value, not concatenated).
 * `base` is copied first so the input is never mutated.
 */
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