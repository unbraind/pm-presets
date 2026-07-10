import { applyPreset, storedTemplate, } from "../shared.js";
/**
 * agent-workflow — project management for teams orchestrating AI agents.
 *
 * The workspace centers on agent runs (delegated, observable units of work),
 * prompt experiments (iterating on instructions/tooling), and eval runs
 * (measuring agent quality). A custom `AgentRun` item type carries the
 * agent lifecycle phase, autonomy mode, and target model so the board reads
 * like a CI dashboard for autonomous work.
 */
export const SETTINGS = {
    id_prefix: "agent-",
    governance: {
        preset: "default",
        ownership_enforcement: "warn",
        create_mode_default: "progressive",
        close_validation_default: "warn",
        parent_reference: "warn",
        metadata_profile: "core",
        create_default_type: "AgentRun",
    },
    validation: {
        sprint_release_format: "warn",
        parent_reference: "warn",
        metadata_profile: "core",
    },
    testing: {
        record_results_to_items: true,
    },
};
// Custom item types this preset contributes to the workspace schema. Registered
// at activation via api.registerItemTypes — see ../../index.ts.
export const ITEM_TYPES = [
    {
        name: "AgentRun",
        aliases: ["agent", "agent-run"],
        options: [
            {
                key: "phase",
                values: ["queued", "planning", "running", "review", "completed", "failed"],
            },
            {
                key: "mode",
                values: ["autonomous", "supervised", "interactive"],
            },
            {
                key: "model",
                values: ["auto", "gpt-4o", "claude-3.5", "local"],
            },
        ],
    },
];
export const TEMPLATES = {
    "agent-task.json": storedTemplate("agent-task", {
        type: "AgentRun",
        priority: "2",
        tags: "agent,task",
        typeOption: ["phase=queued", "mode=supervised", "model=auto"],
        assignee: "TBD",
        acceptanceCriteria: "Agent run completes its objective with a recorded result and artifacts.",
        body: "## Objective\nTBD\n\n## Tools / Access\nTBD\n\n## Success Criteria\nTBD\n\n## Artifacts\nTBD\n",
    }),
    "prompt-experiment.json": storedTemplate("prompt-experiment", {
        type: "AgentRun",
        priority: "3",
        tags: "agent,prompt,experiment",
        typeOption: ["phase=planning", "mode=interactive", "model=auto"],
        assignee: "TBD",
        acceptanceCriteria: "Prompt change is evaluated against the eval set and the delta is recorded.",
        body: "## Hypothesis\nTBD\n\n## Prompt Change\nTBD\n\n## Eval Set\nTBD\n\n## Result vs Baseline\nTBD\n",
    }),
    "eval-run.json": storedTemplate("eval-run", {
        type: "AgentRun",
        priority: "2",
        tags: "agent,eval",
        typeOption: ["phase=queued", "mode=autonomous", "model=auto"],
        assignee: "TBD",
        acceptanceCriteria: "Eval run produces a scorecard comparing the candidate against the baseline.",
        body: "## Eval Set\nTBD\n\n## Candidate\nTBD\n\n## Baseline\nTBD\n\n## Scorecard\nTBD\n",
    }),
};
export function runAgentWorkflowSetup(context) {
    applyPreset(context, {
        label: "Agent workflow",
        settings: SETTINGS,
        templates: TEMPLATES,
        nextSteps: [
            'pm create --template agent-task --title "Delegated agent task"',
            'pm create --template prompt-experiment --title "Iterate on the prompt"',
            'pm create --template eval-run --title "Run the eval suite"',
            "pm list --type AgentRun",
        ],
    });
}
//# sourceMappingURL=index.js.map