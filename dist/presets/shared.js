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
import { acquireApplyAdmission } from "../apply-admission.js";
import { createRequire } from "node:module";
import { resolveSimulationSdk } from "../sdk-loader.js";
import { computeDesiredPresetState, compareDesiredPresetState, ownArtifact, presetArtifactRecord, artifactValuesEqual, seedArtifactMatches } from "../desired-state.js";
import { readPresetApplicationHistory } from "../application-history.js";
import { readSeedArtifacts, readSeedTypes } from "../artifact-reader.js";
import { setJsonProperty } from "../json-object.js";
import { randomUUID } from "node:crypto";
import { ParameterRefusal, assertResolvedParameterValues, buildParameterViews, readSuppliedParameterValues, resolveParameterValues, resolveParameterizedPreset, resolveSettingsWithParameters, } from "../params.js";
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
const APPLY_LOCK_FILE = "pm-presets-apply.lock";
const APPLY_LOCK_POLL_MS = 50;
const APPLY_LOCK_TIMEOUT_MS = 15_000;
const APPLY_LOCK_STALE_MS = 120_000;
/** Promise-based sleep so the lock polls without blocking the runtime. */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Serialize parameterized applies on one workspace.
 *
 * A real apply mutates two things (audited settings and template files) that
 * must describe the SAME parameter values; without serialization two
 * concurrent applies could leave `id_prefix` from one invocation next to
 * template prose from another. The lock is a `locks/` file with a unique
 * owner token, created atomically (O_EXCL), polled briefly, stolen when stale
 * (crashed owner) and released only by its owner — cross-process, not just
 * in-process. Dry-runs skip it: they write nothing of ours.
 */
async function withPresetApplyLock(pmDir, run) {
    const releaseAdmission = await acquireApplyAdmission(pmDir);
    try {
        return await withObservedApplyLock(pmDir, run);
    }
    finally {
        releaseAdmission();
    }
}
/** Keep the existing token-file protocol inside the admission claim for compatibility. */
async function withObservedApplyLock(pmDir, run) {
    const locksDir = path.join(pmDir, "locks");
    const lockPath = path.join(locksDir, APPLY_LOCK_FILE);
    const token = `${process.pid}-${randomUUID()}`;
    fs.mkdirSync(locksDir, { recursive: true });
    const deadline = Date.now() + APPLY_LOCK_TIMEOUT_MS;
    for (;;) {
        try {
            const handle = fs.openSync(lockPath, "wx");
            try {
                fs.writeFileSync(handle, token, "utf8");
            }
            finally {
                fs.closeSync(handle);
            }
            break;
        }
        catch (error) {
            if (error.code !== "EEXIST") {
                throw error;
            }
            try {
                const stats = fs.statSync(lockPath);
                if (Date.now() - stats.mtimeMs > APPLY_LOCK_STALE_MS) {
                    // Publication, recovery and release all hold the admission claim:
                    // another contender cannot publish a replacement between observation
                    // and removal. A token comparison alone would not provide that fence.
                    fs.rmSync(lockPath, { force: true });
                    continue;
                }
            }
            catch {
                // The lock vanished between the failed create and the stat; retry.
            }
            if (Date.now() > deadline) {
                throw new CommandError("Another pm-presets apply is running in this workspace and did not finish in time; retry once it completes.");
            }
            await delay(APPLY_LOCK_POLL_MS);
        }
    }
    try {
        return await run();
    }
    finally {
        // Best-effort release: only a lock file that still carries OUR token is
        // ours to delete. A vanished file means someone reaped it; a different
        // token means a stale steal already handed ownership elsewhere — in both
        // cases this owner must not delete another owner's lock.
        if (fs.existsSync(lockPath) && fs.readFileSync(lockPath, "utf8") === token) {
            fs.rmSync(lockPath, { force: true });
        }
    }
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
    const dryRun = readBooleanOption(options, "dryRun", "dry-run");
    const force = readBooleanOption(options, "force");
    const replace = readBooleanOption(options, "replace");
    const prefixOverride = readStringOption(options, "prefix");
    // Typed parameter binding manifest: validate every supplied value, answer
    // each declared parameter, and substitute every occurrence BEFORE reading or
    // writing any tracker state (unknown/missing/invalid input refuses first).
    // When the unified apply command already resolved the values at its own
    // boundary, they arrive injected here and are re-validated (never re-read
    // from a params file), so settings, templates and the later seed step all
    // use ONE resolution of the caller's input.
    const manifest = input.parameters ?? [];
    let effectiveSettings = input.settings;
    let effectiveTemplates = input.templates;
    let occurrenceCount = 0;
    let parameterValues = {};
    try {
        const injected = options.resolvedParameterValues;
        const resolved = injected === undefined
            ? resolveParameterValues(manifest, readSuppliedParameterValues(options))
            : (assertResolvedParameterValues(manifest, injected), injected);
        parameterValues = resolved.values;
        const substitution = resolveParameterizedPreset(manifest, resolved.values, {
            settings: input.settings,
            templates: input.templates,
        });
        effectiveSettings = substitution.settings;
        effectiveTemplates = substitution.templates;
        occurrenceCount = substitution.occurrences;
        const views = buildParameterViews(manifest, resolved.values).filter((view) => Object.hasOwn(resolved.values, view.name));
        const summary = views
            .map((view) => `${view.name}=${resolved.values[view.name]} (${resolved.sources[view.name]})`)
            .join(", ");
        if (views.length > 0)
            console.log(`Resolved ${views.length} parameter(s), ${occurrenceCount} binding occurrence(s): ${summary}`);
    }
    catch (error) {
        if (error instanceof ParameterRefusal)
            throw error;
        throw new CommandError(`Audited preset settings failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const pmDir = resolvePmDir(context);
    const settingsPath = path.join(pmDir, "settings.json");
    const templatesDir = path.join(pmDir, "templates");
    if (!fs.existsSync(pmDir) || !fs.existsSync(settingsPath)) {
        throw new CommandError(`pm workspace not found. Expected settings file: ${settingsPath}\n` +
            `Run "pm init" first to initialize a pm workspace in this project.`, EXIT_CODE.NOT_FOUND);
    }
    const storedSettings = readJsonObject(settingsPath, "settings.json");
    resolveSettingsWithParameters([], {}, storedSettings);
    const settingsPatch = {
        ...effectiveSettings,
        id_prefix: prefixOverride ?? effectiveSettings.id_prefix,
    };
    const record = input.presetId ? presetArtifactRecord(storedSettings, input.presetId) : undefined;
    if (input.presetId) {
        const history = await readPresetApplicationHistory(pmDir);
        if (history.errors.length)
            throw new ParameterRefusal("artifact_unreadable", "Audited preset settings failed: cannot verify history/_workspace.jsonl; inspect the host history verification before applying.");
        const historical = ownArtifact(history.records, input.presetId);
        if (record && historical === undefined)
            throw new ParameterRefusal("artifact_unreadable", "Managed seed ownership has no verified history/_workspace.jsonl application. Restore the host audit before applying.");
        if (historical !== undefined && !artifactValuesEqual(record, historical ?? undefined))
            throw new ParameterRefusal("invalid_artifact_record", `Ownership differs from the last applied history: settings.json#preset_artifacts.${input.presetId}. Restore that record through the host SDK before reconciling items.`);
    }
    let admittedRecord = record;
    const seeds = input.presetId && (readBooleanOption(options, "withSeeds", "with-seeds") || record)
        ? (await import("../seeds.js")).resolvedSeedsForPreset(input.presetId, parameterValues) : undefined;
    const client = context.sdk?.client;
    requireSeedCapabilities(seeds?.length ?? 0, client);
    const seedTypes = seeds?.length ? await readSeedTypes(pmDir, client) : undefined;
    let desired = await computeDesiredPresetState({ settings: settingsPatch, templates: effectiveTemplates, presetId: input.presetId, seeds, record, replace, seedTypes });
    let effectivePatch = desired.settings;
    // Overrides are final settings input too: they must not reintroduce bindings.
    resolveSettingsWithParameters([], {}, effectivePatch);
    assertWritableReferenceKeys(storedSettings, mergePresetSettings(storedSettings, effectivePatch, replace));
    const templates = desired.templates.map(({ filename, document: template }) => {
        const normalizedName = normalizeTemplateName(template.name);
        if (filename !== `${normalizedName}${TEMPLATE_FILE_EXTENSION}`) {
            throw new CommandError(`Template map key "${filename}" must match document name "${normalizedName}".`);
        }
        return { template, templatePath: path.join(templatesDir, filename) };
    });
    const sdkMutation = context.sdk?.mutateWorkspaceSettings;
    if (typeof sdkMutation !== "function") {
        throw new CommandError("Upgrade the host pm CLI to 2026.10.25 or newer: preset application requires its audited settings capability.");
    }
    const replacementResets = [];
    /** Everything a real apply mutates, so the lock covers all of it at once. */
    const applyWrites = async () => {
        // Enrollment/ids are workspace state, so refresh them after admission. Two
        // first-time contenders must converge on the first owner's stable ids.
        if (input.presetId) {
            const currentRecord = presetArtifactRecord(readJsonObject(settingsPath, "settings.json"), input.presetId);
            const history = await readPresetApplicationHistory(pmDir);
            if (history.errors.length)
                throw new ParameterRefusal("artifact_unreadable", "Cannot verify history/_workspace.jsonl before writing managed artifacts.");
            const historical = ownArtifact(history.records, input.presetId);
            if (currentRecord && historical === undefined)
                throw new ParameterRefusal("artifact_unreadable", "Managed seed ownership has no verified history/_workspace.jsonl application. Restore the host audit before writing.");
            if (historical !== undefined && !artifactValuesEqual(currentRecord, historical ?? undefined))
                throw new ParameterRefusal("invalid_artifact_record", `Ownership differs from the last applied history: settings.json#preset_artifacts.${input.presetId}. Restore ownership before retrying.`);
            admittedRecord = currentRecord;
            if (!artifactValuesEqual(record, currentRecord)) {
                if (record)
                    throw new ParameterRefusal("invalid_artifact_record", `Ownership changed while waiting: settings.json#preset_artifacts.${input.presetId}. Re-diff before retrying.`);
                const currentSeeds = (await import("../seeds.js")).resolvedSeedsForPreset(input.presetId, parameterValues);
                desired = await computeDesiredPresetState({ settings: settingsPatch, templates: effectiveTemplates, presetId: input.presetId, seeds: currentSeeds, record: currentRecord, replace, seedTypes: await readSeedTypes(pmDir, client) });
                effectivePatch = desired.settings;
                requireSeedCapabilities(desired.seeds.length, client);
            }
        }
        // Inspect every overwrite conflict while the apply admission is held, before
        // settings/history can change. Matching existing artifacts need no force.
        const currentSeeds = await readSeedArtifacts(pmDir, desired.seeds.map(({ id }) => id), context.sdk?.client);
        const stale = templates.filter(({ template, templatePath }) => {
            if (!fs.existsSync(templatePath))
                return false;
            try {
                return !artifactValuesEqual(JSON.parse(fs.readFileSync(templatePath, "utf8")), template);
            }
            catch {
                return true;
            }
        }).map(({ template }) => `templates/${template.name}.json`);
        for (const seed of desired.seeds)
            if (ownArtifact(currentSeeds, seed.id) && !seedArtifactMatches(seed.item, ownArtifact(currentSeeds, seed.id)))
                stale.push(`items/${seed.id}`);
        if (stale.length > 0 && !force)
            throw new ParameterRefusal("stale_artifacts", `Application would leave stale artifacts: ${stale.join(", ")}. Inspect them and retry with --force to reconcile the complete desired state.`);
        try {
            await sdkMutation({
                operationId: `pm-presets-${input.presetId ?? "custom"}-${randomUUID()}`,
                dryRun,
                ...(replace ? { replaceSubtrees: REPLACE_SETTINGS_TREES } : {}),
                mutate: (current) => {
                    // The host owns this settings audit lock. Inspect its same raw file:
                    // the typed host projection omits extension reference fields. Never
                    // rotate a pre-existing literal into append-only before/after history.
                    const stored = readJsonObject(settingsPath, "settings.json");
                    resolveSettingsWithParameters([], {}, stored);
                    if (input.presetId && !artifactValuesEqual(admittedRecord, presetArtifactRecord(stored, input.presetId)))
                        throw new ParameterRefusal("invalid_artifact_record", `Ownership changed before the audited write: settings.json#preset_artifacts.${input.presetId}. Re-diff before retrying.`);
                    const mergedSettings = mergePresetSettings({ ...stored, ...current }, effectivePatch, replace);
                    assertWritableReferenceKeys(stored, mergedSettings);
                    if (dryRun && replace) {
                        for (const tree of REPLACE_SETTINGS_TREES) {
                            const patch = settingsPatch[tree];
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
            if (error instanceof ParameterRefusal)
                throw error;
            throw new CommandError(`Audited preset settings failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const verb = replace ? "replace" : "merge";
        if (dryRun) {
            console.log(`[dry-run] Would ${verb} ${input.label} settings into ${settingsPath}:`);
            console.log("Preset patch (the host derives governance policies and canonical storage):");
            // Resolution stores external references only. Never dereference a
            // credential for previews or audited tracker mutation.
            console.log(JSON.stringify(effectivePatch, null, 2));
            if (replace) {
                console.log(`Replacement resets existing paths to host defaults/preset policy: ${JSON.stringify(replacementResets.sort())}`);
            }
        }
        else {
            console.log(`Updated settings.json at ${settingsPath} (${verb} mode)`);
        }
        writePresetTemplates(templatesDir, templates, { dryRun, force });
        if (desired.seeds.length > 0) {
            if (dryRun)
                console.log(`[dry-run] Would seed ${desired.seeds.length} starter item(s):`);
            for (const seed of desired.seeds) {
                if (seedArtifactMatches(seed.item, ownArtifact(currentSeeds, seed.id)))
                    continue;
                if (dryRun) {
                    console.log(`[dry-run] Would reconcile seed: ${seed.id}: ${seed.item.type}: ${seed.item.title}`);
                    continue;
                }
                try {
                    if (ownArtifact(currentSeeds, seed.id))
                        await client.update(seed.id, { ...seed.item, unset: ["parent"] });
                    else
                        await client.create({ ...seed.item, id: seed.id, unset: ["parent"] });
                }
                catch {
                    throw new ParameterRefusal("artifact_write_failed", `Could not reconcile items/${seed.id}. Check registered type '${seed.item.type}', governance and write access. Earlier audited writes may have completed; inspect the tracker and retry with --force.`);
                }
            }
            if (!dryRun) {
                const written = await readSeedArtifacts(pmDir, desired.seeds.map(({ id }) => id), client);
                const staleSeeds = desired.seeds.filter((seed) => !seedArtifactMatches(seed.item, ownArtifact(written, seed.id)));
                if (staleSeeds.length)
                    throw new ParameterRefusal("stale_artifacts", `Managed seeds did not reach the desired state: ${staleSeeds.map(({ id }) => `items/${id}`).join(", ")}. Inspect native validation results and retry.`);
            }
        }
        if (!dryRun) {
            const documents = Object.fromEntries(templates.map(({ templatePath }) => {
                try {
                    return [path.basename(templatePath), JSON.parse(fs.readFileSync(templatePath, "utf8"))];
                }
                catch {
                    return [path.basename(templatePath), undefined];
                }
            }));
            const writtenHistory = input.presetId ? await readPresetApplicationHistory(pmDir) : { records: {}, errors: [] };
            const remaining = compareDesiredPresetState(desired, {
                settings: readJsonObject(settingsPath, "settings.json"), templates: documents,
                seeds: await readSeedArtifacts(pmDir, desired.seeds.map(({ id }) => id), client),
                applicationRecords: writtenHistory.records, artifactErrors: writtenHistory.errors,
            });
            if (remaining.length)
                throw new ParameterRefusal("stale_artifacts", `Application did not reach the complete desired state: ${remaining.join(", ")}. Inspect concurrent edits or host normalization before retrying.`);
        }
    };
    if (dryRun) {
        // A dry-run writes nothing of ours, so it never creates lock files —
        // inspection of read-only trackers keeps failing only on host locks.
        await applyWrites();
    }
    else {
        // Real applies hold the workspace-scoped preset lock across the settings
        // mutation AND the template writes, so two concurrent parameterized
        // applies can never leave settings from one invocation next to template
        // prose from another.
        await withPresetApplyLock(pmDir, applyWrites);
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
/** Refuse missing seed mutation capabilities before any settings/template/item write. */
function requireSeedCapabilities(count, client) {
    if (count > 0 && (!client || typeof client.create !== "function" || typeof client.update !== "function" || typeof client.schemaList !== "function"))
        throw new ParameterRefusal("artifact_capability_missing", "Managed seeds require the invocation-bound host SDK create/update/schemaList capabilities.");
}
/** Refuse nested prototype-key edits that the host audit protocol cannot apply safely. */
function assertWritableReferenceKeys(before, after) {
    const previous = before.secret_references;
    if (!isJsonObject(previous))
        return; // A new map is written as one safe parent value.
    const next = after.secret_references;
    const priorReference = Object.hasOwn(previous, "__proto__") ? previous["__proto__"] : undefined;
    const nextReference = isJsonObject(next) && Object.hasOwn(next, "__proto__") ? next["__proto__"] : undefined;
    if (priorReference !== nextReference) {
        throw new ParameterRefusal("invalid_secret_reference", "This host cannot add or change a nested '__proto__' reference key. Keep the existing reference and rotate its environment value; use a compatible host for a key migration.");
    }
}
/**
 * Write (or, under `dryRun`, print) one apply's resolved template documents.
 *
 * Extracted so the whole template half of an apply runs inside the same
 * workspace apply lock as the settings mutation. Template documents can never
 * hold secret bindings (the resolution engine refuses them), so their dry-run
 * dumps need no redaction.
 */
function writePresetTemplates(templatesDir, templates, options) {
    if (options.dryRun) {
        console.log(`[dry-run] Would create directory: ${templatesDir}`);
    }
    else {
        try {
            fs.mkdirSync(templatesDir, { recursive: true });
        }
        catch {
            throw new ParameterRefusal("artifact_write_failed", "Could not create templates/. Earlier audited settings may have committed; repair tracker write access and retry with --force.");
        }
    }
    for (const { template, templatePath } of templates) {
        if (fs.existsSync(templatePath) && !options.force) {
            console.warn(`Skipped existing template ${templatePath}; its contents already match the desired state.`);
            continue;
        }
        if (options.dryRun) {
            console.log(`[dry-run] Would write template: ${templatePath}`);
            console.log(JSON.stringify(template, null, 2));
            continue;
        }
        try {
            fs.writeFileSync(templatePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
        }
        catch {
            throw new ParameterRefusal("artifact_write_failed", `Could not write templates/${path.basename(templatePath)}. Earlier audited writes may have completed; repair tracker write access and retry with --force.`);
        }
        console.log(`Wrote template ${templatePath}`);
    }
}
/** Resolve template reads through the existing package-or-host SDK loader. */
export function loadTemplateSdk() {
    const sdkPath = resolveSimulationSdk([import.meta.url, path.join(process.cwd(), "package.json"), process.argv[1]]);
    const sdk = createRequire(import.meta.url)(sdkPath);
    /** Delegate native validation first, preserving its expected-error identity. */
    const show = async (name, global) => {
        const result = await sdk.runTemplatesShow(name, global);
        if (result.source === "builtin" && !(await sdk.runTemplatesList(global)).builtin_templates.includes(result.name)) {
            throw new CommandError("Template not found. Choose a name reported by 'pm templates list'.", EXIT_CODE.NOT_FOUND);
        }
        if (result.source === "user")
            assertLoadedTemplateKeys(result.path, result.options);
        return result;
    };
    return {
        runTemplatesList: sdk.runTemplatesList,
        runTemplatesShow: show,
        loadCreateTemplateOptions: async (pmDir, name) => (await show(name, { path: pmDir, noExtensions: true })).options,
    };
}
/** Refuse a host projection that loses raw JSON keys instead of exporting partial data. */
function assertLoadedTemplateKeys(filePath, options) {
    let keys;
    try {
        keys = Object.keys(JSON.parse(fs.readFileSync(filePath, "utf8")).options);
    }
    catch {
        throw new ParameterRefusal("invalid_manifest", "The template changed during validation; inspect its JSON and retry without exporting partial data.");
    }
    if (keys.some((key) => !Object.hasOwn(options, key))) {
        throw new ParameterRefusal("invalid_manifest", "The host cannot preserve this template's option names; use nonempty trimmed names and rename '__proto__' before reading or exporting.");
    }
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
        if (isJsonObject(value) && Object.hasOwn(result, key) && isJsonObject(result[key])) {
            setJsonProperty(result, key, deepMergeJson(result[key], value));
            continue;
        }
        setJsonProperty(result, key, value);
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