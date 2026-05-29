import { applyPreset, storedTemplate, } from "../shared.js";
export const SETTINGS = {
    id_prefix: "oss-",
    governance: {
        preset: "default",
        ownership_enforcement: "warn",
        create_mode_default: "progressive",
        close_validation_default: "warn",
        parent_reference: "warn",
        metadata_profile: "core",
        create_default_type: "Issue",
    },
    validation: {
        sprint_release_format: "warn",
        parent_reference: "warn",
        metadata_profile: "core",
    },
};
export const TEMPLATES = {
    "bug-report.json": storedTemplate("bug-report", {
        type: "Issue",
        priority: "2",
        tags: "bug,community",
        reporter: "TBD",
        affectedVersion: "TBD",
        component: "TBD",
        reproSteps: "1. TBD",
        expectedResult: "TBD",
        actualResult: "TBD",
        acceptanceCriteria: "Maintainer can reproduce or has enough detail to classify the report.",
        body: "## Summary\nTBD\n\n## Reproduction\nTBD\n\n## Environment\nTBD\n\n## Upstream Issue\nTBD\n\n## Logs or Screenshots\nTBD\n",
    }),
    "feature-request.json": storedTemplate("feature-request", {
        type: "Feature",
        priority: "2",
        tags: "feature-request,community",
        value: "TBD",
        impact: "TBD",
        whyNow: "TBD",
        acceptanceCriteria: "Scope is clear, alternatives are considered, and maintainers can decide on next action.",
        body: "## Requested By\nTBD\n\n## Use Case\nTBD\n\n## Proposed Solution\nTBD\n\n## Alternatives\nTBD\n\n## Upstream Issue\nTBD\n\n## Milestone\nTBD\n",
    }),
    "good-first-issue.json": storedTemplate("good-first-issue", {
        type: "Task",
        priority: "3",
        tags: "good-first-issue,help-wanted,contributor-friendly",
        estimatedMinutes: "120",
        acceptanceCriteria: "Issue is scoped for a first-time contributor and includes validation steps.",
        body: "## Task\nTBD\n\n## Skill Level\nbeginner\n\n## Relevant Files\nTBD\n\n## Mentorship Contact\nTBD\n\n## Related Docs\nTBD\n\n## Validation\nTBD\n",
    }),
};
export function runOpenSourceSetup(context) {
    applyPreset(context, {
        label: "Open source",
        settings: SETTINGS,
        templates: TEMPLATES,
        nextSteps: [
            'pm create --template bug-report --title "Investigate community bug"',
            'pm create --template feature-request --title "Evaluate feature request"',
            'pm create --template good-first-issue --title "Prepare contributor task"',
            "pm list",
        ],
    });
}
//# sourceMappingURL=index.js.map