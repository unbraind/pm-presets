/** Shared dispatch used by actual installation and disposable simulations. */
import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
import type { PresetId } from "./registry.ts";
import { runBugTriageSetup } from "./presets/bug-triage/index.ts";
import { runIndieDevSetup } from "./presets/indie-dev/index.ts";
import { runOpenSourceSetup } from "./presets/open-source/index.ts";
import { runSoftwareSprintSetup } from "./presets/software-sprint/index.ts";
import { runStartupRoadmapSetup } from "./presets/startup-roadmap/index.ts";
import { runKanbanSetup } from "./presets/kanban/index.ts";
import { runAgentWorkflowSetup } from "./presets/agent-workflow/index.ts";

/** Complete setup handlers, keyed by the closed bundled-preset union. */
export const PRESET_HANDLERS: Record<PresetId, (ctx: CommandHandlerContext) => Promise<void>> = {
  "bug-triage": runBugTriageSetup,
  "indie-dev": runIndieDevSetup,
  "open-source": runOpenSourceSetup,
  "software-sprint": runSoftwareSprintSetup,
  "startup-roadmap": runStartupRoadmapSetup,
  "kanban": runKanbanSetup,
  "agent-workflow": runAgentWorkflowSetup,
};
