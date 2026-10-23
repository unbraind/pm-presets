/** Host SDK resolution shared by template reads, plans and simulations. */
import { createRequire } from "node:module";
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
/** Resolve the peer from the package or the CLI host, including standalone extension copies. */
export function resolveSimulationSdk(anchors) {
    for (const anchor of anchors) {
        try {
            return createRequire(anchor).resolve("@unbrained/pm-cli/sdk");
        }
        catch {
            // The extension copy may have no node_modules; try the host next.
        }
    }
    throw new SimulationRefusal("sdk_unavailable", "Run with a pm CLI host >=2026.9.30 or install the declared peer dependency.", 1);
}
//# sourceMappingURL=sdk-loader.js.map