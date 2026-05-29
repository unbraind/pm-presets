import { applyPreset, storedTemplate, } from "../shared.js";
export const SETTINGS = {
    id_prefix: "sprint-",
    governance: {
        preset: "default",
        ownership_enforcement: "warn",
        create_mode_default: "progressive",
        close_validation_default: "warn",
        parent_reference: "warn",
        metadata_profile: "core",
        create_default_type: "Task",
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
export const TEMPLATES = {
    "bug.json": storedTemplate("bug", {
        type: "Issue",
        priority: "1",
        tags: "bug,sprint",
        sprint: "current",
        severity: "high",
        environment: "TBD",
        component: "TBD",
        assignee: "TBD",
        reproSteps: "1. TBD",
        expectedResult: "TBD",
        actualResult: "TBD",
        acceptanceCriteria: "Bug is fixed, covered by validation, and ready for sprint review.",
        body: "## Reproduction\nTBD\n\n## Fix Notes\nTBD\n",
    }),
    "epic.json": storedTemplate("epic", {
        type: "Epic",
        priority: "2",
        tags: "epic,sprint",
        goal: "TBD",
        objective: "TBD",
        release: "TBD",
        risk: "medium",
        acceptanceCriteria: "Epic has a clear outcome, scoped child work, and release target.",
        body: "## Objective\nTBD\n\n## Stakeholder\nTBD\n\n## Estimated Sprints\nTBD\n\n## Success Criteria\nTBD\n\n## Scope\nTBD\n",
    }),
    "feature.json": storedTemplate("feature", {
        type: "Feature",
        priority: "2",
        tags: "feature,sprint",
        sprint: "current",
        estimatedMinutes: "240",
        reviewer: "TBD",
        risk: "medium",
        confidence: "high",
        acceptanceCriteria: "Feature meets acceptance criteria, has tests, and is reviewed.",
        body: "## User Story\nTBD\n\n## Design Link\nTBD\n\n## Implementation Notes\nTBD\n",
    }),
    "task.json": storedTemplate("task", {
        type: "Task",
        priority: "2",
        tags: "task,sprint",
        sprint: "current",
        estimatedMinutes: "90",
        assignee: "TBD",
        acceptanceCriteria: "Task is complete and linked validation is green.",
        body: "## Work\nTBD\n\n## Blocked By\nTBD\n\n## Pull Request\nTBD\n\n## Validation\nTBD\n",
    }),
};
export function runSoftwareSprintSetup(context) {
    applyPreset(context, {
        label: "Software sprint",
        settings: SETTINGS,
        templates: TEMPLATES,
        nextSteps: [
            'pm create --template epic --title "Plan sprint epic"',
            'pm create --template feature --title "Build sprint feature"',
            'pm create --template task --title "Complete sprint task"',
            'pm create --template bug --title "Fix sprint bug"',
            "pm list",
        ],
    });
}
//# sourceMappingURL=index.js.map