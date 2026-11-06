# Closeout attribution

Tag foreign implementation follow-ups `upstream`. These records track host work;
package changelog and release-note commands exclude that tag, including historical
copies recovered from immutable release tags. Record delivered package mitigations
in their own package-owned items so those changes remain in release notes.

An explicitly unresolved upstream follow-up also carries `upstream:unresolved`.
`npm run verify:closeout-attribution` reads the complete tracker through the SDK
and rejects a done-role status for that marker. The automated closeout caller runs
this check before generating its changelog, and the full release gate repeats it.
A merge that references or mitigates a host defect does not establish its repair.

Before removing `upstream:unresolved`, record the actual upstream repair revision
and SDK/CLI regression evidence meeting the follow-up's acceptance criteria.
Keep package compatibility refusals until their documented support criteria pass.
For an inaccurate closeout, reopen through the pinned pm CLI and append a correction;
preserve every prior audit event. Reopening clears completion fields without
releasing someone else's claim.
