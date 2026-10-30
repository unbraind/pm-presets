/** Failure categories agents can branch on before retrying. */
export type SimulationRefusalCode = "unknown_preset" | "unknown_scenario" | "duplicate_scenario" | "sdk_unavailable" | "simulation_failed";
/** Actionable refusal; internal paths and raw child diagnostics never escape. */
export declare class SimulationRefusal extends Error {
    /** Stable machine-readable category. */
    readonly code: SimulationRefusalCode;
    /** A concrete next action for the caller. */
    readonly remedy: string;
    /** Usage failures are distinct from execution failures. */
    readonly exitCode: number;
    /** Construct a refusal without exposing the caller's configuration or filesystem. */
    constructor(code: SimulationRefusalCode, remedy: string, exitCode?: number);
}
/** Resolve the peer from the package, the workspace or the CLI host, including invocation symlinks. */
export declare function resolveSimulationSdk(anchors: readonly string[]): string;
//# sourceMappingURL=sdk-loader.d.ts.map