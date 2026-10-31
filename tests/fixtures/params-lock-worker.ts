/** One independent apply process with deterministic pauses at stale removal or release. */
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PmClient, createExtensionCommandSdk } from "@unbrained/pm-cli/sdk";
import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk/authoring";

const [root, actor, phase, moduleFile] = process.argv.slice(2);
const pmRoot = join(root, ".agents", "pm");
const primary = join(pmRoot, "locks", "pm-presets-apply.lock");
const nativeRemove = fs.rmSync;
let paused = false;
fs.rmSync = ((file, options) => {
  if (actor === "alpha" && String(file) === primary && !paused) {
    paused = true;
    if (phase === "release") {
      const stale = new Date(Date.now() - 600_000);
      fs.utimesSync(primary, stale, stale);
    }
    fs.writeFileSync(join(root, "alpha-observed"), "ready");
    const cell = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(join(root, "resume-alpha"))) Atomics.wait(cell, 0, 0, 20);
  }
  return nativeRemove(file, options);
}) as typeof fs.rmSync;
syncBuiltinESMExports();
const { applyPreset, storedTemplate } = await import(pathToFileURL(moduleFile).href) as typeof import("../../src/presets/shared.ts");
const client = new PmClient({ cwd: root, pmRoot, noExtensions: true });
const sdk = createExtensionCommandSdk(pmRoot, client);
const context: CommandHandlerContext = {
  command: "independent-apply", args: [], options: { param: [`projectKey=${actor}`], force: true },
  pm_root: pmRoot, global: { json: true, quiet: true }, sdk: {
    ...sdk,
    mutateWorkspaceSettings: async (input) => {
      fs.writeFileSync(join(root, `${actor}-inside`), "entered");
      const result = await sdk.mutateWorkspaceSettings(input);
      fs.writeFileSync(join(root, `${actor}-mutated`), "written");
      if (actor === "beta") {
        while (!fs.existsSync(join(root, "release-beta"))) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return result;
    },
  },
};
const pending = applyPreset(context, {
  label: "Independent apply", settings: { id_prefix: "${param:projectKey}-" },
  parameters: [{ name: "projectKey", type: "string", required: true }],
  templates: { "card.json": storedTemplate("card", { type: "Task", body: "Project ${param:projectKey}" }) }, nextSteps: [],
});
// A paused apply yields here only after entering its first asynchronous wait.
fs.writeFileSync(join(root, `${actor}-ready`), "ready");
await pending;
