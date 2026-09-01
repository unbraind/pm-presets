# Changelog

## 2026.9.1 - 2026-09-01

### Fixed

- This repository has never produced a static analysis, because it runs no CodeQL workflow ([pm-q9vo](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-q9vo.toon))
- Group codeql-action bumps into one pull request to end the split-PR deadlock ([pm-jg3f](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-jg3f.toon))

## 2026.8.31 - 2026-08-31

### Fixed

- The release changelog remained Unreleased after the release tag was created ([pm-70um](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-70um.toon))

## 2026.8.29 - 2026-08-29

### Fixed

- Finish suffix-safe changelog date verification ([pm-75jv](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-75jv.toon))
- Harden publish attestation scanner against review bypasses ([pm-scbd](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-scbd.toon))

## 2026.8.28 - 2026-08-28

### Fixed

- A failed provenance publish silently falls back to an unattested one ([pm-acsd](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-acsd.toon))
- Stabilise the changelog gate release date by deriving it from the calendar version instead of the clock ([pm-rwp3](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-rwp3.toon))
- changelog scripts read the pm workspace with default budgets instead of canonical complete reads ([pm-4wc5](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-4wc5.toon))

### Security

- The identity gate deadlocks the one remediation its own failure message prescribes ([pm-dc4q](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-dc4q.toon))

### Other

- Relocate the preset catalog out of manifest.json and guard the closed manifest vocabulary ([pm-3e1u](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-3e1u.toon))

## 2026.8.17 - 2026-08-17

### Fixed

- The manifest declared a pm CLI floor of 2026.7.28 while peerDependencies required 2026.8.7, so the CLI enforced a weaker minimum than npm ([pm-6n63](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-6n63.toon))

## 2026.8.14 - 2026-08-14

### Fixed

- A Dependabot bump to pm-cli 2026.8.10 turned the tracker's own history into a CI failure ([pm-q6jk](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-q6jk.toon))

## 2026.8.10 - 2026-08-10

### Other

- Adopt the mandatory docstring gate ([pm-l7yq](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-l7yq.toon))

## 2026.8.8 - 2026-08-08

### Other

- Align pm-presets with pm 2026.8.7 and harden merge-driver lifecycle ([pm-xtq2](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-xtq2.toon))

## 2026.8.7 - 2026-08-07

### Fixed

- Gate durable PM project health in CI on pm CLI 2026.8.6 ([pm-ruq3](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-ruq3.toon))

### Other

- Clear author-attribution health warning for \_workspace history events ([pm-un5v](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-un5v.toon))

## 2026.8.4 - 2026-08-04

### Other

- Resolve pm-changelog to the release that derives release dates in UTC ([pm-z2ip](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-z2ip.toon))

## 2026.7.31 - 2026-07-31

### Fixed

- Release commits discard the rebuilt dist, so the git-install path serves the previous version ([pm-hcjp](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-hcjp.toon))

## 2026.7.29 - 2026-07-29

### Added

- Run the test suite against TypeScript sources behind an uncheatable coverage gate ([pm-h67l](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/features/pm-h67l.toon))

### Other

- Adopt pm-cli 2026.7.29 ([pm-117o](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-117o.toon))

## 2026.7.28 - 2026-07-28

### Other

- Adopt pm-cli 2026.7.28 and migrate activation tests to the real SDK harness ([pm-tfz5](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-tfz5.toon))

## 2026.7.27 - 2026-07-27

### Fixed

- presets commands redeclared host-owned --json global, failing registration on pm-cli 2026.7.27 ([pm-i03k](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-i03k.toon))

### Other

- Type the flag tables and preset dispatch against real SDK contracts ([pm-y7s6](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-y7s6.toon))
- Adopt pm-cli 2026.7.26 typed authoring contracts and move registry tests onto the real activation harness ([pm-ggei](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-ggei.toon))

## 2026.7.26 - 2026-07-26

### Other

- Adopt --respect-item-release in changelog scripts and bump pm-changelog to 2026.7.24 ([pm-yg8d](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-yg8d.toon))
- Enable governance duplicate-detection advisory mode and adopt pm-cli 2026.7.25 ([pm-ra66](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-ra66.toon))

## 2026.7.23 - 2026-07-23

### Fixed

- Recommend pm merge reconcile (2026.7.22) over raw history-repair in Multi-agent merge safety docs ([pm-jau2](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-jau2.toon))

### Other

- Adopt pm field-aware merge driver for multi-agent branch-merge safety ([pm-8mdk](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-8mdk.toon))

## 2026.7.19 - 2026-07-19

### Other

- Readiness/package-governance audit 2026-05-29 ([pm-e1a3](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-e1a3.toon))
- Finish PR \#15: agent-workflow preset + unified presets flags (merge-conflict resolve, bot-review fixes, functional verify) ([pm-mnug](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-mnug.toon))
- Harden release bun-verify so registry-mirror lag cannot block the GitHub release ([pm-0f48](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-0f48.toon))

## 2026.7.10-1 - 2026-07-10

### Other

- Production hardening and consolidated-preset governance pass 2026-07-09 ([pm-0y8x](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-0y8x.toon))
- SDK 2026.7.10 alignment and production readiness pass ([pm-fw94](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-fw94.toon))

## 2026.7.6 - 2026-07-06

### Fixed

- Fix release CI ordering (publish-before-tag) ([pm-kx7u](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-kx7u.toon))

### Other

- Align Node engine with pm CLI runtime ([pm-wf6l](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-wf6l.toon))
- Regenerate CHANGELOG after pm close item ([pm-65i9](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-65i9.toon))

## 2026.6.13 - 2026-06-13

### Other

- Full-cycle hardening wave: pm-presets ([pm-mpyn](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-mpyn.toon))
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

- Add unified presets list/apply + kanban preset + registerItemTypes ([pm-14it](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/features/pm-14it.toon))
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
