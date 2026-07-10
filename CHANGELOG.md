# Changelog

## Unreleased

### Other

- SDK 2026.7.10 alignment and production readiness pass ([pm-fw94](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-fw94.toon))

## 2026.7.6 - 2026-07-06

### Fixed

- Fix release CI ordering (publish-before-tag) ([pm-kx7u](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-kx7u.toon))

### Other

- Align Node engine with pm CLI runtime ([pm-wf6l](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-wf6l.toon))
- Regenerate CHANGELOG after pm close item ([pm-65i9](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-65i9.toon))

## 2026.6.13 - 2026-06-13

### Other

- Daily Release publish step runs prepublishOnly post-tag: align npm publish with --ignore-scripts ([pm-is8q](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-is8q.toon))

## 2026.6.7 - 2026-06-07

### Added

- Synchronize preset registry metadata with bundled kanban preset ([pm-rehf](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/features/pm-rehf.toon))

### Other

- Harden release readiness checks ([pm-7rjp](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-7rjp.toon))
- Align package dependencies to pm CLI/SDK 2026.6.6 ([pm-oaud](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-oaud.toon))

## 2026.6.4 - 2026-06-04

### Added

- Add presets apply --replace, diff --strict, and presets export ([pm-ehaf](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/features/pm-ehaf.toon))

## 2026.6.3-1 - 2026-06-03

### Added

- Deepen presets toolset: add show, diff, validate, enrich list ([pm-ruih](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/features/pm-ruih.toon))

### Other

- Unit tests + functional test against real workspace + release 2026.6.3 ([pm-q60r](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-q60r.toon))

## 2026.6.3 - 2026-06-02

### Added

- Enrich presets list output + add --json; document apply idempotency ([pm-g9oh](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-g9oh.toon))

### Other

- DECISION: apply idempotency, --with-seeds, and capability array ([pm-cj9x](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-cj9x.toon))
- Implement presets validate (all bundled presets parse/load) ([pm-e2qb](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-e2qb.toon))
- Implement presets diff <name\> (workspace vs preset, --json) ([pm-xa8m](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-xa8m.toon))
- Implement presets show <name\> (full definition, --json, exit 3) ([pm-0r28](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-0r28.toon))

## 2026.6.1 - 2026-06-01

### Fixed

- Preset handlers threw plain Error (no exitCode) → runtime double-invocation ([pm-xp9p](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-xp9p.toon))

## 2026.5.28 - 2026-05-28

### Other

- Initial release: consolidate 5 pm-preset-\* packages into pm-presets ([pm-h9u0](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-h9u0.toon))
