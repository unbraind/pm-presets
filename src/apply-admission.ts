/** Cross-process admission with immutable claim paths, including recovery and release. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";

/** Identify a kernel/PID namespace; unverifiable realms deliberately cannot reap one another. */
export function captureAdmissionRealm(): string {
  let realm: string;
  try {
    // These platforms share the host PID domain. Reused/live PIDs still block;
    // only ESRCH allows recovery, even across boots, without a rounded clock key.
    if (process.platform !== "linux") return createHash("sha256").update(`host:${hostname()}`).digest("hex");
    realm = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
      + ":" + fs.readlinkSync("/proc/self/ns/pid");
  } catch {
    realm = randomUUID();
  }
  return createHash("sha256").update(realm).digest("hex");
}

const HOST = captureAdmissionRealm();
const WAIT_MS = 15_000;

/** A public failure excludes local paths, process identities and filesystem diagnostics. */
export class ApplyAdmissionRefusal extends Error {
  /** Host-recognized failure status prevents an unhandled-command retry. */
  readonly exitCode = 1;
  /** Construct the same refusal for acquisition, cleanup and release faults. */
  constructor() {
    super("Preset application ownership is unavailable; wait for other applies, or inspect abandoned claims only after confirming their writers have stopped. Verify lock-directory permissions and retry.");
    this.name = "ApplyAdmissionRefusal";
  }
}

/** Remove only this immutable claim pathname; another owner always has a different name. */
function removeClaim(file: string): void {
  try { fs.unlinkSync(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

/** Only a same-namespace PID proven absent permits automatic claim recovery; uncertainty stays locked. */
function deadClaim(name: string): boolean {
  const match = /^([a-f0-9]{64})-([1-9][0-9]*)-([a-f0-9-]{36})\.claim$/.exec(name);
  if (!match || match[1] !== HOST) return false;
  const pid = Number(match[2]);
  if (!Number.isSafeInteger(pid) || pid > 2147483647) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

/** Only claim files take part in admission; stray files such as `.DS_Store` or editor backups never block an apply. */
function claims(directory: string): string[] {
  return fs.readdirSync(directory).filter((entry) => entry.endsWith(".claim"));
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
export async function acquireApplyAdmission(pmDir: string): Promise<() => void> {
  const directory = path.join(pmDir, "locks", "pm-presets-apply-claims");
  const deadline = Date.now() + WAIT_MS;
  try {
    fs.mkdirSync(directory, { recursive: true });
    for (;;) {
      const name = `${HOST}-${process.pid}-${randomUUID()}.claim`;
      const file = path.join(directory, name);
      fs.writeFileSync(file, "", { flag: "wx", mode: 0o600 });
      let admitted = false;
      try {
        for (const observed of claims(directory)) {
          if (observed !== name && deadClaim(observed)) removeClaim(path.join(directory, observed));
        }
        const current = claims(directory);
        if (current.length === 1 && current[0] === name) {
          admitted = true;
          return () => {
            try { removeClaim(file); }
            catch { throw new ApplyAdmissionRefusal(); }
          };
        }
      } finally {
        if (!admitted) removeClaim(file);
      }
      if (Date.now() >= deadline) throw new ApplyAdmissionRefusal();
      await new Promise((resolve) => setTimeout(resolve, 25 + Math.floor(Math.random() * 75)));
    }
  } catch {
    throw new ApplyAdmissionRefusal();
  }
}
