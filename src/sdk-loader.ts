/** Host SDK resolution shared by template reads, plans and simulations. */
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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

/**
 * Lookup locations for one anchor. Workspace anchors keep their given location
 * first; the invoked CLI entry is followed to its real file first, because a
 * global bin symlink has no node_modules beside it.
 */
function anchorLocations(anchor: string): string[] {
  let given: string;
  let canonical: string;
  try {
    given = anchor.startsWith("file:") ? fileURLToPath(anchor) : anchor;
    canonical = realpathSync(given);
  } catch {
    return [anchor]; // Virtual/nonexistent anchors still support require's normal lookup.
  }
  if (canonical === given) return [anchor];
  return given === process.argv[1] ? [canonical, anchor] : [anchor, canonical];
}

/** Resolve the peer from the package, the workspace or the CLI host, including invocation symlinks. */
export function resolveSimulationSdk(anchors: readonly string[]): string {
  for (const location of anchors.flatMap(anchorLocations)) {
    try {
      return createRequire(location).resolve("@unbrained/pm-cli/sdk");
    } catch {
      // The extension copy may have no node_modules; try the host next.
    }
  }
  throw new SimulationRefusal("sdk_unavailable", "Run with a pm CLI host >=2026.9.30 or install the declared peer dependency.", 1);
}
