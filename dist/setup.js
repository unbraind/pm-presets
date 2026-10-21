import { runBugTriageSetup } from "./presets/bug-triage/index.js";
import { runIndieDevSetup } from "./presets/indie-dev/index.js";
import { runOpenSourceSetup } from "./presets/open-source/index.js";
import { runSoftwareSprintSetup } from "./presets/software-sprint/index.js";
import { runStartupRoadmapSetup } from "./presets/startup-roadmap/index.js";
import { runKanbanSetup } from "./presets/kanban/index.js";
import { runAgentWorkflowSetup } from "./presets/agent-workflow/index.js";
/** Complete setup handlers, keyed by the closed bundled-preset union. */
export const PRESET_HANDLERS = {
    "bug-triage": runBugTriageSetup,
    "indie-dev": runIndieDevSetup,
    "open-source": runOpenSourceSetup,
    "software-sprint": runSoftwareSprintSetup,
    "startup-roadmap": runStartupRoadmapSetup,
    "kanban": runKanbanSetup,
    "agent-workflow": runAgentWorkflowSetup,
};
//# sourceMappingURL=setup.js.map