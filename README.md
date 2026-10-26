# pm-presets

All 7 official [pm-cli](https://github.com/unbraind/pm-cli) workspace presets in one package.

Install once, get all preset setup commands:

```bash
pm install github.com/unbraind/pm-presets --project
```

## Available Presets

| Preset | Command | Governance | Best For |
|---|---|---|---|
| **bug-triage** | `pm triage-setup` | custom strict-close | Incident response, triage teams |
| **indie-dev** | `pm indie-setup` | minimal | Solo developers, personal projects |
| **open-source** | `pm oss-setup` | standard | OSS maintainers with community contributors |
| **software-sprint** | `pm sprint-setup` | standard | Engineering teams running sprints |
| **startup-roadmap** | `pm roadmap-setup` | custom | Startups with investor-facing roadmaps |
| **kanban** | `pm kanban-setup` | minimal | Continuous-flow boards with a custom `Card` item type |
| **agent-workflow** | `pm agent-setup` | default | AI agent project management with a custom `AgentRun` item type |

Run `pm presets list` for the full, machine-readable catalog.

## Usage

1. Initialize a pm workspace in your project:

   ```bash
   pm init
   ```

2. Apply a preset:

   ```bash
   pm triage-setup        # strict bug triage
   pm indie-setup         # minimal solo dev
   pm oss-setup           # open-source project
   pm sprint-setup        # software sprint
   pm roadmap-setup       # startup roadmap
   pm kanban-setup        # continuous-flow kanban
   pm agent-setup        # AI agent project management
   ```

All setup commands share the same flags:

| Flag | Short | Description |
|---|---|---|
| `--force` | `-f` | Overwrite existing preset template files |
| `--dry-run` | `-n` | Preview changes without writing any files |
| `--prefix` | `-p` | Override the id_prefix in settings.json |

Each setup command installs valid `pm create` templates and registers the
`templates show` runtime handler required by the current pm CLI, so
`pm create --template <name>` works after installing and applying this package.

## Managing presets

Beyond the per-preset `*-setup` aliases, pm-presets ships a unified, read-only
management surface plus a generic `apply`:

| Command | Description |
|---|---|
| `pm presets list` | Enumerate every bundled preset and what it configures (governance, built-in + custom item types, templates). |
| `pm presets show <id>` | Print the full definition of one preset: the settings patch it merges, every template (with its `pm create` option keys), and any custom item types it registers. |
| `pm presets diff <id>` | Compare the current workspace (`settings.json` + installed templates) against a preset and report what `apply` would add / change, plus which templates are missing. Add `--strict` to exit non-zero on drift (CI/compliance). |
| `pm presets plan <id>` | Negotiate operational prerequisites before mutation; use `--composition` and `--target` for composed/provider plans. Missing required contracts exit 2. |
| `pm presets stack --input stack.json` | Preview a canonical preset stack; conflicting settings, templates and seed identities require explicit owner choices. |
| `pm presets validate` | Validate that all bundled presets parse and load coherently (governance enums, template names/options, registry↔export agreement). |
| `pm presets apply <id>` | Scaffold a preset into the current workspace (the generic form of the `*-setup` commands). Add `--replace` for a clean reset of the owned settings trees. |
| `pm presets export <name>` | Snapshot the **current** workspace's settings + templates as a reusable preset definition (JSON), to stdout or a file. |

All of the read-only commands accept `--json` for machine-readable output, and
all commands accept `--help`. An unknown preset id exits with code `3`
(`NOT_FOUND`).

```bash
pm presets list
pm presets show software-sprint --json
pm presets diff software-sprint           # what would change if I applied it?
pm presets diff software-sprint --strict  # exit 4 if the workspace has drifted
pm presets validate
pm presets apply software-sprint --dry-run
pm presets apply software-sprint --replace  # clean reset of governance/validation/testing
pm presets export our-config --output our-config.preset.json
```

### Unified `presets` flags

The bare `pm presets` command offers a single entry point for the read-only
surfaces via flags (the dedicated subcommands above remain available with
identical behavior):

| Flag | Description |
|---|---|
| `--list` | List all bundled workspace presets (same output as `pm presets list`). |
| `--diff <id>` | Compare the current workspace against the named preset (same as `pm presets diff <id>`); accepts `--strict` and `--json`. |
| `--custom <name>` | Export the current workspace config as a new preset definition (same as `pm presets export <name>`); accepts `--output`, `--display-name`, and `--json`. |

```bash
pm presets --list
pm presets --diff software-sprint --strict
pm presets --custom our-config --output our-config.preset.json
```

Specify exactly one of `--list`, `--diff`, or `--custom` per invocation.

### `presets apply` flags

`presets apply` accepts the shared `--force` / `--dry-run` / `--prefix` flags,
plus:

| Flag | Short | Description |
|---|---|---|
| `--with-seeds` | `-s` | Also create the preset's starter items after applying it. |
| `--replace` | | Full-replace the `governance` / `validation` / `testing` trees with the preset's instead of deep-merging them. |

**Idempotency & safety.** `apply` is safe to re-run:

- Requires the host pm CLI minimum declared in `manifest.json` and the package
  peer dependency. Settings changes use the host-bound
  SDK audit lock and workspace history. Application awaits that commit before
  writing templates or creating seeds; an unavailable audit capability fails closed.
- `settings.json` is **deep-merged** by default — the preset's keys are layered
  over your existing settings, so unrelated config (telemetry, locks, etc.) is
  preserved.
- `--replace` instead **swaps the `governance` / `validation` / `testing` trees
  wholesale** with the preset's trees — resetting omitted keys to host defaults
  and deriving named governance policies, for a clean reset. The host serializer
  retains unrecognized stored fields. Unrelated top-level settings (`id_prefix`,
  `telemetry`, `locks`, …) are still preserved in both modes.
- Templates are **skipped if a file with that name already exists**; pass
  `--force` to overwrite them.
- `--dry-run` previews every settings merge/replace, template write, and seed
  item without touching disk.

### Drift detection: `presets diff --strict`

`presets diff <id> --strict` reuses the diff logic but **exits non-zero (code
`4`)** when the workspace is not in sync with the named preset — settings to
add/change or templates missing. It prints what drifted (human summary, or the
full diff with `--json`) before exiting, so CI logs explain the failure. When
the workspace already matches the preset it exits `0`. Plain `presets diff`
(without `--strict`) always exits `0` and just reports.

```bash
# Fail a compliance/CI job if the workspace drifts from the locked preset:
pm presets diff bug-triage --strict || echo "workspace drifted!"
```

### Exporting your own config: `presets export`

After you `apply` a preset and customize it, `presets export <name>` captures
the **live** workspace as a reusable preset definition (`settings.json` plus
every installed template). Write it to stdout (use `--json` for clean,
pipeable output) or to a file with `--output`:

```bash
pm presets apply bug-triage          # start from a bundled preset
# ...customize settings.json and templates by hand...
pm presets export our-config --output our-config.preset.json --display-name "Our Team Config"
```

The exported document is `$schema: "pm-presets/exported-preset@1"` and records
`settings` + `templates`. **Custom item-field _values_ are not captured**:
custom scalar fields have no `pm create --<field>` setter today (pm-cli #97),
so the snapshot reconstructs the preset from settings + templates only.

**Seed creation.** `--with-seeds` uses the host SDK client and the invocation's
workspace, author and active schema. It needs neither a `pm` executable on PATH
nor git. Each seed remains independent: native validation failures are reported
per item, successful seeds stay created, and any failure exits nonzero. Dry runs
retain the same preview. Failures show the native SDK validation detail instead
of the subprocess CLI's generic error headline. A missing host `client.create` capability fails clearly.

**Seeds and custom fields.** Starter items created by `--with-seeds` set only
**built-in** fields (`type`, `title`, `priority`, `tags`, `body`). Custom scalar
fields registered via `registerItemFields` still have no direct
`pm create --<field>` setter, so seed-only context lives in the item body.
Registered item-type options are supported through `--type-option`: the
agent-workflow templates persist `phase`, `mode`, and `model` this way while
leaving the core pm `status` field untouched. The kanban `Card` and
agent-workflow `AgentRun` seeds are created with their registered item types.

## Presets in Detail

### bug-triage

**Governance:** custom strict-close — progressive creation with strict ownership and close validation.

**Templates:** `incident`, `hotfix-task`, `regression`

**Default id_prefix:** `bug-`

Best for on-call teams and incident response workflows that need full audit trails.

```bash
pm triage-setup
pm create --template incident
pm create --template hotfix-task
pm create --template regression
```

### indie-dev

**Governance:** minimal — no required fields, no ownership enforcement.

**Templates:** `idea`, `task`

**Default id_prefix:** `indie-`

Best for solo developers who want lightweight task tracking with zero ceremony.

```bash
pm indie-setup
pm create --template idea
pm create --template task
```

### open-source

**Governance:** standard — structured without blocking community contributors.

**Templates:** `bug-report`, `feature-request`, `good-first-issue`

**Default id_prefix:** `oss-`

Best for open-source maintainers handling community submissions and milestone releases.

```bash
pm oss-setup
pm create --template bug-report
pm create --template feature-request
pm create --template good-first-issue
```

### software-sprint

**Governance:** standard — sprint format validated, ownership warned.

**Templates:** `epic`, `feature`, `task`, `bug`

**Default id_prefix:** `sprint-`

Best for engineering teams running two-week sprints with epics and features.

```bash
pm sprint-setup
pm create --template epic
pm create --template feature
pm create --template task
pm create --template bug
```

### startup-roadmap

**Governance:** custom with rich metadata — captures business value and strategic context.

**Templates:** `initiative`, `feature`, `milestone`

**Default id_prefix:** `road-`

Best for startups building investor-facing roadmaps with quarterly planning.

```bash
pm roadmap-setup
pm create --template initiative
pm create --template feature
pm create --template milestone
```

### kanban

**Governance:** minimal — continuous flow with light ownership warnings.

**Templates:** `card`, `expedite`, `blocked`

**Default id_prefix:** `kan-`

Best for teams that pull work through backlog, ready, in-progress, review, and done columns.

```bash
pm kanban-setup
pm create --template card
pm create --template expedite
pm create --template blocked
```

## Migration from legacy individual preset packages

If you previously installed individual preset packages, uninstall those legacy
entries shown by `pm package list --project` and install `pm-presets` instead:

```bash
pm package list --project
pm package uninstall <legacy-preset-package> --project
pm install github.com/unbraind/pm-presets --project
```

The preset commands are identical — only the package name changed.

Preset setup handlers and `applyPreset` return `Promise<void>`; await their
completion before reading the updated configuration. Dry runs validate against
locked current settings and display a labeled preset patch without writing
settings or history. The host derives governance policies and canonical storage;
the patch is a proposed change, rather than a serialized final settings tree.
Replacement previews also list omitted existing owned trees and keys that the
host resets to defaults or preset policy, without printing their old values.
Templates are separate filesystem writes after the audited settings commit;
a later filesystem failure does not roll back that committed settings event.

## Simulate before applying

Run representative agent workflows before changing your workspace:

```bash
pm presets simulate bug-triage
pm presets simulate indie-dev --json
pm presets simulate software-sprint --scenarios create-task,claim-start --json
```

Suite version 1 applies the same bundled setup handler as `presets apply`, then
executes four workflows with the real local pm SDK:

| Scenario | Declared result |
| --- | --- |
| `create-task` | Task exists and is open |
| `claim-start` | Claimed Task is in progress |
| `close-without-evidence` | Refused for bug-triage; closed for other bundled presets |
| `close-with-evidence` | Closed with resolution, expected and actual result |

Expected governance refusals count as passing observations. Every report includes
expected and actual states, pass counts, omitted scenario IDs in `coverageGaps`,
and scope limitations. Selecting a subset does **not** establish full coverage.
Exit 4 means a mismatch or coverage gap; the report is printed before the error.
Unknown presets/scenarios and duplicate selections produce typed usage refusals
(exit 2) with remedies. Missing SDK support or worker failure uses exit 1.

The simulator accepts bundled IDs and scenario IDs only. It creates a new tracker
and home directory in a separate process, disables extension loading and telemetry,
and supplies no tracker paths, credentials, scripts or caller configuration to it.
It never installs into, reads, or writes the caller's tracker. Scratch files are
removed after success or failure. The CLI host may perform its normal runtime
bookkeeping before invoking an extension command.

Reports are reproducible for the same package, suite and supported host version:
random item IDs, timestamps, paths, durations and free-form SDK diagnostics are
excluded. Scenarios run in canonical order and each creates its own Task.
The bounded suite checks built-in Task lifecycle behavior; installed templates,
custom types, external integrations and real agent inference remain explicit
limitations. A passing simulation is not approval to apply a preset or a forecast
of your workspace's existing policies.

See [the SDK example](docs/simulation-example.md), including partial coverage and
handling typed refusals.

## Programmatic API

```typescript
import { PRESET_REGISTRY } from "pm-presets/registry";

for (const preset of PRESET_REGISTRY) {
  console.log(preset.id, preset.command, preset.governance);
}
```

## License

MIT

## Multi-agent merge safety

This repo tracks its project management in `.agents/pm/` and ships a committed `.gitattributes`
that maps those tracker artifacts to pm-cli's field-aware Git merge drivers, so concurrent-branch
tracker edits merge cleanly instead of hard-conflicting. Generated extension assets are excluded
from semantic merging, while their managed manifest retains key-level JSON merging.
Extension assets use Git's native `merge=text` attribute. Native `text`, `binary`, and
`union` drivers need no `merge.<name>.driver` registration; the prepare checks require
registration for every custom driver and verify native extension text merging in a real checkout.
The custom driver **definitions** live in per-clone Git config; `npm install` / `npm ci` wires them automatically via the `prepare` script, `scripts/prepare-merge-driver.ts`: a local launcher that delegates to the installed pm-ops export and is tested against an installer behavior contract. It runs pm-ops's installer, which calls `pm merge install` when the `pm` CLI is on `PATH` and skips with a notice when it is not. A production install of a clone (`npm ci --omit=dev`) has no `pm-ops`, so the launcher skips with one notice, while a stale or broken `pm-ops` fails the install. Registry installs of this package never run `prepare`. Being Node-based, it behaves identically on POSIX shells and Windows `cmd.exe`. To (re)run manually: `npm run merge:install`.

After merging a branch that touched `.agents/pm/`, reconcile any residual history-hash drift with
**`pm merge reconcile`**: preview with `pm merge reconcile --dry-run`, apply with
`pm merge reconcile --message "post-merge reconcile"`, then confirm with `pm validate`, which scans the
whole tracker and flags remaining history drift across **every** affected item (`pm merge reconcile`
itself lists each affected stream in its output; `pm history --verify <id>` spot-checks one item).
Reconciliation repairs receipts and history consistency; a successful validation does not
prove that every concurrent edit survived. Inspect the merged item values and merge receipts
before accepting the result. Keep existing history append-only; do not use history rewriting
as a substitute for reconciliation. See the authoritative
[pm-cli merge-safety guide](https://github.com/unbraind/pm-cli/blob/main/docs/MERGE_SAFETY.md).

## Without git

Preset listing, inspection, diff, validation, export, application, templates and
simulation work in plain directories as well as repositories. Simulation always
uses a disposable non-git tracker, with no git executable on its PATH. None of
these commands requires a Git repository. Upgrade planning, applying, retries and
rollback also work without git; they use the host SDK settings lock and history.

Capability plans also work without Git. Database hosts can compile plans from
their provider snapshots without a local tracker. Git-based release changelog
generation requires a repository and release tags.

Template listing, inspection and export use the host SDK's template inventory
and loader. User files shadow builtin names; invalid stored options refuse with
the SDK's expected error and a diagnostic that identifies the template and option
without echoing document contents. Export uses the loadable filename as its name.

## Versioned preset upgrades

`pm presets upgrade plan --from vendor-v1.json --to vendor-v2.json --receipt upgrade.private.json`
compares two `{id, version, settings}` vendor patches with the current workspace.
It preserves local-only edits and requires explicit JSON-pointer decisions when
vendor and local changes conflict. `presets upgrade apply <receipt>` and
`presets upgrade rollback <receipt>` use the host's audited settings API, including
idempotent retries and stale-settings checks. Plans and command results use
compact TOON or `--json`; complete recovery settings remain in a private receipt.
Requires canonical SDK previews (host 2026.10.17+).

See the [complete upgrade example](docs/upgrade-example.md) for decisions,
recovery, typed SDK usage, refusal remedies and migration boundaries.

## Capability-negotiated plans

Run `pm presets plan kanban --with-seeds --json` before applying a preset.
The read-only planner checks the selected provider's operations and the SDK's
live workspace contracts. Required gaps produce exit status 2, stable
`missing_capability` codes and remedies; optional features are omitted as a
whole. A refused plan never authorizes partial application. No settings, items
or history are written by the planner.

Use `--composition composition.json` for a composed preset with atomic features
and `--target target.json` for the selected directory or database provider's
capability and workspace-contract snapshot. The same compiler evaluates both
backends. Database hosts supply their actual contracts; the backend label alone
never implies support. A snapshot is a planning input, not a connectivity,
authorization, schema-validity or transaction guarantee. Replan after provider
or extension changes. Existing apply/diff/export and audited replacement remain
the execution primitives; this command does not execute composed features.

SDK consumers import `compilePresetPlan`, `bundledPresetComposition`,
`summarizePresetPlan`, `PlanRefusal` and their types from `pm-presets`. The full
SDK plan includes every gap. CLI reports retain complete counts and at most
12 gaps within a 4 KiB detail budget, with `omittedGaps` showing truncation;
host output budgets/projection may reduce output further. Plans contain only
contract identifiers and decisions, never settings values or tracker content.
See [the composed preset example](docs/plan-example.md).

## Preview preset stacks

`pm presets stack --input stack.json --json` adapts selected catalog contributions
to the host's `ProjectProfileDefinition` and `planProfileApplication`. TOON is the
default; both formats retain ownership rows and bounded counts without stored
settings values, template bodies or seed bodies. Unresolved conflicts return
`ready: false`, `code: conflicts`, a remedy and exit 2. Identical contributions
share ownership; different values at the same identity require a listed owner.
Selection order and JSON formatting never determine precedence.

Each selection names a bundled `preset`. Boolean `settings` and `templates`
default to true; `seeds` defaults to false. Disable surfaces to compose disjoint
contributions. Settings ownership uses leaf JSON pointers, templates use their
name, and seeds use `type:title` as a catalog identity (not an existing item ID).
Choices map each conflicting pointer to a competing preset. Unknown, unused or
non-competing choices are refused. Arrays are atomic settings values.

The SDK exports `planPresetStack(pmRoot, sdk, input)`, `summarizePresetStack` and
typed `StackRefusal` errors. It accepts 1–7 unique selections and at most 128
choices (512 characters per pointer), rejects sparse arrays, unknown keys and
non-boolean flags, and bounds CLI JSON artifacts to 1 MiB. Settings previews
require canonical `includePreview` support (host 2026.10.17+). Core plans the
registered `id_prefix` config and templates; other governance, validation and
testing leaves use the host's audited dry-run normalization in an isolated,
mode-0700 scratch directory with a mode-0600 settings copy, removed in `finally`.
This avoids the host dry-run's workspace lock writes on the source. If normalization
would discard an explicit setting choice, `normalization_conflict` asks for
coherent owners. Custom item types/options remain owned by extension activation.

Preview works without git, including on read-only trackers, and writes no source
settings, items, templates, history, receipts or journals. Temporary normalization
files are removed on success or refusal. There is no stack apply/import/export/sync command.
Seed rows describe prospective catalog contributions, without claiming existing
items by title. Plans are observations, not transactions or replayable authority;
replan after peer changes. Target classifications always read current settings
and templates. See [the stack example](docs/stack-example.md).
