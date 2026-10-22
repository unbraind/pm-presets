/** Three-way vendor settings evolution, with portable receipts and host-owned auditing. */
import { createHash } from "node:crypto";
/** Typed failure with a stable remedy; user settings and raw SDK messages stay private. */
export class UpgradeRefusal extends Error {
    /** Stable category suitable for programmatic handling. */
    code;
    /** Concrete corrective action, excluding private diagnostics. */
    remedy;
    /** Expected usage/conflict failure, recognized by the pm extension host. */
    exitCode = 2;
    /** Construct a safe, machine-readable refusal. */
    constructor(code, remedy) {
        super(`${code}: ${remedy}`);
        this.name = "UpgradeRefusal";
        this.code = code;
        this.remedy = remedy;
    }
}
/** Identify plain data objects, excluding arrays and class instances. */
function object(value) {
    return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
/** Validate bounded JSON and reject prototype keys even in arrays or unused patch branches. */
function json(value, depth = 0) {
    if (depth > 32)
        throw new UpgradeRefusal("invalid_input", "Limit settings nesting to 32 levels.");
    if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))
        return;
    if (Array.isArray(value)) {
        for (const child of value)
            json(child, depth + 1);
        return;
    }
    if (!object(value))
        throw new UpgradeRefusal("invalid_input", "Supply JSON objects, arrays and finite scalar values only.");
    for (const [key, child] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key))
            throw new UpgradeRefusal("invalid_input", "Remove prototype-related settings keys.");
        json(child, depth + 1);
    }
}
/** Sort object keys so formatting and insertion order cannot change a receipt identity. */
function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(",")}]`;
    if (object(value))
        return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return String(JSON.stringify(value));
}
/** Compare missing values distinctly from null, empty objects and empty arrays. */
function equal(left, right) {
    return canonical(left) === canonical(right);
}
/** Validate a vendor patch before reading any workspace state. */
function vendor(value) {
    if (!object(value) || typeof value.id !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(value.id)
        || typeof value.version !== "string" || !/^[a-zA-Z0-9._+-]{1,100}$/.test(value.version) || !object(value.settings)
        || Object.keys(value).some((key) => !["id", "version", "settings"].includes(key))) {
        throw new UpgradeRefusal("invalid_input", "Supply {id, version, settings} with nonempty stable labels and an object patch.");
    }
    json(value);
}
/** Validate choices before using them as paths or decisions. */
function choices(value) {
    if (!object(value) || Object.entries(value).some(([key, choice]) => !key.startsWith("/") || !["local", "vendor"].includes(String(choice)))) {
        throw new UpgradeRefusal("invalid_input", "Supply an object mapping conflict JSON pointers to local or vendor.");
    }
    json(value);
}
/** Merge only vendor-owned paths; structural changes and arrays are atomic conflicts. */
function migrate(from, to, before, decisions) {
    const changes = [];
    const used = new Set();
    /** Resolve one subtree without traversing local-only fields. */
    function visit(base, next, local, path) {
        if ((object(base) || base === undefined) && (object(next) || next === undefined) && object(local) && next !== undefined) {
            const result = structuredClone(local);
            const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(next)]);
            for (const key of [...keys].sort()) {
                const child = visit(base?.[key], next[key], local[key], `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
                if (child === undefined)
                    delete result[key];
                else
                    result[key] = child;
            }
            return result;
        }
        if (equal(base, next)) {
            if (!equal(base, local))
                changes.push({ path, kind: "local", decision: "" });
            return local;
        }
        if (equal(local, base)) {
            changes.push({ path, kind: "vendor", decision: "" });
            return next;
        }
        if (equal(local, next)) {
            changes.push({ path, kind: "already", decision: "" });
            return local;
        }
        const decision = decisions[path] ?? "";
        used.add(path);
        changes.push({ path, kind: "conflict", decision });
        return decision === "vendor" ? next : local;
    }
    const after = visit(from, to, before, "");
    if (Object.keys(decisions).some((key) => !used.has(key)))
        throw new UpgradeRefusal("invalid_input", "Remove decisions for paths that are not conflicts in this plan.");
    return { after, changes };
}
/** Compare JSON settings without a host; arrays and structural type changes require atomic choices. */
export function comparePresetUpgrade(from, to, local, decisions = {}) {
    for (const value of [from, to, local]) {
        if (!object(value))
            throw new UpgradeRefusal("invalid_input", "Supply object settings snapshots for all three comparison inputs.");
        json(value);
    }
    choices(decisions);
    return migrate(from, to, local, decisions);
}
/** Bind the complete artifact rather than relying on the caller's filename or operation id. */
function identity(receipt) {
    return createHash("sha256").update(canonical(receipt)).digest("hex");
}
/** Enforce the host capability and translate execution failures without exposing configuration. */
async function mutation(sdk, options) {
    if (typeof sdk?.mutateWorkspaceSettings !== "function")
        throw new UpgradeRefusal("sdk_required", "Use a pm host with audited settings mutation and canonical includePreview support (2026.10.17+).");
    try {
        return await sdk.mutateWorkspaceSettings(options);
    }
    catch (error) {
        if (error instanceof UpgradeRefusal)
            throw error;
        throw new UpgradeRefusal("mutation_refused", "Check pm health and the settings schema, then retry with the same receipt; retain the artifact for recovery.");
    }
}
/** Replace only the smallest object containing removed leaves; other raw source fields remain host-owned. */
function removedSubtrees(before, after, prefix = "") {
    if (prefix && Object.keys(before).some((key) => !(key in after)))
        return [prefix];
    return Object.keys(before).flatMap((key) => object(before[key]) && object(after[key])
        ? removedSubtrees(before[key], after[key], prefix ? `${prefix}.${key}` : key) : []);
}
/** Plan against the locked inline snapshot; dry-run never changes settings or history. */
export async function planPresetUpgrade(sdk, from, to, decisions = {}, generation = "1") {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(generation))
        throw new UpgradeRefusal("invalid_input", "Use a nonempty migration generation of at most 64 letters, digits, dots, underscores or hyphens.");
    vendor(from);
    vendor(to);
    choices(decisions);
    if (from.id !== to.id || from.version === to.version)
        throw new UpgradeRefusal("invalid_input", "Use the same vendor id with two different immutable version labels.");
    let before = {};
    let proposed = {};
    let changes = [];
    const replacements = [];
    const preview = await mutation(sdk, {
        operationId: "preset-upgrade-preview", dryRun: true, includePreview: true,
        replaceSubtrees: replacements,
        mutate: (current) => {
            before = JSON.parse(JSON.stringify(current));
            const result = migrate(from.settings, to.settings, before, decisions);
            proposed = result.after;
            replacements.push(...removedSubtrees(before, proposed));
            changes = result.changes;
            return proposed;
        },
    });
    if (!preview.preview)
        throw new UpgradeRefusal("sdk_required", "Upgrade the pm host to support canonical includePreview settings results (2026.10.17+).");
    if (!equal(preview.preview, proposed))
        throw new UpgradeRefusal("normalization_changed", "Adjust the vendor patch to the host's canonical settings schema and explicit governance policy, then replan.");
    const receipt = { schema: 1, generation, from, to, decisions, before, after: JSON.parse(JSON.stringify(preview.preview)), changes };
    return structuredClone({ ...receipt, id: identity(receipt) });
}
/** Validate private artifacts received from JSON before any host mutation. Digests detect edits, not authorship. */
export function parseUpgradeReceipt(value) {
    json(value);
    if (!object(value) || value.schema !== 1 || typeof value.generation !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(value.generation) || typeof value.id !== "string" || !object(value.before) || !object(value.after) || !Array.isArray(value.changes)) {
        throw new UpgradeRefusal("invalid_receipt", "Use the complete unchanged receipt written by presets upgrade plan.");
    }
    const { id, ...body } = value;
    if (identity(body) !== id)
        throw new UpgradeRefusal("invalid_receipt", "Restore the unchanged receipt; regenerate a plan to change decisions.");
    const receipt = value;
    vendor(receipt.from);
    vendor(receipt.to);
    choices(receipt.decisions);
    const expected = migrate(receipt.from.settings, receipt.to.settings, receipt.before, receipt.decisions);
    if (receipt.from.id !== receipt.to.id || receipt.from.version === receipt.to.version || !equal(expected.after, receipt.after) || !equal(expected.changes, receipt.changes)) {
        throw new UpgradeRefusal("invalid_receipt", "Regenerate the receipt from the original vendor versions and explicit decisions.");
    }
    return receipt;
}
/** Bounded result emitted by CLI renderers; full settings stay in the private receipt file. */
export function summarizePresetUpgrade(receipt) {
    const conflicts = receipt.changes.filter((change) => change.kind === "conflict");
    let bytes = 0;
    const visible = conflicts.slice(0, 20).filter((change) => {
        bytes += Buffer.byteLength(JSON.stringify(change));
        return bytes <= 4096;
    });
    return { id: receipt.id, preset: receipt.from.id, from: receipt.from.version, to: receipt.to.version,
        ready: !receipt.changes.some((change) => change.kind === "conflict" && change.decision === ""),
        changed: !equal(receipt.before, receipt.after), paths: receipt.changes.length,
        conflicts: visible, omittedConflicts: conflicts.length - visible.length,
        counts: { vendor: receipt.changes.filter((change) => change.kind === "vendor").length, local: receipt.changes.filter((change) => change.kind === "local").length, already: receipt.changes.filter((change) => change.kind === "already").length, conflict: conflicts.length } };
}
/** Apply or roll back exactly once through the host audit lock, refusing stale state and unresolved choices. */
export async function executePresetUpgrade(sdk, input, direction) {
    const receipt = parseUpgradeReceipt(input);
    if (direction !== "apply" && direction !== "rollback")
        throw new UpgradeRefusal("invalid_input", "Choose apply or rollback.");
    if (!summarizePresetUpgrade(receipt).ready)
        throw new UpgradeRefusal("conflicts", "Supply local or vendor for every conflict in a decisions file and generate a new receipt.");
    const [before, after] = direction === "apply" ? [receipt.before, receipt.after] : [receipt.after, receipt.before];
    const result = await mutation(sdk, {
        operationId: `preset-${direction}-${receipt.id}`, replaceSubtrees: removedSubtrees(before, after),
        mutate: (current) => {
            if (!equal(current, before) && !equal(current, after))
                throw new UpgradeRefusal("stale_settings", "Settings changed since this receipt; replan against current settings before applying or rolling back.");
            return structuredClone(after);
        },
    });
    // Replay skips the callback. Check the live snapshot before reporting success,
    // including retries after a rollback or a concurrent later settings mutation.
    await mutation(sdk, { operationId: "preset-upgrade-verify", dryRun: true, mutate: (current) => {
            if (!equal(current, after))
                throw new UpgradeRefusal("stale_settings", "The operation was replayed or settings changed after it; inspect history and replan with a new explicit generation for further migration.");
            return current;
        } });
    return { ...summarizePresetUpgrade(receipt), direction, changed: result.changed, replayed: result.replayed };
}
//# sourceMappingURL=upgrade.js.map