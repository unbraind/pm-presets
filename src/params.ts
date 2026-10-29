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

import { readBoundedInputFile } from "./input-file.ts";
import { setJsonProperty } from "./json-object.ts";
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
export type ParameterRefusalCode =
  | "invalid_manifest"
  | "invalid_param_flag"
  | "invalid_params_file"
  | "unknown_parameter"
  | "unanswered_parameter"
  | "invalid_value"
  | "invalid_secret_reference"
  | "unavailable_secret_reference"
  | "unknown_binding"
  | "malformed_binding"
  | "secret_in_public_prose"
  | "invalid_binding_location";

/**
 * Actionable, privacy-safe refusal.
 *
 * Mirrors the package's established refusal pattern: a stable machine-readable
 * {@link code}, a concrete {@link remedy}, and a usage-class {@link exitCode}.
 * Refusals NEVER contain secret values. Commands display external references
 * and never dereference them.
 */
export class ParameterRefusal extends Error {
  /** Machine-readable failure category. */
  readonly code: ParameterRefusalCode;
  /** Concrete next action for the caller. */
  readonly remedy: string;
  /** Usage-class exit status; never zero (a refusal is not a success). */
  readonly exitCode = 2;
  /** Construct a refusal without echoing secret values. */
  constructor(code: ParameterRefusalCode, remedy: string) {
    super(`${code}: ${remedy}`);
    this.name = "ParameterRefusal";
    this.code = code;
    this.remedy = remedy;
  }
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
function assertPlainValue(name: string, raw: string, type: PresetParameterType): string {
  const value = raw.trim();
  if (value.length === 0) {
    throw new ParameterRefusal("invalid_value", `Parameter '${name}' must be a non-empty value (supply --param ${name}=<value>).`);
  }
  if (CONTROL_CHARACTERS.test(raw)) {
    throw new ParameterRefusal(
      "invalid_value",
      `Parameter '${name}' must not contain control characters or line breaks${type === "secret" ? " (secret value rejected without echoing)" : ""}.`,
    );
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
export function validateParameterManifest(manifest: PresetParameterManifest): void {
  if (!Array.isArray(manifest) || manifest.length > MAX_MANIFEST_PARAMETERS) {
    throw new ParameterRefusal("invalid_manifest", `A parameter manifest declares at most ${MAX_MANIFEST_PARAMETERS} parameters.`);
  }
  if (manifest.length === 0) {
    return; // An empty manifest is the explicit "no parameters" declaration.
  }
  const seen = new Set<string>();
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
        || parameter.values.some((value: string) => typeof value !== "string" || value.trim() === "" || value.trim() !== value)
        || new Set(parameter.values).size !== parameter.values.length) {
        throw new ParameterRefusal("invalid_manifest", `Enum parameter '${parameter.name}' must declare unique, non-empty trimmed allowed values.`);
      }
    } else if (parameter.values !== undefined) {
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
        normalizeParameterValue(parameter, parameter.default);
      } catch (error) {
        throw new ParameterRefusal(
          "invalid_manifest",
          `Parameter '${parameter.name}' declares a default that violates its own constraints (${(error as ParameterRefusal).remedy}).`,
        );
      }
    }
  }
}

/** True when the pattern source compiles as a full-match regular expression. */
function isCompilingFullMatchPattern(source: string): boolean {
  try {
    new RegExp(`^(?:${source})$`);
    return true;
  } catch {
    return false;
  }
}

/** Apply the parameter's own constraints (length, enum, pattern) to one value. */
function assertValueConstraints(parameter: PresetParameter, value: string): void {
  const maxLength = parameter.maxLength ?? DEFAULT_MAX_VALUE_LENGTH;
  if (value.length > maxLength) {
    throw new ParameterRefusal("invalid_value", `Parameter '${parameter.name}' must be at most ${maxLength} character(s).`);
  }
  if (parameter.type === "enum" && !(parameter.values as readonly string[]).includes(value)) {
    throw new ParameterRefusal(
      "invalid_value",
      `Parameter '${parameter.name}' must be one of: ${(parameter.values as readonly string[]).join(", ")}.`,
    );
  }
  if (parameter.type === "string" && parameter.pattern !== undefined && !new RegExp(`^(?:${parameter.pattern})$`).test(value)) {
    throw new ParameterRefusal("invalid_value", `Parameter '${parameter.name}' must match ${parameter.pattern}.`);
  }
}

/** True only for an explicit environment reference; never inspect its value here. */
export function isSecretReference(value: unknown): boolean {
  return typeof value === "string" && value.trim() === value && /^@[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

/** Resolve an external reference at the consuming operation, in memory only.
 * Apply, catalog, diff and planning never call this function or need credentials.
 * The caller must not persist or emit the result.
 */
export function resolveSecretReference(reference: string): string {
  if (!isSecretReference(reference)) {
    throw new ParameterRefusal("invalid_secret_reference", "Supply a secret reference as @ENV_NAME; keep the credential in the environment, outside the tracker.");
  }
  const name = reference.slice(1);
  const value = Object.hasOwn(process.env, name) ? process.env[name] : undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new ParameterRefusal("unavailable_secret_reference", "Set the referenced environment variable before the consuming operation; keep its value outside the tracker.");
  }
  return value;
}

/** Normalize and validate the exact value that every downstream consumer receives. */
function normalizeParameterValue(parameter: PresetParameter, raw: string): string {
  const value = assertPlainValue(parameter.name, raw, parameter.type);
  assertValueConstraints(parameter, value);
  if (parameter.type === "secret" && !isSecretReference(value)) {
    throw new ParameterRefusal("invalid_secret_reference", "Supply a secret reference as @ENV_NAME; literal credentials are refused. Keep the credential outside the tracker.");
  }
  if (value.includes(BINDING_PREFIX)) {
    throw new ParameterRefusal("invalid_value", "Parameter values must not contain parameter binding syntax.");
  }
  return value;
}

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
export function collectParameterValues(
  manifest: PresetParameterManifest,
  supplied: Readonly<Record<string, string>>,
): ResolvedParameterValues {
  validateParameterManifest(manifest);
  for (const name of Object.keys(supplied)) {
    if (!manifest.some((parameter) => parameter.name === name)) {
      const declared = manifest.map((parameter) => parameter.name).join(", ");
      throw new ParameterRefusal(
        "unknown_parameter",
        `Parameter '${name}' is not declared by this preset. Declared: ${declared || "(none)"}.`,
      );
    }
  }
  const values: Record<string, string> = {};
  const sources: Record<string, "supplied" | "default"> = {};
  const unanswered: string[] = [];
  for (const parameter of manifest) {
    const raw = Object.hasOwn(supplied, parameter.name) ? supplied[parameter.name] : undefined;
    if (raw === undefined) {
      if (parameter.default !== undefined) {
        values[parameter.name] = normalizeParameterValue(parameter, parameter.default);
        sources[parameter.name] = "default";
      } else {
        unanswered.push(parameter.name);
      }
      continue;
    }
    if (typeof raw !== "string") {
      throw new ParameterRefusal("invalid_value", `Parameter '${parameter.name}' must be supplied as a string value.`);
    }
    const value = normalizeParameterValue(parameter, raw);
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
export function resolveParameterValues(
  manifest: PresetParameterManifest,
  supplied: Readonly<Record<string, string>>,
): ResolvedParameterValues {
  const resolved = collectParameterValues(manifest, supplied);
  if (resolved.unanswered.some((name) => manifest.find((parameter) => parameter.name === name)?.required)) {
    const required = resolved.unanswered.filter(
      (name) => manifest.find((parameter) => parameter.name === name)?.required,
    );
    throw new ParameterRefusal(
      "unanswered_parameter",
      `Unanswered required parameter(s): ${required.join(", ")}. Supply --param <name>=<value> (or a --params-file) for each before applying; see 'pm presets show <id>'.`,
    );
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
export function assertResolvedParameterValues(
  manifest: PresetParameterManifest,
  resolved: ResolvedParameterValues,
): void {
  validateParameterManifest(manifest);
  for (const [name, value] of Object.entries(resolved.values)) {
    const parameter = manifest.find((entry) => entry.name === name);
    if (!parameter) {
      throw new ParameterRefusal("unknown_parameter", `Parameter '${name}' is not declared by this preset.`);
    }
    if (typeof value !== "string") {
      throw new ParameterRefusal("invalid_value", `Parameter '${name}' must be a string value.`);
    }
    if (normalizeParameterValue(parameter, value) !== value) {
      throw new ParameterRefusal("invalid_value", `Parameter '${name}' must already be normalized in an injected resolution.`);
    }
    const source = Object.hasOwn(resolved.sources, name) ? resolved.sources[name] : undefined;
    if (source !== "supplied" && source !== "default") {
      throw new ParameterRefusal("invalid_value", `Parameter '${name}' has an invalid resolution source.`);
    }
  }
  for (const parameter of manifest) {
    if (parameter.required && !Object.hasOwn(resolved.values, parameter.name)) {
      throw new ParameterRefusal(
        "unanswered_parameter",
        `Unanswered required parameter(s): ${parameter.name}. Supply --param <name>=<value> (or a --params-file) before applying.`,
      );
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
export function redactSecretValues(text: string, secretValues: readonly string[]): string {
  let result = text;
  for (const secret of secretValues) {
    if (secret.length > 0) {
      result = result.split(secret).join("<redacted>");
    }
  }
  return result;
}

/**
 * Redact secret values in a structured JSON value, BEFORE serialization.
 *
 * Redaction must always operate on VALUES, never on serialized text: a secret
 * containing quotes or backslashes appears JSON-escaped in the serialized form
 * (`abc\"def`) and a text-level match silently misses it. This walker redacts
 * every string that contains a secret, inside plain objects and dense arrays
 * alike, cloning as it goes so the input is never mutated.
 */
export function redactSecretValuesDeep(value: unknown, secretValues: readonly string[]): unknown {
  if (typeof value === "string") {
    return redactSecretValues(value, secretValues);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecretValuesDeep(entry, secretValues));
  }
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      setJsonProperty(copy, key, redactSecretValuesDeep(entry, secretValues));
    }
    return copy;
  }
  return structuredClone(value);
}

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
export function collectSecretSettingPaths(
  settings: PresetSettingsPatch,
  manifest: PresetParameterManifest,
): string[] {
  const secretNames = new Set(
    manifest.filter((parameter) => parameter.type === "secret").map((parameter) => parameter.name),
  );
  const paths: string[] = [];
  const walk = (value: unknown, prefix: string): void => {
    const secretDestination = prefix === "secret_references" || prefix.startsWith("secret_references.");
    if (typeof value === "string") {
      const scan = scanString(value, prefix);
      if (secretDestination || scan.occurrences.some((occurrence) => secretNames.has(occurrence.parameter))) {
        paths.push(prefix);
      }
      return;
    }
    if (Array.isArray(value)) {
      // Arrays are atomic leaves in the settings model: a secret bound
      // anywhere inside one marks the WHOLE leaf for wholesale redaction.
      if (secretDestination || containsSecretBinding(value, secretNames)) {
        paths.push(prefix);
      }
      return;
    }
    if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      for (const [key, entry] of Object.entries(value)) {
        walk(entry, prefix ? `${prefix}.${key}` : key);
      }
    } else if (secretDestination) {
      paths.push(prefix);
    }
  };
  walk(settings, "");
  return paths.sort((left, right) => left.localeCompare(right));
}

/** True when any string inside `value` (recursively) binds a secret parameter. */
function containsSecretBinding(value: unknown, secretNames: ReadonlySet<string>): boolean {
  if (typeof value === "string") {
    return scanString(value, "array").occurrences.some((occurrence) => secretNames.has(occurrence.parameter));
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsSecretBinding(entry, secretNames));
  }
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value).some((entry) => containsSecretBinding(entry, secretNames));
  }
  return false;
}

/** Build the compact parameter views for `presets show` (secrets never show defaults). */
export function buildParameterViews(
  manifest: PresetParameterManifest,
  supplied?: Readonly<Record<string, string>>,
): PresetParameterView[] {
  validateParameterManifest(manifest);
  return manifest.map((parameter) => {
    const answered = supplied !== undefined && Object.hasOwn(supplied, parameter.name);
    const view: {
      name: string; type: PresetParameterType; required: boolean; hasDefault: boolean;
      default?: string; description?: string; pattern?: string; values?: readonly string[]; unanswered: boolean;
    } = {
      name: parameter.name,
      type: parameter.type,
      required: parameter.required,
      hasDefault: parameter.default !== undefined,
      unanswered: parameter.required && !answered && parameter.default === undefined,
    };
    if (parameter.type !== "secret" && parameter.default !== undefined) {
      view.default = normalizeParameterValue(parameter, parameter.default);
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
export function parseParameterFlagEntries(raw: unknown): Array<{ name: string; value: string }> {
  const entries: Array<{ name: string; value: string }> = [];
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
export function parseParamsFile(text: string): Record<string, string> {
  if (Buffer.byteLength(text, "utf8") > MAX_PARAMS_FILE_BYTES) {
    throw new ParameterRefusal("invalid_params_file", `The params file must be at most ${MAX_PARAMS_FILE_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new ParameterRefusal("invalid_params_file", "The params file must be a JSON object of parameter names to string values.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) {
    throw new ParameterRefusal("invalid_params_file", "The params file must be a JSON object of parameter names to string values.");
  }
  const supplied: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
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
export function readSuppliedParameterValues(options: Readonly<Record<string, unknown>>): Record<string, string> {
  const flags = parseParameterFlagEntries(options.param);
  const file = options.paramsFile !== undefined ? options.paramsFile : options["params-file"];
  const supplied: Record<string, string> = {};
  for (const entry of flags) {
    supplied[entry.name] = entry.value;
  }
  if (typeof file === "string" && file.trim().length > 0) {
    let text: string;
    try { text = readBoundedInputFile(file.trim(), MAX_PARAMS_FILE_BYTES); }
    catch {
      throw new ParameterRefusal("invalid_params_file", `Use a readable regular JSON params file no larger than ${MAX_PARAMS_FILE_BYTES} bytes.`);
    }
    const fromFile = parseParamsFile(text);
    for (const [name, value] of Object.entries(fromFile)) {
      if (Object.hasOwn(supplied, name)) {
        throw new ParameterRefusal("invalid_param_flag", `Parameter '${name}' supplied by both --param and the params file; keep one.`);
      }
      supplied[name] = value;
    }
  } else if (file !== undefined && file !== null) {
    throw new ParameterRefusal("invalid_params_file", "--params-file takes a path to a JSON object of parameter values.");
  }
  return supplied;
}

/** One binding occurrence found while scanning a preset's values. */
export interface ParameterBindingOccurrence {
  readonly parameter: string;
  /** Human-readable location, e.g. "settings.id_prefix" or "templates.initiative.options.tags". */
  readonly location: string;
}

/** Scan one string for binding tokens; returns well-formed and malformed finds. */
function scanString(value: string, location: string): { occurrences: ParameterBindingOccurrence[]; malformed: boolean } {
  const occurrences: ParameterBindingOccurrence[] = [];
  let malformed = false;
  let cursor = value.indexOf(BINDING_PREFIX);
  while (cursor >= 0) {
    const nameStart = cursor + BINDING_PREFIX.length;
    const end = value.indexOf("}", nameStart);
    if (end < 0) {
      malformed = true;
    } else {
      const name = value.slice(nameStart, end);
      if (!PARAMETER_NAME_PATTERN.test(name)) {
        malformed = true;
      } else {
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
 * preset's authored content without answering its parameters. Final strings
 * may retain only those authored unanswered tokens: substitution must never
 * assemble new binding syntax across value or literal boundaries.
 */
function substituteString(
  value: string,
  location: string,
  values: Readonly<Record<string, string>>,
  declared: ReadonlySet<string>,
  allowUnresolved: boolean,
): { result: string; occurrences: number } {
  let result = value;
  let occurrences = 0;
  const authoredUnresolvedOffsets = new Set<number>();
  let cursor = result.indexOf(BINDING_PREFIX);
  while (cursor >= 0) {
    const nameStart = cursor + BINDING_PREFIX.length;
    const end = result.indexOf("}", nameStart);
    if (end < 0 || !PARAMETER_NAME_PATTERN.test(result.slice(nameStart, end))) {
      throw new ParameterRefusal(
        "malformed_binding",
        `Malformed parameter binding at ${location}: use the exact form \${param:<name>}.`,
      );
    }
    const name = result.slice(nameStart, end);
    if (!declared.has(name)) {
      throw new ParameterRefusal("unknown_binding", `Binding at ${location} is not declared by the preset's parameter manifest.`);
    }
    if (!Object.hasOwn(values, name)) {
      if (!allowUnresolved) {
        throw new ParameterRefusal(
          "unanswered_parameter",
          `Binding \${param:${name}} at ${location} has no supplied value or default. Supply --param ${name}=<value> (or a --params-file) before applying.`,
        );
      }
      // Declaration mode: keep the authored occurrence for inspection.
      authoredUnresolvedOffsets.add(cursor);
      cursor = result.indexOf(BINDING_PREFIX, end + 1);
      continue;
    }
    result = result.slice(0, cursor) + values[name] + result.slice(end + 1);
    occurrences += 1;
    cursor = result.indexOf(BINDING_PREFIX, cursor + values[name].length);
  }
  for (let remaining = result.indexOf(BINDING_PREFIX); remaining >= 0;
    remaining = result.indexOf(BINDING_PREFIX, remaining + BINDING_PREFIX.length)) {
    if (!authoredUnresolvedOffsets.has(remaining)) {
      throw new ParameterRefusal("invalid_value", "Parameter substitution must not assemble new binding syntax; change the values or surrounding text.");
    }
  }
  return { result, occurrences };
}

/** Substitute a tree whose field names were checked by collectOccurrences; arrays stay dense. */
function substituteTree(
  value: unknown,
  location: string,
  values: Readonly<Record<string, string>>,
  declared: ReadonlySet<string>,
  allowUnresolved: boolean,
  counter: { occurrences: number },
): unknown {
  if (typeof value === "string") {
    const { result, occurrences } = substituteString(value, location, values, declared, allowUnresolved);
    counter.occurrences += occurrences;
    return result;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      substituteTree(entry, `${location}[${index}]`, values, declared, allowUnresolved, counter),
    );
  }
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      setJsonProperty(copy, key, substituteTree(entry, `${location}.${key}`, values, declared, allowUnresolved, counter));
    }
    return copy;
  }
  if (value !== null && typeof value === "object") {
    throw new ParameterRefusal("invalid_manifest", "Bindings require plain JSON objects and arrays; unsupported objects cannot bypass validation.");
  }
  return structuredClone(value);
}

/** Refuse secret occurrences inside public prose (templates and seeds). */
function refuseSecretsInProse(occurrences: ParameterBindingOccurrence[], secretNames: ReadonlySet<string>, target: string): void {
  for (const occurrence of occurrences) {
    if (secretNames.has(occurrence.parameter)) {
      throw new ParameterRefusal(
        "secret_in_public_prose",
        `Secret parameter '${occurrence.parameter}' is bound at ${occurrence.location}; ${target} are public. Bind secret references only into settings.secret_references.<name>; public destinations are never secret-capable.`,
      );
    }
  }
}

/** The declared parameter names of a manifest, for binding-name classification. */
function declaredNames(manifest: PresetParameterManifest): ReadonlySet<string> {
  return new Set(manifest.map((parameter) => parameter.name));
}

/** Collect all binding occurrences in a preset part for reporting and refusal. */
function collectOccurrences(
  value: unknown,
  location: string,
  occurrences: ParameterBindingOccurrence[],
  malformedLocations: string[],
  nativeKeys = false,
): void {
  if (typeof value === "string") {
    const scan = scanString(value, location);
    occurrences.push(...scan.occurrences);
    if (scan.malformed) {
      malformedLocations.push(location);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectOccurrences(entry, `${location}[${index}]`, occurrences, malformedLocations, nativeKeys));
    return;
  }
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, entry] of Object.entries(value)) {
      if (nativeKeys && (key.length === 0 || key.trim() !== key || key === "__proto__")) {
        throw new ParameterRefusal("invalid_manifest", "Use nonempty trimmed template/seed field names; rename '__proto__' because supported host readers cannot preserve it.");
      }
      if (key.includes(BINDING_PREFIX)) throw new ParameterRefusal("invalid_binding_location", "Parameter bindings cannot appear in field or file names.");
      collectOccurrences(entry, `${location}.${key}`, occurrences, malformedLocations, nativeKeys);
    }
  }
}

/**
 * Resolve a preset's settings patch against resolved parameter values.
 *
 * Returns a substituted deep copy; the input is never mutated. Secret
 * references are allowed only as entire leaves in the explicit secret_references map.
 */
export function resolveSettingsWithParameters(
  manifest: PresetParameterManifest,
  values: Readonly<Record<string, string>>,
  settings: PresetSettingsPatch,
  allowUnresolved = false,
): { settings: PresetSettingsPatch; occurrences: number } {
  const effectiveValues = collectParameterValues(manifest, values).values;
  const occurrences: ParameterBindingOccurrence[] = [];
  collectOccurrences(settings, "settings", occurrences, []);
  const secretNames = new Set(manifest.filter((parameter) => parameter.type === "secret").map((parameter) => parameter.name));
  for (const occurrence of occurrences) {
    if (secretNames.has(occurrence.parameter)) {
      const key = occurrence.location.slice("settings.secret_references.".length);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
        || occurrence.location !== `settings.secret_references.${key}`
        || settings.secret_references?.[key] !== `\${param:${occurrence.parameter}}`) {
        throw new ParameterRefusal("secret_in_public_prose", "Secret references may bind only as entire values in settings.secret_references.<name>; identifiers and tracked prose are never secret-capable.");
      }
    }
  }
  if (settings.secret_references !== undefined) {
    if (settings.secret_references === null || typeof settings.secret_references !== "object" || Array.isArray(settings.secret_references)) {
      throw new ParameterRefusal("invalid_secret_reference", "settings.secret_references must be a map of names to @ENV_NAME references.");
    }
    for (const [key, reference] of Object.entries(settings.secret_references)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof reference !== "string") {
        throw new ParameterRefusal("invalid_secret_reference", "settings.secret_references must use static names and string references.");
      }
      if (!isSecretReference(reference) && !/^\$\{param:[A-Za-z][A-Za-z0-9_-]{0,31}\}$/.test(reference)) {
        throw new ParameterRefusal("invalid_secret_reference", "settings.secret_references accepts only @ENV_NAME references or secret parameter bindings.");
      }
    }
  }
  const counter = { occurrences: 0 };
  const settingsResult = substituteTree(
    settings,
    "settings",
    effectiveValues,
    declaredNames(manifest),
    allowUnresolved,
    counter,
  ) as PresetSettingsPatch;
  for (const reference of Object.values(settingsResult.secret_references ?? {})) {
    if (!isSecretReference(reference) && !(allowUnresolved && reference.startsWith(BINDING_PREFIX))) {
      throw new ParameterRefusal("invalid_secret_reference", "settings.secret_references accepts only @ENV_NAME references.");
    }
  }
  return { settings: settingsResult, occurrences: counter.occurrences };
}

/**
 * Resolve a preset's template map against resolved parameter values.
 *
 * Template documents are PUBLIC: a secret binding anywhere in them (including
 * the `name`, which additionally must stay binding-free because it becomes a
 * file name) is refused with {@link ParameterRefusal} before any write.
 */
export function resolveTemplatesWithParameters(
  manifest: PresetParameterManifest,
  values: Readonly<Record<string, string>>,
  templates: PresetTemplateMap,
  allowUnresolved = false,
): { templates: PresetTemplateMap; occurrences: number } {
  const effectiveValues = collectParameterValues(manifest, values).values;
  const secretNames = new Set(manifest.filter((parameter) => parameter.type === "secret").map((parameter) => parameter.name));
  const occurrences: ParameterBindingOccurrence[] = [];
  const malformed: string[] = [];
  collectOccurrences(templates, "templates", occurrences, malformed, true);
  if (malformed.length > 0) {
    throw new ParameterRefusal("malformed_binding", `Malformed parameter binding in template(s): ${malformed.join(", ")}.`);
  }
  for (const [filename, document] of Object.entries(templates)) {
    const nameScan = scanString(document.name, `templates.${filename}.name`);
    if (nameScan.occurrences.length > 0) {
      throw new ParameterRefusal(
        "invalid_binding_location",
        `Template file '${filename}' has a binding in its name; template names become file names and must be static.`,
      );
    }
  }
  refuseSecretsInProse(occurrences, secretNames, "templates");
  const counter = { occurrences: 0 };
  const resolved = substituteTree(templates, "templates", effectiveValues, declaredNames(manifest), allowUnresolved, counter) as PresetTemplateMap;
  return { templates: resolved, occurrences: counter.occurrences };
}

/**
 * Resolve a preset's seed items against resolved parameter values.
 *
 * Seed items become PUBLIC tracker prose, so a secret binding in ANY seed field
 * is refused; the refusal names the parameter and location but never a value.
 */
export function resolveSeedsWithParameters(
  manifest: PresetParameterManifest,
  values: Readonly<Record<string, string>>,
  seeds: readonly SeedItem[],
  allowUnresolved = false,
): { seeds: SeedItem[]; occurrences: number } {
  const effectiveValues = collectParameterValues(manifest, values).values;
  const secretNames = new Set(manifest.filter((parameter) => parameter.type === "secret").map((parameter) => parameter.name));
  const occurrences: ParameterBindingOccurrence[] = [];
  const malformed: string[] = [];
  collectOccurrences(seeds, "seeds", occurrences, malformed, true);
  if (malformed.length > 0) {
    throw new ParameterRefusal("malformed_binding", `Malformed parameter binding in seed(s): ${malformed.join(", ")}.`);
  }
  refuseSecretsInProse(occurrences, secretNames, "generated public seed prose");
  const counter = { occurrences: 0 };
  const resolved = substituteTree(seeds, "seeds", effectiveValues, declaredNames(manifest), allowUnresolved, counter) as SeedItem[];
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
export function resolveParameterizedPreset(
  manifest: PresetParameterManifest,
  values: Readonly<Record<string, string>>,
  parts: {
    readonly settings?: PresetSettingsPatch;
    readonly templates?: PresetTemplateMap;
    readonly seeds?: readonly SeedItem[];
  },
  allowUnresolved = false,
): {
  settings?: PresetSettingsPatch;
  templates?: PresetTemplateMap;
  seeds?: SeedItem[];
  occurrences: number;
} {
  collectParameterValues(manifest, values);
  let occurrences = 0;
  const result: { settings?: PresetSettingsPatch; templates?: PresetTemplateMap; seeds?: SeedItem[] } = {};
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
