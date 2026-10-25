# Seed SDK adoption evidence

Baseline: pm-presets `117a077df250a905d8a8f9ebee39eeeb38b4a0f4`
(origin/main, version 2026.10.25). The package SDK remains pinned to
2026.10.20; the registry CLI version was verified as 2026.10.25.

| Audit finding | Replacement / disposition | Evidence |
| --- | --- | --- |
| `src/seeds.ts:114-158`: CLI-based seed creation | Inject `ctx.sdk.client`, await `PmClient.create` for each seed, delete subprocess writer and exit/output parsing. Preserve ordered independent partial successes. | `tests/seeds.test.ts`, `tests/commands.test.ts`, installed-host regression below, 28 differential cases. |
| Seed-set shared replay/precondition boundary | No such boundary exists: independent creates intentionally retain successes after a failure. `commitItemMutations` would change this behavior. | A refused first seed followed by a successful seed retains exactly the latter, including author, tags, priority and body. |
| Manual argv preview | Retain `buildSeedCreateArgs` solely for the existing `planSeeds().command` presentation contract. The SDK has no structured create-options-to-argv preview API; `renderPmCommand` requires already-tokenized argv. This helper never drives writes. | Existing pure argv and plan tests remain unchanged. |
| `src/presets/shared.ts:278-285`, `src/upgrade.ts:165-168` | Already use `mutateWorkspaceSettings`; retain raw vendor/base settings. Normalized `readSettings` strips fields and cannot replace lossless vendor snapshots. | Existing audited settings and upgrade tests; new corrupt-after-cache refusal regression. |

## Differential procedure

Build the baseline archive using the same pinned dependencies as the candidate.
Export `.agents/pm` from the public repositories' origin/main commits. These are
read-only inputs: the harness hashes them before and after execution. Every
command runs on a disposable overlay in a non-git directory with
`GIT_CEILING_DIRECTORIES` set and a PATH containing only a launcher for the pinned
pm host. The baseline needs that launcher; the candidate's separate regression
also runs with an empty PATH.

Run:

```sh
node scripts/sdk-seed-differential.ts <baseline-package> <presets-tracker-snapshot> <review-tracker-snapshot>
```

| Public source | Commit | Snapshot SHA-256 | Matching cases |
| --- | --- | --- | --- |
| unbraind/pm-presets | `117a077df250a905d8a8f9ebee39eeeb38b4a0f4` | `790935dabea1728de6cf56a11796ad9c4d64440357ff9805714e4a9a37eca9d3` | 14 |
| unbraind/pm-review | `d65d149bbcafdc11d2ef6addcfff8bf2e4f479e1` | `76f5070fb89e72e94b74cc1ee62eccaa75f8642849e1fd28c7ab5f5103863679` | 14 |

Each tracker covers all seven presets in dry-run and real application modes.
Compare exit codes, stdout, stderr and full created item contents; normalize only
the disposable workspace path, generated item IDs and creation/update timestamps.
Existing public items must stay unchanged. Both source snapshots retain their
hashes. Result: **28/28 match, zero output or item-content differences**.

An additional invalid-first/valid-second function comparison preserves counts,
order and the valid stored item. One intentional diagnostic difference is named
and asserted: the subprocess CLI gave `Error: Invalid argument value`, while the
SDK returns its specific `Invalid type value "UnknownSeedType"` detail. README
calls out the native diagnostic behavior.

The intentional invocation changes are that seed writes use the host's author,
workspace and active schema, need no executable on PATH, and refuse a missing
host create capability. Native validation failures retain per-item reporting and
a nonzero final exit. Dry-run output remains unchanged.

## Revert proof and integrity

The new installed-host regression runs all seven presets with seeds, including
Card and AgentRun, with no pm or git executable on PATH. Candidate: passes. With
only the changed seed implementation and its caller restored to the baseline
(the rest of the source is identical), the same regression fails at the first
seed with `spawnSync pm ENOENT` (0/1 pass).

The corruption regression creates valid workspace history, primes the SDK's
mutation-event cache, then changes an authoritative history patch without
resealing it. Applying with seeds refuses through audited settings mutation;
settings, templates, items and corrupted history remain unchanged. No cached
index replaces verified history reads or drives a write, recovery or cursor
choice in the seed implementation.

A separate real SDK callback test preserves an actionable refusal for a foreign
provider value and confirms no settings, template or item writes. All SDK tests
use real temp trackers rather than mocked SDK clients.
