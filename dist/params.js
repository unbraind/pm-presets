/**
 * params.ts — typed parameter binding manifests for preset authoring.
 *
 * A preset declares its project parameters ONCE as a typed manifest
 * ({@link PresetParameterManifest}) and references them from settings, template
 * and seed values with `${param:<name>}` binding occurrences. This module is the
 * single resolution engine for every read and write path (`presets apply`,
 * `diff`, `show`, `plan`, `stack`, `validate`): each occurrence is substituted
 * with the same supplied-or-default value, unknown or unanswered parameters are
 * refused with typed refusals BEFORE any write, and secret-typed values can
 * never reach the public prose of templates or seed items.
 *
 * Boundary contract (one strict validation, before any side effect):
 *  - parameter names match `[A-Za-z][A-Za-z0-9_-]{0,31}`;
 *  - values are trimmed strings, 1..maxLength characters (default 256, at most
 *    1024), without control characters;
 *  - enum values must be declared members; string values must fully match the
 *    declared pattern;
 *  - a malformed `${param:` fragment is a refusal, never silently passed
 *    through as literal prose.
 */
import * as fs from "node:fs";
/**
 * Actionable, privacy-safe refusal.
 *
 * Mirrors the package's established refusal pattern: a stable machine-readable
 * {@link code}, a concrete {@link remedy}, and a usage-class {@link exitCode}.
 * Refusals NEVER contain secret values (secrets render as `<redacted>` when a
 * parameter has to be named with its value class at all).
 */
export class ParameterRefusal extends Error {
    /** Machine-readable failure category. */
    code;
    /** Concrete next action for the caller. */
    remedy;
    /** Usage-class exit status; never zero (a refusal is not a success). */
    exitCode = 2;
    /** Construct a refusal without echoing secret values. */
    constructor(code, remedy) {
        super(`${code}: ${remedy}`);
        this.name = "ParameterRefusal";
        this.code = code;
        this.remedy = remedy;
    }
}
/** Upper bounds shared by the manifest and input validation. */
const MAX_NAME_LENGTH = 32;
const MIN_VALUE_LENGTH = 1;
const DEFAULT_MAX_VALUE_LENGTH = 256;
const MAX_ALLOWED_VALUE_LENGTH = 1024;
const MAX_MANIFEST_PARAMETERS = 32;
const MAX_PARAMS_FILE_BYTES = 64 * 1024;
const PARAMETER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const BINDING_PREFIX = "${param:";
/** Reject control characters so values can never corrupt settings or prose. */
function assertPlainValue(name, raw, type) {
    const value = raw.trim();
    if (value.length === 0) {
        throw new ParameterRefusal("invalid_value", `Parameter '${name}' must be a non-empty value (supply --param ${name}=<value>).`);
    }
    if (CONTROL_CHARACTERS.test(raw)) {
        throw new ParameterRefusal("invalid_value", `Parameter '${name}' must not contain control characters or line breaks${type === "secret" ? " (secret value rejected without echoing)" : ""}.`);
    }
    return value;
}
/**
 * Validate a parameter manifest once, at the boundary.
 *
 * Names must be valid and unique, enum parameters must declare unique allowed
 * values, patterns must compile and fully apply to their own defaults, and a
 * `secret` parameter must not carry a default (a default secret would be
 * published with the preset's source). Throws {@link ParameterRefusal} with the
 * first precise problem.
 */
export function validateParameterManifest(manifest) {
    if (!Array.isArray(manifest) || manifest.length > MAX_MANIFEST_PARAMETERS) {
        throw new ParameterRefusal("invalid_manifest", `A parameter manifest declares at most ${MAX_MANIFEST_PARAMETERS} parameters.`);
    }
    if (manifest.length === 0) {
        return; // An empty manifest is the explicit "no parameters" declaration.
    }
    const seen = new Set();
    for (const parameter of manifest) {
        if (parameter === null || typeof parameter !== "object" || Array.isArray(parameter)) {
            throw new ParameterRefusal("invalid_manifest", "Every parameter declaration must be a plain object.");
        }
        if (typeof parameter.name !== "string" || !PARAMETER_NAME_PATTERN.test(parameter.name)) {
            throw new ParameterRefusal("invalid_manifest", `Parameter names must match [A-Za-z][A-Za-z0-9_-]{0,${MAX_NAME_LENGTH - 1}}.`);
        }
        if (seen.has(parameter.name)) {
            throw new ParameterRefusal("invalid_manifest", `Parameter '${parameter.name}' is declared more than once.`);
        }
        seen.add(parameter.name);
        if (!["string", "enum", "secret"].includes(parameter.type)) {
            throw new ParameterRefusal("invalid_manifest", `Parameter '${parameter.name}' must have type 'string', 'enum' or 'secret'.`);
        }
        if (parameter.type === "enum") {
            if (!Array.isArray(parameter.values) || parameter.values.length === 0
                || parameter.values.some((value) => typeof value !== "string" || value.trim() === "" || value.trim() !== value)
                || new Set(parameter.values).size !== parameter.values.length) {
                throw new ParameterRefusal("invalid_manifest", `Enum parameter '${parameter.name}' must declare unique, non-empty trimmed allowed values.`);
            }
        }
        else if (parameter.values !== undefined) {
            throw new ParameterRefusal("invalid_manifest", `Parameter '${parameter.name}' is not an enum and must not declare values.`);
        }
        if (parameter.pattern !== undefined) {
            if (typeof parameter.pattern !== "string" || !isCompilingFullMatchPattern(parameter.pattern)) {
                throw new ParameterRefusal("invalid_manifest", `Parameter '${parameter.name}' declares a pattern that is not a valid full-match regular expression.`);
            }
            if (parameter.type !== "string") {
                throw new ParameterRefusal("invalid_manifest", `Parameter '${parameter.name}' must have type 'string' to declare a pattern.`);
            }
        }
        const maxLength = parameter.maxLength ?? DEFAULT_MAX_VALUE_LENGTH;
        if (!Number.isSafeInteger(maxLength) || maxLength < MIN_VALUE_LENGTH || maxLength > MAX_ALLOWED_VALUE_LENGTH) {
            throw new ParameterRefusal("invalid_manifest", `Parameter '${parameter.name}' declares maxLength outside 1-${MAX_ALLOWED_VALUE_LENGTH}.`);
        }
        if (typeof parameter.required !== "boolean") {
            throw new ParameterRefusal("invalid_manifest", `Parameter '${parameter.name}' must declare required as a boolean.`);
        }
        if (parameter.description !== undefined && (typeof parameter.description !== "string" || parameter.description.length === 0 || parameter.description.length > 200)) {
            throw new ParameterRefusal("invalid_manifest", `Parameter '${parameter.name}' description must be a bounded non-empty string.`);
        }
        if (parameter.default !== undefined) {
            if (parameter.type === "secret") {
                throw new ParameterRefusal("invalid_manifest", `Secret parameter '${parameter.name}' must not declare a default; supply it per invocation.`);
            }
            try {
                const value = assertPlainValue(parameter.name, parameter.default, parameter.type);
                assertValueConstraints(parameter, value);
            }
            catch (error) {
                throw new ParameterRefusal("invalid_manifest", `Parameter '${parameter.name}' declares a default that violates its own constraints (${error.remedy}).`);
            }
        }
    }
}
/** True when the pattern source compiles as a full-match regular expression. */
function isCompilingFullMatchPattern(source) {
    try {
        new RegExp(`^(?:${source})$`);
        return true;
    }
    catch {
        return false;
    }
}
/** Apply the parameter's own constraints (length, enum, pattern) to one value. */
function assertValueConstraints(parameter, value) {
    const maxLength = parameter.maxLength ?? DEFAULT_MAX_VALUE_LENGTH;
    if (value.length > maxLength) {
        throw new ParameterRefusal("invalid_value", `Parameter '${parameter.name}' must be at most ${maxLength} character(s).`);
    }
    if (parameter.type === "enum" && !parameter.values.includes(value)) {
        throw new ParameterRefusal("invalid_value", `Parameter '${parameter.name}' must be one of: ${parameter.values.join(", ")}.`);
    }
    if (parameter.type === "string" && parameter.pattern !== undefined && !new RegExp(`^(?:${parameter.pattern})$`).test(value)) {
        throw new ParameterRefusal("invalid_value", `Parameter '${parameter.name}' must match ${parameter.pattern}.`);
    }
}
/**
 * Effective parameter values collected WITHOUT answering requirements.
 *
 * The lenient half of the resolution boundary: every supplied key must still
 * be declared and satisfy its own constraints, but required parameters may
 * remain unanswered (listed in {@link ResolvedParameterValues.unanswered}) so
 * read surfaces can display declarations without pretending to apply them.
 * Pure: reads nothing, writes nothing.
 */
export function collectParameterValues(manifest, supplied) {
    validateParameterManifest(manifest);
    for (const name of Object.keys(supplied)) {
        if (!manifest.some((parameter) => parameter.name === name)) {
            const declared = manifest.map((parameter) => parameter.name).join(", ");
            throw new ParameterRefusal("unknown_parameter", `Parameter '${name}' is not declared by this preset. Declared: ${declared || "(none)"}.`);
        }
    }
    const values = {};
    const sources = {};
    const unanswered = [];
    for (const parameter of manifest) {
        const raw = Object.hasOwn(supplied, parameter.name) ? supplied[parameter.name] : undefined;
        if (raw === undefined) {
            if (parameter.default !== undefined) {
                values[parameter.name] = parameter.default;
                sources[parameter.name] = "default";
            }
            else {
                unanswered.push(parameter.name);
            }
            continue;
        }
        if (typeof raw !== "string") {
            throw new ParameterRefusal("invalid_value", `Parameter '${parameter.name}' must be supplied as a string value.`);
        }
        const value = assertPlainValue(parameter.name, raw, parameter.type);
        assertValueConstraints(parameter, value);
        values[parameter.name] = value;
        sources[parameter.name] = "supplied";
    }
    return { values, sources, unanswered };
}
/**
 * Resolve a manifest against caller-supplied values.
 *
 * The strict boundary every write path uses: `unknown_parameter` for
 * undeclared names, `unanswered_parameter` listing every required choice
 * without a value or default, `invalid_value` for constraint violations.
 * Pure: reads nothing, writes nothing.
 */
export function resolveParameterValues(manifest, supplied) {
    const resolved = collectParameterValues(manifest, supplied);
    if (resolved.unanswered.some((name) => manifest.find((parameter) => parameter.name === name)?.required)) {
        const required = resolved.unanswered.filter((name) => manifest.find((parameter) => parameter.name === name)?.required);
        throw new ParameterRefusal("unanswered_parameter", `Unanswered required parameter(s): ${required.join(", ")}. Supply --param <name>=<value> (or a --params-file) for each before applying; see 'pm presets show <id>'.`);
    }
    return resolved;
}
/**
 * Re-validate a pre-resolved value set (e.g. injected by a command that
 * already resolved them at its boundary) against the manifest.
 *
 * Ensures a threaded-in result still declares only manifest parameters with
 * constraint-satisfying values, every required parameter is answered, and the
 * sources are well-formed — so a downstream consumer can trust values it did
 * not resolve itself without re-reading any input.
 */
export function assertResolvedParameterValues(manifest, resolved) {
    validateParameterManifest(manifest);
    for (const [name, value] of Object.entries(resolved.values)) {
        const parameter = manifest.find((entry) => entry.name === name);
        if (!parameter) {
            throw new ParameterRefusal("unknown_parameter", `Parameter '${name}' is not declared by this preset.`);
        }
        if (typeof value !== "string") {
            throw new ParameterRefusal("invalid_value", `Parameter '${name}' must be a string value.`);
        }
        assertValueConstraints(parameter, assertPlainValue(name, value, parameter.type));
        const source = resolved.sources[name];
        if (source !== "supplied" && source !== "default") {
            throw new ParameterRefusal("invalid_value", `Parameter '${name}' has an invalid resolution source.`);
        }
    }
    for (const parameter of manifest) {
        if (parameter.required && !Object.hasOwn(resolved.values, parameter.name)) {
            throw new ParameterRefusal("unanswered_parameter", `Unanswered required parameter(s): ${parameter.name}. Supply --param <name>=<value> (or a --params-file) before applying.`);
        }
    }
}
/**
 * Replace every occurrence of any supplied secret value with `<redacted>`.
 *
 * The single redaction primitive for every emitted surface (dry-run patch
 * dumps, diff results): privacy-safe in both directions — it can never reveal a
 * secret, and it only ever matches exact secret values.
 */
export function redactSecretValues(text, secretValues) {
    let result = text;
    for (const secret of secretValues) {
        if (secret.length > 0) {
            result = result.split(secret).join("<redacted>");
        }
    }
    return result;
}
/** Build the compact parameter views for `presets show` (secrets never show defaults). */
export function buildParameterViews(manifest, supplied) {
    validateParameterManifest(manifest);
    return manifest.map((parameter) => {
        const answered = supplied !== undefined && Object.hasOwn(supplied, parameter.name);
        const view = {
            name: parameter.name,
            type: parameter.type,
            required: parameter.required,
            hasDefault: parameter.default !== undefined,
            unanswered: parameter.required && !answered && parameter.default === undefined,
        };
        if (parameter.type !== "secret" && parameter.default !== undefined) {
            view.default = parameter.default;
        }
        if (parameter.description !== undefined) {
            view.description = parameter.description;
        }
        if (parameter.pattern !== undefined) {
            view.pattern = parameter.pattern;
        }
        if (parameter.type === "enum" && parameter.values !== undefined) {
            view.values = [...parameter.values];
        }
        return view;
    });
}
/** Parse repeated `--param <name>=<value>` flag entries.
 *
 * Accepts the loose-option shapes the host can deliver (string or string[]).
 * Each entry must split at the first `=` into a declared-shape name and a
 * non-empty value; duplicate names are refused (a repeated parameter is an
 * invocation mistake, not an override).
 */
export function parseParameterFlagEntries(raw) {
    const entries = [];
    const list = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
    for (const entry of list) {
        if (typeof entry !== "string") {
            throw new ParameterRefusal("invalid_param_flag", "--param takes <name>=<value> entries.");
        }
        const separator = entry.indexOf("=");
        if (separator <= 0) {
            throw new ParameterRefusal("invalid_param_flag", `--param expects <name>=<value>; got an entry without '='.`);
        }
        const name = entry.slice(0, separator).trim();
        if (!PARAMETER_NAME_PATTERN.test(name)) {
            throw new ParameterRefusal("invalid_param_flag", `--param name must match [A-Za-z][A-Za-z0-9_-]{0,${MAX_NAME_LENGTH - 1}}.`);
        }
        const value = entry.slice(separator + 1);
        if (value.trim().length === 0) {
            throw new ParameterRefusal("invalid_param_flag", `--param ${name}=<value> needs a non-empty value.`);
        }
        if (entries.some((existing) => existing.name === name)) {
            throw new ParameterRefusal("invalid_param_flag", `Parameter '${name}' supplied more than once; keep one --param entry.`);
        }
        entries.push({ name, value });
    }
    return entries;
}
/**
 * Read a `--params-file` JSON document of supplied parameter values.
 *
 * One strict boundary schema: a bounded plain JSON object whose every value is
 * a string. Anything else (arrays, nested objects, non-string values,
 * duplicate keys after trimming, oversized files) is a typed refusal before any
 * read of tracker state.
 */
export function parseParamsFile(text) {
    if (Buffer.byteLength(text, "utf8") > MAX_PARAMS_FILE_BYTES) {
        throw new ParameterRefusal("invalid_params_file", `The params file must be at most ${MAX_PARAMS_FILE_BYTES} bytes.`);
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new ParameterRefusal("invalid_params_file", "The params file must be a JSON object of parameter names to string values.");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) {
        throw new ParameterRefusal("invalid_params_file", "The params file must be a JSON object of parameter names to string values.");
    }
    const supplied = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== "string") {
            throw new ParameterRefusal("invalid_params_file", `Params file entry '${key}' must be a string value.`);
        }
        if (!PARAMETER_NAME_PATTERN.test(key)) {
            throw new ParameterRefusal("invalid_params_file", `Params file key '${key}' must match [A-Za-z][A-Za-z0-9_-]{0,${MAX_NAME_LENGTH - 1}}.`);
        }
        supplied[key] = value;
    }
    return supplied;
}
/**
 * Read supplied parameters from command options (both spelling variants).
 *
 * Combines `--param` entries and one `--params-file`; a name supplied through
 * both is a refusal. The file is read exactly once, here, before any tracker
 * state is touched.
 */
export function readSuppliedParameterValues(options) {
    const flags = parseParameterFlagEntries(options.param);
    const file = options.paramsFile;
    const supplied = {};
    for (const entry of flags) {
        supplied[entry.name] = entry.value;
    }
    if (typeof file === "string" && file.trim().length > 0) {
        const fromFile = parseParamsFile(fs.readFileSync(file.trim(), "utf8"));
        for (const [name, value] of Object.entries(fromFile)) {
            if (Object.hasOwn(supplied, name)) {
                throw new ParameterRefusal("invalid_param_flag", `Parameter '${name}' supplied by both --param and the params file; keep one.`);
            }
            supplied[name] = value;
        }
    }
    else if (file !== undefined && file !== null) {
        throw new ParameterRefusal("invalid_params_file", "--params-file takes a path to a JSON object of parameter values.");
    }
    return supplied;
}
/** Scan one string for binding tokens; returns well-formed and malformed finds. */
function scanString(value, location) {
    const occurrences = [];
    let malformed = false;
    let cursor = value.indexOf(BINDING_PREFIX);
    while (cursor >= 0) {
        const nameStart = cursor + BINDING_PREFIX.length;
        const end = value.indexOf("}", nameStart);
        if (end < 0) {
            malformed = true;
        }
        else {
            const name = value.slice(nameStart, end);
            if (!PARAMETER_NAME_PATTERN.test(name)) {
                malformed = true;
            }
            else {
                occurrences.push({ parameter: name, location });
            }
        }
        cursor = value.indexOf(BINDING_PREFIX, nameStart);
    }
    return { occurrences, malformed };
}
/**
 * Substitute every well-formed occurrence in one string.
 *
 * Undeclared names always refuse (`unknown_binding` — an authoring bug). A
 * name that IS declared but has no effective value refuses in write mode
 * (`unanswered_parameter` — a missing binding must never reach a write) and is
 * left untouched in declaration mode, so inspection surfaces can display the
 * preset's authored content without answering its parameters.
 */
function substituteString(value, location, values, declared, allowUnresolved) {
    let result = value;
    let occurrences = 0;
    let cursor = result.indexOf(BINDING_PREFIX);
    while (cursor >= 0) {
        const nameStart = cursor + BINDING_PREFIX.length;
        const end = result.indexOf("}", nameStart);
        if (end < 0 || !PARAMETER_NAME_PATTERN.test(result.slice(nameStart, end))) {
            throw new ParameterRefusal("malformed_binding", `Malformed parameter binding at ${location}: use the exact form \${param:<name>}.`);
        }
        const name = result.slice(nameStart, end);
        if (!Object.hasOwn(values, name)) {
            if (!declared.has(name)) {
                throw new ParameterRefusal("unknown_binding", `Binding \${param:${name}} at ${location} is not declared by the preset's parameter manifest; declare it or fix the name.`);
            }
            if (!allowUnresolved) {
                throw new ParameterRefusal("unanswered_parameter", `Binding \${param:${name}} at ${location} has no supplied value or default. Supply --param ${name}=<value> (or a --params-file) before applying.`);
            }
            // Declaration mode: keep the authored occurrence for inspection.
            cursor = result.indexOf(BINDING_PREFIX, end + 1);
            continue;
        }
        result = result.slice(0, cursor) + values[name] + result.slice(end + 1);
        occurrences += 1;
        cursor = result.indexOf(BINDING_PREFIX, cursor + values[name].length);
    }
    return { result, occurrences };
}
/** Walk a JSON-ish tree, substituting in every string leaf; arrays stay dense. */
function substituteTree(value, location, values, declared, allowUnresolved, counter) {
    if (typeof value === "string") {
        const { result, occurrences } = substituteString(value, location, values, declared, allowUnresolved);
        counter.occurrences += occurrences;
        return result;
    }
    if (Array.isArray(value)) {
        return value.map((entry, index) => substituteTree(entry, `${location}[${index}]`, values, declared, allowUnresolved, counter));
    }
    if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        const copy = {};
        for (const [key, entry] of Object.entries(value)) {
            copy[key] = substituteTree(entry, `${location}.${key}`, values, declared, allowUnresolved, counter);
        }
        return copy;
    }
    return structuredClone(value);
}
/** Refuse secret occurrences inside public prose (templates and seeds). */
function refuseSecretsInProse(occurrences, secretNames, target) {
    for (const occurrence of occurrences) {
        if (secretNames.has(occurrence.parameter)) {
            throw new ParameterRefusal("secret_in_public_prose", `Secret parameter '${occurrence.parameter}' is bound at ${occurrence.location}; ${target} are public. Bind secrets only into settings values, or change the parameter type.`);
        }
    }
}
/** The declared parameter names of a manifest, for binding-name classification. */
function declaredNames(manifest) {
    return new Set(manifest.map((parameter) => parameter.name));
}
/** Collect all binding occurrences in a preset part for reporting and refusal. */
function collectOccurrences(value, location, occurrences, malformedLocations) {
    if (typeof value === "string") {
        const scan = scanString(value, location);
        occurrences.push(...scan.occurrences);
        if (scan.malformed) {
            malformedLocations.push(location);
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((entry, index) => collectOccurrences(entry, `${location}[${index}]`, occurrences, malformedLocations));
        return;
    }
    if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        for (const [key, entry] of Object.entries(value)) {
            collectOccurrences(entry, `${location}.${key}`, occurrences, malformedLocations);
        }
    }
}
/**
 * Resolve a preset's settings patch against resolved parameter values.
 *
 * Returns a substituted deep copy; the input is never mutated. Secret
 * parameters are allowed here (settings are the private configuration surface).
 */
export function resolveSettingsWithParameters(manifest, values, settings, allowUnresolved = false) {
    const counter = { occurrences: 0 };
    const settingsResult = substituteTree(settings, "settings", values, declaredNames(manifest), allowUnresolved, counter);
    return { settings: settingsResult, occurrences: counter.occurrences };
}
/**
 * Resolve a preset's template map against resolved parameter values.
 *
 * Template documents are PUBLIC: a secret binding anywhere in them (including
 * the `name`, which additionally must stay binding-free because it becomes a
 * file name) is refused with {@link ParameterRefusal} before any write.
 */
export function resolveTemplatesWithParameters(manifest, values, templates, allowUnresolved = false) {
    const secretNames = new Set(manifest.filter((parameter) => parameter.type === "secret").map((parameter) => parameter.name));
    const occurrences = [];
    const malformed = [];
    collectOccurrences(templates, "templates", occurrences, malformed);
    if (malformed.length > 0) {
        throw new ParameterRefusal("malformed_binding", `Malformed parameter binding in template(s): ${malformed.join(", ")}.`);
    }
    for (const [filename, document] of Object.entries(templates)) {
        const nameScan = scanString(document.name, `templates.${filename}.name`);
        if (nameScan.occurrences.length > 0) {
            throw new ParameterRefusal("invalid_binding_location", `Template file '${filename}' has a binding in its name; template names become file names and must be static.`);
        }
    }
    refuseSecretsInProse(occurrences, secretNames, "templates");
    const counter = { occurrences: 0 };
    const resolved = substituteTree(templates, "templates", values, declaredNames(manifest), allowUnresolved, counter);
    return { templates: resolved, occurrences: counter.occurrences };
}
/**
 * Resolve a preset's seed items against resolved parameter values.
 *
 * Seed items become PUBLIC tracker prose, so a secret binding in ANY seed field
 * is refused; the refusal names the parameter and location but never a value.
 */
export function resolveSeedsWithParameters(manifest, values, seeds, allowUnresolved = false) {
    const secretNames = new Set(manifest.filter((parameter) => parameter.type === "secret").map((parameter) => parameter.name));
    const occurrences = [];
    const malformed = [];
    collectOccurrences(seeds, "seeds", occurrences, malformed);
    if (malformed.length > 0) {
        throw new ParameterRefusal("malformed_binding", `Malformed parameter binding in seed(s): ${malformed.join(", ")}.`);
    }
    refuseSecretsInProse(occurrences, secretNames, "generated public seed prose");
    const counter = { occurrences: 0 };
    const resolved = substituteTree(seeds, "seeds", values, declaredNames(manifest), allowUnresolved, counter);
    return { seeds: resolved, occurrences: counter.occurrences };
}
/**
 * Resolve every preset part against resolved parameter values in one call.
 *
 * Used by the apply path so settings, templates and seeds resolve against the
 * SAME effective values (one supplied project parameter reaches every declared
 * occurrence), with all refusals raised before any write. Passing
 * `allowUnresolved` switches to declaration mode: occurrences of declared-but-
 * unanswered parameters stay authored for inspection surfaces.
 */
export function resolveParameterizedPreset(manifest, values, parts, allowUnresolved = false) {
    let occurrences = 0;
    const result = {};
    if (parts.settings !== undefined) {
        const resolved = resolveSettingsWithParameters(manifest, values, parts.settings, allowUnresolved);
        result.settings = resolved.settings;
        occurrences += resolved.occurrences;
    }
    if (parts.templates !== undefined) {
        const resolved = resolveTemplatesWithParameters(manifest, values, parts.templates, allowUnresolved);
        result.templates = resolved.templates;
        occurrences += resolved.occurrences;
    }
    if (parts.seeds !== undefined) {
        const resolved = resolveSeedsWithParameters(manifest, values, parts.seeds, allowUnresolved);
        result.seeds = resolved.seeds;
        occurrences += resolved.occurrences;
    }
    return { ...result, occurrences };
}
//# sourceMappingURL=params.js.map