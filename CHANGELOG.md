# Changelog

## 2026.10.30 - 2026-10-30

### Fixed

- Resolve the host SDK through symlinked pm entry points ([pm-jzy6](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-jzy6.toon))

## 2026.10.28 - 2026-10-28

### Other

- Stop Hound from linting generated dist/ output ([pm-hound-generated-dist](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-hound-generated-dist.toon))

## 2026.10.27 - 2026-10-27

### Changed

- Use the pm SDK for preset seed creation ([pm-1j8u](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-1j8u.toon))

## 2026.10.26 - 2026-10-26

### Added

- Preview preset stacks through host profile composition ([pm-1eww](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/features/pm-1eww.toon))

### Other

- Point the npm homepage at the package catalog and link the author ([pm-39f2](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-39f2.toon))

## 2026.10.25 - 2026-10-25

### Added

- Negotiate preset prerequisites before settings changes ([pm-8dq2](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/features/pm-8dq2.toon))
- Preserve local settings through versioned preset upgrades ([pm-qgje](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/features/pm-qgje.toon))
- Simulate preset agent workflows before workspace installation ([pm-ygsu](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/features/pm-ygsu.toon))

### Fixed

- Preserve SDK refusal identity when loading create templates ([pm-bzvf](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-bzvf.toon))
- Clarify reconciliation evidence limits in merge-safety documentation ([pm-jau2](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-jau2.toon))

## 2026.10.23 - 2026-10-23

### Changed

- Enable the gated GitHub issue sync ([pm-1631](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-1631.toon))
- Adopt pm-github 2026.10.16: default-branch-safe gated sync and daily gated closeout PRs ([pm-1ugy](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-1ugy.toon))

### Fixed

- Propagate the docstring gate entry guard fix ([pm-wqll](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-wqll.toon))
- The publish-attestation gate misses a publish routed through an unquoted shell variable ([pm-mzg9](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-mzg9.toon))
- Preset apply bypasses workspace settings history and leaves strict health failing ([pm-1vx6](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-1vx6.toon))
- Keep weekly toolchain bumps compatible with audited preset replacement and prepare behavior ([pm-0czt](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-0czt.toon))
- The release job authenticated with a stored npm token that expired, so publishing stopped while every other gate stayed green ([pm-6e1a](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-6e1a.toon))
- A release run bumped and committed a new version every night while publishing was impossible, because the only externally-failable step runs last ([pm-nhcz](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-nhcz.toon))

### Other

- Certify pm-presets on PM CLI SDK 2026.9.28 and current published release helpers ([pm-weky](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-weky.toon))

### Closed

- Closed: Fix release publish ordering before protected main push ([pm-g33z](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-g33z.toon))

## 2026.10.12 - 2026-10-12

### Fixed

- Keep weekly toolchain bumps compatible with audited preset replacement and prepare behavior ([pm-0czt](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-0czt.toon))

## 2026.10.5 - 2026-10-05

### Other

- Auto-merge green Dependabot updates and group the pm toolchain into one daily PR ([pm-v1it](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-v1it.toon))

## 2026.9.26 - 2026-09-26

### Other

- Certify pm CLI 2026.9.23 and adopt the guarded pm-ops merge-driver launcher ([pm-deqt](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-deqt.toon))

## 2026.9.22 - 2026-09-22

### Fixed

- A publish that npm accepts late is reported as failed and the GitHub Release is skipped on bun mirror lag ([pm-y8lz](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-y8lz.toon))

### Other

- Certify pm CLI 2026.9.21 and install merge drivers through the canonical pm-ops launcher ([pm-wmxk](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/tasks/pm-wmxk.toon))

## 2026.9.18 - 2026-09-18

### Other

- Certify pm CLI 2026.9.17 ([pm-yffv](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-yffv.toon))

## 2026.9.13 - 2026-09-13

### Other

- Certify pm CLI 2026.9.12 and the pm-ops 2026.9.11 auditor ([pm-cmnc](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-cmnc.toon))

## 2026.9.11 - 2026-09-11

### Other

- Certify pm CLI 2026.9.10 and pick up the canonical auditor fixes the lockfile was holding back ([pm-1kos](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-1kos.toon))

## 2026.9.9 - 2026-09-09

### Other

- Close the coverage mandate gap ([pm-kqnt](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-kqnt.toon))

## 2026.9.8 - 2026-09-08

### Security

- Consume the canonical attestation gate instead of carrying a copy of it ([pm-y0j0](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-y0j0.toon))

## 2026.9.1 - 2026-09-01

### Fixed

- This repository has never produced a static analysis, because it runs no CodeQL workflow ([pm-q9vo](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-q9vo.toon))
- Group codeql-action bumps into one pull request to end the split-PR deadlock ([pm-jg3f](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-jg3f.toon))

## 2026.8.31 - 2026-08-31

### Closed

- Closed: The release changelog remained Unreleased after the release tag was created ([pm-70um](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-70um.toon))

## 2026.8.29 - 2026-08-29

### Fixed

- A failed provenance publish silently falls back to an unattested one ([pm-acsd](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-acsd.toon))
- Stabilise the changelog gate release date by deriving it from the calendar version instead of the clock ([pm-rwp3](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-rwp3.toon))
- Finish suffix-safe changelog date verification ([pm-75jv](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-75jv.toon))
- Harden publish attestation scanner against review bypasses ([pm-scbd](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-scbd.toon))

## 2026.8.28 - 2026-08-28

### Fixed

- changelog scripts read the pm workspace with default budgets instead of canonical complete reads ([pm-4wc5](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-4wc5.toon))

### Other

- Relocate the preset catalog out of manifest.json and guard the closed manifest vocabulary ([pm-3e1u](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-3e1u.toon))

### Closed

- Closed: The identity gate deadlocks the one remediation its own failure message prescribes ([pm-dc4q](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-dc4q.toon))

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

## 2026.8.1 - 2026-08-01

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

### Other

- Adopt pm field-aware merge driver for multi-agent branch-merge safety ([pm-8mdk](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/chores/pm-8mdk.toon))

### Closed

- Closed: Recommend pm merge reconcile (2026.7.22) over raw history-repair in Multi-agent merge safety docs ([pm-jau2](https://github.com/unbraind/pm-presets/blob/main/.agents/pm/issues/pm-jau2.toon))

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
