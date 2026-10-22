/** CLI boundary for private migration artifacts and compact agent-facing results. */
import { closeSync, constants, fstatSync, openSync, readSync, writeFileSync } from "node:fs";
import type { CommandHandlerContext, ExtensionApi } from "@unbrained/pm-cli/sdk/authoring";
import { readStringOption } from "./presets/shared.ts";
import { executePresetUpgrade, parseUpgradeReceipt, planPresetUpgrade, summarizePresetUpgrade, UpgradeRefusal } from "./upgrade.ts";
import type { UpgradeDecisions, VersionedPreset } from "./upgrade.ts";

/** Read one bounded JSON artifact, suppressing filesystem paths and private parser diagnostics. */
function artifact(file: string | undefined): unknown {
  if (!file) throw new UpgradeRefusal("invalid_input", "Provide the required JSON artifact flags; see pm presets upgrade plan --help.");
  try {
    const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) throw new Error("artifact size or type");
      const buffer = Buffer.alloc(1024 * 1024 + 1);
      let size = 0;
      while (size < buffer.length) {
        const count = readSync(fd, buffer, size, buffer.length - size, null);
        if (count === 0) break;
        size += count;
      }
      if (size > 1024 * 1024) throw new Error("artifact grew beyond limit");
      return JSON.parse(buffer.subarray(0, size).toString("utf8")) as unknown;
    } finally {
      closeSync(fd);
    }
  } catch {
    throw new UpgradeRefusal("invalid_input", "Use a readable regular JSON file no larger than 1 MiB.");
  }
}
/** Register settings-only migration commands; no workspace discovery or Git subprocess is needed. */
export function registerUpgradeCommands(api: ExtensionApi): void {
  api.registerCommand({
    name: "presets upgrade plan", action: "presets-upgrade-plan",
    description: "Plan versioned vendor settings evolution and save a private recovery receipt without mutating the tracker.",
    examples: ["pm presets upgrade plan --from vendor-v1.json --to vendor-v2.json --receipt upgrade.private.json", "pm presets upgrade plan --from vendor-v1.json --to vendor-v2.json --decisions decisions.json --receipt resolved.private.json --json"],
    flags: [
      { long: "--from", value_type: "string", value_name: "<file>", description: "Original versioned vendor settings JSON." },
      { long: "--to", value_type: "string", value_name: "<file>", description: "Target versioned vendor settings JSON." },
      { long: "--decisions", value_type: "string", value_name: "<file>", description: "JSON pointer to local/vendor conflict decisions." },
      { long: "--generation", value_type: "string", value_name: "<id>", description: "Explicit new migration generation after rollback; defaults to 1 for stable retries." },
      { long: "--receipt", value_type: "string", value_name: "<file>", description: "New private receipt file; existing files are never overwritten." },
    ],
    run: async (ctx: CommandHandlerContext) => {
      const output = readStringOption(ctx.options, "receipt");
      if (!output) throw new UpgradeRefusal("invalid_input", "Provide --receipt with a new private file to retain recovery settings before applying.");
      const decisionFile = readStringOption(ctx.options, "decisions");
      const receipt = await planPresetUpgrade(ctx.sdk!, artifact(readStringOption(ctx.options, "from")) as VersionedPreset,
        artifact(readStringOption(ctx.options, "to")) as VersionedPreset, decisionFile ? artifact(decisionFile) as UpgradeDecisions : {}, readStringOption(ctx.options, "generation"));
      try {
        const serialized = JSON.stringify(receipt) + "\n";
        if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error("receipt too large");
        writeFileSync(output, serialized, { flag: "wx", mode: 0o600 });
      } catch {
        throw new UpgradeRefusal("invalid_input", "Choose a new writable receipt file; keep the complete receipt below 1 MiB. Existing artifacts are never overwritten.");
      }
      return summarizePresetUpgrade(receipt);
    },
  });
  for (const direction of ["apply", "rollback"] as const) {
    api.registerCommand({
      name: `presets upgrade ${direction}`, action: `presets-upgrade-${direction}`,
      description: `${direction === "apply" ? "Apply" : "Roll back"} a resolved preset migration through audited SDK settings mutations.`,
      arguments: [{ name: "receipt", required: true, description: "Private JSON receipt saved by presets upgrade plan." }],
      examples: [`pm presets upgrade ${direction} upgrade.private.json --json`],
      run: async (ctx: CommandHandlerContext) => executePresetUpgrade(ctx.sdk!, parseUpgradeReceipt(artifact(ctx.args?.[0])), direction),
    });
  }
}
