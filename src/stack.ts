/** Catalog ownership adapter; host profile planning and settings normalization own target semantics. */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as Host from "@unbrained/pm-cli/sdk";
import type { ExtensionCommandSdk } from "@unbrained/pm-cli/sdk/authoring";
import { requirePresetDefinition, presetTemplateEntries } from "./catalog.ts";
import { PRESET_REGISTRY, type PresetId } from "./registry.ts";
import { resolvedSeedsForPreset, type SeedItem } from "./seeds.ts";
import { loadTemplateSdk, mergePresetSettings } from "./presets/shared.ts";
import { ParameterRefusal } from "./params.ts";
import { resolveSimulationSdk } from "./sdk-loader.ts";
import { setJsonProperty } from "./json-object.ts";
import { normalizeSeedArtifact } from "./desired-state.ts";
import { readSeedTypes } from "./artifact-reader.ts";

/** Select whole catalog surfaces; omitted flags select settings/templates but omit seeds. */
export interface PresetStackSelection {
  readonly preset: PresetId;
  readonly settings?: boolean;
  readonly templates?: boolean;
  readonly seeds?: boolean;
}
/** Bounded JSON request. Choices map an ownership JSON pointer to a competing preset id. */
export interface PresetStackInput {
  readonly selections: readonly PresetStackSelection[];
  readonly choices?: Readonly<Record<string, PresetId>>;
}
/** Ownership is independent of current tracker values; identical contributions share ownership. */
export interface PresetStackOwnership {
  readonly path: string;
  readonly owners: readonly PresetId[];
  readonly conflict: boolean;
  readonly choice: PresetId | "";
}
/** Safe failures omit user settings and raw provider diagnostics. */
export type StackRefusalCode = "invalid_input" | "sdk_required" | "target_unavailable" | "normalization_conflict";
/** A usage refusal carries a stable category and a concrete corrective action. */
export class StackRefusal extends Error {
  /** Machine-readable failure category. */
  readonly code: StackRefusalCode;
  /** Action to take before retrying. */
  readonly remedy: string;
  /** Expected failure recognized by the extension host. */
  readonly exitCode = 2;
  /** Construct a privacy-safe diagnostic. */
  constructor(code: StackRefusalCode, remedy: string) {
    super(`${code}: ${remedy}`);
    this.name = "StackRefusal";
    this.code = code;
    this.remedy = remedy;
  }
}
/** Complete preview; profile is the host-native portion, settingsPatch covers additional preset knobs. */
export interface PresetStackPlan {
  readonly schema: 1;
  readonly ready: boolean;
  readonly selections: readonly PresetStackSelection[];
  readonly ownership: readonly PresetStackOwnership[];
  readonly unresolved: number;
  readonly profile: Host.ProjectProfileDefinition | null;
  readonly hostPlan: Host.ProfileApplicationPlan | null;
  readonly settingsPatch: Readonly<Record<string, unknown>>;
  /** Paths changed by host normalization, including derived governance leaves; values stay private. */
  readonly settingsChanges: readonly string[];
  /** Catalog seed identities only; no item creation or deduplication against tracker titles is attempted. */
  readonly seeds: readonly { readonly identity: string; readonly owner: PresetId; readonly item: SeedItem }[];
}

/** Recognize plain JSON objects, excluding custom prototypes. */
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
/** Fail the single request schema before any provider or filesystem access. */
function invalid(): never {
  throw new StackRefusal("invalid_input", "Use {selections:[{preset,settings?,templates?,seeds?}],choices?:{conflictPointer:preset}}; select 1-7 unique bundled ids, boolean flags, and at most 128 choices. See the stack example.");
}
/** Strict boundary: reject accessors, hidden properties, sparse arrays, extra keys and unbounded inputs. */
function parseInput(input: unknown): PresetStackInput {
  if (!object(input)) invalid();
  const own = Reflect.ownKeys(input);
  if (own.some((key) => typeof key !== "string" || !["selections", "choices"].includes(key)
    || !Object.getOwnPropertyDescriptor(input, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key)!, "value"))) invalid();
  const selections = input.selections;
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 7
    || Reflect.ownKeys(selections).length !== selections.length + 1) invalid();
  const seen = new Set<string>();
  const parsed: PresetStackSelection[] = [];
  for (let index = 0; index < selections.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(selections, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) invalid();
    const entry: unknown = descriptor.value;
    if (!object(entry) || Reflect.ownKeys(entry).some((key) => typeof key !== "string"
      || !["preset", "settings", "templates", "seeds"].includes(key)
      || !Object.getOwnPropertyDescriptor(entry, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(entry, key)!, "value"))) invalid();
    if (typeof entry.preset !== "string" || !PRESET_REGISTRY.some(({ id }) => id === entry.preset) || seen.has(entry.preset)) invalid();
    for (const key of ["settings", "templates", "seeds"]) if (Object.hasOwn(entry, key) && typeof entry[key] !== "boolean") invalid();
    const selection = { preset: entry.preset as PresetId, settings: entry.settings !== false, templates: entry.templates !== false, seeds: entry.seeds === true };
    if (!selection.settings && !selection.templates && !selection.seeds) invalid();
    seen.add(selection.preset);
    parsed.push(selection);
  }
  const choices = input.choices === undefined ? {} : input.choices;
  if (!object(choices) || Reflect.ownKeys(choices).length > 128) invalid();
  for (const key of Reflect.ownKeys(choices)) {
    if (typeof key !== "string" || key.length > 512 || !/^\/(settings|templates|seeds)\/.+/.test(key)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(choices, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value") || !seen.has(descriptor.value)) invalid();
  }
  return { selections: parsed.sort((a, b) => a.preset < b.preset ? -1 : 1), choices: { ...choices } as Record<string, PresetId> };
}
/** Stable key-order comparison for bundled JSON values and host canonical snapshots. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return String(JSON.stringify(value));
}
/** Encode one JSON pointer segment without conflating slashes or tildes. */
function escape(value: string): string { return value.replaceAll("~", "~0").replaceAll("/", "~1"); }
/** Flatten settings leaves only; arrays and empty objects remain atomic. */
function leaves(value: unknown, prefix = ""): Map<string, unknown> {
  if (object(value) && Object.keys(value).length > 0) {
    return new Map(Object.keys(value).sort().flatMap((key) => [...leaves(value[key], `${prefix}/${escape(key)}`)]));
  }
  return new Map([[prefix, value]]);
}
/** Install a trusted bundled setting leaf into a fresh patch. */
function put(patch: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.slice("/settings/".length).split("/").map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
  let cursor = patch;
  for (const key of keys.slice(0, -1)) {
    if (!Object.hasOwn(cursor, key)) setJsonProperty(cursor, key, {});
    cursor = cursor[key] as Record<string, unknown>;
  }
  setJsonProperty(cursor, keys[keys.length - 1], structuredClone(value));
}

/** Require the host's canonical preview; ordinary replay receipts cannot substitute for settings. */
export function stackSettingsPreview(result: Awaited<ReturnType<ExtensionCommandSdk["mutateWorkspaceSettings"]>>): Host.PmSettings {
  if (!result.preview) throw new StackRefusal("sdk_required", "Use a host that returns canonical inline previews.");
  return result.preview;
}

/** Adapt bundled contributions into a canonical host profile preview; never apply or persist a plan. */
export async function planPresetStack(pmRoot: string, sdk: ExtensionCommandSdk, input: PresetStackInput): Promise<PresetStackPlan> {
  const request = parseInput(input);
  const seedTypes = request.selections.some((selection) => selection.seeds) && sdk?.client ? await readSeedTypes(pmRoot, sdk.client) : [];
  const candidates = new Map<string, { owner: PresetId; value: unknown }[]>();
  /** Accumulate catalog ownership without assigning precedence to selection order. */
  function add(path: string, owner: PresetId, value: unknown): void {
    const entries = candidates.get(path) ?? [];
    entries.push({ owner, value }); candidates.set(path, entries);
  }
  for (const selection of request.selections) {
    const id = selection.preset;
    if (selection.settings) for (const [path, value] of leaves(requirePresetDefinition(id).settings)) add(`/settings${path}`, id, value);
    if (selection.templates) for (const template of presetTemplateEntries(id)) add(`/templates/${escape(template.name)}`, id, template.options);
    if (selection.seeds) for (const authored of resolvedSeedsForPreset(id, {}, true)) {
      const seed = JSON.stringify(authored).includes("${param:") ? authored : normalizeSeedArtifact(authored, seedTypes);
      add(`/seeds/${escape(`${seed.type}:${seed.title}`)}`, id, seed);
    }
  }
  const ownership: PresetStackOwnership[] = [];
  const resolved = new Map<string, { owner: PresetId; value: unknown }>();
  for (const [path, entries] of [...candidates].sort(([a], [b]) => a < b ? -1 : 1)) {
    const conflict = new Set(entries.map(({ value }) => canonical(value))).size > 1;
    const choice = request.choices![path];
    if (choice && (!conflict || !entries.some(({ owner }) => owner === choice))) invalid();
    const selected = choice ? entries.find(({ owner }) => owner === choice)! : entries[0];
    ownership.push({ path, owners: entries.map(({ owner }) => owner), conflict, choice: choice ?? "" });
    if (!conflict || choice) resolved.set(path, selected);
  }
  if (Object.keys(request.choices!).some((path) => !candidates.has(path))) invalid();
  const unresolved = ownership.filter((entry) => entry.conflict && !entry.choice).length;
  const base = { schema: 1 as const, ready: unresolved === 0, selections: request.selections, ownership, unresolved };
  if (unresolved) return { ...base, profile: null, hostPlan: null, settingsPatch: {}, settingsChanges: [], seeds: [] };

  if (typeof sdk?.mutateWorkspaceSettings !== "function") throw new StackRefusal("sdk_required", "Use a pm host with canonical includePreview settings support (2026.10.17+).");
  const patch: Record<string, unknown> = {};
  const templates: Host.ProfileTemplateEntry[] = [];
  const seeds: { identity: string; owner: PresetId; item: SeedItem }[] = [];
  for (const [path, { owner, value }] of resolved) {
    if (path.startsWith("/settings/")) put(patch, path, value);
    else if (path.startsWith("/templates/")) templates.push({ name: path.slice(11).replaceAll("~1", "/").replaceAll("~0", "~"), options: structuredClone(value) as Host.ProfileTemplateOptions });
    else seeds.push({ identity: path.slice(7).replaceAll("~1", "/").replaceAll("~0", "~"), owner, item: structuredClone(value) as SeedItem });
  }
  const profile: Host.ProjectProfileDefinition = {
    name: "preset-stack", title: "Preset stack", summary: request.selections.map(({ preset }) => preset).join(" + "),
    types: [], statuses: [], fields: [], workflows: [], packages: [], templates,
    config: Object.hasOwn(patch, "id_prefix") ? [{ key: "id_prefix", value: String(patch.id_prefix), summary: "Selected preset ID prefix" }] : [],
  };
  try {
    const host = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url, join(process.cwd(), "package.json"), process.argv[1]])) as typeof Host;
    const currentTemplates = new Map<string, Host.ProfileTemplateOptions>();
    const inventory = await host.runTemplatesList({ path: pmRoot, noExtensions: true });
    for (const name of inventory.user_templates) if (templates.some((template) => template.name === name)) currentTemplates.set(name, await loadTemplateSdk().loadCreateTemplateOptions(pmRoot, name));
    const sourceSettings = await host.readFileIfExists(join(pmRoot, "settings.json"));
    // Host dry-runs acquire a workspace lock. Normalize an isolated settings copy
    // so a read-only source needs no lock directory, receipt or runtime writes.
    const scratch = await mkdtemp(join(tmpdir(), "preset-stack-normalize-"));
    let preview: Awaited<ReturnType<ExtensionCommandSdk["mutateWorkspaceSettings"]>>;
    let before: Host.PmSettings | undefined;
    try {
      // An absent/invalid source remains invalid; permissive readSettings defaults
      // must not turn an uninitialized tracker into an apparently valid plan.
      await writeFile(join(scratch, "settings.json"), sourceSettings!, { mode: 0o600 });
      const isolated = host.createExtensionCommandSdk(scratch, new host.PmClient({ pmRoot: scratch, noExtensions: true }), "preset-stack-preview");
      preview = await isolated.mutateWorkspaceSettings({
        operationId: `preset-stack-preview-${randomUUID()}`, dryRun: true, includePreview: true,
        mutate: (current) => { before = structuredClone(current); return mergePresetSettings(current as unknown as Record<string, unknown>, patch, false) as unknown as Host.PmSettings; },
      });
    } finally { await rm(scratch, { recursive: true, force: true }); }
    const normalized = leaves(stackSettingsPreview(preview), "/settings");
    if ([...resolved].some(([path, { value }]) => path.startsWith("/settings/") && canonical(normalized.get(path)) !== canonical(value))) {
      throw new StackRefusal("normalization_conflict", "Host governance normalization changes a selected setting. Choose coherent owners for governance and mirrored validation leaves, or select settings from just one preset, then replan.");
    }
    const old = leaves(before, "/settings");
    const settingsChanges = [...new Set([...old.keys(), ...normalized.keys()])].sort().filter((path) => canonical(old.get(path)) !== canonical(normalized.get(path)));
    const hostPlan = host.planProfileApplication(profile, { typesRaw: null, statusesRaw: null, fieldsRaw: null, workflows: [], settings: before, templates: currentTemplates, installedPackages: new Set() });
    return { ...base, profile, hostPlan, settingsPatch: patch, settingsChanges, seeds };
  } catch (error) {
    if (error instanceof StackRefusal || error instanceof ParameterRefusal) throw error;
    throw new StackRefusal("target_unavailable", "Initialize a tracker, check pm health and template validity, and retry with a compatible host. Preview never applies a partial stack.");
  }
}

/** Compact agent output excludes all stored values and complete template/seed bodies. */
export function summarizePresetStack(plan: PresetStackPlan) {
  const counts = { settings: plan.ownership.filter(({ path }) => path.startsWith("/settings/")).length,
    templates: plan.ownership.filter(({ path }) => path.startsWith("/templates/")).length,
    seeds: plan.ownership.filter(({ path }) => path.startsWith("/seeds/")).length, unresolved: plan.unresolved };
  if (Object.values(counts).some((count) => !Number.isSafeInteger(count) || count < 0 || count > 1024)) throw new StackRefusal("invalid_input", "Regenerate a bounded stack plan before summarizing it.");
  return { schema: 1, ready: plan.ready, presets: plan.selections.map(({ preset }) => preset), counts, ownership: plan.ownership,
    settingsChanges: plan.settingsChanges, templates: plan.hostPlan?.templates.changes.map(({ name, status }) => ({ name, status })) ?? [],
    ...(plan.ready ? {} : { code: "conflicts", remedy: "Set choices for every unresolved conflict pointer to one listed owner, then replan.", exit_code: 2 }) };
}
