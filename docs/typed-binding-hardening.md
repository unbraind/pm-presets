# Typed-binding hardening verification

The saved review commit `39a68ea` contains no remaining source or test hunks
to port onto main. PR #191 (`d1087cf`) already delivered its snapshot capture,
legacy-sensitive diff refusals, fixed scratch prefix, registered seed identity
check and regression tests. Later changes added artifact ownership and native
seed normalization. Replacing current files with the saved versions would
remove those protections. The old tracker changes belong to the closed feature
and are superseded by the related follow-up issue.

The follow-up adds independent acceptance checks in
`tests/typed-binding-hardening.test.ts`:

- Three project keys retain coherent settings, complete template documents and
  managed seed title/body when injected values and selection flags change after
  invocation. Replacement apply and diff agree in real nongit trackers.
- Desired settings, template documents, seed contents and ownership survive
  caller mutation during asynchronous replacement normalization.
- Absent, unknown and prototype-named seed identities refuse without changing
  any tracker bytes. Released catalog definitions remain accepted.
- Sensitive replacement trees refuse before scratch tracker creation and
  ordinary diffs redact their values. Sensitive prefixes cannot generate public
  seed identifiers. External references remain accepted.

Run the focused checks and reproducible behavioral reverts with:

```sh
node --test --test-concurrency=2 tests/typed-binding-hardening.test.ts
node --test --test-concurrency=2 tests/revert-evidence.test.ts
node --test --test-concurrency=2 tests/evidence-counts.test.ts
node --test --test-concurrency=2 tests/evidence-formatting.test.ts
node tests/fixtures/typed-binding-revert.ts
```

The verifier copies sources and the focused fixtures into a disposable directory,
shares installed dependencies, and changes one behavior at a time. It verifies a
passing baseline, eight failing reverts, and a passing restoration after each.
The reverts remove binding-value capture, settings capture, template capture, seed capture,
ownership-record capture, catalog membership, replacement privacy, and seed
identifier privacy. The checkout under review is never mutated. Cleanup and
restoration run even when an assertion fails.

Baseline, mutation and restoration all use the same named-result validator.
The [Node custom reporter](https://nodejs.org/api/test.html#custom-reporters)
emits terminal events rather than interpreting console text. Each run must
contain the four required test names exactly once, without skips, todo or
cancellation. A mutation must fail its designated test with its own assertion
cause while every other test passes. Every restoration must pass all four.
Counts are printed only after those checks succeed. The adversarial tests
exercise missing and filtered cases, misleading assertion text, failures in the
wrong test, malformed records and skipped restorations through real processes.
Diagnostics identify required test positions or allowlisted repository-relative
runner files. Unknown names, private path prefixes, malformed JSON contents and
invalid metadata values are omitted from assertion details. Real syntax/import
failure fixtures verify this boundary without turning loader errors into proof.

The broader evidence audit also removed fixed cardinalities from the seed
differential and public plan reporting scripts. Snapshot observations count
completed comparisons, and backend-pair counts increment after the equality
assertion. Both CLIs and property tests call the same exported reporting
functions across varied inventory sizes and failed comparisons; plan checks use
real SDK contracts in a synthetic nongit tracker. Importing either script does
not run filesystem admission or permission-changing cleanup. A disposable-copy
regression reruns the complete reporting properties after LF/CRLF conversion,
alternate brace placement and timing-variable renaming. Tests do not extract or
evaluate TypeScript source fragments.

Rebuild `dist/` from current source; do not copy generated files from the saved
commit. The open coverage/closeout PR #203 owns its source, test and tracker
changes separately. This verification does not claim to repair that gate or the
upstream closeout attribution.
