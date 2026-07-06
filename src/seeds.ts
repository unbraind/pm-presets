/**
 * seeds.ts — optional starter items for `presets apply <id> --with-seeds`.
 *
 * IMPORTANT (pm-cli issue #97): custom scalar fields registered via
 * `registerItemFields` have no `pm create --<field>` setter. Seed items
 * therefore set ONLY built-in fields (title, type, priority, tags, body). Any
 * preset-specific context lives in the body text, not in custom options.
 *
 * Seeding shells out to the `pm` binary so item IDs, the toon format, and
 * workspace governance are all handled by pm itself rather than re-implemented
 * here. The seed *definitions* and the dry-run plan are pure and unit-tested;
 * only `seedPresetItems` touches the process.
 */

import { spawnSync } from "node:child_process";

/** A single starter item, restricted to built-in create fields. */
export interface SeedItem {
  type: string;
  title: string;
  priority?: string;
  tags?: string;
  body?: string;
}

/** Built-in-only seed items keyed by preset id. */
export const PRESET_SEEDS: Record<string, SeedItem[]> = {
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
      title: "Define first roadmap initiative",
      priority: "2",
      tags: "roadmap",
      body: "Starter initiative seeded by pm-presets.",
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

export function seedsForPreset(presetId: string): SeedItem[] {
  return PRESET_SEEDS[presetId] ?? [];
}

/** Build the `pm create` argv for one seed item (built-in fields only). */
export function buildSeedCreateArgs(pmRoot: string, seed: SeedItem): string[] {
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

export interface SeedPlanEntry {
  title: string;
  type: string;
  command: string;
}

/** Pure dry-run plan: what `--with-seeds` would create, without running anything. */
export function planSeeds(pmRoot: string, presetId: string): SeedPlanEntry[] {
  return seedsForPreset(presetId).map((seed) => ({
    title: seed.title,
    type: seed.type,
    command: `pm ${buildSeedCreateArgs(pmRoot, seed).join(" ")}`,
  }));
}

export interface SeedResult {
  created: number;
  failed: number;
  details: Array<{ title: string; ok: boolean; message?: string }>;
}

/**
 * Create the preset's starter items by shelling out to `pm create`.
 * Non-throwing: failures are collected so a partial seed still reports clearly.
 */
export function seedPresetItems(pmRoot: string, presetId: string, pmBin = "pm"): SeedResult {
  const seeds = seedsForPreset(presetId);
  const details: SeedResult["details"] = [];
  let created = 0;
  let failed = 0;

  for (const seed of seeds) {
    const result = spawnSync(pmBin, buildSeedCreateArgs(pmRoot, seed), {
      encoding: "utf8",
    });
    if (result.status === 0) {
      created += 1;
      details.push({ title: seed.title, ok: true });
    } else {
      failed += 1;
      const message = (result.stderr || result.stdout || result.error?.message || "")
        .toString()
        .trim()
        .split("\n")[0];
      details.push({ title: seed.title, ok: false, message });
    }
  }

  return { created, failed, details };
}
