/**
 * diff.ts — compare a pm workspace against a bundled preset definition.
 *
 * The comparison is split in two so the interesting logic stays pure and
 * unit-testable:
 *
 *   - `computePresetDiff(definition, snapshot)` is pure: it takes an already-read
 *     workspace snapshot and the preset definition and returns a structured diff.
 *   - `readWorkspaceSnapshot(pmDir)` is the only filesystem-touching part.
 *
 * What we compare:
 *   - settings.json: every leaf in the preset's settings patch (added vs changed
 *     vs already-matching),
 *   - templates: which of the preset's templates are missing / present in the
 *     workspace `templates/` directory,
 *   - item types: the custom item types the preset registers (informational —
 *     they are registered in-memory at activation, not written to disk).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { PresetDefinition } from "./catalog.ts";
import { collectParameterValues, redactSecretValuesDeep, ParameterRefusal, type PresetParameterManifest } from "./params.ts";

type JsonValue = unknown;
type JsonObject = Record<string, unknown>;

/**
 * The slice of a workspace a preset diff compares against: the parsed
 * `settings.json` (or `undefined` when it is absent or unreadable) and the
 * template file names present under `templates/`. Captured once so the diff is
 * computed against a stable snapshot rather than re-reading disk mid-compare.
 */
export interface WorkspaceSnapshot {
  /** Parsed settings.json (or `undefined` if absent/unreadable). */
  settings: JsonObject | undefined;
  /** Template names present in the workspace `templates/` directory. */
  templateNames: string[];
}

export interface SettingDiffEntry {
  /** Dotted path into settings.json, e.g. "governance.preset". */
  path: string;
  status: "add" | "change" | "match";
  preset: JsonValue;
  workspace: JsonValue;
}

export interface PresetDiff {
  presetId: string;
  /** True when applying the preset would change nothing. */
  inSync: boolean;
  settings: SettingDiffEntry[];
  templates: {
    missing: string[];
    present: string[];
  };
  /** Custom item types the preset would register (informational). */
  itemTypes: string[];
  summary: {
    settingsToAdd: number;
    settingsToChange: number;
    templatesMissing: number;
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Flatten a settings patch into dotted-path leaves, recursing into objects. */
function flattenLeaves(value: JsonObject, prefix = ""): Array<{ path: string; value: JsonValue }> {
  const leaves: Array<{ path: string; value: JsonValue }> = [];
  for (const [key, child] of Object.entries(value)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (isJsonObject(child)) {
      leaves.push(...flattenLeaves(child, dotted));
    } else {
      leaves.push({ path: dotted, value: child });
    }
  }
  return leaves;
}

/** Read a dotted path out of a JSON object; returns `undefined` if any hop misses. */
function readPath(root: JsonObject | undefined, dotted: string): { found: boolean; value: JsonValue } {
  if (!root) {
    return { found: false, value: undefined };
  }
  let current: JsonValue = root;
  for (const segment of dotted.split(".")) {
    if (!isJsonObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false, value: undefined };
    }
    current = (current as JsonObject)[segment];
  }
  return { found: true, value: current };
}

function valuesEqual(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Pure diff: preset definition vs an already-read workspace snapshot. */
export function computePresetDiff(
  definition: PresetDefinition,
  snapshot: WorkspaceSnapshot,
): PresetDiff {
  const presetSettings = definition.settings as unknown as JsonObject;
  const settingLeaves = flattenLeaves(presetSettings);

  const settings: SettingDiffEntry[] = settingLeaves.map((leaf) => {
    const current = readPath(snapshot.settings, leaf.path);
    if (!current.found) {
      return { path: leaf.path, status: "add", preset: leaf.value, workspace: undefined };
    }
    if (valuesEqual(current.value, leaf.value)) {
      return { path: leaf.path, status: "match", preset: leaf.value, workspace: current.value };
    }
    return { path: leaf.path, status: "change", preset: leaf.value, workspace: current.value };
  });

  const workspaceTemplates = new Set(snapshot.templateNames);
  const missing: string[] = [];
  const present: string[] = [];
  for (const template of definition.templates) {
    if (workspaceTemplates.has(template.name)) {
      present.push(template.name);
    } else {
      missing.push(template.name);
    }
  }

  const settingsToAdd = settings.filter((entry) => entry.status === "add").length;
  const settingsToChange = settings.filter((entry) => entry.status === "change").length;

  const secretPaths = new Set(definition.secretSettingPaths ?? []);
  return {
    presetId: definition.id,
    inSync: settingsToAdd === 0 && settingsToChange === 0 && missing.length === 0,
    settings: settings.map((entry) => secretPaths.has(entry.path) ? redactSettingEntry(entry) : entry),
    templates: { missing, present },
    itemTypes: definition.itemTypes.map((type) => type.name),
    summary: {
      settingsToAdd,
      settingsToChange,
      templatesMissing: missing.length,
    },
  };
}

/** Hide an entire sensitive location, including a stored value of a different shape. */
function redactSettingEntry(entry: SettingDiffEntry): SettingDiffEntry {
  return {
    ...entry,
    preset: "<redacted>",
    workspace: entry.workspace === undefined ? undefined : "<redacted>",
  };
}

/** Detect supplied secrets anywhere in a resolved leaf, including atomic arrays. */
function containsSecretValue(value: unknown, secrets: readonly string[]): boolean {
  if (typeof value === "string") return secrets.some((secret) => value.includes(secret));
  if (Array.isArray(value)) return value.some((entry) => containsSecretValue(entry, secrets));
  if (isJsonObject(value)) return Object.values(value).some((entry) => containsSecretValue(entry, secrets));
  return false;
}

/** Read the workspace snapshot from disk (the only impure part). */
export function readWorkspaceSnapshot(pmDir: string): WorkspaceSnapshot {
  const settingsPath = path.join(pmDir, "settings.json");
  let settings: JsonObject | undefined;
  if (fs.existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as unknown;
      if (isJsonObject(parsed)) {
        settings = parsed;
      }
    } catch {
      settings = undefined;
    }
  }

  const templatesDir = path.join(pmDir, "templates");
  let templateNames: string[] = [];
  if (fs.existsSync(templatesDir)) {
    templateNames = fs
      .readdirSync(templatesDir)
      .filter((entry) => entry.toLowerCase().endsWith(".json"))
      .map((entry) => entry.slice(0, -".json".length));
  }

  return { settings, templateNames };
}

/**
 * The parameterized diff surface both diff commands share.
 *
 * A diff is a preview of apply, so it resolves with the caller's supplied
 * values and refuses exactly like apply does: any required parameter still
 * unanswered refuses with the typed remedy before the workspace is read.
 * Because diff results are emitted (TOON/JSON or console), every value that
 * came from a secret-typed parameter is redacted on BOTH sides of each
 * settings entry — the preset side and the workspace side — so a diff can
 * never leak a secret into command output.
 */
export function computeParameterizedDiff(
  definition: PresetDefinition,
  manifest: PresetParameterManifest,
  supplied: Readonly<Record<string, string>>,
  snapshot: WorkspaceSnapshot,
): PresetDiff {
  const unanswered = definition.parameters.filter((view) => view.unanswered).map((view) => view.name);
  if (unanswered.length > 0) {
    throw new ParameterRefusal(
      "unanswered_parameter",
      `Unanswered required parameter(s): ${unanswered.join(", ")}. Supply --param <name>=<value> (or a --params-file) for each, or diff the default resolution by omitting --param.`,
    );
  }
  const diff = computePresetDiff(definition, snapshot);
  const values = collectParameterValues(manifest, supplied).values;
  const secrets = manifest
    .filter((parameter) => parameter.type === "secret" && Object.hasOwn(values, parameter.name))
    .map((parameter) => values[parameter.name]);
  if (secrets.length === 0) {
    return diff;
  }
  // Projected definitions retain authored provenance. For SDK callers that
  // construct resolved definitions directly, infer sensitive leaves from the
  // supplied values as well. In either case hide BOTH sides wholesale: stored
  // credentials can differ in value and JSON shape during rotation.
  const secretPaths = new Set(definition.secretSettingPaths ?? []);
  return {
    ...diff,
    settings: diff.settings.map((entry) =>
      secretPaths.has(entry.path) || containsSecretValue(entry.preset, secrets)
        ? redactSettingEntry(entry) : {
          ...entry,
          preset: redactSecretValuesDeep(entry.preset, secrets),
          workspace: redactSecretValuesDeep(entry.workspace, secrets),
        }),
  };
}
