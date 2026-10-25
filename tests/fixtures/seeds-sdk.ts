/** Exercise real seed commands with no git or pm executable available. */
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { createExtensionCommandSdk, listMutationEvents, PmClient, readHistoryEntries, verifyHistoryEntries } from "@unbrained/pm-cli/sdk";
import { createExtensionTestHarness } from "@unbrained/pm-cli/sdk/testing";
import mod from "../../src/index.ts";
import { PRESET_REGISTRY } from "../../src/registry.ts";

const [scenario, root] = process.argv.slice(2);
assert.ok(root);
const pmRoot = join(root, ".agents", "pm");
const client = new PmClient({ cwd: root, pmRoot, noExtensions: true, author: "sdk-seed-author" });
await client.init();
const sdk = createExtensionCommandSdk(pmRoot, client, "sdk-seed-author");
const harness = await createExtensionTestHarness(mod, { name: "pm-presets", capabilities: ["commands", "schema"] });
assert.deepEqual(harness.activation.failed, []);
if (scenario === "all-presets") {
  const extension = join(pmRoot, "extensions", "pm-presets");
  mkdirSync(extension, { recursive: true });
  for (const source of ["package.json", "manifest.json", "dist"]) cpSync(resolve(source), join(extension, source), { recursive: true });
  const cli = resolve("node_modules/@unbrained/pm-cli/dist/cli.js");
  for (const preset of PRESET_REGISTRY) {
    const result = spawnSync(process.execPath, [cli, "--author", "sdk-seed-author", "presets", "apply", preset.id, "--with-seeds", "--force"], {
      cwd: root, encoding: "utf8", env: { ...process.env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const items = (await new PmClient({ cwd: root, pmRoot }).listAllComplete()).items;
  assert.equal(items.length, 8);
  assert.ok(items.every((item) => item.author === "sdk-seed-author"));
  assert.ok(items.some((item) => item.type === "Card"));
  assert.ok(items.some((item) => item.type === "AgentRun"));
} else {
  await sdk.mutateWorkspaceSettings({ operationId: "prime-workspace", mutate: (current) => ({ ...current, id_prefix: "primed-" }) });
  const events = await listMutationEvents({ pmRoot, full: true });
  assert.ok(events.events.some((event) => event.item_id === "_workspace"));
  const historyPath = join(pmRoot, "history", "_workspace.jsonl");
  assert.equal(verifyHistoryEntries(await readHistoryEntries(historyPath, "_workspace")).ok, true);
  const raw = readFileSync(historyPath, "utf8");
  // Change a patch without resealing the entry, after priming the derived index.
  const corrupted = raw.replace("primed-", "broken-");
  assert.notEqual(corrupted, raw);
  writeFileSync(historyPath, corrupted);
  const settingsBefore = readFileSync(join(pmRoot, "settings.json"), "utf8");
  await assert.rejects(() => harness.runCommand({ command: "presets apply", args: ["indie-dev"], options: { withSeeds: true }, pmRoot, sdk }), /Audited preset settings failed/);
  assert.equal(readFileSync(join(pmRoot, "settings.json"), "utf8"), settingsBefore);
  assert.equal(readFileSync(historyPath, "utf8"), corrupted);
  assert.equal(existsSync(join(pmRoot, "templates")), false);
  assert.equal((await client.listAllComplete()).items.length, 0);
}
