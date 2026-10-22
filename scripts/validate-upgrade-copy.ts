/** Read-only validation on an exported public tracker, never the source checkout. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createExtensionCommandSdk, PmClient } from "@unbrained/pm-cli/sdk";
import { planPresetUpgrade, summarizePresetUpgrade } from "../src/upgrade.ts";

const root = process.argv[2];
if (!root) throw new Error("Provide an exported public tracker directory.");
const pmRoot = join(root, ".agents", "pm");
/** Hash every copied file, including history, to demonstrate that reads leave it unchanged. */
function census(): Map<string, string> {
  return new Map(readdirSync(pmRoot, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => {
    const file = join(entry.parentPath, entry.name);
    return [file.slice(pmRoot.length), createHash("sha256").update(readFileSync(file)).digest("hex")];
  }));
}
const before = census();
const client = new PmClient({ pmRoot, cwd: root, author: "preset-copy-validation", noExtensions: true });
const items = await client.listAllComplete();
const sdk = createExtensionCommandSdk(pmRoot, client, "preset-copy-validation", "migration-copy-validation");
// Declared test vendor evolution against real untouched settings; this is not a claim
// that this tracker previously installed this synthetic vendor or either revision.
const from = { id: "validation-policy", version: "1.0.0", settings: { id_prefix: "vendor-", output: { default_format: "toon" } } };
const to = { id: "validation-policy", version: "2.0.0", settings: { id_prefix: "vendor2-", output: { default_format: "json" } } };
const unresolved = await planPresetUpgrade(sdk, from, to);
assert.equal(summarizePresetUpgrade(unresolved).ready, false);
const resolved = await planPresetUpgrade(sdk, from, to, { "/id_prefix": "local" });
assert.equal(summarizePresetUpgrade(resolved).ready, true);
assert.equal(resolved.after.id_prefix, resolved.before.id_prefix);
assert.equal(resolved.after.output && typeof resolved.after.output === "object" && "default_format" in resolved.after.output ? resolved.after.output.default_format : undefined, "json");
assert.equal((await planPresetUpgrade(sdk, from, to, { "/id_prefix": "local" })).id, resolved.id);
const after = census();
assert.deepEqual(after, before);
const history = readdirSync(join(pmRoot, "history")).filter((file) => file.endsWith(".jsonl"));
console.log(JSON.stringify({ items: items.items.length, files: before.size, historyStreams: history.length,
  historyEntries: history.reduce((count, file) => count + readFileSync(join(pmRoot, "history", file), "utf8").trim().split("\n").filter(Boolean).length, 0),
  trackerFilesChanged: 0, planRetriesIdentical: true, unresolved: summarizePresetUpgrade(unresolved), resolved: summarizePresetUpgrade(resolved),
  scope: "Real public tracker settings; declared synthetic vendor revisions; read-only planning only." }));
