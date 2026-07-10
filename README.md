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

- `settings.json` is **deep-merged** by default — the preset's keys are layered
  over your existing settings, so unrelated config (telemetry, locks, etc.) is
  preserved.
- `--replace` instead **swaps the `governance` / `validation` / `testing` trees
  wholesale** with the preset's exact trees — dropping any keys the preset no
  longer sets, for a clean reset. Unrelated top-level settings (`id_prefix`,
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

## Programmatic API

```typescript
import { PRESET_REGISTRY } from "pm-presets/registry";

for (const preset of PRESET_REGISTRY) {
  console.log(preset.id, preset.command, preset.governance);
}
```

## License

MIT
