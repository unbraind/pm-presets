# PM CLI/SDK 2026.10.4 certification candidate

Exact CLI/SDK, pm-ops, pm-changelog and managed pm-github pins: 2026.10.4. @types/node: 26.6.4; TypeScript: 7.0.2. SDK/manifest floor remains 2026.9.30. Consolidates Dependabot #111, #112, #114 and #115; copies CodeQL SHA `2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2` exactly. The prepare launcher is byte-identical to the published pm-ops template.

Heavy commands ran under `flock /tmp/claude-1000/heavy-gate.lock`.

- `npm install`: lock refreshed and merge drivers prepared.
- `node --test tests/prepare-merge-driver.test.ts`: 8/8 pass, zero skips, including malformed lookup error preservation.
- `pm test pm-kewj --run --only-index 1 --progress --json` runs `env -u PM_PATH npm run release:check`: **158/159 pass, zero skips**. The remaining replace-mode assertion stays intact.
- Coverage reports **100% lines / branches / functions** for 16 configured files. Statements are unmeasured; this is not whole-repository four-dimension coverage. Existing quality owner pm-915f remains open.
- `npm audit --omit=dev` and `npm audit`: **zero vulnerabilities**.
- `npx pm health --strict-exit --require-merge-drivers`: **exit 0**, one advisory stale-item finding.
- Separately completed the remaining release steps: `npm run audit:prod`, `npm run pack:dry-run`, `npm run changelog:check`, `npm run verify:release-publish-attestation`, `npm run verify:release-changelog-date`: pass.
- Managed pm-github installed from `npm:pm-github@2026.10.4`; `pm github sync --repo unbraind/pm-presets --dry-run`: no linked provenance items, `synced: 0`, `skipped: 0`, `planned: 0`. Zero-case preview; no issue writes or scheduled sync enabled. CI restores the managed package artifacts before strict health; the registry is tracked, downloaded artifacts are ignored.

## SDK blocker

[pm-cli #1394](https://github.com/unbraind/pm-cli/issues/1394) independently reproduces the published audited SDK preserving an omitted raw governance key. The callback and canonical preview cannot see it, yet the serialized raw tree retains it. Existing `tests/shared.test.ts` asserts `--replace` must remove it; the full gate remains red until the host SDK supports this safely.

`node docs/SDK-1394-repro.mjs` uses only synthetic disposable data, exits 1 with the retained-key assertion, and always deletes its workspace. Exact observation:

```json
{"cli":"2026.10.4","callbackHadLeftover":false,"receiptChanged":true,"previewHasLeftover":false,"persistedLeftover":true}
```

No direct settings-write workaround, changed assertion, ignored file, lower threshold or upstream source patch was used. Certification owner pm-kewj is blocked by package owner pm-yatu / upstream #1394.

## Real-tracker packed acceptance

Copied this repository's `.agents/pm` into `/tmp/claude-1000/cert-wt/pm-presets-dogfood/.agents/pm`. Ran `npm pack`, installed the tarball with `npm install --save-exact <archive> @unbrained/pm-cli@2026.10.4`, then `npx -y @unbrained/pm-cli@2026.10.4 package install <archive> --project`.

Both launchers `npx -y @unbrained/pm-cli@2026.10.4` and `bunx --bun @unbrained/pm-cli@2026.10.4` completed:

```sh
<launcher> presets list --json
<launcher> presets validate --json
<launcher> presets show software-sprint --json
<launcher> presets diff software-sprint --json
<launcher> presets apply software-sprint --dry-run
# Each preset: bug-triage, indie-dev, open-source, software-sprint,
# startup-roadmap, kanban, agent-workflow
<launcher> presets apply <preset>
<launcher> presets apply <preset> --replace
<launcher> presets export <runtime>-real-tracker --output <runtime>-export.json
```

Both exported snapshots parsed; npm and native Bun catalogs matched. Output: `Real tracker npm/native Bun preset catalog equality; all seven merge/replace paths completed.` Scratch tracker deleted. These successful preset workflows do not override the separate omitted-raw-key regression.
