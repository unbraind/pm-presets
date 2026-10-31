/** Identify a kernel/PID namespace; unverifiable realms deliberately cannot reap one another. */
export declare function captureAdmissionRealm(): string;
/** A public failure excludes local paths, process identities and filesystem diagnostics. */
export declare class ApplyAdmissionRefusal extends Error {
    /** Host-recognized failure status prevents an unhandled-command retry. */
    readonly exitCode = 1;
    /** Construct the same refusal for acquisition, cleanup and release faults. */
    constructor();
}
/**
 * Publish a unique claim and enter only when it is the sole surviving claim.
 *
 * Active owners keep their claim throughout publication, stale-lock recovery,
 * the settings/template writes and release. Contenders withdraw before waiting.
 * A reaper can unlink only the exact dead claim it observed: a replacement owner
 * has a fresh pathname, never the old one. The containing directory is retained,
 * so directory removal/recreation cannot turn cleanup into an ABA race.
 * Live or unverifiable processes are never evicted merely because time passed.
 */
export declare function acquireApplyAdmission(pmDir: string): Promise<() => void>;
//# sourceMappingURL=apply-admission.d.ts.map