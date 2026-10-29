/** Host SDK resolution shared by template reads, plans and simulations. */
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";

/** Failure categories agents can branch on before retrying. */
export type SimulationRefusalCode = "unknown_preset" | "unknown_scenario" | "duplicate_scenario" | "sdk_unavailable" | "simulation_failed";
/** Actionable refusal; internal paths and raw child diagnostics never escape. */
export class SimulationRefusal extends Error {
  /** Stable machine-readable category. */
  readonly code: SimulationRefusalCode;
  /** A concrete next action for the caller. */
  readonly remedy: string;
  /** Usage failures are distinct from execution failures. */
  readonly exitCode: number;
  /** Construct a refusal without exposing the caller's configuration or filesystem. */
  constructor(code: SimulationRefusalCode, remedy: string, exitCode = 2) {
    super(`${code}: ${remedy}`);
    this.name = "SimulationRefusal";
    this.code = code;
    this.remedy = remedy;
    this.exitCode = exitCode;
  }
}

/** Resolve the peer from canonical package/CLI locations, including invocation symlinks. */
export function resolveSimulationSdk(anchors: readonly string[]): string {
  for (const anchor of anchors) {
    let canonical = anchor;
    try { canonical = realpathSync(anchor.startsWith("file:") ? new URL(anchor) : anchor); }
    catch { /* Virtual/nonexistent anchors still support require's normal lookup. */ }
    try {
      return createRequire(canonical).resolve("@unbrained/pm-cli/sdk");
    } catch {
      // The extension copy may have no node_modules; try the host next.
    }
  }
  throw new SimulationRefusal("sdk_unavailable", "Run with a pm CLI host >=2026.9.30 or install the declared peer dependency.", 1);
}
