/**
 * apply-command.ts — the unified `presets apply` bridge.
 *
 * One boundary for one apply invocation: the caller's parameter input is read
 * exactly once (flags plus at most one params file), every declared parameter
 * is answered strictly, and the SEED bindings are validated here — all before
 * the setup handler writes a single settings leaf or template file. The
 * resolved values are then threaded through the handler (and on to seed
 * creation) so no later step re-reads the caller's input.
 */

import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk/authoring";
import { PRESET_PARAMETERS } from "./registry.ts";
import { requirePresetDefinition, type PresetDefinition } from "./catalog.ts";
import { readBooleanOption } from "./presets/shared.ts";
import { readSuppliedParameterValues, resolveParameterValues, type ResolvedParameterValues } from "./params.ts";
import { resolvedSeedsForPreset, type SeedItem } from "./seeds.ts";

/** Everything one apply invocation needs, resolved at a single boundary. */
export interface ResolvedPresetApplication {
  /** The preset the caller named (already validated against the registry). */
  readonly definition: PresetDefinition;
  /** Effective parameter values plus their sources; strict resolution refused before any write. */
  readonly parameters: ResolvedParameterValues;
  /** Whether the caller asked for the preset's starter items. */
  readonly withSeeds: boolean;
  /** Whether the whole apply is a preview. */
  readonly dryRun: boolean;
  /** Resolved, validated seed items (only when requested); never re-read from input. */
  readonly seeds: readonly SeedItem[] | undefined;
}

/**
 * Resolve one apply invocation completely, before any write.
 *
 * Strict order: unknown or invalid parameter input refuses first, unanswered
 * required parameters refuse next (listing every unanswered choice), and a
 * malformed or secret binding in the preset's SEEDS refuses here — all before
 * the setup handler runs, so a bad seed can never leave a half-applied preset.
 * The returned values are the single resolution the settings, templates and
 * seed steps all use; nothing downstream reads flags or the params file again.
 */
export function resolvePresetApplication(context: CommandHandlerContext): ResolvedPresetApplication {
  const options = context.options;
  const supplied = readSuppliedParameterValues(options);
  const definition = requirePresetDefinition(context.args?.[0], supplied);
  const manifest = PRESET_PARAMETERS[definition.id];
  const parameters = resolveParameterValues(manifest, supplied);
  const withSeeds = readBooleanOption(options, "withSeeds", "with-seeds");
  const dryRun = readBooleanOption(options, "dryRun", "dry-run");
  const seeds = withSeeds ? resolvedSeedsForPreset(definition.id, parameters.values) : undefined;
  return { definition, parameters, withSeeds, dryRun, seeds };
}

/**
 * Clone the command context so the setup handler receives the invocation's
 * resolved values (never a file path to re-read).
 */
export function contextWithResolvedParameters(
  context: CommandHandlerContext,
  application: ResolvedPresetApplication,
): CommandHandlerContext {
  return {
    ...context,
    options: { ...context.options, resolvedParameterValues: application.parameters },
  };
}