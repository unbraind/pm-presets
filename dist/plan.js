import { seedsForPreset } from "./seeds.js";
import { requirePresetDefinition } from "./catalog.js";
/** Invalid inputs and unavailable contract readers fail closed before planning. */
export class PlanRefusal extends Error {
    /** Machine-readable reason for recovery decisions. */
    code;
    /** Concrete next action, without private diagnostics. */
    remedy;
    /** Host-recognized usage/refusal status. */
    exitCode = 2;
    /** Construct a safe refusal for SDK and CLI consumers. */
    constructor(code, remedy) {
        super(`${code}: ${remedy}`);
        this.name = "PlanRefusal";
        this.code = code;
        this.remedy = remedy;
    }
}
/** Accept only plain data records; never interpret arrays as contract objects. */
function object(value) {
    return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
/** Keep identifiers printable, bounded and safe in compact agent output. */
function identifier(value) {
    return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,79}$/.test(value) && value.trim() === value;
}
/** Reject malformed contract envelopes instead of treating missing metadata as support. */
function strings(value) {
    return Array.isArray(value) && value.every(identifier);
}
/** One consistent bounded-input refusal avoids leaking untrusted file contents. */
function invalid() {
    throw new PlanRefusal("invalid_input", "Use a valid composition (1-32 uniquely named features, at most 8 unique requirements each) and complete target contracts; see the plan example.");
}
/** Validate declarations received through JSON or JavaScript, before any contract matching. */
function validate(composition, target) {
    if (!object(composition) || !identifier(composition.id) || !Array.isArray(composition.features)
        || composition.features.length < 1 || composition.features.length > 32
        || !object(target) || !["directory", "database"].includes(target.backend) || !strings(target.capabilities) || !object(target.contracts))
        invalid();
    const contracts = target.contracts;
    if (!strings(contracts.types) || !strings(contracts.statuses) || !identifier(contracts.openStatus)
        || !identifier(contracts.closeStatus) || !identifier(contracts.canceledStatus)
        || (contracts.fields !== undefined && (!Array.isArray(contracts.fields) || contracts.fields.some((field) => !object(field) || !identifier(field.key))))
        || (contracts.extensionCommands !== undefined && (!Array.isArray(contracts.extensionCommands) || contracts.extensionCommands.some((command) => !object(command) || !identifier(command.command)))))
        invalid();
    const ids = new Set();
    for (const feature of composition.features) {
        if (!object(feature) || !identifier(feature.id) || ids.has(feature.id) || typeof feature.optional !== "boolean"
            || !Array.isArray(feature.requires) || feature.requires.length > 8)
            invalid();
        ids.add(feature.id);
        const requirements = new Set();
        for (const requirement of feature.requires) {
            if (!object(requirement) || typeof requirement.kind !== "string" || !["capability", "command", "type", "field", "status"].includes(requirement.kind) || !identifier(requirement.name))
                invalid();
            const key = `${requirement.kind}:${requirement.name}`;
            if (requirements.has(key))
                invalid();
            requirements.add(key);
        }
    }
}
/** Match operational prerequisites against host contracts; never read, write, activate or invoke Git. */
export function compilePresetPlan(composition, target) {
    validate(composition, target);
    const available = {
        capability: new Set(target.capabilities), command: new Set((target.contracts.extensionCommands ?? []).map((entry) => entry.command)),
        type: new Set(target.contracts.types), field: new Set((target.contracts.fields ?? []).map((entry) => entry.key)), status: new Set(target.contracts.statuses),
    };
    const selected = [], omitted = [], refused = [];
    const gaps = [];
    for (const feature of composition.features) {
        const missing = feature.requires.filter((requirement) => !available[requirement.kind].has(requirement.name));
        if (missing.length === 0)
            selected.push(feature.id);
        else {
            (feature.optional ? omitted : refused).push(feature.id);
            for (const requirement of missing) {
                const remedy = requirement.kind === "capability" ? `Select a provider supporting ${requirement.name}, then replan.`
                    : `Enable the host ${requirement.kind} contract ${requirement.name}, then replan.`;
                gaps.push({ kind: requirement.kind, name: requirement.name, feature: feature.id, code: "missing_capability", remedy });
            }
        }
    }
    return { schema: 1, preset: composition.id, backend: target.backend, ready: refused.length === 0, selected, omitted, refused, gaps };
}
/** Declare prerequisites of existing bundled apply primitives, without executing them. */
export function bundledPresetComposition(id, withSeeds = false) {
    const preset = requirePresetDefinition(id);
    const features = [
        { id: "settings", optional: false, requires: [{ kind: "capability", name: "settings.audit" }] },
        { id: "templates", optional: false, requires: [{ kind: "capability", name: "templates.write" },
                ...[...new Set(preset.templates.map((template) => template.type))].map((name) => ({ kind: "type", name }))] },
    ];
    if (withSeeds)
        features.push({ id: "seeds", optional: false, requires: [{ kind: "capability", name: "items.create" },
                ...[...new Set(seedsForPreset(preset.id).map((seed) => seed.type))].map((name) => ({ kind: "type", name }))] });
    return { id: preset.id, features };
}
/** Compact CLI view with complete counts and explicit truncation, never hidden gaps. */
export function summarizePresetPlan(plan) {
    const gaps = [];
    let bytes = 0;
    for (const gap of plan.gaps) {
        bytes += Buffer.byteLength(JSON.stringify(gap));
        if (gaps.length < 12 && bytes <= 4096)
            gaps.push(gap);
    }
    return { ...plan, gaps, gapCount: plan.gaps.length, omittedGaps: plan.gaps.length - gaps.length };
}
//# sourceMappingURL=plan.js.map