/** Three-way vendor settings evolution, with portable receipts and host-owned auditing. */
import { createHash } from "node:crypto";
import type { PmSettings } from "@unbrained/pm-cli/sdk";
import type { ExtensionCommandSdk } from "@unbrained/pm-cli/sdk/authoring";

/** JSON settings patches accept nested objects and treat arrays as indivisible values. */
export type UpgradeSettings = { readonly [key: string]: UpgradeValue };
/** JSON-only values exclude executable inputs and ambiguous undefined properties. */
export type UpgradeValue = null | boolean | number | string | readonly UpgradeValue[] | UpgradeSettings;
/** A caller supplies the original vendor patch, not an export of locally customized settings. */
export interface VersionedPreset {
  /** Stable vendor identity, identical across the two versions. */
  readonly id: string;
  /** Explicit immutable vendor revision or release label. */
  readonly version: string;
  /** Only vendor-owned settings, without templates or tracker items. */
  readonly settings: UpgradeSettings;
}
/** Explicit choices use RFC 6901 JSON pointers; missing decisions never default to vendor. */
export type UpgradeDecisions = Readonly<Record<string, "local" | "vendor">>;
/** A compact observation reveals paths and choices, never previous setting values. */
export interface UpgradeChange {
  /** Unambiguous JSON pointer, with escaped slashes and tildes. */
  readonly path: string;
  /** Unchanged vendor settings preserve local customizations automatically. */
  readonly kind: "vendor" | "local" | "already" | "conflict";
  /** Empty for automatic choices or an unresolved conflict. */
  readonly decision: "local" | "vendor" | "";
}
/** Private recovery artifact; persist before applying and keep outside version control. */
export interface PresetUpgradeReceipt {
  /** Version of the receipt contract, independent of vendor versions. */
  readonly schema: 1;
  /** Content digest binding the plan, choices and normalized snapshots. */
  readonly id: string;
  /** Explicit retry generation; increment only to start a new migration after rollback. */
  readonly generation: string;
  /** Original vendor patch and revision. */
  readonly from: VersionedPreset;
  /** Target vendor patch and revision. */
  readonly to: VersionedPreset;
  /** Explicit decisions, including decisions to preserve conflicting local edits. */
  readonly decisions: UpgradeDecisions;
  /** Normalized inline settings observed under the host settings lock. */
  readonly before: UpgradeSettings;
  /** Canonical settings preview returned by the host serializer. */
  readonly after: UpgradeSettings;
  /** Paths requiring attention or recording preserved local intent. */
  readonly changes: readonly UpgradeChange[];
}
/** Agents can branch on these categories without parsing raw SDK diagnostics. */
export type UpgradeRefusalCode = "invalid_input" | "invalid_receipt" | "sdk_required" | "conflicts" | "stale_settings" | "normalization_changed" | "mutation_refused";
/** Typed failure with a stable remedy; user settings and raw SDK messages stay private. */
export class UpgradeRefusal extends Error {
  /** Stable category suitable for programmatic handling. */
  readonly code: UpgradeRefusalCode;
  /** Concrete corrective action, excluding private diagnostics. */
  readonly remedy: string;
  /** Expected usage/conflict failure, recognized by the pm extension host. */
  readonly exitCode = 2;
  /** Construct a safe, machine-readable refusal. */
  constructor(code: UpgradeRefusalCode, remedy: string) {
    super(`${code}: ${remedy}`);
    this.name = "UpgradeRefusal";
    this.code = code;
    this.remedy = remedy;
  }
}

/** Identify plain data objects, excluding arrays and class instances. */
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
/** Validate bounded JSON and reject prototype keys even in arrays or unused patch branches. */
function json(value: unknown, depth = 0): void {
  if (depth > 32) throw new UpgradeRefusal("invalid_input", "Limit settings nesting to 32 levels.");
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) {
    for (const child of value) json(child, depth + 1);
    return;
  }
  if (!object(value)) throw new UpgradeRefusal("invalid_input", "Supply JSON objects, arrays and finite scalar values only.");
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new UpgradeRefusal("invalid_input", "Remove prototype-related settings keys.");
    json(child, depth + 1);
  }
}
/** Sort object keys so formatting and insertion order cannot change a receipt identity. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return String(JSON.stringify(value));
}
/** Compare missing values distinctly from null, empty objects and empty arrays. */
function equal(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}
/** Validate a vendor patch before reading any workspace state. */
function vendor(value: unknown): asserts value is VersionedPreset {
  if (!object(value) || typeof value.id !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(value.id)
    || typeof value.version !== "string" || !/^[a-zA-Z0-9._+-]{1,100}$/.test(value.version) || !object(value.settings)
    || Object.keys(value).some((key) => !["id", "version", "settings"].includes(key))) {
    throw new UpgradeRefusal("invalid_input", "Supply {id, version, settings} with nonempty stable labels and an object patch.");
  }
  json(value);
}
/** Validate choices before using them as paths or decisions. */
function choices(value: unknown): asserts value is UpgradeDecisions {
  if (!object(value) || Object.entries(value).some(([key, choice]) => !key.startsWith("/") || !["local", "vendor"].includes(String(choice)))) {
    throw new UpgradeRefusal("invalid_input", "Supply an object mapping conflict JSON pointers to local or vendor.");
  }
  json(value);
}
/** Merge only vendor-owned paths; structural changes and arrays are atomic conflicts. */
function migrate(from: UpgradeSettings, to: UpgradeSettings, before: UpgradeSettings, decisions: UpgradeDecisions): { after: UpgradeSettings; changes: UpgradeChange[] } {
  const changes: UpgradeChange[] = [];
  const used = new Set<string>();
  /** Resolve one subtree without traversing local-only fields. */
  function visit(base: unknown, next: unknown, local: unknown, path: string): unknown {
    if ((object(base) || base === undefined) && (object(next) || next === undefined) && object(local) && next !== undefined) {
      const result = structuredClone(local);
      const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(next)]);
      for (const key of [...keys].sort()) {
        const child = visit(base?.[key], next[key], local[key], `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
        if (child === undefined) delete result[key];
        else result[key] = child;
      }
      return result;
    }
    if (equal(base, next)) {
      if (!equal(base, local)) changes.push({ path, kind: "local", decision: "" });
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
  const after = visit(from, to, before, "") as UpgradeSettings;
  if (Object.keys(decisions).some((key) => !used.has(key))) throw new UpgradeRefusal("invalid_input", "Remove decisions for paths that are not conflicts in this plan.");
  return { after, changes };
}
/** Compare JSON settings without a host; arrays and structural type changes require atomic choices. */
export function comparePresetUpgrade(from: UpgradeSettings, to: UpgradeSettings, local: UpgradeSettings, decisions: UpgradeDecisions = {}): { after: UpgradeSettings; changes: readonly UpgradeChange[] } {
  for (const value of [from, to, local]) {
    if (!object(value)) throw new UpgradeRefusal("invalid_input", "Supply object settings snapshots for all three comparison inputs.");
    json(value);
  }
  choices(decisions);
  return migrate(from, to, local, decisions);
}
/** Bind the complete artifact rather than relying on the caller's filename or operation id. */
function identity(receipt: Omit<PresetUpgradeReceipt, "id">): string {
  return createHash("sha256").update(canonical(receipt)).digest("hex");
}
/** Enforce the host capability and translate execution failures without exposing configuration. */
async function mutation(sdk: ExtensionCommandSdk, options: Parameters<ExtensionCommandSdk["mutateWorkspaceSettings"]>[0]) {
  if (typeof sdk?.mutateWorkspaceSettings !== "function") throw new UpgradeRefusal("sdk_required", "Use a pm host with audited settings mutation and canonical includePreview support (2026.10.17+).");
  try {
    return await sdk.mutateWorkspaceSettings(options);
  } catch (error) {
    if (error instanceof UpgradeRefusal) throw error;
    throw new UpgradeRefusal("mutation_refused", "Check pm health and the settings schema, then retry with the same receipt; retain the artifact for recovery.");
  }
}
/** Replace only the smallest object containing removed leaves; other raw source fields remain host-owned. */
function removedSubtrees(before: UpgradeSettings, after: UpgradeSettings, prefix = ""): string[] {
  if (prefix && Object.keys(before).some((key) => !(key in after))) return [prefix];
  return Object.keys(before).flatMap((key) => object(before[key]) && object(after[key])
    ? removedSubtrees(before[key] as UpgradeSettings, after[key] as UpgradeSettings, prefix ? `${prefix}.${key}` : key) : []);
}
/** Plan against the locked inline snapshot; dry-run never changes settings or history. */
export async function planPresetUpgrade(sdk: ExtensionCommandSdk, from: VersionedPreset, to: VersionedPreset, decisions: UpgradeDecisions = {}, generation = "1"): Promise<PresetUpgradeReceipt> {
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(generation)) throw new UpgradeRefusal("invalid_input", "Use a nonempty migration generation of at most 64 letters, digits, dots, underscores or hyphens.");
  vendor(from);
  vendor(to);
  choices(decisions);
  if (from.id !== to.id || from.version === to.version) throw new UpgradeRefusal("invalid_input", "Use the same vendor id with two different immutable version labels.");
  let before: UpgradeSettings = {};
  let proposed: UpgradeSettings = {};
  let changes: UpgradeChange[] = [];
  const replacements: string[] = [];
  const preview = await mutation(sdk, {
    operationId: "preset-upgrade-preview", dryRun: true, includePreview: true,
    replaceSubtrees: replacements,
    mutate: (current) => {
      before = JSON.parse(JSON.stringify(current)) as UpgradeSettings;
      const result = migrate(from.settings, to.settings, before, decisions);
      proposed = result.after;
      replacements.push(...removedSubtrees(before, proposed));
      changes = result.changes;
      return proposed as unknown as PmSettings;
    },
  });
  if (!preview.preview) throw new UpgradeRefusal("sdk_required", "Upgrade the pm host to support canonical includePreview settings results (2026.10.17+).");
  if (!equal(preview.preview, proposed)) throw new UpgradeRefusal("normalization_changed", "Adjust the vendor patch to the host's canonical settings schema and explicit governance policy, then replan.");
  const receipt = { schema: 1 as const, generation, from, to, decisions, before, after: JSON.parse(JSON.stringify(preview.preview)) as UpgradeSettings, changes };
  return structuredClone({ ...receipt, id: identity(receipt) });
}
/** Validate private artifacts received from JSON before any host mutation. Digests detect edits, not authorship. */
export function parseUpgradeReceipt(value: unknown): PresetUpgradeReceipt {
  json(value);
  if (!object(value) || value.schema !== 1 || typeof value.generation !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(value.generation) || typeof value.id !== "string" || !object(value.before) || !object(value.after) || !Array.isArray(value.changes)) {
    throw new UpgradeRefusal("invalid_receipt", "Use the complete unchanged receipt written by presets upgrade plan.");
  }
  const { id, ...body } = value;
  if (identity(body as unknown as Omit<PresetUpgradeReceipt, "id">) !== id) throw new UpgradeRefusal("invalid_receipt", "Restore the unchanged receipt; regenerate a plan to change decisions.");
  const receipt = value as unknown as PresetUpgradeReceipt;
  vendor(receipt.from);
  vendor(receipt.to);
  choices(receipt.decisions);
  const expected = migrate(receipt.from.settings, receipt.to.settings, receipt.before, receipt.decisions);
  if (receipt.from.id !== receipt.to.id || receipt.from.version === receipt.to.version || !equal(expected.after, receipt.after) || !equal(expected.changes, receipt.changes)) {
    throw new UpgradeRefusal("invalid_receipt", "Regenerate the receipt from the original vendor versions and explicit decisions.");
  }
  return receipt;
}
/** Compact plan report; retrieve all paths from the private receipt when conflicts are truncated. */
export interface PresetUpgradeSummary {
  /** Full digest to identify the saved artifact. */
  readonly id: string;
  /** Vendor identity retained across versions. */
  readonly preset: string;
  /** Original vendor revision. */
  readonly from: string;
  /** Target vendor revision. */
  readonly to: string;
  /** True only when every conflict has an explicit decision. */
  readonly ready: boolean;
  /** Whether normalized settings differ. */
  readonly changed: boolean;
  /** Total path observations in the private receipt. */
  readonly paths: number;
  /** At most twenty conflicts in canonical path order, within a 4 KiB detail budget. */
  readonly conflicts: readonly UpgradeChange[];
  /** Number of conflicts omitted from this compact view. */
  readonly omittedConflicts: number;
  /** Total observations by classification, including omitted conflicts. */
  readonly counts: Readonly<Record<UpgradeChange["kind"], number>>;
}
/** Successful execution acknowledgement; the host history is the durable commit receipt. */
export interface PresetUpgradeResult extends PresetUpgradeSummary {
  /** Forward migration or restoration of the recorded settings. */
  readonly direction: "apply" | "rollback";
  /** Whether the SDK recognized an already committed operation identity. */
  readonly replayed: boolean;
}
/** Bounded result emitted by CLI renderers; full settings stay in the private receipt file. */
export function summarizePresetUpgrade(receipt: PresetUpgradeReceipt): PresetUpgradeSummary {
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
export async function executePresetUpgrade(sdk: ExtensionCommandSdk, input: PresetUpgradeReceipt, direction: "apply" | "rollback"): Promise<PresetUpgradeResult> {
  const receipt = parseUpgradeReceipt(input);
  if (direction !== "apply" && direction !== "rollback") throw new UpgradeRefusal("invalid_input", "Choose apply or rollback.");
  if (!summarizePresetUpgrade(receipt).ready) throw new UpgradeRefusal("conflicts", "Supply local or vendor for every conflict in a decisions file and generate a new receipt.");
  const [before, after] = direction === "apply" ? [receipt.before, receipt.after] : [receipt.after, receipt.before];
  const result = await mutation(sdk, {
    operationId: `preset-${direction}-${receipt.id}`, replaceSubtrees: removedSubtrees(before, after),
    mutate: (current) => {
      if (!equal(current, before) && !equal(current, after)) throw new UpgradeRefusal("stale_settings", "Settings changed since this receipt; replan against current settings before applying or rolling back.");
      return structuredClone(after) as unknown as PmSettings;
    },
  });
  // Replay skips the callback. Check the live snapshot before reporting success,
  // including retries after a rollback or a concurrent later settings mutation.
  await mutation(sdk, { operationId: "preset-upgrade-verify", dryRun: true, mutate: (current) => {
    if (!equal(current, after)) throw new UpgradeRefusal("stale_settings", "The operation was replayed or settings changed after it; inspect history and replan with a new explicit generation for further migration.");
    return current;
  } });
  return { ...summarizePresetUpgrade(receipt), direction, changed: result.changed, replayed: result.replayed };
}
