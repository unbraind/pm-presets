# Inspect preset behavior before applying

```typescript
import { simulatePreset, SimulationRefusal } from "pm-presets";

try {
  const report = simulatePreset({ preset: "bug-triage" });
  console.log(report.ok, report.checked, report.passed); // true, 4, 4
  const close = report.scenarios.find(row => row.id === "close-without-evidence");
  console.log(close?.expected, close?.actual); // refused, refused

  const partial = simulatePreset({ preset: "indie-dev", scenarios: ["create-task"] });
  console.log(partial.ok); // false: three workflows remain unmeasured
  console.log(partial.coverageGaps);
} catch (error) {
  if (!(error instanceof SimulationRefusal)) throw error;
  console.error(error.code, error.remedy, error.exitCode);
}
```

The SDK call is synchronous and bounded by a 60 second worker deadline. It
creates, claims, updates and closes synthetic Tasks using a local pm SDK with
extensions disabled. The constructor accepts no tracker/client/command override.
Missing selections are explicit even for `scenarios: []`. Unknown runtime IDs and
duplicate selections are refused before a worker starts.

```sh
pm presets simulate bug-triage --json
# ok:true, checked:4, passed:4; close-without-evidence is an expected refusal

pm presets simulate indie-dev --scenarios create-task --json
# exit 4; coverageGaps: claim-start, close-without-evidence, close-with-evidence
```

The JSON and default TOON reports contain the same fields. On partial coverage,
the error path prints a single compact JSON report before the host's error text.
Read `limitations` even for a complete passing suite: templates and custom types
are installed as part of setup but their creation workflows are not evaluated.
The suite never connects to external trackers or runs agent inference.
