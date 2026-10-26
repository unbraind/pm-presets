# Review a preset stack

Save this as `stack.json` to combine Indie Dev settings/templates with Open Source
templates and starter seeds:

```json
{
  "selections": [
    { "preset": "indie-dev" },
    { "preset": "open-source", "settings": false, "seeds": true }
  ]
}
```

Run `pm presets stack --input stack.json --json` (or omit `--json` for TOON).
The result is ready with five settings leaves, five templates, one seed and zero
unresolved conflicts. Nothing is applied or saved.

For competing ownership, replace Open Source with Software Sprint and enable
settings. The preview refuses with four conflicts. Add these choices to select
Software Sprint wherever the two presets disagree:

```json
{
  "selections": [
    { "preset": "indie-dev" },
    { "preset": "software-sprint" }
  ],
  "choices": {
    "/settings/governance/preset": "software-sprint",
    "/settings/id_prefix": "software-sprint",
    "/settings/testing/record_results_to_items": "software-sprint",
    "/templates/task": "software-sprint"
  }
}
```

Re-run the same preview. Reversing selections or reformatting with CRLF produces
the same canonical plan. Choice pointers come from the ownership rows; do not
guess paths. Shared values require no choice. Governance and mirrored validation
choices must remain coherent with the host's canonical settings semantics.

```ts
import { planPresetStack, summarizePresetStack } from "pm-presets";
import { createExtensionCommandSdk, PmClient } from "@unbrained/pm-cli/sdk";

const pmRoot = ".agents/pm";
const client = new PmClient({ pmRoot, author: "stack-review" });
const sdk = createExtensionCommandSdk(pmRoot, client, "stack-review");
const plan = await planPresetStack(pmRoot, sdk, {
  selections: [{ preset: "indie-dev" }, { preset: "open-source", settings: false }],
});
console.log(summarizePresetStack(plan));
// plan.profile and plan.hostPlan expose the host-native template/config plan.
// plan.settingsPatch contains only resolved bundled settings, never stored values.
```

Typed refusals: `invalid_input` → correct the bounded request/choices;
`sdk_required` → use a compatible host; `target_unavailable` → initialize/check
the tracker and templates; `normalization_conflict` → choose coherent settings
owners or select settings from one preset. All refusals leave the tracker alone.
