/** Read managed seed contents through the authoritative host SDK, never tracker parsing. */
import { createRequire } from "node:module";
import { resolveSimulationSdk } from "./sdk-loader.js";
import { ParameterRefusal } from "./params.js";
/** Read complete managed items; absent ids differ, and other read failures refuse. */
export async function readSeedArtifacts(pmRoot, ids, client) {
    if (ids.length === 0)
        return {};
    try {
        const sdk = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url, process.argv[1]]));
        const settings = await sdk.readSettings(pmRoot);
        const registry = sdk.resolveItemTypeRegistry(settings);
        const schema = await (client ?? new sdk.PmClient({ pmRoot, noExtensions: true })).schemaList();
        const types = [...schema.builtin, ...schema.custom, ...schema.extension];
        if (types.length !== schema.counts.total)
            throw new Error("Incomplete active schema");
        const folders = Object.fromEntries([...Object.entries(registry.type_to_folder), ...types.map(({ name, folder }) => [name, folder])]);
        const entries = [];
        for (const id of ids) {
            const located = await sdk.locateItem(pmRoot, id, settings.id_prefix, settings.item_format, folders);
            if (!located)
                continue;
            const { document } = await sdk.readLocatedItem(located, { schema: settings.schema });
            entries.push([id, { ...document.metadata, body: document.body }]);
        }
        return Object.fromEntries(entries);
    }
    catch {
        throw new ParameterRefusal("artifact_unreadable", `Cannot read managed artifacts completely: ${ids.map((id) => `items/${id}`).join(", ")}. Check tracker access and repair malformed documents before applying.`);
    }
}
//# sourceMappingURL=artifact-reader.js.map