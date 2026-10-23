/** Read-only CLI bridge; remote hosts can supply provider-owned contract snapshots. */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { getWorkspaceContracts } from "@unbrained/pm-cli/sdk";
import type { CommandHandlerContext, ExtensionApi } from "@unbrained/pm-cli/sdk/authoring";
import { resolveSimulationSdk } from "./sdk-loader.ts";
import { readBooleanOption, readStringOption, resolvePmDir } from "./presets/shared.ts";
import { readWorkspaceSettings } from "./export.ts";
import { readPresetArtifact } from "./upgrade-command.ts";
import { bundledPresetComposition, compilePresetPlan, PlanRefusal, summarizePresetPlan } from "./plan.ts";
import type { PresetComposition, PresetPlanTarget } from "./plan.ts";

/** Translate bounded artifact reader failures into this surface's stable typed refusal. */
function artifact(file: string): unknown {
  try { return readPresetArtifact(file); }
  catch { throw new PlanRefusal("invalid_input", "Use a readable regular JSON artifact no larger than 1 MiB; see pm presets plan --help."); }
}
/** Resolve the host's real activated contracts, preserving standalone extension loading. */
export async function readDirectoryPlanTarget(ctx: CommandHandlerContext): Promise<PresetPlanTarget> {
  const pmRoot = resolvePmDir(ctx);
  if (!existsSync(join(pmRoot, "settings.json"))) throw new PlanRefusal("contracts_unavailable", "Initialize a tracker with pm init, or supply --target with the selected provider's contract snapshot.");
  try {
    if (!readWorkspaceSettings(pmRoot)) throw new Error("Unreadable settings");
    const sdkPath = resolveSimulationSdk([import.meta.url, join(process.cwd(), "package.json"), process.argv[1]]);
    const sdk = createRequire(import.meta.url)(sdkPath) as { getWorkspaceContracts: typeof getWorkspaceContracts };
    const contracts = await sdk.getWorkspaceContracts(pmRoot, { cwd: process.cwd(), noExtensions: ctx.global?.noExtensions === true });
    const capabilities: string[] = ["templates.write"];
    if (typeof ctx.sdk?.mutateWorkspaceSettings === "function") capabilities.push("settings.audit");
    if (typeof ctx.sdk?.client.create === "function") capabilities.push("items.create");
    return { backend: "directory", capabilities, contracts };
  } catch {
    throw new PlanRefusal("contracts_unavailable", "Use a pm host with getWorkspaceContracts support and check extension health, or supply a complete selected-provider --target snapshot.");
  }
}
/** Compile a bundled or composed preset; failed required prerequisites request a structured nonzero exit. */
export async function runPresetPlan(ctx: CommandHandlerContext) {
  const compositionFile = readStringOption(ctx.options, "composition");
  const targetFile = readStringOption(ctx.options, "target");
  const seeds = readBooleanOption(ctx.options, "withSeeds", "with-seeds");
  if ((compositionFile && (ctx.args.length > 0 || seeds)) || (!compositionFile && ctx.args.length !== 1)) {
    throw new PlanRefusal("invalid_input", "Choose one bundled preset id (optionally --with-seeds), or --composition with no preset id or seed flag.");
  }
  const composition = compositionFile ? artifact(compositionFile) as PresetComposition : bundledPresetComposition(ctx.args[0], seeds);
  const target = targetFile ? artifact(targetFile) as PresetPlanTarget : await readDirectoryPlanTarget(ctx);
  const plan = summarizePresetPlan(compilePresetPlan(composition, target));
  return plan.ready ? plan : { ...plan, exit_code: 2,
    code: "missing_capability", remediation: "Resolve the required feature gaps and replan before applying settings." };
}
/** Register a first-class read surface so host TOON/JSON projection and budgets remain available. */
export function registerPlanCommand(api: ExtensionApi): void {
  api.registerCommand({
    name: "presets plan", action: "presets-plan", family: "workspace", read_output: { row_keys: ["gaps"] },
    description: "Negotiate required and optional preset prerequisites without mutating settings or tracker data.",
    arguments: [{ name: "preset", required: false, description: "Bundled preset id; omit when using --composition." }],
    examples: ["pm presets plan kanban --json", "pm presets plan --composition composition.json --target target.json --json"],
    flags: [
      { long: "--composition", value_type: "string", value_name: "<file>", description: "Bounded JSON composed feature requirements instead of a bundled preset." },
      { long: "--target", value_type: "string", value_name: "<file>", description: "Selected provider's backend, capabilities and SDK workspace contracts; never inferred from its backend label." },
      { long: "--with-seeds", value_type: "boolean", description: "Also require the bundled preset's starter-item creation capability." },
    ],
    run: runPresetPlan,
  });
}
