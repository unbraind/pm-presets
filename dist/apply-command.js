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
import { PRESET_PARAMETERS } from "./registry.js";
import { requirePresetDefinition } from "./catalog.js";
import { readBooleanOption } from "./presets/shared.js";
import { readSuppliedParameterValues, resolveParameterValues } from "./params.js";
import { resolvedSeedsForPreset } from "./seeds.js";
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
export function resolvePresetApplication(context) {
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
export function contextWithResolvedParameters(context, application) {
    return {
        ...context,
        options: { ...context.options, resolvedParameterValues: application.parameters },
    };
}
//# sourceMappingURL=apply-command.js.map