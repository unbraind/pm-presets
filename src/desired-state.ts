/** One complete artifact plan shared by preset application and synchronization. */
import type { PresetSettingsPatch, PresetTemplateMap, StoredCreateTemplateDocument } from "./presets/shared.ts";
import type { SeedItem } from "./seeds.ts";
import { replacementSettings } from "./settings-replacement.ts";
import { ParameterRefusal, resolveParameterizedPreset } from "./params.ts";

/** Durable seed ownership; item ids survive later parameter/prefix changes. */
export interface PresetArtifactRecord {
  version: 1;
  seedIds: string[];
}

/** Every semantic artifact one application owns, excluding host audit timestamps. */
export interface DesiredPresetState {
  settings: PresetSettingsPatch;
  templates: Array<{ filename: string; document: StoredCreateTemplateDocument }>;
  seeds: Array<{ id: string; item: SeedItem }>;
  /** Replacement owns all three settings trees, including omitted raw keys. */
  replace: boolean;
  /** Native audited ownership must agree with the generated settings record. */
  ownership?: { presetId: string; record: PresetArtifactRecord };
}

/** Read only an artifact map's own entry, including when a prototype is polluted. */
export function ownArtifact<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  return map && Object.hasOwn(map, key) ? map[key] : undefined;
}

/** Read package-owned application metadata without accepting malformed ownership. */
export function presetArtifactRecord(settings: Record<string, unknown> | undefined, presetId: string): PresetArtifactRecord | undefined {
  const records = ownArtifact(settings, "preset_artifacts");
  if (records === undefined) return undefined;
  if (typeof records !== "object" || records === null || Array.isArray(records)) throw new ParameterRefusal("invalid_artifact_record", "Inspect settings.preset_artifacts; restore its versioned seed ownership records before applying or diffing.");
  if (!Object.hasOwn(records, presetId)) return undefined;
  const record = (records as Record<string, unknown>)[presetId];
  if (typeof record !== "object" || record === null || Array.isArray(record)
    || Object.keys(record).sort().join(",") !== "seedIds,version"
    || (record as PresetArtifactRecord).version !== 1
    || !Array.isArray((record as PresetArtifactRecord).seedIds)
    || Object.keys((record as PresetArtifactRecord).seedIds).join(",") !== Array.from({ length: (record as PresetArtifactRecord).seedIds.length }, (_, index) => String(index)).join(",")
    || (record as PresetArtifactRecord).seedIds.some((id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(id))
    || new Set((record as PresetArtifactRecord).seedIds).size !== (record as PresetArtifactRecord).seedIds.length) {
    throw new ParameterRefusal("invalid_artifact_record", "Restore the preset's version 1 seedIds ownership record; never substitute an unrelated item id.");
  }
  return record as PresetArtifactRecord;
}

/** Compute settings, complete template files, stable seeds and ownership together. */
export async function computeDesiredPresetState(input: {
  settings: PresetSettingsPatch;
  templates: PresetTemplateMap;
  presetId?: string;
  seeds?: readonly SeedItem[];
  record?: PresetArtifactRecord;
  replace?: boolean;
}): Promise<DesiredPresetState> {
  if (Object.hasOwn(input.settings, "preset_artifacts")) throw new ParameterRefusal("invalid_manifest", "settings.preset_artifacts is workspace-local ownership managed by apply; omit it from authored preset settings.");
  if (input.record) presetArtifactRecord({ preset_artifacts: { [input.presetId!]: input.record } }, input.presetId!);
  if (input.seeds?.length && !input.presetId) throw new ParameterRefusal("invalid_artifact_record", "Provide a preset id before enrolling managed seeds.");
  try {
    // Final prefix overrides and artifact payloads use the same strict binding
    // checks. Legacy sensitive settings remain available to the diff redactor;
    // application validates its entire settings patch before planning.
    resolveParameterizedPreset([], {}, { settings: { id_prefix: input.settings.id_prefix }, templates: input.templates, seeds: input.seeds });
    const settings = structuredClone(input.settings);
    if (input.replace) {
      const canonical = await replacementSettings(input.settings);
      for (const tree of ["governance", "validation", "testing"] as const) {
        delete settings[tree];
        Object.defineProperty(settings, tree, { value: canonical[tree], enumerable: true, configurable: true, writable: true });
      }
    }
    if (input.record && input.record.seedIds.some((id, index) => !id.endsWith(`preset-${input.presetId}-${index}`))) throw new ParameterRefusal("invalid_artifact_record", "Managed seed ids must retain their preset and slot identity; restore ownership before reconciling any item.");
    const seeds = (input.seeds ?? []).map((item, index) => ({
      id: input.record?.seedIds[index] ?? `${settings.id_prefix}preset-${input.presetId}-${index}`,
      item: structuredClone(item),
    }));
    if (seeds.some(({ id }) => !/^[a-z0-9][a-z0-9-]{0,127}$/.test(id))) throw new ParameterRefusal("invalid_artifact_record", "Use a lowercase letter/digit/hyphen prefix before enrolling managed seeds.");
    if (input.record && input.record.seedIds.length !== seeds.length) throw new ParameterRefusal("invalid_artifact_record", "The managed seed inventory changed; inspect the preset's seed ownership before migrating it.");
    const ownership = input.presetId && input.seeds !== undefined ? { presetId: input.presetId, record: { version: 1 as const, seedIds: seeds.map(({ id }) => id) } } : undefined;
    if (ownership) {
      Object.defineProperty(settings, "preset_artifacts", { value: { [ownership.presetId]: ownership.record }, enumerable: true, configurable: true, writable: true });
    }
    return { settings, templates: Object.entries(input.templates).map(([filename, document]) => ({ filename, document: structuredClone(document) })), seeds, replace: input.replace === true, ownership };
  } catch (error) {
    if (error instanceof ParameterRefusal) throw error;
    throw new ParameterRefusal("invalid_manifest", "Desired artifacts must contain plain JSON data; remove functions and other uncloneable values before applying or diffing.");
  }
}

/** Structural JSON equality ignores object insertion order and retains own-key semantics. */
export function artifactValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && Array.from({ length: left.length }, (_, index) => index).every((index) => Object.hasOwn(left, index) === Object.hasOwn(right, index) && (!Object.hasOwn(left, index) || artifactValuesEqual(left[index], right[index])));
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && artifactValuesEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/** Compare all seed fields application controls while preserving unrelated user metadata. */
export function seedArtifactMatches(seed: SeedItem, current: Record<string, unknown> | undefined): boolean {
  return current !== undefined && ownArtifact(current, "type") === seed.type && ownArtifact(current, "title") === seed.title
    && String(ownArtifact(current, "priority")) === String(seed.priority ?? 2)
    && artifactValuesEqual(ownArtifact(current, "tags") ?? [], (seed.tags ?? "").split(",").filter(Boolean).sort())
    && (ownArtifact(current, "body") ?? "") === (seed.body ?? "") && ownArtifact(current, "parent") === undefined;
}

/** Name every controlled setting, complete template or seed that differs. */
export function compareDesiredPresetState(desired: DesiredPresetState, current: {
  settings: Record<string, unknown> | undefined;
  templates: Record<string, unknown>;
  seeds: Record<string, Record<string, unknown>>;
  applicationRecords?: Record<string, PresetArtifactRecord | null>;
  artifactErrors?: readonly string[];
}): string[] {
  const changed: string[] = [...(current.artifactErrors ?? [])];
  /** Compare a partial settings tree without inheriting prototype properties. */
  function settings(value: unknown, actual: unknown, name: string): void {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      if (actual === null || typeof actual !== "object" || Array.isArray(actual)) { changed.push(`settings.json#${name}`); return; }
      for (const [key, child] of Object.entries(value)) settings(child, Object.hasOwn(actual, key) ? (actual as Record<string, unknown>)[key] : undefined, name ? `${name}.${key}` : key);
    } else if (!artifactValuesEqual(value, actual)) changed.push(`settings.json#${name}`);
  }
  settings(desired.settings, current.settings, "");
  if (desired.replace) for (const tree of ["governance", "validation", "testing"] as const) {
    if (!artifactValuesEqual(desired.settings[tree], ownArtifact(current.settings, tree))) changed.push(`settings.json#${tree}`);
  }
  for (const template of desired.templates) if (!artifactValuesEqual(template.document, ownArtifact(current.templates, template.filename))) changed.push(`templates/${template.filename}`);
  for (const seed of desired.seeds) if (!seedArtifactMatches(seed.item, ownArtifact(current.seeds, seed.id))) changed.push(`items/${seed.id}`);
  if (desired.ownership && !artifactValuesEqual(desired.ownership.record, ownArtifact(current.applicationRecords, desired.ownership.presetId))) changed.push("history/_workspace.jsonl");
  return [...new Set(changed)];
}
