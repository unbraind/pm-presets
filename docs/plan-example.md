# Negotiate a composed preset

Declare atomic features in `composition.json`:

```json
{
  "id": "team-workflow",
  "features": [
    {
      "id": "governance",
      "optional": false,
      "requires": [{ "kind": "capability", "name": "settings.audit" }]
    },
    {
      "id": "issue-sync",
      "optional": true,
      "requires": [{ "kind": "command", "name": "github sync" }]
    }
  ]
}
```

Use `pm presets plan --composition composition.json --json` with an initialized
directory tracker. Activated commands come from the host SDK's
`getWorkspaceContracts`, not a package manifest's claimed capabilities.
`--no-extensions` honors the host switch and leaves extension commands absent.

For a database provider, obtain its actual `WorkspaceContracts` using its
SDK/transport and save a target snapshot. A minimal example `target.json` is:

```json
{
  "backend": "database",
  "capabilities": ["settings.audit"],
  "contracts": {
    "types": ["Task"],
    "statuses": ["open", "closed", "canceled"],
    "openStatus": "open",
    "closeStatus": "closed",
    "canceledStatus": "canceled",
    "fields": [],
    "extensionCommands": []
  }
}
```

```sh
pm presets plan --composition composition.json --target target.json --json
```

This returns `ready: true`, selects `governance`, omits `issue-sync`, and
identifies the missing `command` named `github sync` with a remedy. Changing
`issue-sync.optional` to `false` yields `ready: false`, puts it in `refused`,
and exits 2. Removing `settings.audit` refuses `governance` on either backend.
No plan command attempts any settings mutation or database connection.

```ts
import { compilePresetPlan, summarizePresetPlan } from "pm-presets";
import type { PresetComposition, PresetPlanTarget } from "pm-presets";

/** Compile already validated provider snapshots supplied by the embedding host. */
export function inspect(composition: PresetComposition, target: PresetPlanTarget) {
  const plan = compilePresetPlan(composition, target);
  return summarizePresetPlan(plan);
}
```

Requirement kinds are `capability`, `command` (canonical activated extension
command path), `type`, `field` (schema key), and `status`. Matching is exact and
case-sensitive. All requirements are conjunctive. Repeat shared prerequisites
in every dependent feature; optionality does not implicitly weaken dependencies.
The compiler validates the declaration envelope, not the settings schema. Names
are bounded to 80 printable identifier characters, compositions to 32 unique
features, and each feature to 8 unique requirements. JSON artifacts must be
regular files of at most 1 MiB. Malformed input raises `PlanRefusal` with
`invalid_input`; failed live contract reads use `contracts_unavailable`.

Directory defaults advertise `templates.write` (the package's filesystem
primitive), `settings.audit` when the host supplies audited settings mutation,
and `items.create` when its SDK client supplies creation. These describe API
support, not effective filesystem permissions. A database provider must declare
its own operations explicitly, including template support if available. Bundled
plans require settings and templates; `--with-seeds` also requires item creation.
A provider contract does not attest that the existing filesystem apply command
can execute against a database. The embedding host owns execution and must
honor the selected/omitted decisions after checking `ready` and current contracts.
