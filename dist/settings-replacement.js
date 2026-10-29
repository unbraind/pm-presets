/** Derive replacement-owned trees through the host's serializer on isolated synthetic settings. */
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSimulationSdk } from "./sdk-loader.js";
import { ParameterRefusal } from "./params.js";
/** Normalize only public owned settings trees; workspace values and secret maps never enter the scratch tracker. */
export async function replacementSettings(patch) {
    const scratch = await mkdtemp(join(tmpdir(), "preset-replacement-"));
    const trees = ["governance", "validation", "testing"];
    let result;
    let failure;
    try {
        const sdk = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url, process.argv[1]]));
        const client = new sdk.PmClient({ pmRoot: scratch, noExtensions: true });
        await client.init(patch.id_prefix);
        const isolated = sdk.createExtensionCommandSdk(scratch, client);
        await isolated.mutateWorkspaceSettings({ operationId: "preset-replacement-plan", replaceSubtrees: trees, mutate: (current) => {
                const result = structuredClone(current);
                for (const tree of trees) {
                    if (patch[tree] === undefined)
                        delete result[tree];
                    else
                        result[tree] = patch[tree];
                }
                return result;
            } });
        const serialized = JSON.parse(await readFile(join(scratch, "settings.json"), "utf8"));
        result = Object.fromEntries(trees.map((tree) => [tree, Object.getOwnPropertyDescriptor(serialized, tree).value]));
    }
    catch {
        failure = new ParameterRefusal("artifact_unreadable", "The host could not plan canonical replacement settings. Inspect the preset's public governance/validation/testing configuration before retrying.");
    }
    // Cleanup completes before either result or typed failure escapes. Keeping
    // one exit also prevents a cleanup exception from exposing host diagnostics.
    try {
        await rm(scratch, { recursive: true, force: true });
    }
    catch {
        failure = new ParameterRefusal("artifact_unreadable", "Could not clean isolated public-settings normalization state. Inspect filesystem access before retrying; the target tracker was not modified by planning.");
    }
    if (failure)
        throw failure;
    return result;
}
//# sourceMappingURL=settings-replacement.js.map