import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createExtensionCommandSdk, isPmCliExpectedError, loadCreateTemplateOptions, PmClient, runTemplatesList as sdkList, runTemplatesShow as sdkShow, type CommandHandlerContext } from "@unbrained/pm-cli/sdk";
import { runTemplatesList, runTemplatesShow } from "../../src/presets/shared.ts";
import { PRESET_REGISTRY } from "../../src/registry.ts";
import { PRESET_HANDLERS } from "../../src/setup.ts";
import { readWorkspaceTemplates } from "../../src/export.ts";

const [scenario, root] = process.argv.slice(2);
assert.ok(root);
const pmRoot = join(root, ".agents", "pm");
const client = new PmClient({ cwd: root, pmRoot, noExtensions: true });
await client.init();
const ctx: CommandHandlerContext = {
  command: "templates", args: [], options: {}, pm_root: pmRoot,
  global: { json: true, noExtensions: true, path: join(root, "wrong-tracker") },
  sdk: createExtensionCommandSdk(pmRoot, client),
};
const globals = { ...ctx.global, path: pmRoot };
const templates = join(pmRoot, "templates");
mkdirSync(templates, { recursive: true });
if (scenario === "refusal" || scenario === "export-refusal") {
  writeFileSync(join(templates, "bad.json"), JSON.stringify({ options: { priority: 1 }, secret: "private-document-marker" }));
  await assert.rejects(() => sdkShow("bad", globals), isPmCliExpectedError);
  await assert.rejects(async () => scenario === "refusal" ? runTemplatesShow({ ...ctx, args: ["bad"] }) : readWorkspaceTemplates(pmRoot), (error: unknown) => {
    assert.ok(isPmCliExpectedError(error), "malformed template must retain SDK expected-error identity");
    assert.equal(error.exitCode, 1);
    assert.equal(error.message, 'Template "bad" contains invalid value for option "priority".');
    assert.ok(!error.message.includes("private-document-marker"));
    return true;
  });
} else if (scenario === "parity") {
  assert.deepEqual(await runTemplatesList(ctx), await sdkList(globals));
  for (const name of (await sdkList(globals)).templates) {
    assert.deepEqual(await runTemplatesShow({ ...ctx, args: [name] }), await sdkShow(name, globals));
  }
  writeFileSync(join(templates, "bug.json"), JSON.stringify({ name: "bug", created_at: "2026-01-01", updated_at: "2026-01-02", options: { type: "Task", priority: "4", tags: ["shadow"] } }));
  assert.deepEqual(await runTemplatesList(ctx), await sdkList(globals));
  assert.deepEqual(await runTemplatesShow({ ...ctx, args: ["bug"] }), await sdkShow("bug", globals));
} else {
  assert.equal(scenario, "presets");
  assert.equal(PRESET_REGISTRY.length, 7);
  for (const preset of PRESET_REGISTRY) {
    await PRESET_HANDLERS[preset.id]({ ...ctx, options: { force: true } });
    for (const template of preset.templates) {
      const shown = await runTemplatesShow({ ...ctx, args: [template] });
      assert.deepEqual(shown.options, await loadCreateTemplateOptions(pmRoot, template));
      assert.ok((await runTemplatesList(ctx)).user_templates.includes(template));
    }
  }
}
