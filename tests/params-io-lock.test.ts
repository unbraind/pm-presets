/** Properties for typed file faults and generation-safe apply ownership. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { readSuppliedParameterValues, ParameterRefusal } from "../src/params.ts";
import { readPresetArtifact } from "../src/upgrade-command.ts";
import { acquireApplyAdmission, ApplyAdmissionRefusal, captureAdmissionRealm } from "../src/apply-admission.ts";
import { verifyLockInterleavings } from "./fixtures/params-lock-scenario.ts";

test("property: all params-file filesystem failures are typed, private and descriptor-clean", (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-file-faults-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = join(root, "synthetic-input.json");
  fs.writeFileSync(file, '{"projectKey":"file"}');
  const methods = ["openSync", "fstatSync", "readSync", "closeSync"] as const;
  for (const stage of methods) for (const code of ["ENOENT", "EACCES", "ENOTDIR", "ELOOP", "EIO"]) {
    for (const boundary of ["paramsFile", "params-file", "artifact"]) {
      const active = new Set<number>();
      const mocks: Array<{ mock: { restore(): void } }> = [];
      for (const method of methods) {
        const native = fs[method];
        mocks.push(t.mock.method(fs, method, ((...args: unknown[]) => {
          if (method === stage && method !== "closeSync") throw Object.assign(new Error('synthetic-private-data"\\diagnostic'), { code });
          const result = Reflect.apply(native, fs, args);
          if (method === "openSync") active.add(result as number);
          if (method === "closeSync") {
            active.delete(args[0] as number);
            if (method === stage) throw Object.assign(new Error('synthetic-private-data"\\diagnostic'), { code });
          }
          return result;
        }) as never));
      }
      syncBuiltinESMExports();
      let failure: unknown;
      try { boundary === "artifact" ? readPresetArtifact(file) : readSuppliedParameterValues({ [boundary]: file }); }
      catch (error) { failure = error; }
      finally { for (const mock of mocks) mock.mock.restore(); syncBuiltinESMExports(); }
      assert.equal(active.size, 0, `${stage}/${code}: descriptors must close after refusal`);
      assert.equal((failure as { code: string }).code, boundary === "artifact" ? "invalid_input" : "invalid_params_file");
      assert.equal((failure as { exitCode: number }).exitCode, 2);
      assert.ok(!String(failure).includes("synthetic-private-data"));
      assert.ok(!String(failure).includes(file));
    }
  }
});

test("params-file boundaries reject missing, nonregular, oversized and malformed paths before reads can escape", (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-file-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const big = join(root, "large.json");
  fs.writeFileSync(big, "x".repeat(65537));
  const ordinary = join(root, "ordinary.json");
  fs.writeFileSync(ordinary, '{"projectKey":"雪α"}');
  for (const file of [join(root, "missing"), root, big, join(ordinary, "child"), "invalid\0path"]) {
    for (const key of ["paramsFile", "params-file"]) assert.throws(() => readSuppliedParameterValues({ [key]: file }), (error: unknown) => error instanceof ParameterRefusal && error.code === "invalid_params_file" && error.exitCode === 2);
  }
  const native = fs.readSync;
  const mock = t.mock.method(fs, "readSync", ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null) => native(fd, buffer, offset, Math.min(1, length), position)) as typeof fs.readSync);
  syncBuiltinESMExports();
  try { assert.deepEqual(readSuppliedParameterValues({ paramsFile: ordinary }), { projectKey: "雪α" }); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  const stat = fs.fstatSync;
  const grow = t.mock.method(fs, "fstatSync", ((...args: unknown[]) => {
    const result = Reflect.apply(stat, fs, args);
    fs.writeFileSync(ordinary, "x".repeat(65537));
    return result;
  }) as typeof fs.fstatSync);
  syncBuiltinESMExports();
  try { assert.throws(() => readSuppliedParameterValues({ paramsFile: ordinary }), { code: "invalid_params_file", exitCode: 2 }); }
  finally { grow.mock.restore(); syncBuiltinESMExports(); }
});

test("property: stale takeover cannot delete replacement ownership across independent processes", async (t) => {
  await verifyLockInterleavings(t, resolve("src/presets/shared.ts"), [process.execPath], ["stale"]);
});

test("property: delayed release cannot delete replacement ownership across independent processes", async (t) => {
  await verifyLockInterleavings(t, resolve("src/presets/shared.ts"), [process.execPath], ["release"]);
});

test("admission claims retain live and unknown owners and release only their unique pathname", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-admission-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const release = await acquireApplyAdmission(root);
  const directory = join(root, "locks", "pm-presets-apply-claims");
  const [owned] = fs.readdirSync(directory);
  const stale = new Date(Date.now() - 600_000);
  fs.utimesSync(join(directory, owned), stale, stale);
  let clock = 0;
  const time = t.mock.method(Date, "now", () => clock++ * 20_000);
  try { await assert.rejects(acquireApplyAdmission(root), ApplyAdmissionRefusal); }
  finally { time.mock.restore(); }
  assert.deepEqual(fs.readdirSync(directory), [owned], "an old live owner must survive and the contender must withdraw");
  const foreign = join(directory, "unverifiable-owner.claim");
  fs.writeFileSync(foreign, "");
  release();
  assert.deepEqual(fs.readdirSync(directory), ["unverifiable-owner.claim"]);
  fs.unlinkSync(foreign);
  const again = await acquireApplyAdmission(root);
  const marker = join(directory, fs.readdirSync(directory)[0]);
  fs.unlinkSync(marker);
  again(); // Idempotent best effort after a vanished immutable marker.
  assert.deepEqual(fs.readdirSync(directory), []);
});

test("stray non-claim files never block admission and are left in place", async (t) => {
  const root = fs.mkdtempSync(join(tmpdir(), "preset-admission-stray-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "locks", "pm-presets-apply-claims");
  fs.mkdirSync(directory, { recursive: true });
  for (const stray of [".DS_Store", "notes.claim~", "sync-conflict.tmp"]) fs.writeFileSync(join(directory, stray), "");
  let clock = 0;
  const time = t.mock.method(Date, "now", () => clock++ * 20_000);
  let release: () => void;
  try { release = await acquireApplyAdmission(root); }
  finally { time.mock.restore(); }
  assert.equal(fs.readdirSync(directory).filter((entry) => entry.endsWith(".claim")).length, 1);
  release();
  assert.deepEqual(fs.readdirSync(directory).sort(), [".DS_Store", "notes.claim~", "sync-conflict.tmp"]);
});

test("unverifiable PID namespaces receive distinct recovery realms", (t) => {
  const mock = t.mock.method(fs, "readlinkSync", () => { throw Object.assign(new Error("private namespace"), { code: "EACCES" }); });
  syncBuiltinESMExports();
  try {
    const first = captureAdmissionRealm(), second = captureAdmissionRealm();
    assert.notEqual(first, second, "unverified namespaces must never authorize recovery of each other's claims");
    assert.ok(!first.includes("private"));
  } finally { mock.mock.restore(); syncBuiltinESMExports(); }
});

test("claim recovery targets the observed dead pathname even when another reaper publishes a replacement", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const { randomUUID } = await import("node:crypto");
  const root = fs.mkdtempSync(join(tmpdir(), "preset-dead-claim-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, ["--input-type=module", "-e",
    'const {acquireApplyAdmission}=await import(process.argv[1]); await acquireApplyAdmission(process.argv[2]); process.exit(0);',
    pathToFileURL(resolve("src/apply-admission.ts")).href, root], { encoding: "utf8", timeout: 20_000 });
  assert.equal(child.status, 0, child.stderr);
  const directory = join(root, "locks", "pm-presets-apply-claims");
  const [dead] = fs.readdirSync(directory);
  const verified = captureAdmissionRealm() === captureAdmissionRealm();
  if (!verified) {
    let clock = 0;
    const time = t.mock.method(Date, "now", () => clock++ * 20_000);
    try { await assert.rejects(acquireApplyAdmission(root), ApplyAdmissionRefusal); }
    finally { time.mock.restore(); }
    assert.ok(fs.existsSync(join(directory, dead)), "unverified owners must stay locked");
    return;
  }
  const first = await acquireApplyAdmission(root);
  assert.ok(!fs.existsSync(join(directory, dead)), "a proven dead owner must be recoverable");
  first();
  // Reinstall that immutable dead generation for a deterministic second-reaper race.
  fs.writeFileSync(join(directory, dead), "");
  const replacement = `${captureAdmissionRealm()}-${process.pid}-${randomUUID()}.claim`;
  const unlink = fs.unlinkSync;
  const remove = t.mock.method(fs, "unlinkSync", (file: fs.PathLike) => {
    if (String(file) === join(directory, dead)) {
      unlink(file);
      fs.writeFileSync(join(directory, replacement), "");
      throw Object.assign(new Error("already reaped"), { code: "ENOENT" });
    }
    unlink(file);
  });
  syncBuiltinESMExports();
  let clock = 0;
  const time = t.mock.method(Date, "now", () => clock++ * 20_000);
  try { await assert.rejects(acquireApplyAdmission(root), ApplyAdmissionRefusal); }
  finally { remove.mock.restore(); syncBuiltinESMExports(); time.mock.restore(); }
  assert.deepEqual(fs.readdirSync(directory), [replacement], "late cleanup must preserve the replacement's different pathname");
});

test("invalid, foreign and unverifiable owners remain contended; acquisition and release faults stay typed", async (t) => {
  const { randomUUID } = await import("node:crypto");
  const root = fs.mkdtempSync(join(tmpdir(), "preset-admission-faults-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "locks", "pm-presets-apply-claims");
  fs.mkdirSync(directory, { recursive: true });
  const realm = captureAdmissionRealm();
  for (const owner of [`${"0".repeat(64)}-1-${randomUUID()}.claim`, `${realm}-99999999999999999999-${randomUUID()}.claim`, `${realm}-2147483648-${randomUUID()}.claim`, `${realm}-1-${randomUUID()}.claim`]) {
    fs.writeFileSync(join(directory, owner), "");
    let clock = 0;
    const time = t.mock.method(Date, "now", () => clock++ * 20_000);
    const kill = t.mock.method(process, "kill", () => { throw Object.assign(new Error("owner inaccessible"), { code: "EPERM" }); });
    try { await assert.rejects(acquireApplyAdmission(root), ApplyAdmissionRefusal); }
    finally { time.mock.restore(); kill.mock.restore(); }
    assert.deepEqual(fs.readdirSync(directory), [owner]);
    fs.unlinkSync(join(directory, owner));
  }
  for (const method of ["mkdirSync", "writeFileSync", "readdirSync"] as const) {
    const mock = t.mock.method(fs, method, (() => { throw Object.assign(new Error("private filesystem diagnostic"), { code: "EACCES" }); }) as never);
    syncBuiltinESMExports();
    try { await assert.rejects(acquireApplyAdmission(root), (error: unknown) => error instanceof ApplyAdmissionRefusal && !String(error).includes("private filesystem")); }
    finally { mock.mock.restore(); syncBuiltinESMExports(); }
    assert.deepEqual(fs.readdirSync(directory), []);
  }
  const release = await acquireApplyAdmission(root);
  const mock = t.mock.method(fs, "unlinkSync", () => { throw Object.assign(new Error("private release diagnostic"), { code: "EIO" }); });
  syncBuiltinESMExports();
  try { assert.throws(release, ApplyAdmissionRefusal); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(fs.readdirSync(directory).length, 1, "a failed release must stay locked, never authorize another writer");
});

test("all SDK setup/apply/diff entry points refuse bad params files before native writes", async (t) => {
  const { PmClient } = await import("@unbrained/pm-cli/sdk");
  const { createExtensionTestHarness } = await import("@unbrained/pm-cli/sdk/testing");
  const { default: mod, PRESET_REGISTRY } = await import("../src/index.ts");
  const root = fs.mkdtempSync(join(tmpdir(), "preset-input-sdk-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  const client = new PmClient({ cwd: root, pmRoot, noExtensions: true });
  await client.init();
  const before = fs.readFileSync(join(pmRoot, "settings.json"), "utf8");
  const h = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
  assert.deepEqual(h.activation.failed, []);
  const commands = [
    ...PRESET_REGISTRY.map(({ command }) => ({ command, args: [] as string[], options: {} })),
    { command: "presets apply", args: ["startup-roadmap"], options: { withSeeds: true } },
    { command: "presets apply", args: ["indie-dev"], options: {} },
    { command: "presets diff", args: ["startup-roadmap"], options: {} },
    { command: "presets", args: [], options: { diff: "startup-roadmap" } },
  ];
  for (const command of commands) for (const key of ["paramsFile", "params-file"]) {
    await assert.rejects(h.runCommand({ ...command, pmRoot, options: { ...command.options, [key]: join(root, "missing.json") } }),
      (error: unknown) => (error as { code: string }).code === "invalid_params_file" && (error as { exitCode: number }).exitCode === 2);
    assert.equal(fs.readFileSync(join(pmRoot, "settings.json"), "utf8"), before);
    assert.ok(!fs.existsSync(join(pmRoot, "templates")));
    assert.equal((await client.listAllComplete()).items.length, 0);
  }
});
