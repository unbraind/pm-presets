export { resolveSimulationSdk, SimulationRefusal, type SimulationRefusalCode } from "./sdk-loader.ts";
/** Versioned, bounded probes; arbitrary commands and caller workspaces are never accepted. */
export declare const PRESET_SCENARIOS: readonly ["create-task", "claim-start", "close-without-evidence", "close-with-evidence"];
/** Identifies a built-in agent workflow, rather than executable user input. */
export type PresetScenarioId = typeof PRESET_SCENARIOS[number];
/** Select a subset to inspect; omissions remain visible as coverage gaps. */
export interface PresetSimulationOptions {
    /** Bundled preset id (same names accepted by presets apply). */
    readonly preset: string;
    /** Defaults to the complete suite. An empty list explicitly measures no scenarios. */
    readonly scenarios?: readonly PresetScenarioId[];
}
/** Stable observations, excluding random ids, clock values, warnings and local paths. */
export interface PresetScenarioResult {
    /** Workflow that was executed. */
    readonly id: PresetScenarioId;
    /** Declared expected end state for this preset's governance. */
    readonly expected: "open" | "in_progress" | "closed" | "refused";
    /** Measured end state; unexpected failures remain visible. */
    readonly actual: "open" | "in_progress" | "closed" | "refused";
    /** Whether the observation matched the declared behavior. */
    readonly passed: boolean;
    /** Stable advice when the workflow was refused. */
    readonly remedy: string;
}
/** Compact SDK/TOON/JSON report; partial coverage can never look complete. */
export interface PresetSimulationReport {
    /** False for a mismatch or omitted workflow. */
    readonly ok: boolean;
    /** Contract version for comparing deterministic reports. */
    readonly suiteVersion: 1;
    /** Canonical preset identifier. */
    readonly preset: string;
    /** Execution boundary, independent of the invoking workspace. */
    readonly isolation: "synthetic-no-extensions";
    /** Number of workflows actually executed. */
    readonly checked: number;
    /** Number matching their declared expectations. */
    readonly passed: number;
    /** Omitted workflows, in canonical suite order. */
    readonly coverageGaps: readonly PresetScenarioId[];
    /** Limits that apply even when every declared scenario passes. */
    readonly limitations: readonly string[];
    /** Results in canonical suite order, independent of selection order. */
    readonly scenarios: readonly PresetScenarioResult[];
}
/** Apply settings and execute real SDK operations; called only inside the isolated process. */
export declare function executeSyntheticScenarios(root: string, preset: string, scenarios: readonly PresetScenarioId[], sdkPath: string): Promise<PresetSimulationReport>;
/** Simulate before installing: no caller tracker is read, copied, installed into, or mutated. */
export declare function simulatePreset(options: PresetSimulationOptions): PresetSimulationReport;
//# sourceMappingURL=simulation.d.ts.map