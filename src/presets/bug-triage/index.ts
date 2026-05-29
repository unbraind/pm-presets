import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";

import {
  applyPreset,
  storedTemplate,
  type PresetSettingsPatch,
  type PresetTemplateMap,
} from "../shared.js";

export const SETTINGS = {
  id_prefix: "bug-",
  governance: {
    preset: "custom",
    ownership_enforcement: "strict",
    create_mode_default: "progressive",
    close_validation_default: "strict",
    parent_reference: "strict_error",
    metadata_profile: "strict",
    force_required_for_stale_lock: true,
    create_default_type: "Issue",
  },
  validation: {
    sprint_release_format: "strict_error",
    parent_reference: "warn",
    metadata_profile: "strict",
  },
  testing: {
    record_results_to_items: true,
  },
} satisfies PresetSettingsPatch;

export const TEMPLATES = {
  "incident.json": storedTemplate("incident", {
    type: "Issue",
    priority: "1",
    tags: "incident,production",
    severity: "critical",
    environment: "production",
    customerImpact: "TBD",
    component: "TBD",
    reporter: "TBD",
    reproSteps: "1. TBD",
    expectedResult: "Service remains healthy for users.",
    actualResult: "TBD",
    acceptanceCriteria:
      "Impact is mitigated, root cause is documented, and a follow-up owner is assigned.",
    body:
      "## Impact\nTBD\n\n## Timeline\nDetected at: TBD\nOwner: TBD\nAffected systems: TBD\n\n## Mitigation\nTBD\n\n## Root Cause\nTBD\n\n## Postmortem\nTBD\n",
  }),
  "hotfix-task.json": storedTemplate("hotfix-task", {
    type: "Task",
    priority: "1",
    tags: "hotfix,incident",
    assignee: "TBD",
    reviewer: "TBD",
    release: "production",
    risk: "high",
    acceptanceCriteria:
      "Fix is reviewed, deployed to the target environment, and rollback steps are documented.",
    body:
      "## Fix\nTBD\n\n## Linked Incident\nTBD\n\n## Validation\nTBD\n\n## Target\nBranch: main\nDeploy target: production\n\n## Rollback Plan\nTBD\n\n## Pull Request\nTBD\n",
  }),
  "regression.json": storedTemplate("regression", {
    type: "Issue",
    priority: "2",
    tags: "regression",
    severity: "high",
    environment: "TBD",
    regression: "true",
    affectedVersion: "TBD",
    fixedVersion: "TBD",
    reproSteps: "1. TBD",
    expectedResult: "Previous known-good behavior is preserved.",
    actualResult: "TBD",
    acceptanceCriteria:
      "Regression is fixed, verified against the last known-good behavior, and covered by a test.",
    body:
      "## Regression Summary\nTBD\n\n## Owner\nTBD\n\n## Introduced In\nTBD\n\n## Affected Tests\nTBD\n\n## Last Known Good\nTBD\n\n## Verification\nTBD\n",
  }),
} satisfies PresetTemplateMap;

export function runBugTriageSetup(context: CommandHandlerContext): void {
  applyPreset(context, {
    label: "Bug triage",
    settings: SETTINGS,
    templates: TEMPLATES,
    nextSteps: [
      'pm create --template incident --title "Investigate production incident"',
      'pm create --template hotfix-task --title "Ship incident hotfix"',
      'pm create --template regression --title "Fix regression"',
    ],
    warning:
      "Strict governance is active: closing work requires complete resolution metadata.",
  });
}
