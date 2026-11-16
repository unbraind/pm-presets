# Fleet CI v2

Required checks remain `test (22)`, `test (26)` and
`windows-prepare-lifecycle`. PRs and manual dispatch run quick CI; superseded
PRs cancel. Linux checks use GitHub-hosted Ubuntu, and the real Windows command
parser contract stays on Windows. Linux jobs time out after 30 minutes and
Windows after 15 minutes. CodeQL is optional, with a 30-minute timeout.

| Check / contract | Code PR: test (22) | Code PR: test (26) | Docs/tracker-only PR | Deep: Node 22/26 × npm/Bun |
| --- | --- | --- | --- | --- |
| npm ci and prepare merge drivers | yes | yes | all three required checks | yes |
| Strict pm health, required merge drivers | yes | yes | all three required checks | yes |
| Fresh build and committed dist parity | yes | yes | — | yes |
| Build, test compilation, entire tests suite | quick | quick via coverage | — | full via both gates |
| Typecheck | via build/test compilation | npm release gate | — | npm + Bun release gates |
| Lint and complete docstrings | — | npm release gate | — | npm + Bun release gates |
| Coverage: unchanged 100% lines/branches/functions and source scope | — | quick | — | full via both gates |
| Production dependency audit, npm pack dry-run | — | npm release gate | — | npm + Bun release gates |
| Closeout attribution verification | via tests | npm release gate | — | npm + Bun release gates |
| Changelog consistency | — | npm release gate | all three required checks | npm + Bun release gates |
| Publish attestation and version-derived changelog date | via verifier tests | npm release gate | — | npm + Bun release gates |
| Packed CLI/SDK acceptance, Node and Bun, JSON and TOON | embedded tests | embedded tests | — | embedded in both gates |
| Bun graph install and bunx host CLI smoke | — | yes | — | yes |
| Original simulation-release-gates npm/Bun checks | — | npm once | — | both gates on both Node versions |
| Windows prepare lifecycle, cmd parser, closeout launcher and behavioral revert | separate Windows quick check | separate Windows quick check | cheap checks only | retained in PR tier |
| CodeQL | separate workflow for matching paths | separate workflow for matching paths | ignored paths skip scan | main matching paths; weekly Monday 05:29 UTC |

Docs/tracker-only means all changed paths match `.agents/pm/**`, `*.md`,
`docs/**`, `CHANGELOG.md` or `LICENSE`. As in the pilot, executable tracker
JavaScript/TypeScript/shell, executable docs files and all tracker extensions
select code CI. Diff detection compares actual PR
endpoints, uses NUL-separated names and disables rename folding so moving code
into documentation still runs code checks. Manual dispatch always selects code.
The cheap path runs only npm ci, strict health and changelog consistency, while
reporting all required check names. There is no separate Markdown linter.

Deep runs on main pushes, daily at 02:53 UTC and dispatch, at full depth and
`PM_TEST_TIME_SCALE=3`. This avoids the release schedules (03:23 UTC and hourly
at :41) and weekly CodeQL. The Node 22/26 × npm/Bun matrix runs exactly one
full release gate per job. Jobs use the self-hosted `pm-local` pool unless
`PM_LOCAL_DEEP=off`, then Ubuntu hosted runners. Each job has a 120-minute timeout.
Per-ref concurrency preserves active runs and retains one pending run. Local
runners keep their persistent npm cache and preinstalled Bun; GitHub cache restore and Bun setup run only on hosted runners. Bun's version
is logged. Deep checks have distinct names and do not satisfy required PR checks.
Full-depth certification happens after merge; it has not been run locally.

`tests/support/depth.ts` defaults to full depth when unset (and for unknown
values). Quick takes the same deterministic prefix, one tenth rounded up with
a floor of 25 capped by the original count. Seed expressions, batch boundaries
and per-operation assertions stay the same. Corpus sizes are 520 → 52 parameter
sequences, 600 → 60 synthetic manifests, 500 → 50 stack sequences, 180 → 25
artifact operations, 120 → 25 canonical resolution cases, 40 → 25 ownership
trackers and 32 → 25 native seed normalization cases. Structural size limits,
adversarial secret cases and lock-protocol polling counts are unchanged.
Coverage thresholds, sources and exclusions remain identical at both depths.

Finite property suites already use operation counts rather than latency claims.
Operational watchdogs for packed CLI commands, lock worker phases and admission
barriers now honor `PM_TEST_TIME_SCALE` (default 1); invalid/nonpositive scales
fail. No product timeout or release verifier changed. Wave-1 PR #221's CI history
contains one successful run and no failed runs, so there is no demonstrated
wave-1 flaky failure to claim fixed.

Packed tests install the tarball through the host package command and execute
it under Node and Bun. They do **not** prove Bun package-manager or bunx install
paths. The explicit smoke installs the dependency graph with Bun and invokes the
pinned host CLI through bunx; this is narrower than full packed consumer
acceptance through those package managers. The Node 22 suite itself retains
embedded tarball tests; no standalone pack, coverage or changelog command runs
on that leg.

Owner measurements on 2026-11-15: 39,929 fleet runner-minutes/day, 1,357 for
this package, approximately 28 minutes median queueing and 55 minutes median
successful PR CI wall time. Latest successful main run 43679647905 measured
32m37s for test (22), 27m50s for test (26), 27m37s for simulation-release-gates
and 2m32s for Windows, from job creation to completion, including queues. Across
its logs the slowest packed test took 154.33s; the stack model took 28.93s and
parameter model 15.29s. These individual test times are full-depth historical
measurements, not controlled quick/full benchmarks.

The same historical main jobs spent 4m25s (Node 22), 2m49s (Node 26),
5m17s (simulation) and 1m00s (Windows) actually executing. Node 22 full
coverage took 4m01s, Node 26 full coverage 2m26s; simulation npm/Bun gates
took 2m28s and 2m27s. Queue time dominates the created-to-completed totals.
Local quick and current PR measurements are recorded in the tracker and PR body.

Runner environment and filter decisions were checked against the official
[contexts reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)
and [workflow trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
Required CI always triggers; path filtering is confined to optional CodeQL.

## Local validation receipt

Typecheck, lint, build/test compilation and four CI/depth/watchdog tests passed.
The seven original touched quick test files passed 73/73 with no skips or
cancellations in 8m24.12s on Node 24. The single quick coverage invocation on
Node 26 took 9m43.05s: 367/370 tests passed, with three disposable CLI fixtures
misrouted by the linked-test runner's inherited `PM_PATH`. Two audited-settings
fixtures now pass explicit `--path`; the SDK seed child pins `PM_PATH` to its
own tracker. Both affected files then passed 9/9 under that same linked-test
context in 20.63s, and typecheck/lint/test compilation passed again.

The failed coverage invocation reported 100% lines/branches/functions. Independent
LCOV inspection confirmed exactly all 36 configured source files, 6,645/6,645
lines, 1,972/1,972 branches and 388/388 functions hit. This is coverage evidence,
not a successful complete gate: no second local coverage run was performed.
Final hosted quick CI must certify the combined suite after the fixture fix;
full-depth and native Windows validation remain external. Strict YAML parsing
and six real Git-diff classifier cases passed; actionlint was unavailable.

## Final-template follow-up (2026-11-16)

Latest successful PR CI: [run 43728186611](https://github.com/unbraind/pm-presets/actions/runs/43728186611).
These are historical workflow job measurements, not a controlled benchmark of this change.

| Job | Execution (started → completed) | Wall time (created → completed) |
| --- | --- | --- |
| simulation-release-gates | 7m45s | 103m18s |
| windows-prepare-lifecycle | 1m07s | 34m12s |
| test (22) | 5m27s | 111m24s |
| test (26) | 4m07s | 110m33s |

Every measured job executed within the 15-minute quick-tier target. Queueing
explains any larger wall time. No test-depth adjustment or sharding is included.
CodeQL is optional: ordered paths exclude tracker data, Markdown, docs and
lockfiles, then restore all executable tracker suffixes (`mjs,cjs,js,jsx,ts,tsx,mts,cts,sh`)
and `.agents/pm/extensions/**`. Required CI still runs on every PR.

The workflow contracts strictly parse all three tier YAML files, exercise each PR
classifier against data and executable paths, and verify one full gate per matrix
job, self-hosted setup, the runner expression and non-cancelling deep concurrency.
Full-depth execution remains post-merge deep-CI evidence.
