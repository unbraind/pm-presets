/** Recover managed ownership from the host's verified append-only settings audit. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { resolveSimulationSdk } from "./sdk-loader.ts";
import { ownArtifact, presetArtifactRecord, type PresetArtifactRecord } from "./desired-state.ts";

/** Verified last application ownership, or named uncertainty without exposing audit values. */
export interface PresetApplicationHistory {
  records: Record<string, PresetArtifactRecord | null>;
  errors: string[];
}

const verified = new Map<string, { digest: string; value: PresetApplicationHistory }>();

/** Read/replay through public SDK contracts; no history, usage or cache mutation. */
export async function readPresetApplicationHistory(pmRoot: string): Promise<PresetApplicationHistory> {
  const file = join(pmRoot, "history", "_workspace.jsonl");
  if (!existsSync(file)) return { records: {}, errors: [] };
  try {
    const sdk = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url, process.argv[1]])) as typeof import("@unbrained/pm-cli/sdk");
    const { entries, raw } = await sdk.readHistorySnapshot(file, "_workspace");
    const digest = createHash("sha256").update(raw!).digest("hex");
    const cached = verified.get(pmRoot);
    if (cached?.digest === digest) return structuredClone(cached.value);
    const latest = entries.length > 0 ? sdk.replayHistoryToTarget(entries, entries.length - 1) : undefined;
    const records = new Map<string, PresetArtifactRecord | null>();
    for (let index = entries.length - 1; index >= 0; index--) {
      const match = /^extension:(?:[^:]+:)*settings:(?:[^:]+:)*pm-presets-([a-z][a-z0-9-]*)-[a-f0-9-]{36}$/.exec(entries[index].op);
      if (!match || records.has(match[1])) continue;
      const replayed = index === entries.length - 1 ? latest! : sdk.replayHistoryToTarget(entries, index);
      const documents = ownArtifact(replayed.metadata, "documents") as Record<string, unknown> | undefined;
      const settings = ownArtifact(documents, "settings.json") as Record<string, unknown> | undefined;
      records.set(match[1], structuredClone(presetArtifactRecord(settings, match[1]) ?? null));
    }
    const value = { records: Object.fromEntries(records), errors: [] };
    verified.delete(pmRoot);
    if (verified.size >= 16) verified.delete(verified.keys().next().value!);
    verified.set(pmRoot, { digest, value });
    return structuredClone(value);
  } catch { return { records: {}, errors: ["history/_workspace.jsonl"] }; }
}
