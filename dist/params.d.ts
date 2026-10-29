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
 * never enter tracker data: only external references are stored.
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
import type { PresetSettingsPatch, PresetTemplateMap } from "./presets/shared.ts";
import type { SeedItem } from "./seeds.ts";
/** Parameter value types the engine understands. */
export type PresetParameterType = "string" | "enum" | "secret";
/**
 * One declared preset parameter.
 *
 * The declaration is the single source of truth: every binding occurrence in
 * the preset's settings, templates and seeds resolves against it, and the
 * resolved native fields are validated by the existing preset-validation and
 * host settings-audit paths.
 */
export interface PresetParameter {
    /** Stable parameter name used in `${param:<name>}` occurrences and `--param`. */
    readonly name: string;
    /** Value domain; `secret` accepts external references in secret_references only. */
    readonly type: PresetParameterType;
    /** True when apply refuses without a supplied value or default. */
    readonly required: boolean;
    /** Short, bounded description shown by `presets show` and in refusals. */
    readonly description?: string;
    /** Value used when the caller supplies none. Refused for `secret` parameters. */
    readonly default?: string;
    /** Full-match regex source for `string` values (e.g. "^[a-z][a-z0-9-]{0,15}$"). */
    readonly pattern?: string;
    /** Bound for supplied and default values; 1..1024, default 256. */
    readonly maxLength?: number;
    /** Allowed values for `enum` parameters; required for them. */
    readonly values?: readonly string[];
}
/** A preset's parameter manifest: every parameter declared exactly once. */
export type PresetParameterManifest = readonly PresetParameter[];
/** Stable refusal categories agents can branch on without parsing prose. */
export type ParameterRefusalCode = "stale_artifacts" | "invalid_artifact_record" | "artifact_unreadable" | "artifact_capability_missing" | "artifact_write_failed" | "invalid_manifest" | "invalid_param_flag" | "invalid_params_file" | "unknown_parameter" | "unanswered_parameter" | "invalid_value" | "invalid_secret_reference" | "unavailable_secret_reference" | "unknown_binding" | "malformed_binding" | "secret_in_public_prose" | "invalid_binding_location";
/**
 * Actionable, privacy-safe refusal.
 *
 * Mirrors the package's established refusal pattern: a stable machine-readable
 * {@link code}, a concrete {@link remedy}, and a usage-class {@link exitCode}.
 * Refusals NEVER contain secret values. Commands display external references
 * and never dereference them.
 */
export declare class ParameterRefusal extends Error {
    /** Machine-readable failure category. */
    readonly code: ParameterRefusalCode;
    /** Concrete next action for the caller. */
    readonly remedy: string;
    /** Usage-class exit status; never zero (a refusal is not a success). */
    readonly exitCode = 2;
    /** Construct a refusal without echoing secret values. */
    constructor(code: ParameterRefusalCode, remedy: string);
}
/** Compact, bounded view of one declared parameter for `presets show`. */
export interface PresetParameterView {
    readonly name: string;
    readonly type: PresetParameterType;
    readonly required: boolean;
    readonly hasDefault: boolean;
    /** Default value; omitted for `secret` parameters. */
    readonly default?: string;
    readonly description?: string;
    /** Declared pattern source for `string` parameters. */
    readonly pattern?: string;
    /** Declared allowed values for `enum` parameters. */
    readonly values?: readonly string[];
    /** True when neither a supplied value nor a default answers this parameter. */
    readonly unanswered: boolean;
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
export declare function validateParameterManifest(manifest: PresetParameterManifest): void;
/** True only for an explicit environment reference; never inspect its value here. */
export declare function isSecretReference(value: unknown): boolean;
/** Resolve an external reference at the consuming operation, in memory only.
 * Apply, catalog, diff and planning never call this function or need credentials.
 * The caller must not persist or emit the result.
 */
export declare function resolveSecretReference(reference: string): string;
/** The resolved outcome of a manifest against caller-supplied values. */
export interface ResolvedParameterValues {
    /** Effective value per answered parameter (supplied or default). */
    readonly values: Readonly<Record<string, string>>;
    /** Where each effective value came from. */
    readonly sources: Readonly<Record<string, "supplied" | "default">>;
    /** Declared parameters with neither a supplied value nor a default (lenient collection only). */
    readonly unanswered: readonly string[];
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
export declare function collectParameterValues(manifest: PresetParameterManifest, supplied: Readonly<Record<string, string>>): ResolvedParameterValues;
/**
 * Resolve a manifest against caller-supplied values.
 *
 * The strict boundary every write path uses: `unknown_parameter` for
 * undeclared names, `unanswered_parameter` listing every required choice
 * without a value or default, `invalid_value` for constraint violations.
 * Pure: reads nothing, writes nothing.
 */
export declare function resolveParameterValues(manifest: PresetParameterManifest, supplied: Readonly<Record<string, string>>): ResolvedParameterValues;
/**
 * Re-validate a pre-resolved value set (e.g. injected by a command that
 * already resolved them at its boundary) against the manifest.
 *
 * Ensures a threaded-in result still declares only manifest parameters with
 * constraint-satisfying values, every required parameter is answered, and the
 * sources are well-formed — so a downstream consumer can trust values it did
 * not resolve itself without re-reading any input.
 */
export declare function assertResolvedParameterValues(manifest: PresetParameterManifest, resolved: ResolvedParameterValues): void;
/**
 * Replace every occurrence of any supplied secret value with `<redacted>`.
 *
 * The single redaction primitive for every emitted surface (dry-run patch
 * dumps, diff results): privacy-safe in both directions — it can never reveal a
 * secret, and it only ever matches exact secret values.
 */
export declare function redactSecretValues(text: string, secretValues: readonly string[]): string;
/**
 * Redact secret values in a structured JSON value, BEFORE serialization.
 *
 * Redaction must always operate on VALUES, never on serialized text: a secret
 * containing quotes or backslashes appears JSON-escaped in the serialized form
 * (`abc\"def`) and a text-level match silently misses it. This walker redacts
 * every string that contains a secret, inside plain objects and dense arrays
 * alike, cloning as it goes so the input is never mutated.
 */
export declare function redactSecretValuesDeep(value: unknown, secretValues: readonly string[]): unknown;
/**
 * Dotted settings paths that are secret-capable or bind a secret parameter.
 *
 * Value-based redaction alone cannot protect a rotated credential: the stored
 * workspace value is a DIFFERENT string than the currently supplied secret, so
 * nothing matches it. These paths identify every settings leaf the preset's
 * authored content binds a `secret`-typed parameter into, plus every leaf of
 * the explicit secret_references destination even for static references and
 * empty manifests. Emitted surfaces redact those leaves regardless of the
 * value they currently hold. Arrays are atomic (mirroring the diff's model).
 */
export declare function collectSecretSettingPaths(settings: PresetSettingsPatch, manifest: PresetParameterManifest): string[];
/** Build the compact parameter views for `presets show` (secrets never show defaults). */
export declare function buildParameterViews(manifest: PresetParameterManifest, supplied?: Readonly<Record<string, string>>): PresetParameterView[];
/** Parse repeated `--param <name>=<value>` flag entries.
 *
 * Accepts the loose-option shapes the host can deliver (string or string[]).
 * Each entry must split at the first `=` into a declared-shape name and a
 * non-empty value; duplicate names are refused (a repeated parameter is an
 * invocation mistake, not an override).
 */
export declare function parseParameterFlagEntries(raw: unknown): Array<{
    name: string;
    value: string;
}>;
/**
 * Read a `--params-file` JSON document of supplied parameter values.
 *
 * One strict boundary schema: a bounded plain JSON object whose every value is
 * a string. Anything else (arrays, nested objects, non-string values,
 * duplicate keys after trimming, oversized files) is a typed refusal before any
 * read of tracker state.
 */
export declare function parseParamsFile(text: string): Record<string, string>;
/**
 * Read supplied parameters from command options (both spelling variants).
 *
 * Combines `--param` entries and one `--params-file`; a name supplied through
 * both is a refusal. The file is read exactly once, here, before any tracker
 * state is touched.
 */
export declare function readSuppliedParameterValues(options: Readonly<Record<string, unknown>>): Record<string, string>;
/** One binding occurrence found while scanning a preset's values. */
export interface ParameterBindingOccurrence {
    readonly parameter: string;
    /** Human-readable location, e.g. "settings.id_prefix" or "templates.initiative.options.tags". */
    readonly location: string;
}
/**
 * Resolve a preset's settings patch against resolved parameter values.
 *
 * Returns a substituted deep copy; the input is never mutated. Secret
 * references are allowed only as entire leaves in the explicit secret_references map.
 */
export declare function resolveSettingsWithParameters(manifest: PresetParameterManifest, values: Readonly<Record<string, string>>, settings: PresetSettingsPatch, allowUnresolved?: boolean): {
    settings: PresetSettingsPatch;
    occurrences: number;
};
/**
 * Resolve a preset's template map against resolved parameter values.
 *
 * Template documents are PUBLIC: a secret binding anywhere in them (including
 * the `name`, which additionally must stay binding-free because it becomes a
 * file name) is refused with {@link ParameterRefusal} before any write.
 */
export declare function resolveTemplatesWithParameters(manifest: PresetParameterManifest, values: Readonly<Record<string, string>>, templates: PresetTemplateMap, allowUnresolved?: boolean): {
    templates: PresetTemplateMap;
    occurrences: number;
};
/**
 * Resolve a preset's seed items against resolved parameter values.
 *
 * Seed items become PUBLIC tracker prose, so a secret binding in ANY seed field
 * is refused; the refusal names the parameter and location but never a value.
 */
export declare function resolveSeedsWithParameters(manifest: PresetParameterManifest, values: Readonly<Record<string, string>>, seeds: readonly SeedItem[], allowUnresolved?: boolean): {
    seeds: SeedItem[];
    occurrences: number;
};
/**
 * Resolve every preset part against resolved parameter values in one call.
 *
 * Used by the apply path so settings, templates and seeds resolve against the
 * SAME effective values (one supplied project parameter reaches every declared
 * occurrence), with all refusals raised before any write. Passing
 * `allowUnresolved` switches to declaration mode: occurrences of declared-but-
 * unanswered parameters stay authored for inspection surfaces.
 */
export declare function resolveParameterizedPreset(manifest: PresetParameterManifest, values: Readonly<Record<string, string>>, parts: {
    readonly settings?: PresetSettingsPatch;
    readonly templates?: PresetTemplateMap;
    readonly seeds?: readonly SeedItem[];
}, allowUnresolved?: boolean): {
    settings?: PresetSettingsPatch;
    templates?: PresetTemplateMap;
    seeds?: SeedItem[];
    occurrences: number;
};
//# sourceMappingURL=params.d.ts.map