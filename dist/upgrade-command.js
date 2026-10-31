/** CLI boundary for private migration artifacts and compact agent-facing results. */
import { writeFileSync } from "node:fs";
import { readBoundedInputFile } from "./input-file.js";
import { readStringOption } from "./presets/shared.js";
import { executePresetUpgrade, parseUpgradeReceipt, planPresetUpgrade, summarizePresetUpgrade, UpgradeRefusal } from "./upgrade.js";
/** Read one bounded JSON artifact, suppressing filesystem paths and private parser diagnostics. */
export function readPresetArtifact(file) {
    if (!file)
        throw new UpgradeRefusal("invalid_input", "Provide the required JSON artifact flags; see pm presets upgrade plan --help.");
    try {
        return JSON.parse(readBoundedInputFile(file, 1024 * 1024));
    }
    catch {
        throw new UpgradeRefusal("invalid_input", "Use a readable regular JSON file no larger than 1 MiB.");
    }
}
/** Register settings-only migration commands; no workspace discovery or Git subprocess is needed. */
export function registerUpgradeCommands(api) {
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
        run: async (ctx) => {
            const output = readStringOption(ctx.options, "receipt");
            if (!output)
                throw new UpgradeRefusal("invalid_input", "Provide --receipt with a new private file to retain recovery settings before applying.");
            const decisionFile = readStringOption(ctx.options, "decisions");
            const receipt = await planPresetUpgrade(ctx.sdk, readPresetArtifact(readStringOption(ctx.options, "from")), readPresetArtifact(readStringOption(ctx.options, "to")), decisionFile ? readPresetArtifact(decisionFile) : {}, readStringOption(ctx.options, "generation"));
            try {
                const serialized = JSON.stringify(receipt) + "\n";
                if (Buffer.byteLength(serialized) > 1024 * 1024)
                    throw new Error("receipt too large");
                writeFileSync(output, serialized, { flag: "wx", mode: 0o600 });
            }
            catch {
                throw new UpgradeRefusal("invalid_input", "Choose a new writable receipt file; keep the complete receipt below 1 MiB. Existing artifacts are never overwritten.");
            }
            return summarizePresetUpgrade(receipt);
        },
    });
    for (const direction of ["apply", "rollback"]) {
        api.registerCommand({
            name: `presets upgrade ${direction}`, action: `presets-upgrade-${direction}`,
            description: `${direction === "apply" ? "Apply" : "Roll back"} a resolved preset migration through audited SDK settings mutations.`,
            arguments: [{ name: "receipt", required: true, description: "Private JSON receipt saved by presets upgrade plan." }],
            examples: [`pm presets upgrade ${direction} upgrade.private.json --json`],
            run: async (ctx) => executePresetUpgrade(ctx.sdk, parseUpgradeReceipt(readPresetArtifact(ctx.args?.[0])), direction),
        });
    }
}
//# sourceMappingURL=upgrade-command.js.map