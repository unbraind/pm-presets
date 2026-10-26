import { readPresetArtifact } from "./upgrade-command.js";
import { readStringOption, resolvePmDir } from "./presets/shared.js";
import { planPresetStack, StackRefusal, summarizePresetStack } from "./stack.js";
/** Read one bounded JSON selection artifact; the planner owns the only input schema. */
async function runStack(ctx) {
    let input;
    try {
        input = readPresetArtifact(readStringOption(ctx.options, "input"));
    }
    catch {
        throw new StackRefusal("invalid_input", "Provide --input with a readable regular JSON file no larger than 1 MiB; see pm presets stack --help.");
    }
    return summarizePresetStack(await planPresetStack(resolvePmDir(ctx), ctx.sdk, input));
}
/** Register an always-preview command; no apply, journal, export or receipt is written. */
export function registerStackCommand(api) {
    api.registerCommand({
        name: "presets stack", action: "presets-stack", family: "workspace", read_output: { row_keys: ["ownership"] },
        description: "Preview selected preset contributions through host profile planning; require explicit choices for competing ownership.",
        examples: ["pm presets stack --input stack.json --json", "pm presets stack --input stack.json"],
        flags: [{ long: "--input", value_type: "string", value_name: "<file>", description: "Bounded JSON {selections,choices?}; settings/templates default on, seeds default off." }],
        run: runStack,
    });
}
//# sourceMappingURL=stack-command.js.map