/** Preflight every overwrite against verified preset provenance before auditing intent. */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { resolveSimulationSdk } from "./sdk-loader.js";
import { artifactValuesEqual, ownArtifact } from "./desired-state.js";
import { readPresetOwnership } from "./application-history.js";
import { replacementSettings } from "./settings-replacement.js";
import { ParameterRefusal } from "./params.js";
/** Refuse tampered ownership; only the preset's recorded audit may establish it. */
export async function verifiedArtifactOwnership(pmRoot, stored) {
    try {
        const verified = await readPresetOwnership(pmRoot);
        const current = ownArtifact(stored, "preset_ownership") ?? {};
        if (typeof current !== "object" || current === null || Array.isArray(current) || Object.values(current).some((value) => value !== true && typeof value !== "string") || !artifactValuesEqual(current, verified))
            throw new Error("Unverified ownership");
        return verified;
    }
    catch {
        throw new ParameterRefusal("invalid_artifact_record", "Cannot verify settings.json#preset_ownership against preset application history. Restore the recorded provenance before retrying.");
    }
}
/** Reject an unowned collision even if its bytes happen to match the desired artifact. */
export function requireArtifactOwnership(owned, artifact) {
    if (ownArtifact(owned, artifact) === true)
        return;
    // A setting cannot be renamed: name the two ways to clear a settings-leaf collision instead.
    const remedy = artifact.startsWith("settings.json#")
        ? "Restore that setting to its host default, or keep its current value (for id_prefix, pass the same --prefix), before retrying"
        : "Preserve or rename that artifact before retrying";
    throw new ParameterRefusal("artifact_conflict", `Unowned collision: ${artifact}. ${remedy}; --force cannot adopt it.`);
}
let initialDefaults;
/** Initialize the baseline through the same host serializer that initializes real trackers. */
export async function initialPresetSettings() {
    if (!initialDefaults) {
        const sdk = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url, process.argv[1]]));
        const canonical = await replacementSettings({ id_prefix: "pm-" });
        initialDefaults = { ...sdk.SETTINGS_DEFAULTS, ...canonical, governance: { ...sdk.SETTINGS_DEFAULTS.governance, ...canonical.governance } };
    }
    return initialDefaults;
}
/** Check every changed/deleted settings leaf, including raw keys removed by replacement. */
export function admitSettingsOwnership(before, after, owned, baseline, keys = Object.keys(after)) {
    const sdk = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url, process.argv[1]]));
    const result = { ...owned };
    /** Walk the real merged write, comparing initial host defaults with the same key semantics. */
    function visit(previous, next, defaults, pointer) {
        if ((next === undefined || (next !== null && typeof next === "object" && !Array.isArray(next))) && (previous === undefined || (previous !== null && typeof previous === "object" && !Array.isArray(previous)))) {
            for (const key of new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})])) {
                visit(ownArtifact(previous, key), ownArtifact(next, key), ownArtifact(defaults, key), `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
            }
            return;
        }
        const artifact = `settings.json#${pointer}`;
        if (artifactValuesEqual(previous, next) && !artifactValuesEqual(previous, defaults))
            return;
        if (previous !== undefined && !artifactValuesEqual(previous, defaults))
            requireArtifactOwnership(owned, artifact);
        Object.defineProperty(result, artifact, { value: true, enumerable: true, writable: true, configurable: true });
    }
    // Ownership records are package-managed and checked separately, never user-authored patches.
    for (const key of keys)
        if (key !== "preset_artifacts" && key !== "preset_ownership") {
            visit(ownArtifact(before, key), after[key], ownArtifact(baseline ?? sdk.SETTINGS_DEFAULTS, key), `/${key}`);
        }
    // The host mirrors these explicit governance knobs into validation storage.
    for (const key of ["parent_reference", "metadata_profile"]) {
        if (ownArtifact(result, `settings.json#/governance/${key}`) === true)
            result[`settings.json#/validation/${key}`] = true;
    }
    return result;
}
/** Missing managed documents with retained identity require the public native restore command. */
export async function refuseReservedSeedIdentity(pmRoot, id, owned) {
    const sdk = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url, process.argv[1]]));
    if (!existsSync(sdk.getHistoryPath(pmRoot, id)))
        return;
    if (!owned)
        requireArtifactOwnership({}, `items/${id}`);
    let target;
    try {
        const { entries } = await sdk.readHistorySnapshot(sdk.getHistoryPath(pmRoot, id), id);
        for (const entry of [...entries].reverse()) {
            try {
                const projection = await sdk.getItemAt(id, entry.ts, { pmRoot });
                if (projection.document.metadata.id === id) {
                    target = projection.as_of_timestamp;
                    break;
                }
            }
            catch { /* Deleted or unavailable projections are never offered as restore targets. */ }
        }
    }
    catch { /* Preserve malformed history and report only a typed verification remedy. */ }
    if (!target)
        throw new ParameterRefusal("artifact_recovery_required", `Cannot select a verified materialized restore target for items/${id}. Run 'pm history ${id} --verify' and repair its retained history before retrying; no preset artifacts were changed.`);
    throw new ParameterRefusal("artifact_recovery_required", `Managed document items/${id} is missing while history/${id}.jsonl retains its identity. Run 'pm restore ${id} ${target}', inspect the restored item, then retry the preset with --force. Preserve its history.`);
}
/** Match a native birth record to the unique token reserved before this run created the item. */
export async function seedOwnershipProven(pmRoot, id, token) {
    if (typeof token !== "string")
        return false;
    const sdk = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url, process.argv[1]]));
    const file = sdk.getHistoryPath(pmRoot, id);
    if (!existsSync(file))
        return false;
    try {
        const { entries } = await sdk.readHistorySnapshot(file, id);
        const birth = entries[0];
        if (!birth || birth.op !== "create" || birth.message !== `${token} | explicit_unset=parent`)
            return false;
        return ownArtifact(sdk.replayHistoryToTarget(entries, 0).metadata, "id") === id;
    }
    catch {
        throw new ParameterRefusal("artifact_unreadable", `Cannot verify the native birth provenance of items/${id}. Run 'pm history ${id} --verify' before retrying; keep its history.`);
    }
}
/** Recognize native identity races while leaving unrelated write failures in their own category. */
export function isArtifactCollision(error) {
    const native = error;
    return new Set(["item_already_exists", "item_identity_reserved"]).has(native?.context?.code);
}
//# sourceMappingURL=artifact-ownership.js.map