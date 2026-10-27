/**
 * seeds.ts — optional starter items for `presets apply <id> --with-seeds`.
 *
 * IMPORTANT (pm-cli issue #97): custom scalar fields registered via
 * `registerItemFields` have no `pm create --<field>` setter. Seed items
 * therefore set ONLY built-in fields (title, type, priority, tags, body). Any
 * preset-specific context lives in the body text, not in custom options.
 *
 * Seeding uses the invocation-bound SDK client so IDs, storage, schema and
 * governance stay host-owned. The argv builder below is presentation-only:
 * existing dry-run consumers can still display a manual create command.
 */
import { CommandError } from "./presets/shared.js";
import { PRESET_PARAMETERS } from "./registry.js";
import { resolveSeedsWithParameters, resolveParameterValues } from "./params.js";
/** Built-in-only seed items keyed by preset id. */
export const PRESET_SEEDS = {
    "bug-triage": [
        {
            type: "Issue",
            title: "Example production incident",
            priority: "1",
            tags: "incident,production",
            body: "Starter incident seeded by pm-presets. Replace with a real incident.",
        },
    ],
    "indie-dev": [
        {
            type: "Task",
            title: "Set up project skeleton",
            priority: "2",
            tags: "task",
            body: "Starter task seeded by pm-presets.",
        },
    ],
    "open-source": [
        {
            type: "Issue",
            title: "Triage incoming community issues",
            priority: "2",
            tags: "triage",
            body: "Starter triage issue seeded by pm-presets.",
        },
    ],
    "software-sprint": [
        {
            type: "Epic",
            title: "First sprint epic",
            priority: "2",
            tags: "epic,sprint",
            body: "Starter epic seeded by pm-presets.",
        },
        {
            type: "Task",
            title: "First sprint task",
            priority: "2",
            tags: "task,sprint",
            body: "Starter task seeded by pm-presets.",
        },
    ],
    "startup-roadmap": [
        {
            type: "Feature",
            title: "Define the ${param:projectKey} first roadmap initiative",
            priority: "2",
            tags: "roadmap",
            body: "Starter initiative for the ${param:projectKey} project seeded by pm-presets. Replace with a real initiative.",
        },
    ],
    "kanban": [
        {
            type: "Card",
            title: "First card on the board",
            priority: "2",
            tags: "kanban",
            body: "Starter card seeded by pm-presets.",
        },
    ],
    "agent-workflow": [
        {
            type: "AgentRun",
            title: "First delegated agent task",
            priority: "2",
            tags: "agent,task",
            body: "Starter agent run seeded by pm-presets. Replace with a real delegated task.",
        },
    ],
};
/**
 * Resolve a preset id to its starter seed items.
 *
 * Returns an empty array for an id with no seeds (including an unknown id),
 * so callers can iterate unconditionally and a preset that ships no seeds is
 * simply a no-op rather than an error.
 */
export function seedsForPreset(presetId) {
    return PRESET_SEEDS[presetId] ?? [];
}
/**
 * Resolve a preset's seed items against its typed parameter manifest.
 *
 * Seeds are authored with `${param:<name>}` occurrences exactly like settings
 * and templates; the SAME resolution engine substitutes every occurrence and
 * refuses secret bindings in the public seed prose before anything is created.
 * Presets without parameters return their seeds unchanged.
 */
export function resolvedSeedsForPreset(presetId, supplied = {}) {
    const seeds = seedsForPreset(presetId);
    const manifest = PRESET_PARAMETERS[presetId] ?? [];
    if (manifest.length === 0 || seeds.length === 0) {
        return seeds;
    }
    const values = resolveParameterValues(manifest, supplied).values;
    return resolveSeedsWithParameters(manifest, values, seeds).seeds;
}
/** Build a manual command preview only; seed writes never execute these arguments. */
export function buildSeedCreateArgs(pmRoot, seed) {
    const args = ["--path", pmRoot, "create", "--type", seed.type, "--title", seed.title];
    if (seed.priority) {
        args.push("--priority", seed.priority);
    }
    if (seed.tags) {
        args.push("--tags", seed.tags);
    }
    if (seed.body) {
        args.push("--body", seed.body);
    }
    return args;
}
/** Pure dry-run plan: what `--with-seeds` would create, without running anything. */
export function planSeeds(pmRoot, presetId, supplied = {}) {
    return resolvedSeedsForPreset(presetId, supplied).map((seed) => ({
        title: seed.title,
        type: seed.type,
        command: `pm ${buildSeedCreateArgs(pmRoot, seed).join(" ")}`,
    }));
}
/**
 * Create independent starter items through the invocation-bound SDK client.
 * Non-throwing: native create failures retain the existing partial-result shape.
 * There is no batch/replay precondition: an invalid seed must not undo others.
 */
export async function seedPresetItems(client, presetId, supplied = {}) {
    const seeds = resolvedSeedsForPreset(presetId, supplied);
    const details = [];
    let created = 0;
    let failed = 0;
    for (const seed of seeds) {
        try {
            // State every relationship/scope field explicitly (no ambient defaults):
            // `unset: ["parent"]` is the SDK's explicit no-parent form, so a random
            // ambient session focus can never be inherited as the seed's parent.
            await client.create({ ...seed, unset: ["parent"] });
            created += 1;
            details.push({ title: seed.title, ok: true });
        }
        catch (error) {
            failed += 1;
            const message = (error instanceof Error ? error.message : String(error)).trim().split("\n")[0];
            details.push({ title: seed.title, ok: false, message });
        }
    }
    return { created, failed, details };
}
/**
 * Print a dry-run plan or create starter items for an already-applied preset.
 *
 * Logs the seedless case so `presets apply --with-seeds` on a preset with no
 * seeds is an explicit no-op rather than silence. Throws {@link CommandError}
 * when one or more creates fail, after reporting each outcome.
 */
export async function runPresetSeeds(pmRoot, presetId, options) {
    const seeds = resolvedSeedsForPreset(presetId, options.suppliedParameters);
    if (seeds.length === 0) {
        console.log(`No starter seeds defined for '${presetId}'.`);
        return;
    }
    if (options.dryRun) {
        console.log("");
        console.log(`[dry-run] Would seed ${seeds.length} starter item(s):`);
        for (const entry of planSeeds(pmRoot, presetId, options.suppliedParameters)) {
            console.log(`  - ${entry.type}: ${entry.title}`);
        }
        return;
    }
    console.log("");
    console.log(`Seeding ${seeds.length} starter item(s)...`);
    if (typeof options.client?.create !== "function") {
        throw new CommandError("Preset seeds require the host SDK client.create capability. Run with a pm CLI host >=2026.9.30.");
    }
    const seedResult = await seedPresetItems(options.client, presetId, options.suppliedParameters);
    for (const detail of seedResult.details) {
        if (detail.ok) {
            console.log(`  Created: ${detail.title}`);
        }
        else {
            console.warn(`  Failed:  ${detail.title}${detail.message ? ` (${detail.message})` : ""}`);
        }
    }
    if (seedResult.failed > 0) {
        throw new CommandError(`Seeded ${seedResult.created} item(s) but ${seedResult.failed} failed.`);
    }
}
//# sourceMappingURL=seeds.js.map