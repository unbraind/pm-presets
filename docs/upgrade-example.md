# Upgrade vendor settings without losing local intent

Keep the original vendor patch, its immutable version label, and the next vendor
patch. A workspace export contains local customizations and is not a substitute
for the original patch. For example, `vendor-v1.json`:

```json
{"id":"team-policy","version":"1.0.0","settings":{"id_prefix":"team-","output":{"default_format":"toon"}}}
```

And `vendor-v2.json`:

```json
{"id":"team-policy","version":"2.0.0","settings":{"id_prefix":"team2-","output":{"default_format":"json"}}}
```

If the workspace prefix is `local-`, the prefix is a conflict while the unchanged
local output format can adopt the vendor change automatically:

```sh
pm presets upgrade plan --from vendor-v1.json --to vendor-v2.json --receipt upgrade.private.json
```

The compact TOON report contains a receipt digest, `ready: false`, counts, and
`/id_prefix` as an unresolved conflict. `--json` selects the same data as JSON.
Planning writes only a new private receipt file, never tracker settings/history.
It refuses to overwrite an existing artifact. The receipt contains complete
inline settings for recovery, is created with mode 0600, and must remain outside
version control. Protect backups of this artifact as you protect settings.

Save an explicit `decisions.json`:

```json
{"/id_prefix":"local"}
```

Then generate a resolved receipt and apply it:

```sh
pm presets upgrade plan --from vendor-v1.json --to vendor-v2.json --decisions decisions.json --receipt resolved.private.json --json
pm presets upgrade apply resolved.private.json --json
pm presets upgrade apply resolved.private.json --json
pm presets upgrade rollback resolved.private.json --json
pm presets upgrade rollback resolved.private.json --json
```

The second apply and rollback are retries: they do not add duplicate history
entries. The host's settings history records the digest in the operation id and
the invoking author. Retain the receipt before attempting apply so interrupted
invocations can be retried. Inspect history and replan after a completed rollback;
an old apply receipt cannot be used to silently reapply a rolled-back operation.
To deliberately apply again, plan with a new explicit `--generation 2`.

Arrays are atomic. Conflicting additions, deletions, and structural type changes
also require `local` or `vendor`. Choices use JSON pointers, escaping `~` as `~0`
and `/` as `~1`; unknown/nonconflicting decision paths are refused. Unchanged
vendor paths and local-only settings retain local intent. Deleting a setting
that the host requires or normalizes to a default is refused; make the target
patch explicit using valid host settings. File-backed schema overlays are outside
the inline settings scope.

Both apply and rollback compare the complete normalized inline settings under
the host audit lock. Later edits, including edits to unrelated settings, refuse
rollback rather than overwrite them. Resolve those edits with a fresh plan and
history inspection. Use `--generation 2` (or another new explicit label) when
planning a deliberate new apply after a rollback; keep the default generation for
retries of the same operation. Templates, seeds, item types, items, integrations and external
configuration are not migrated. Receipts are portable trusted input: their digest
detects accidental edits, not authorship or permission to change a workspace.
Do not apply a receipt from an untrusted party or another workspace.

SDK callers use the host command SDK already provided to extensions:

```ts
import { planPresetUpgrade, executePresetUpgrade, summarizePresetUpgrade } from "pm-presets";
import type { VersionedPreset } from "pm-presets";

// from and to are trusted VersionedPreset documents; ctx is the host command context.
const receipt = await planPresetUpgrade(ctx.sdk, from, to, { "/id_prefix": "local" });
const summary = summarizePresetUpgrade(receipt);
// Persist the complete receipt privately before calling executePresetUpgrade.
if (summary.ready) await executePresetUpgrade(ctx.sdk, receipt, "apply");
```

`comparePresetUpgrade` is the pure JSON comparison API. `parseUpgradeReceipt`
validates a saved artifact before execution. `UpgradeRefusal` exposes `code`,
`remedy` and `exitCode`; codes include `invalid_input`, `invalid_receipt`,
`sdk_required`, `conflicts`, `stale_settings`, `normalization_changed` and
`mutation_refused`. CLI errors include the stable code and remedy and exit 2.
The private receipt holds all observations; command reports cap conflict details
at 20 and 4 KiB of details, and declare `omittedConflicts` alongside complete counts. Input files must
be regular JSON files of at most 1 MiB. Canonical preview support requires a host
SDK from 2026.10.17 or newer; earlier hosts receive a remedy without fallback
filesystem writes. Dry-run planning still requires the host's transient lock
directory to be writable; settings, items and history are not modified.
