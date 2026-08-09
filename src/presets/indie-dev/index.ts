import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";

import {
  applyPreset,
  storedTemplate,
  type PresetSettingsPatch,
  type PresetTemplateMap,
} from "../shared.ts";

/**
 * The settings patch for the indie-dev preset.
 *
 * Minimal governance (`metadata_profile: core`, no close validation, no test
 * recording) for a solo developer; the default create type is `Task` and new
 * items are prefixed `indie-`.
 */
export const SETTINGS = {
  id_prefix: "indie-",
  governance: {
    preset: "minimal",
    ownership_enforcement: "none",
    create_mode_default: "progressive",
    close_validation_default: "off",
    metadata_profile: "core",
    create_default_type: "Task",
  },
  validation: {
    sprint_release_format: "warn",
    parent_reference: "warn",
    metadata_profile: "core",
  },
  testing: {
    record_results_to_items: false,
  },
} satisfies PresetSettingsPatch;

/**
 * The templates the indie-dev preset installs: an `idea` decision record and a
 * solo `task`, keeping the surface small for a one-person workspace.
 */
export const TEMPLATES = {
  "idea.json": storedTemplate("idea", {
    type: "Decision",
    priority: "3",
    tags: "idea",
    outcome: "TBD",
    whyNow: "TBD",
    body:
      "## Idea\nTBD\n\n## Hypothesis\nTBD\n\n## Effort\nsmall\n\n## Project\nTBD\n\n## Decision\nTBD\n\n## Outcome\nTBD\n",
  }),
  "task.json": storedTemplate("task", {
    type: "Task",
    priority: "2",
    tags: "solo",
    estimatedMinutes: "60",
    acceptanceCriteria: "Task is complete and any relevant notes are captured.",
    body: "## Project\nTBD\n\n## Notes\nTBD\n\n## Done When\nTBD\n",
  }),
} satisfies PresetTemplateMap;

/**
 * Command handler for the indie-dev setup command: delegates the settings,
 * templates, and next-steps to {@link applyPreset}.
 */
export function runIndieDevSetup(context: CommandHandlerContext): void {
  applyPreset(context, {
    label: "Indie dev",
    settings: SETTINGS,
    templates: TEMPLATES,
    nextSteps: [
      'pm create --template idea --title "Evaluate new idea"',
      'pm create --template task --title "Ship the next task"',
    ],
  });
}
