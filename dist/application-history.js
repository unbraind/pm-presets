import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { resolveSimulationSdk } from "./sdk-loader.js";
import { ownArtifact, presetArtifactRecord } from "./desired-state.js";
const verified = new Map();
/** Read/replay through public SDK contracts; no history, usage or cache mutation. */
export async function readPresetApplicationHistory(pmRoot) {
    const file = join(pmRoot, "history", "_workspace.jsonl");
    if (!existsSync(file))
        return { records: {}, errors: [] };
    try {
        const sdk = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url, process.argv[1]]));
        const { entries, raw } = await sdk.readHistorySnapshot(file, "_workspace");
        const digest = createHash("sha256").update(raw).digest("hex");
        const cached = verified.get(pmRoot);
        if (cached?.digest === digest)
            return structuredClone(cached.value);
        const latest = entries.length > 0 ? sdk.replayHistoryToTarget(entries, entries.length - 1) : undefined;
        const records = new Map();
        for (let index = entries.length - 1; index >= 0; index--) {
            const match = /^extension:(?:[^:]+:)*settings:(?:[^:]+:)*pm-presets-([a-z][a-z0-9-]*)-[a-f0-9-]{36}$/.exec(entries[index].op);
            if (!match || records.has(match[1]))
                continue;
            const replayed = index === entries.length - 1 ? latest : sdk.replayHistoryToTarget(entries, index);
            const documents = ownArtifact(replayed.metadata, "documents");
            const settings = ownArtifact(documents, "settings.json");
            records.set(match[1], structuredClone(presetArtifactRecord(settings, match[1]) ?? null));
        }
        const value = { records: Object.fromEntries(records), errors: [] };
        verified.delete(pmRoot);
        if (verified.size >= 16)
            verified.delete(verified.keys().next().value);
        verified.set(pmRoot, { digest, value });
        return structuredClone(value);
    }
    catch {
        return { records: {}, errors: ["history/_workspace.jsonl"] };
    }
}
/** Verify cumulative template/settings ownership against a recorded preset settings mutation. */
export async function readPresetOwnership(pmRoot) {
    const file = join(pmRoot, "history", "_workspace.jsonl");
    if (!existsSync(file))
        return {};
    const sdk = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url, process.argv[1]]));
    const { entries } = await sdk.readHistorySnapshot(file, "_workspace");
    for (let index = entries.length - 1; index >= 0; index--) {
        if (!/^extension:(?:[^:]+:)*settings:(?:[^:]+:)*pm-presets-[a-z][a-z0-9-]*-[a-f0-9-]{36}$/.test(entries[index].op))
            continue;
        const replayed = sdk.replayHistoryToTarget(entries, index);
        const documents = ownArtifact(replayed.metadata, "documents");
        const settings = ownArtifact(documents, "settings.json");
        return (ownArtifact(settings, "preset_ownership") ?? {});
    }
    return {};
}
//# sourceMappingURL=application-history.js.map