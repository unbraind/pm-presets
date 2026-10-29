import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";

import {
  applyPreset,
  storedTemplate,
  type PresetSettingsPatch,
  type PresetTemplateMap,
} from "../shared.ts";
import type { PresetParameter, PresetParameterManifest } from "../../params.ts";

/**
 * The typed parameter binding manifest for the startup-roadmap preset.
 *
 * `projectKey` is declared once here and referenced with `${param:projectKey}`
 * occurrences in the settings patch (`id_prefix`), template bodies and the
 * preset's seed item, so one supplied value reaches every declared occurrence.
 * Its default keeps the historical `road-` prefix and prose when no parameter
 * is supplied, so existing invocations are unchanged.
 */
export const PARAMETERS: PresetParameterManifest = [
  {
    name: "projectKey",
    type: "string",
    required: true,
    default: "road",
    pattern: "[a-z][a-z0-9-]{0,15}",
    maxLength: 16,
    description: "Lowercase project key used for item id prefixes, roadmap template prose and the starter initiative seed.",
  } satisfies PresetParameter,
];

/**
 * The settings patch for the startup-roadmap preset.
 *
 * Custom governance with strict metadata and stale-lock force required, tuned
 * for roadmap planning; the default create type is `Feature` and new items are
 * prefixed `road-`.
 */
export const SETTINGS = {
  id_prefix: "${param:projectKey}-",
  governance: {
    preset: "custom",
    ownership_enforcement: "warn",
    create_mode_default: "progressive",
    close_validation_default: "warn",
    parent_reference: "warn",
    metadata_profile: "strict",
    force_required_for_stale_lock: true,
    create_default_type: "Feature",
  },
  validation: {
    sprint_release_format: "warn",
    parent_reference: "warn",
    metadata_profile: "strict",
  },
  testing: {
    record_results_to_items: false,
  },
} satisfies PresetSettingsPatch;

/**
 * The templates the startup-roadmap preset installs: an `initiative`, a roadmap
 * `feature`, and a `milestone` (the last with a `+90d` deadline default).
 */
export const TEMPLATES = {
  "initiative.json": storedTemplate("initiative", {
    type: "Epic",
    priority: "1",
    tags: "initiative,roadmap",
    value: "TBD",
    impact: "TBD",
    outcome: "TBD",
    whyNow: "TBD",
    risk: "high",
    confidence: "medium",
    acceptanceCriteria:
      "Initiative has owner, success metrics, target window, and explicit risks.",
    body:
      "## Objective\nTBD\n\n## Project\n${param:projectKey}\n\n## Owner\nTBD\n\n## Stakeholders\nTBD\n\n## Target Quarter\nTBD\n\n## Investment Level\nTBD\n\n## Business Value\nTBD\n\n## Success Metrics\nTBD\n\n## Risks\nTBD\n",
  }),
  "feature.json": storedTemplate("feature", {
    type: "Feature",
    priority: "2",
    tags: "feature,roadmap",
    value: "TBD",
    impact: "TBD",
    estimatedMinutes: "480",
    risk: "medium",
    confidence: "medium",
    acceptanceCriteria:
      "Feature is linked to a roadmap outcome and has measurable acceptance criteria.",
    body:
      "## Milestone\nTBD\n\n## Project\n${param:projectKey}\n\n## User Story\nTBD\n\n## Impacted Personas\nTBD\n\n## Design Link\nTBD\n\n## Scope\nTBD\n\n## Acceptance\nTBD\n",
  }),
  "milestone.json": storedTemplate("milestone", {
    type: "Milestone",
    priority: "1",
    tags: "milestone,roadmap",
    deadline: "+90d",
    release: "TBD",
    acceptanceCriteria:
      "Milestone scope, exit criteria, and stakeholder sign-off are explicit.",
    body:
      "## Owner\nTBD\n\n## Scope Summary\nTBD\n\n## Exit Criteria\nTBD\n\n## Stakeholder Sign-off\nTBD\n\n## Investor Facing\nfalse\n\n## Go-To-Market Notes\nTBD\n",
  }),
} satisfies PresetTemplateMap;

/**
 * Command handler for the startup-roadmap setup command: delegates the
 * settings, templates, and next-steps to {@link applyPreset}.
 */
export async function runStartupRoadmapSetup(context: CommandHandlerContext): Promise<void> {
  await applyPreset(context, {
    presetId: "startup-roadmap",
    label: "Startup roadmap",
    settings: SETTINGS,
    templates: TEMPLATES,
    parameters: PARAMETERS,
    nextSteps: [
      'pm create --template initiative --title "Plan strategic initiative"',
      'pm create --template feature --title "Define roadmap feature"',
      'pm create --template milestone --title "Commit roadmap milestone"',
      "pm list --tag roadmap",
    ],
  });
}
