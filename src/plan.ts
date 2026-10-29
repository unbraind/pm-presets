/** Operational prerequisite negotiation, independent of storage and settings validation. */
import type { WorkspaceContracts } from "@unbrained/pm-cli/sdk";
import { resolvedSeedsForPreset } from "./seeds.ts";
import { requirePresetDefinition } from "./catalog.ts";
import { normalizeSeedArtifact } from "./desired-state.ts";

/** A named operational prerequisite; command names are canonical activated extension paths. */
export interface PresetRequirement {
  /** Backend operations and host-resolved extension/schema surfaces are separate namespaces. */
  readonly kind: "capability" | "command" | "type" | "field" | "status";
  /** Exact, case-sensitive contract identifier. */
  readonly name: string;
}
/** An indivisible feature: all prerequisites must exist before it can be selected. */
export interface PresetPlanFeature {
  /** Stable reference to the composed preset's feature, not an executable command. */
  readonly id: string;
  /** Missing optional features are explicitly omitted; required features block the whole plan. */
  readonly optional: boolean;
  /** Conjunction of prerequisites; an empty list is supported everywhere. */
  readonly requires: readonly PresetRequirement[];
}
/** A composed preset declares prerequisites without exposing settings or tracker values. */
export interface PresetComposition {
  /** Stable preset identity. */
  readonly id: string;
  /** Ordered atomic features; dependencies belong in each feature's requirements. */
  readonly features: readonly PresetPlanFeature[];
}
/** Provider-supplied contract snapshot; credentials, URLs and database connections are excluded. */
export interface PresetPlanTarget {
  /** Transport label affects reporting only, never negotiation semantics. */
  readonly backend: "directory" | "database";
  /** Operations actually supported by the selected provider, not guessed from its label. */
  readonly capabilities: readonly string[];
  /** Unmodified workspace contracts from the host SDK or selected database provider. */
  readonly contracts: WorkspaceContracts;
}
/** Stable failure categories usable without parsing human messages. */
export type PlanRefusalCode = "invalid_input" | "contracts_unavailable" | "missing_capability";
/** Invalid inputs and unavailable contract readers fail closed before planning. */
export class PlanRefusal extends Error {
  /** Machine-readable reason for recovery decisions. */
  readonly code: PlanRefusalCode;
  /** Concrete next action, without private diagnostics. */
  readonly remedy: string;
  /** Host-recognized usage/refusal status. */
  readonly exitCode = 2;
  /** Construct a safe refusal for SDK and CLI consumers. */
  constructor(code: PlanRefusalCode, remedy: string) {
    super(`${code}: ${remedy}`);
    this.name = "PlanRefusal";
    this.code = code;
    this.remedy = remedy;
  }
}
/** A precise unsatisfied contract, including the affected feature and recovery action. */
export interface PresetPlanGap extends PresetRequirement {
  /** Feature whose atomic selection this prerequisite prevents. */
  readonly feature: string;
  /** Uniform code for both optional omissions and required refusals. */
  readonly code: "missing_capability";
  /** Provider/schema/extension action to take before replanning. */
  readonly remedy: string;
}
/** Bounded plan with no settings values; refused plans never authorize partial application. */
export interface PresetPlan {
  /** Version of this portable plan contract. */
  readonly schema: 1;
  /** Composed preset identity. */
  readonly preset: string;
  /** Selected provider label. */
  readonly backend: PresetPlanTarget["backend"];
  /** True only if all required features can run. */
  readonly ready: boolean;
  /** Supported feature identifiers, in composition order. */
  readonly selected: readonly string[];
  /** Optional features omitted atomically, in composition order. */
  readonly omitted: readonly string[];
  /** Required features whose missing prerequisites block execution. */
  readonly refused: readonly string[];
  /** Complete precise gaps; inputs are bounded to 32 features and 8 requirements each. */
  readonly gaps: readonly PresetPlanGap[];
}

/** Accept only plain data records; never interpret arrays as contract objects. */
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
/** Keep identifiers printable, bounded and safe in compact agent output. */
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,79}$/.test(value) && value.trim() === value;
}
/** Reject malformed contract envelopes instead of treating missing metadata as support. */
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(identifier);
}
/** One consistent bounded-input refusal avoids leaking untrusted file contents. */
function invalid(): never {
  throw new PlanRefusal("invalid_input", "Use a valid composition (1-32 uniquely named features, at most 8 unique requirements each) and complete target contracts; see the plan example.");
}
/** Validate declarations received through JSON or JavaScript, before any contract matching. */
function validate(composition: PresetComposition, target: PresetPlanTarget): void {
  if (!object(composition) || !identifier(composition.id) || !Array.isArray(composition.features)
    || composition.features.length < 1 || composition.features.length > 32
    || !object(target) || !["directory", "database"].includes(target.backend) || !strings(target.capabilities) || !object(target.contracts)) invalid();
  const contracts = target.contracts;
  if (!strings(contracts.types) || !strings(contracts.statuses) || !identifier(contracts.openStatus)
    || !identifier(contracts.closeStatus) || !identifier(contracts.canceledStatus)
    || (contracts.fields !== undefined && (!Array.isArray(contracts.fields) || contracts.fields.some((field) => !object(field) || !identifier(field.key))))
    || (contracts.extensionCommands !== undefined && (!Array.isArray(contracts.extensionCommands) || contracts.extensionCommands.some((command) => !object(command) || !identifier(command.command))))) invalid();
  const ids = new Set<string>();
  for (const feature of composition.features) {
    if (!object(feature) || !identifier(feature.id) || ids.has(feature.id) || typeof feature.optional !== "boolean"
      || !Array.isArray(feature.requires) || feature.requires.length > 8) invalid();
    ids.add(feature.id);
    const requirements = new Set<string>();
    for (const requirement of feature.requires) {
      if (!object(requirement) || typeof requirement.kind !== "string" || !["capability", "command", "type", "field", "status"].includes(requirement.kind) || !identifier(requirement.name)) invalid();
      const key = `${requirement.kind}:${requirement.name}`;
      if (requirements.has(key)) invalid();
      requirements.add(key);
    }
  }
}
/** Match operational prerequisites against host contracts; never read, write, activate or invoke Git. */
export function compilePresetPlan(composition: PresetComposition, target: PresetPlanTarget): PresetPlan {
  validate(composition, target);
  const available: Record<PresetRequirement["kind"], ReadonlySet<string>> = {
    capability: new Set(target.capabilities), command: new Set((target.contracts.extensionCommands ?? []).map((entry) => entry.command)),
    type: new Set(target.contracts.types), field: new Set((target.contracts.fields ?? []).map((entry) => entry.key)), status: new Set(target.contracts.statuses),
  };
  const selected: string[] = [], omitted: string[] = [], refused: string[] = [];
  const gaps: PresetPlanGap[] = [];
  for (const feature of composition.features) {
    const missing = feature.requires.filter((requirement) => !available[requirement.kind].has(requirement.name));
    if (missing.length === 0) selected.push(feature.id);
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
export function bundledPresetComposition(id: string, withSeeds = false): PresetComposition {
  const preset = requirePresetDefinition(id);
  const features: PresetPlanFeature[] = [
    { id: "settings", optional: false, requires: [{ kind: "capability", name: "settings.audit" }] },
    { id: "templates", optional: false, requires: [{ kind: "capability", name: "templates.write" },
      ...[...new Set(preset.templates.map((template) => template.type))].map((name) => ({ kind: "type" as const, name }))] },
  ];
  if (withSeeds) features.push({ id: "seeds", optional: false, requires: [{ kind: "capability", name: "items.create" },
    ...[...new Set(resolvedSeedsForPreset(preset.id, {}, true).map((seed) => JSON.stringify(seed).includes("${param:") ? seed.type : normalizeSeedArtifact(seed, preset.itemTypes).type))].map((name) => ({ kind: "type" as const, name }))] });
  return { id: preset.id, features };
}
/** Compact CLI view with complete counts and explicit truncation, never hidden gaps. */
export function summarizePresetPlan(plan: PresetPlan) {
  const gaps: PresetPlanGap[] = [];
  let bytes = 0;
  for (const gap of plan.gaps) {
    bytes += Buffer.byteLength(JSON.stringify(gap));
    if (gaps.length < 12 && bytes <= 4096) gaps.push(gap);
  }
  return { ...plan, gaps, gapCount: plan.gaps.length, omittedGaps: plan.gaps.length - gaps.length };
}
