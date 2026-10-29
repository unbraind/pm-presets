/** Packed commands protect defaults and secrets under both supported runtimes and renderers. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { verifyLockInterleavings } from "./fixtures/params-lock-scenario.ts";
import { assertNoCredentials, secretCorpus, trackerBytes } from "./fixtures/params-secret-oracle.ts";
import { PmClient } from "@unbrained/pm-cli/sdk";

test("packed applies and both strict diff forms agree on complete artifacts under Node and Bun", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-artifacts-packed-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const consumerEnv = { ...process.env, NODE_V8_COVERAGE: "", PM_AUTHOR: "packed-artifact-test", PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" };
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", root, "--json"], { encoding: "utf8", env: consumerEnv });
  assert.equal(packed.status, 0, packed.stderr);
  const archive = join(root, JSON.parse(packed.stdout)[0].filename);
  const cli = resolve("node_modules/@unbrained/pm-cli/dist/cli.js");
  const runtimes = [process.execPath];
  if (spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0) runtimes.push("bun");
  else t.diagnostic("Bun unavailable; packed Node verified; Bun remains an external gate.");
  for (const runtime of runtimes) {
    const work = join(root, runtime === "bun" ? "bun" : "node"), pmRoot = join(work, ".agents", "pm");
    mkdirSync(work, { recursive: true });
    await new PmClient({ pmRoot, cwd: work, noExtensions: true }).init();
    /** Execute installed artifacts with isolated user state and explicit exit assertions. */
    function run(args: string[], status = 0) {
      const result = spawnSync(runtime, [cli, "--path", pmRoot, ...args], { cwd: work, encoding: "utf8", timeout: 60_000,
        env: { ...consumerEnv, HOME: work, USERPROFILE: work, XDG_CONFIG_HOME: work, XDG_CACHE_HOME: work } });
      assert.equal(result.status, status, result.stdout + result.stderr);
      return result.stdout + result.stderr;
    }
    run(["package", "install", archive, "--project"]);
    // Card and AgentRun are supplied by the active host schema, rather than a
    // manually persisted schema fixture. Their complete seed state must agree.
    for (const preset of ["startup-roadmap", "kanban", "agent-workflow"]) {
      run(["presets", "apply", preset, "--with-seeds", "--force", "--replace"]);
      assert.equal(JSON.parse(run(["presets", "diff", preset, "--strict", "--json"])).inSync, true);
    }
    run(["presets", "apply", "startup-roadmap", "--param", "projectKey=alpha", "--force"]);
    const before = trackerBytes(pmRoot);
    assert.match(run(["presets", "apply", "startup-roadmap", "--param", "projectKey=beta"], 2), /stale_artifacts.*templates\/initiative.json/s);
    assert.equal(trackerBytes(pmRoot), before, "refused binding changes must preserve every tracker byte");
    for (const json of [[], ["--json"]]) for (const command of [["presets", "diff", "startup-roadmap"], ["presets", "--diff", "startup-roadmap"]]) {
      assert.match(run([...command, "--param", "projectKey=beta", "--strict", ...json], 4), /templates\/initiative.json/);
    }
    run(["presets", "apply", "startup-roadmap", "--param", "projectKey=beta", "--force"]);
    assert.equal(JSON.parse(run(["presets", "diff", "startup-roadmap", "--param", "projectKey=beta", "--strict", "--json"])).inSync, true);
    const template = join(pmRoot, "templates", "initiative.json"), document = JSON.parse(readFileSync(template, "utf8"));
    document.options.body += "\nManual edit";
    writeFileSync(template, JSON.stringify(document));
    assert.match(run(["presets", "diff", "startup-roadmap", "--param", "projectKey=beta", "--strict", "--json"], 4), /templates\/initiative.json/);
    const unrelated = JSON.parse(readFileSync(join(pmRoot, "settings.json"), "utf8")).preset_artifacts.kanban.seedIds[0];
    const card = join(pmRoot, "cards", `${unrelated}.toon`); assert.ok(existsSync(card));
    writeFileSync(card, "invalid unrelated card");
    run(["presets", "apply", "startup-roadmap", "--param", "projectKey=beta", "--force"]);
    assert.equal(JSON.parse(run(["presets", "diff", "startup-roadmap", "--param", "projectKey=beta", "--strict", "--json"])).inSync, true);
    assert.ok(run(["presets", "diff", "kanban", "--strict", "--json"], 4).includes(`items/${unrelated}`));
  }
});

test("packed parameter classes hold for npm/Node and Bun CLI in JSON and TOON on non-git trackers", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "preset-parameters-packed-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pmRoot = join(root, ".agents", "pm");
  await new PmClient({ pmRoot, cwd: root, noExtensions: true }).init();
  // These children load installed dist and host dependencies, outside the
  // coverage gate's source scope. Keep behavioral assertions in real consumers
  // while source coverage remains measured in this test process and SDK tests.
  const consumerEnv = { ...process.env, NODE_V8_COVERAGE: "" };
  const cli = resolve("node_modules/@unbrained/pm-cli/dist/cli.js");
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", root, "--json"], { encoding: "utf8", env: consumerEnv });
  assert.equal(packed.status, 0, packed.stderr);
  const archive = join(root, JSON.parse(packed.stdout)[0].filename);
  const install = spawnSync(process.execPath, [cli, "--path", pmRoot, "package", "install", archive, "--project"], { cwd: root, encoding: "utf8", env: consumerEnv, timeout: 60_000 });
  assert.equal(install.status, 0, install.stderr + install.stdout);
  const entry = join(pmRoot, "extensions", "pm-presets", "dist", "presets", "startup-roadmap", "index.js");
  assert.ok(existsSync(entry));
  const originalEntry = readFileSync(entry, "utf8");
  // This synthetic authoring fixture exercises the published secret contract;
  // bundled presets intentionally ship no secrets. It also makes the bundled
  // default adversarial without changing any actual package source or tracker.
  appendFileSync(entry, '\nPARAMETERS[0] = { ...PARAMETERS[0], default: " \\u2003road\\u00a0 " };\nPARAMETERS.push({ name: "token", type: "secret", required: false });\nSETTINGS.secret_references = { deploy: "${param:token}" };\n');
  const fixture = readFileSync(entry, "utf8");
  const settingsFile = join(pmRoot, "settings.json");
  const stored = 'old-synthetic"credential\\value';
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  settings.secret_references = Object.fromEntries(["deploy", ...Object.getOwnPropertyNames(Object.prototype), "prototype"].map((key) => [key, key === "deploy" ? "@PREVIOUS_TOKEN" : "@PRESET_PACKED_TOKEN"]));
  writeFileSync(settingsFile, JSON.stringify(settings));
  let before = readFileSync(settingsFile, "utf8");
  const runtimes = [process.execPath];
  const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
  if (bun.status === 0) runtimes.push("bun");
  else t.diagnostic("Bun unavailable; npm/Node packed consumer verified; Bun remains an external gate.");
  const credentials = secretCorpus();
  for (const runtime of runtimes) {
    /** Invoke the actual installed parser/renderer with isolated user state. */
    function run(args: string[]) {
      const result = spawnSync(runtime, [cli, "--path", pmRoot, ...(args[0].endsWith("-setup") ? args : ["presets", ...args])], { cwd: root, encoding: "utf8", timeout: 60_000,
        env: { ...consumerEnv, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, GIT_CEILING_DIRECTORIES: root, PRESET_PACKED_TOKEN: credentials[0], PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assertNoCredentials(result.stdout + result.stderr + trackerBytes(pmRoot), credentials);
      return result.stdout;
    }
    // Root dispatch accepts a union of flags; branches that do not consume
    // parameters must refuse them before an export can create a tracked file.
    for (const json of [[], ["--json"]]) {
      for (const args of [["--list"], ["--custom", "refused-copy", "--output", join(pmRoot, "refused-copy.json")]]) {
        const result = spawnSync(runtime, [cli, "--path", pmRoot, "presets", ...args, "--param", `token=${credentials[0]}`, ...json], { cwd: root, encoding: "utf8", timeout: 60_000,
          env: { ...consumerEnv, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" } });
        assert.equal(result.status, 2, "unused parameter inputs must refuse before dispatch");
        assert.match(result.stdout + result.stderr, /invalid_param_flag/);
        assertNoCredentials(result.stdout + result.stderr + trackerBytes(pmRoot), credentials);
        assert.ok(!existsSync(join(pmRoot, "refused-copy.json")));
      }
    }
    // Every flag-bearing entry point must translate file transport failures
    // before the handler can change native settings, templates or seeds.
    const invalid = join(root, "missing-params.json");
    const entryPoints = [
      ["triage-setup"], ["indie-setup"], ["oss-setup"], ["sprint-setup"],
      ["roadmap-setup"], ["kanban-setup"], ["agent-setup"],
      ["apply", "startup-roadmap"], ["apply", "indie-dev"],
      ["diff", "startup-roadmap"], ["--diff", "startup-roadmap"],
    ];
    for (const [index, args] of entryPoints.entries()) {
      for (const json of [[], ["--json"]]) {
        const command = args[0].endsWith("-setup") ? args : ["presets", ...args];
        const output = spawnSync(runtime, [cli, "--path", pmRoot, ...command, "--params-file", index % 2 ? root : invalid, ...json], {
          cwd: root, encoding: "utf8", timeout: 60_000,
          env: { ...consumerEnv, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
        });
        assert.equal(output.status, 2, output.stdout + output.stderr);
        assert.match(output.stdout + output.stderr, /invalid_params_file/);
        assert.ok(!/ENOENT|EISDIR|ENOTDIR/.test(output.stdout + output.stderr));
        assert.equal(readFileSync(settingsFile, "utf8"), before);
      }
    }
    writeFileSync(entry, fixture);
    // A literal external reference is a secret-capable destination even when
    // no secret parameter supplies it. Read-only legacy fixtures must redact
    // every shape without modifying settings, history or any other tracker byte.
    const referenceBaseline = readFileSync(settingsFile, "utf8");
    try {
      for (const declaration of [fixture, fixture + '\nPARAMETERS.pop();\n']) {
        writeFileSync(entry, declaration + '\nSETTINGS.secret_references = { deploy: "@NEW_STATIC_TOKEN" };\n');
        let variant = 0;
        for (const json of [[], ["--json"]]) {
          for (const args of [["diff", "startup-roadmap"], ["--diff", "startup-roadmap"]]) {
            const credential = credentials[variant % credentials.length];
            const legacy = JSON.parse(referenceBaseline);
            legacy.secret_references = { deploy: variant % 2 ? { nested: [credential] } : credential };
            writeFileSync(settingsFile, JSON.stringify(legacy));
            const trackerBefore = trackerBytes(pmRoot);
            const output = spawnSync(runtime, [cli, "--path", pmRoot, "presets", ...args, ...json], { cwd: root, encoding: "utf8", timeout: 60_000,
              env: { ...consumerEnv, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" } });
            assert.equal(output.status, 0, "static-reference diff must remain available for legacy values");
            assertNoCredentials(output.stdout + output.stderr, credentials);
            assert.ok((output.stdout + output.stderr).includes("@NEW_STATIC_TOKEN"));
            assert.match(output.stdout + output.stderr, /<redacted>/);
            assert.equal(trackerBytes(pmRoot), trackerBefore);
            variant += 1;
          }
        }
      }
    } finally {
      // Only read commands ran against the legacy fixture; restore its exact
      // reference-only baseline before any audited mutation can run.
      writeFileSync(settingsFile, referenceBaseline); writeFileSync(entry, fixture);
    }
    assertNoCredentials(trackerBytes(pmRoot), credentials);
    const secret = "@PRESET_PACKED_TOKEN";
    for (const json of [[], ["--json"]]) {
      for (const args of [["diff", "startup-roadmap"], ["--diff", "startup-roadmap"]]) {
        const output = run([...args, "--param", `token=${secret}`, ...json]);
        assert.ok(output.includes("@PRESET_PACKED_TOKEN"));
        for (const forbidden of [stored, JSON.stringify(stored).slice(1, -1)]) assert.ok(!output.includes(forbidden));
        assert.ok(output.includes("road-"));
        assert.ok(!output.includes("${param:projectKey}"));
      }
    }
    run(["simulate", "kanban", "--json"]);
    const show = JSON.parse(run(["show", "startup-roadmap", "--json"]));
    assert.equal(show.settings.id_prefix, "road-");
    assert.equal(show.parameters[0].default, "road");
    const input = join(root, "stack.json");
    writeFileSync(input, JSON.stringify({ selections: [{ preset: "startup-roadmap", settings: false, templates: false, seeds: true }] }));
    for (const json of [[], ["--json"]]) {
      const output = run(["stack", "--input", input, ...json]);
      assert.ok(output.includes("Define the road first roadmap initiative"));
      assert.ok(!output.includes("${param:"));
    }
    // Explicit reference destination remains safe through actual SDK dry-runs.
    writeFileSync(entry, fixture);
    for (const args of [["apply", "startup-roadmap"], ["roadmap-setup"]]) {
      const output = run([...args, "--dry-run", "--force", "--param", `token=${secret}`]);
      assert.ok(output.includes("@PRESET_PACKED_TOKEN"));
      assert.ok(output.includes(secret));
    }

    const env = { ...consumerEnv, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root,
      PRESET_PACKED_TOKEN: credentials[0], PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" };
    // Install synthetic secret declarations into every setup alias, so refusals
    // exercise secret input validation rather than unknown-parameter shortcuts.
    const registryFile = join(pmRoot, "extensions", "pm-presets", "dist", "registry.js");
    const otherEntries: Array<[string, string]> = [[registryFile, readFileSync(registryFile, "utf8")]];
    for (const id of ["bug-triage", "indie-dev", "open-source", "software-sprint", "kanban", "agent-workflow"]) {
      const file = join(pmRoot, "extensions", "pm-presets", "dist", "presets", id, "index.js");
      otherEntries.push([file, readFileSync(file, "utf8")]);
      writeFileSync(file, readFileSync(file, "utf8").replace('await applyPreset(context, {', 'await applyPreset(context, { parameters: [{ name: "token", type: "secret", required: false }],') + '\nSETTINGS.secret_references = { deploy: "${param:token}" };\n');
      appendFileSync(registryFile, `\nPRESET_PARAMETERS[${JSON.stringify(id)}].push({ name: "token", type: "secret", required: false });\n`);
    }
    try {
      for (const [index, args] of entryPoints.entries()) {
        for (const json of [[], ["--json"]]) {
          const command = args[0].endsWith("-setup") ? args : ["presets", ...args];
          const credential = credentials[index % credentials.length];
          const paramsFile = join(root, "secret-params.json");
          writeFileSync(paramsFile, JSON.stringify({ token: credential }));
          const supplied = json.length ? ["--params-file", paramsFile] : ["--param", `token=${credential}`];
          const result = spawnSync(runtime, [cli, "--path", pmRoot, ...command, ...supplied, ...json], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
          assert.equal(result.status, 2, "literal credentials must refuse on every parameter-bearing command");
          assert.match(result.stdout + result.stderr, /invalid_secret_reference/);
          assertNoCredentials(result.stdout + result.stderr + trackerBytes(pmRoot), credentials);
          assert.equal(readFileSync(settingsFile, "utf8"), before);
        }
      }
      for (const json of [[], ["--json"]]) {
        const commands = [["presets", "list"], ["presets", "--list"], ["presets", "show", "startup-roadmap"], ["presets", "validate"],
          ["presets", "plan", "startup-roadmap"], ["presets", "stack", "--input", input], ["presets", "export", "reference-copy"], ["presets", "--custom", "reference-copy"],
          ["presets", "diff", "startup-roadmap", "--param", "token=@PRESET_PACKED_TOKEN"], ["presets", "--diff", "startup-roadmap", "--param", "token=@PRESET_PACKED_TOKEN"],
          ["presets", "apply", "startup-roadmap", "--dry-run", "--force", "--with-seeds", "--param", "token=@PRESET_PACKED_TOKEN"],
          ...entryPoints.slice(0, 7).map((args) => [...args, "--dry-run", "--force", "--param", "token=@PRESET_PACKED_TOKEN"])];
        for (const [index, command] of commands.entries()) {
          env.PRESET_PACKED_TOKEN = credentials[index % credentials.length];
          const result = spawnSync(runtime, [cli, "--path", pmRoot, ...command, ...json], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
          assert.equal(result.status, 0, result.stdout + result.stderr);
          assertNoCredentials(result.stdout + result.stderr + trackerBytes(pmRoot), credentials);
        }
      }
      assert.equal(readFileSync(settingsFile, "utf8"), before);
      // Credential rotation changes only the external environment. Actual
      // non-git seeds and append-only settings history must stay reference-only.
      for (const credential of credentials) {
        env.PRESET_PACKED_TOKEN = credential;
        const result = spawnSync(runtime, [cli, "--path", pmRoot, "presets", "apply", "startup-roadmap", "--with-seeds", "--force", "--param", "token=@PRESET_PACKED_TOKEN"], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assertNoCredentials(result.stdout + result.stderr + trackerBytes(pmRoot), credentials);
        assert.equal(JSON.parse(readFileSync(settingsFile, "utf8")).secret_references.deploy, "@PRESET_PACKED_TOKEN");
        assert.match(readFileSync(join(pmRoot, "history", "_workspace.jsonl"), "utf8"), /@PRESET_PACKED_TOKEN/);
        const items = (await new PmClient({ pmRoot, cwd: root, noExtensions: true }).listAllComplete()).items;
        assert.ok(items.length > 0 && items.every((item) => item.id.startsWith("road-")));
      }
      const vendor1 = join(root, "vendor1.json"), vendor2 = join(root, "vendor2.json"), decisions = join(root, "decisions.json");
      writeFileSync(vendor1, JSON.stringify({ id: "reference", version: "v1", settings: { id_prefix: "vendor-" } }));
      writeFileSync(vendor2, JSON.stringify({ id: "reference", version: "v2", settings: { id_prefix: "next-" } }));
      writeFileSync(decisions, JSON.stringify({ "/id_prefix": "vendor" }));
      for (const [index, json] of [[], ["--json"]].entries()) {
        const receipt = join(root, `receipt-${runtime === "bun" ? "bun" : "node"}-${index}.json`);
        for (const command of [["templates", "list"], ["templates", "show", "initiative"],
          ["presets", "upgrade", "plan", "--from", vendor1, "--to", vendor2, "--decisions", decisions, "--receipt", receipt, "--generation", `${runtime === "bun" ? "bun" : "node"}-${index}`],
          ["presets", "upgrade", "apply", receipt], ["presets", "upgrade", "rollback", receipt]]) {
          const result = spawnSync(runtime, [cli, "--path", pmRoot, ...command, ...json], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
          assert.equal(result.status, 0, result.stdout + result.stderr);
          assertNoCredentials(result.stdout + result.stderr + trackerBytes(pmRoot), credentials);
        }
      }
      const sdkLoader = join(pmRoot, "extensions", "pm-presets", "dist", "sdk-loader.js");
      const loaderSource = readFileSync(sdkLoader, "utf8");
      assert.ok(loaderSource.includes("export function resolveSimulationSdk(anchors) {"));
      writeFileSync(sdkLoader, loaderSource.replace("export function resolveSimulationSdk(anchors) {", 'export function resolveSimulationSdk(anchors) { throw new Error("synthetic SDK lookup fault");'));
      try {
        for (const json of [[], ["--json"]]) {
          const result = spawnSync(runtime, [cli, "--path", pmRoot, "roadmap-setup", "--param", `token=${credentials[0]}`, ...json], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
          assert.equal(result.status, 2, "SDK transport faults must preserve the typed refusal result");
          assert.match(result.stdout + result.stderr, /invalid_secret_reference/);
          assertNoCredentials(result.stdout + result.stderr + trackerBytes(pmRoot), credentials);
        }
      } finally { writeFileSync(sdkLoader, loaderSource); }
      const stable = readFileSync(settingsFile, "utf8");
      for (const [source, expected] of [
        [fixture + '\nSETTINGS.id_prefix = "${param:token}-";\n', "secret_in_public_prose"],
        [fixture + '\nPARAMETERS.length = 0; SETTINGS.id_prefix = "road-"; delete SETTINGS.secret_references; Object.values(TEMPLATES)[0].options.body = "${param:missing}";\n', "unknown_binding"],
      ]) {
        writeFileSync(entry, source);
        for (const command of [["presets", "apply", "startup-roadmap", "--with-seeds"], ["roadmap-setup"], ["presets", "show", "startup-roadmap", "--json"]]) {
          const result = spawnSync(runtime, [cli, "--path", pmRoot, ...command, ...(expected === "secret_in_public_prose" && command[1] !== "show" ? ["--param", "token=@PRESET_PACKED_TOKEN"] : [])], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
          assert.equal(result.status, 2, result.stdout + result.stderr);
          assert.match(result.stdout + result.stderr, new RegExp(expected));
          if (command[1] === "show") assert.equal(JSON.parse(result.stderr).code, expected);
          assert.equal(readFileSync(settingsFile, "utf8"), stable);
          assertNoCredentials(result.stdout + result.stderr + trackerBytes(pmRoot), credentials);
        }
      }
      writeFileSync(entry, fixture);
      const seedModule = join(pmRoot, "extensions", "pm-presets", "dist", "seeds.js");
      const originalSeeds = readFileSync(seedModule, "utf8");
      const compositionFixture = fixture + '\nPARAMETERS.push({ name: "left", type: "string", required: false, default: "${param" }, { name: "right", type: "string", required: false, default: ":missing}" });\nSETTINGS.secret_references = { deploy: "@PRESET_PACKED_TOKEN" };\n';
      const fragmentsFile = join(root, "fragments.json");
      writeFileSync(fragmentsFile, JSON.stringify({ left: "${param", right: ":missing}" }));
      try {
        for (const destination of ["settings", "templates", "seeds"]) {
          const change = destination === "settings" ? '\nSETTINGS.id_prefix = "${param:left}${param:right}";\n'
            : destination === "templates" ? '\nObject.values(TEMPLATES)[0].options.body = "${param:left}${param:right}";\n' : "";
          writeFileSync(entry, compositionFixture + change);
          writeFileSync(seedModule, originalSeeds + (destination === "seeds" ? '\nPRESET_SEEDS["startup-roadmap"] = [{ type: "Task", title: "${param:left}${param:right}" }];\n' : ""));
          const compositionBefore = trackerBytes(pmRoot);
          for (const json of [[], ["--json"]]) {
            const commands = [["presets", "apply", "startup-roadmap", "--with-seeds", ...(json.length ? ["--params-file", fragmentsFile] : [])],
              ["presets", "diff", "startup-roadmap", "--param", "left=${param", "--param", "right=:missing}"],
              ["presets", "--diff", "startup-roadmap"], ["presets", "show", "startup-roadmap"]];
            if (destination !== "seeds") commands.push(["roadmap-setup"]);
            for (const command of commands) {
              const result = spawnSync(runtime, [cli, "--path", pmRoot, ...command, ...json], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
              assert.equal(result.status, 2, "composed bindings must refuse before output or mutation");
              assert.match(result.stdout + result.stderr, /invalid_value/);
              assertNoCredentials(result.stdout + result.stderr + trackerBytes(pmRoot), credentials);
              assert.equal(trackerBytes(pmRoot), compositionBefore);
            }
          }
        }
      } finally { writeFileSync(entry, fixture); writeFileSync(seedModule, originalSeeds); }
      const ownKeys = ["deploy", ...Object.getOwnPropertyNames(Object.prototype), "prototype"];
      const keyFixture = fixture + '\nSETTINGS.secret_references = Object.fromEntries(["deploy", ...Object.getOwnPropertyNames(Object.prototype), "prototype"].map((key) => [key, "${param:token}"]));\nObject.defineProperty(Object.values(TEMPLATES)[0].options, "constructor", { value: "public-own-data", enumerable: true, configurable: true, writable: true });\n';
      const keyParams = join(root, "key-params.json");
      writeFileSync(keyParams, JSON.stringify({ token: "@PRESET_PACKED_TOKEN" }));
      try {
        writeFileSync(entry, keyFixture + '\nObject.defineProperty(Object.values(TEMPLATES)[0].options, "__proto__", { value: "unsupported-own-data", enumerable: true, configurable: true });\n');
        const invalidBefore = trackerBytes(pmRoot);
        for (const json of [[], ["--json"]]) {
          for (const command of [["presets", "apply", "startup-roadmap", "--param", "token=@PRESET_PACKED_TOKEN"], ["roadmap-setup", "--params-file", keyParams]]) {
            const result = spawnSync(runtime, [cli, "--path", pmRoot, ...command, ...json], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
            assert.equal(result.status, 2, "unsupported native keys must refuse before writing");
            assert.match(result.stdout + result.stderr, /invalid_manifest/);
            assert.equal(trackerBytes(pmRoot), invalidBefore);
          }
        }
        writeFileSync(entry, keyFixture);
        for (const json of [[], ["--json"]]) {
          for (const command of [["presets", "apply", "startup-roadmap", "--with-seeds", "--force", "--param", "token=@PRESET_PACKED_TOKEN"],
            ["roadmap-setup", "--force", "--params-file", keyParams]]) {
            const result = spawnSync(runtime, [cli, "--path", pmRoot, ...command, ...json], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
            assert.equal(result.status, 0, result.stdout + result.stderr);
            const refs = JSON.parse(readFileSync(settingsFile, "utf8")).secret_references;
            assert.deepEqual(refs, Object.fromEntries(ownKeys.map((key) => [key, "@PRESET_PACKED_TOKEN"])));
            assert.ok(Object.hasOwn(refs, "__proto__"));
            const options = JSON.parse(readFileSync(join(pmRoot, "templates", "initiative.json"), "utf8")).options;
            assert.ok(Object.hasOwn(options, "constructor"));
            assert.equal(options.constructor, "public-own-data");
            assertNoCredentials(result.stdout + result.stderr + trackerBytes(pmRoot), credentials);
          }
          const ownBefore = trackerBytes(pmRoot);
          const absent = spawnSync(runtime, [cli, "--path", pmRoot, "templates", "show", "constructor", ...json], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
          assert.equal(absent.status, 3, "template names must come from the own SDK inventory");
          assert.equal(trackerBytes(pmRoot), ownBefore);
          for (const command of [["presets", "show", "startup-roadmap"], ["presets", "diff", "startup-roadmap", "--param", "token=@PRESET_PACKED_TOKEN"],
            ["presets", "--diff", "startup-roadmap", "--param", "token=@PRESET_PACKED_TOKEN"], ["presets", "export", "own-key-copy"],
            ["presets", "--custom", "own-key-copy"], ["templates", "show", "initiative"]]) {
            const result = spawnSync(runtime, [cli, "--path", pmRoot, ...command, ...json], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
            assert.equal(result.status, 0, result.stdout + result.stderr);
            assert.ok(result.stdout.includes(command[0] === "templates" ? "constructor" : "__proto__"), "the output must preserve the accepted own key");
            if (json.length) {
              const value = JSON.parse(result.stdout);
              if (command[0] === "templates") {
                assert.ok(Object.hasOwn(value.options, "constructor"));
                assert.equal(value.options.constructor, "public-own-data");
              } else if (command[1] === "diff" || command[1] === "--diff") {
                assert.ok(ownKeys.every((key) => value.settings.some((entry: any) => entry.path === `secret_references.${key}` && entry.preset === "@PRESET_PACKED_TOKEN")));
              } else {
                assert.deepEqual(value.settings.secret_references, Object.fromEntries(ownKeys.map((key) => [key, command[1] === "show" ? "${param:token}" : "@PRESET_PACKED_TOKEN"])));
              }
            } else if (command[0] === "templates") {
              assert.match(result.stdout, /"?constructor"?:\s*"?public-own-data"?/);
            } else if (command[1] !== "diff" && command[1] !== "--diff") {
              for (const key of ownKeys) assert.ok(result.stdout.includes(`${key}:`) || result.stdout.includes(`"${key}":`), "TOON must retain each actual map key, not only metadata paths");
            } else {
              for (const key of ownKeys) assert.ok(result.stdout.includes(`secret_references.${key}`));
            }
            assertNoCredentials(result.stdout + result.stderr + trackerBytes(pmRoot), credentials);
            assert.equal(trackerBytes(pmRoot), ownBefore);
          }
        }
        const history = readFileSync(join(pmRoot, "history", "_workspace.jsonl"), "utf8");
        for (const key of ownKeys) assert.ok(history.includes(JSON.stringify(key)));
        const templateFile = join(pmRoot, "templates", "initiative.json"), originalTemplate = readFileSync(templateFile, "utf8");
        const unsupported = JSON.parse(originalTemplate);
        Object.defineProperty(unsupported.options, "__proto__", { value: "legacy-public-data", enumerable: true, configurable: true });
        writeFileSync(templateFile, JSON.stringify(unsupported));
        try {
          const legacyBefore = trackerBytes(pmRoot), refusedOutput = join(pmRoot, "refused-own-export.json");
          for (const json of [[], ["--json"]]) {
            for (const command of [["presets", "export", "refused-copy", "--output", refusedOutput], ["presets", "--custom", "refused-copy", "--output", refusedOutput], ["templates", "show", "initiative"]]) {
              const result = spawnSync(runtime, [cli, "--path", pmRoot, ...command, ...json], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
              assert.equal(result.status, 2, "legacy template loss must refuse instead of producing a partial projection");
              assert.match(result.stdout + result.stderr, /invalid_manifest/);
              assert.ok(!existsSync(refusedOutput));
              assert.equal(trackerBytes(pmRoot), legacyBefore);
            }
          }
        } finally { writeFileSync(templateFile, originalTemplate); }
      } finally {
        writeFileSync(entry, fixture);
      }
      assertNoCredentials(trackerBytes(pmRoot), credentials);
    } finally { for (const [file, source] of otherEntries) writeFileSync(file, source); }
    // Each runtime starts from the previous audited result. Never restore raw
    // settings behind append-only history; read-only assertions above compare
    // against this per-runtime baseline before actual mutation scenarios.
    before = readFileSync(settingsFile, "utf8");
  }
  assert.equal(readFileSync(settingsFile, "utf8"), before, "read commands must preserve stored settings");
  writeFileSync(entry, originalEntry);
  await verifyLockInterleavings(t, join(pmRoot, "extensions", "pm-presets", "dist", "presets", "shared.js"), runtimes);
});
