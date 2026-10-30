/** Host SDK resolution shared by template reads, plans and simulations. */
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
/** Actionable refusal; internal paths and raw child diagnostics never escape. */
export class SimulationRefusal extends Error {
    /** Stable machine-readable category. */
    code;
    /** A concrete next action for the caller. */
    remedy;
    /** Usage failures are distinct from execution failures. */
    exitCode;
    /** Construct a refusal without exposing the caller's configuration or filesystem. */
    constructor(code, remedy, exitCode = 2) {
        super(`${code}: ${remedy}`);
        this.name = "SimulationRefusal";
        this.code = code;
        this.remedy = remedy;
        this.exitCode = exitCode;
    }
}
/**
 * Lookup locations for one anchor. Workspace anchors keep their given location
 * first; the invoked CLI entry is followed to its real file first, because a
 * global bin symlink has no node_modules beside it.
 */
function anchorLocations(anchor) {
    let given;
    let canonical;
    try {
        given = anchor.startsWith("file:") ? fileURLToPath(anchor) : anchor;
        canonical = realpathSync(given);
    }
    catch {
        return [anchor]; // Virtual/nonexistent anchors still support require's normal lookup.
    }
    if (canonical === given)
        return [anchor];
    return given === process.argv[1] ? [canonical, anchor] : [anchor, canonical];
}
/** Resolve the peer from the package, the workspace or the CLI host, including invocation symlinks. */
export function resolveSimulationSdk(anchors) {
    for (const location of anchors.flatMap(anchorLocations)) {
        try {
            return createRequire(location).resolve("@unbrained/pm-cli/sdk");
        }
        catch {
            // The extension copy may have no node_modules; try the host next.
        }
    }
    throw new SimulationRefusal("sdk_unavailable", "Run with a pm CLI host >=2026.9.30 or install the declared peer dependency.", 1);
}
//# sourceMappingURL=sdk-loader.js.map