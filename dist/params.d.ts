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
    /** Value domain; `secret` may bind ONLY into settings leaves. */
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
export type ParameterRefusalCode = "invalid_manifest" | "invalid_param_flag" | "invalid_params_file" | "unknown_parameter" | "unanswered_parameter" | "invalid_value" | "unknown_binding" | "malformed_binding" | "secret_in_public_prose" | "invalid_binding_location";
/**
 * Actionable, privacy-safe refusal.
 *
 * Mirrors the package's established refusal pattern: a stable machine-readable
 * {@link code}, a concrete {@link remedy}, and a usage-class {@link exitCode}.
 * Refusals NEVER contain secret values (secrets render as `<redacted>` when a
 * parameter has to be named with its value class at all).
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
/** The resolved outcome of a manifest against caller-supplied values. */
export interface ResolvedParameterValues {
    /** Effective value per declared parameter (supplied or default). */
    readonly values: Readonly<Record<string, string>>;
    /** Where each effective value came from. */
    readonly sources: Readonly<Record<string, "supplied" | "default">>;
}
/**
 * Resolve a manifest against caller-supplied values.
 *
 * The strict boundary: every supplied key must be declared
 * (`unknown_parameter`), every required parameter must be answered by a
 * supplied value or a default (`unanswered_parameter`, listing ALL unanswered
 * choices and their remedies), and every value must satisfy its parameter's own
 * constraints (`invalid_value`). Pure: reads nothing, writes nothing.
 */
export declare function resolveParameterValues(manifest: PresetParameterManifest, supplied: Readonly<Record<string, string>>): ResolvedParameterValues;
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
 * parameters are allowed here (settings are the private configuration surface).
 */
export declare function resolveSettingsWithParameters(manifest: PresetParameterManifest, values: Readonly<Record<string, string>>, settings: PresetSettingsPatch): {
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
export declare function resolveTemplatesWithParameters(manifest: PresetParameterManifest, values: Readonly<Record<string, string>>, templates: PresetTemplateMap): {
    templates: PresetTemplateMap;
    occurrences: number;
};
/**
 * Resolve a preset's seed items against resolved parameter values.
 *
 * Seed items become PUBLIC tracker prose, so a secret binding in ANY seed field
 * is refused; the refusal names the parameter and location but never a value.
 */
export declare function resolveSeedsWithParameters(manifest: PresetParameterManifest, values: Readonly<Record<string, string>>, seeds: readonly SeedItem[]): {
    seeds: SeedItem[];
    occurrences: number;
};
/**
 * Resolve every preset part against resolved parameter values in one call.
 *
 * Used by the apply path so settings, templates and seeds resolve against the
 * SAME effective values (one supplied project parameter reaches every declared
 * occurrence), with all refusals raised before any write.
 */
export declare function resolveParameterizedPreset(manifest: PresetParameterManifest, values: Readonly<Record<string, string>>, parts: {
    readonly settings?: PresetSettingsPatch;
    readonly templates?: PresetTemplateMap;
    readonly seeds?: readonly SeedItem[];
}): {
    settings?: PresetSettingsPatch;
    templates?: PresetTemplateMap;
    seeds?: SeedItem[];
    occurrences: number;
};
//# sourceMappingURL=params.d.ts.map