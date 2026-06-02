# pm-presets

All 5 official [pm-cli](https://github.com/unbraind/pm-cli) workspace presets in one package.

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
| `pm presets diff <id>` | Compare the current workspace (`settings.json` + installed templates) against a preset and report what `apply` would add / change, plus which templates are missing. |
| `pm presets validate` | Validate that all bundled presets parse and load coherently (governance enums, template names/options, registry↔export agreement). |
| `pm presets apply <id>` | Scaffold a preset into the current workspace (the generic form of the `*-setup` commands). |

All of the read-only commands accept `--json` for machine-readable output, and
all commands accept `--help`. An unknown preset id exits with code `3`
(`NOT_FOUND`).

```bash
pm presets list
pm presets show software-sprint --json
pm presets diff software-sprint           # what would change if I applied it?
pm presets validate
pm presets apply software-sprint --dry-run
```

### `presets apply` flags

`presets apply` accepts the shared `--force` / `--dry-run` / `--prefix` flags,
plus:

| Flag | Short | Description |
|---|---|---|
| `--with-seeds` | `-s` | Also create the preset's starter items after applying it. |

**Idempotency & safety.** `apply` is safe to re-run:

- `settings.json` is **deep-merged** — the preset's keys are layered over your
  existing settings, so unrelated config (telemetry, locks, etc.) is preserved.
- Templates are **skipped if a file with that name already exists**; pass
  `--force` to overwrite them.
- `--dry-run` previews every settings merge, template write, and seed item
  without touching disk.

**Seeds and custom fields (pm-cli #97).** Starter items created by
`--with-seeds` set only **built-in** fields (`type`, `title`, `priority`,
`tags`, `body`). Custom scalar fields registered via `registerItemFields` have
no `pm create --<field>` setter today, so any preset-specific context lives in
the seed item's body text rather than in custom options. The kanban `Card`
type *is* a registered item type, so its seed is created as `--type Card`.

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

## Migration from pm-preset-* packages

If you previously installed individual `pm-preset-*` packages, uninstall them
and install `pm-presets` instead:

```bash
pm package uninstall pm-preset-bug-triage --project
pm package uninstall pm-preset-indie-dev --project
pm package uninstall pm-preset-open-source --project
pm package uninstall pm-preset-software-sprint --project
pm package uninstall pm-preset-startup-roadmap --project

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
