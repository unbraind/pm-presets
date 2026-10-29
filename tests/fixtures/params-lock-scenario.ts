/** Reproduce ownership replacement at the last possible point before unlink in real processes. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TestContext } from "node:test";
import { PmClient, readSettings } from "@unbrained/pm-cli/sdk";

/** Exercise stale takeover AND delayed release without relying on scheduler timing. */
export async function verifyLockInterleavings(t: TestContext, moduleFile: string, runtimes: readonly string[], phases: readonly string[] = ["stale", "release"]): Promise<void> {
  for (const phase of phases) {
    const root = mkdtempSync(join(tmpdir(), "preset-generation-race-"));
    const pmRoot = join(root, ".agents", "pm");
    await new PmClient({ cwd: root, pmRoot, noExtensions: true }).init();
    const primary = join(pmRoot, "locks", "pm-presets-apply.lock");
    mkdirSync(join(pmRoot, "locks"), { recursive: true });
    if (phase === "stale") {
      writeFileSync(primary, "observed-dead-generation");
      const old = new Date(Date.now() - 600_000);
      utimesSync(primary, old, old);
    }
    const children: Array<{ child: ChildProcess; done: Promise<void> }> = [];
    /** Start a fully independent runtime and retain its exit/error evidence. */
    function start(actor: string, runtime: string) {
      const child = spawn(runtime, [resolve("tests/fixtures/params-lock-worker.ts"), root, actor, phase, moduleFile], {
        stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
      });
      let errors = "";
      child.stderr!.on("data", (value) => { errors += String(value); });
      const timeout = setTimeout(() => child.kill("SIGTERM"), 60_000);
      const done = new Promise<void>((resolveExit, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => { clearTimeout(timeout); code === 0 ? resolveExit() : reject(new Error(`Apply worker failed (${code}): ${errors}`)); });
      });
      // Retain rejection until cleanup joins every child, even if a barrier assertion fails.
      done.catch(() => {});
      const worker = { child, done };
      children.push(worker);
      return worker;
    }
    /** Wait for an actual process phase, refusing early exits instead of sleeping blindly. */
    async function barrier(name: string, worker: { child: ChildProcess; done: Promise<void> }) {
      const deadline = Date.now() + 45_000;
      while (!existsSync(join(root, name))) {
        if (worker.child.exitCode !== null) { await worker.done; assert.fail(`Missing worker phase ${name}`); }
        assert.ok(Date.now() < deadline, `Worker phase timed out: ${name}`);
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      }
    }
    try {
      const alpha = start("alpha", runtimes[0]);
      await barrier("alpha-observed", alpha);
      const beta = start("beta", runtimes[runtimes.length - 1]);
      await barrier("beta-ready", beta);
      const betaEntered = existsSync(join(root, "beta-inside"));
      if (betaEntered) {
        // A correct atomic-removal alternative could allow beta to run first.
        // Its generation must survive alpha's delayed cleanup and alpha must
        // stay outside native mutation until beta releases it.
        await barrier("beta-mutated", beta);
        const generation = readFileSync(primary, "utf8");
        writeFileSync(join(root, "resume-alpha"), "continue");
        if (phase === "release") await alpha.done;
        else {
          await barrier("alpha-ready", alpha);
          assert.equal(existsSync(join(root, "alpha-inside")), false, "native applies must not overlap while beta holds its generation");
        }
        assert.equal(readFileSync(primary, "utf8"), generation, `${phase}: delayed cleanup must preserve the replacement generation`);
      } else {
        writeFileSync(join(root, "resume-alpha"), "continue");
        await alpha.done;
        await barrier("beta-mutated", beta);
        assert.ok(existsSync(primary), `${phase}: the earlier owner must not unlink the replacement owner's lock`);
      }
      writeFileSync(join(root, "release-beta"), "continue");
      await beta.done;
      await alpha.done;
      const prefix = (await readSettings(pmRoot)).id_prefix;
      assert.ok(prefix === "alpha-" || prefix === "beta-");
      const template = JSON.parse(readFileSync(join(pmRoot, "templates", "card.json"), "utf8"));
      assert.equal(template.options.body, `Project ${prefix.slice(0, -1)}`);
      assert.equal(existsSync(primary), false);
    } finally {
      writeFileSync(join(root, "resume-alpha"), "continue");
      writeFileSync(join(root, "release-beta"), "continue");
      await Promise.allSettled(children.map(({ done }) => done));
      rmSync(root, { recursive: true, force: true });
    }
  }
}
