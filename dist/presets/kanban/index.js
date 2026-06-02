import { applyPreset, storedTemplate, } from "../shared.js";
export const SETTINGS = {
    id_prefix: "kan-",
    governance: {
        preset: "minimal",
        ownership_enforcement: "warn",
        create_mode_default: "progressive",
        close_validation_default: "off",
        parent_reference: "warn",
        metadata_profile: "core",
        create_default_type: "Card",
    },
    validation: {
        sprint_release_format: "warn",
        parent_reference: "warn",
        metadata_profile: "core",
    },
    testing: {
        record_results_to_items: false,
    },
};
// Custom item types this preset contributes to the workspace schema. Registered
// at activation via api.registerItemTypes — see ../../index.ts.
export const ITEM_TYPES = [
    {
        name: "Card",
        aliases: ["card"],
        options: [
            {
                key: "column",
                values: ["backlog", "todo", "in-progress", "review", "done"],
            },
            { key: "swimlane", values: ["default", "expedite", "blocked"] },
        ],
    },
];
export const TEMPLATES = {
    "card.json": storedTemplate("card", {
        type: "Card",
        priority: "2",
        tags: "kanban",
        column: "backlog",
        swimlane: "default",
        assignee: "TBD",
        acceptanceCriteria: "Card reaches the done column with its checklist complete.",
        body: "## Summary\nTBD\n\n## Checklist\n- [ ] TBD\n\n## Notes\nTBD\n",
    }),
    "expedite.json": storedTemplate("expedite", {
        type: "Card",
        priority: "1",
        tags: "kanban,expedite",
        column: "todo",
        swimlane: "expedite",
        assignee: "TBD",
        acceptanceCriteria: "Expedited card is unblocked and pulled straight to done.",
        body: "## Why expedite\nTBD\n\n## Blocking\nTBD\n\n## Resolution\nTBD\n",
    }),
    "blocked.json": storedTemplate("blocked", {
        type: "Card",
        priority: "2",
        tags: "kanban,blocked",
        column: "in-progress",
        swimlane: "blocked",
        blockedBy: "TBD",
        assignee: "TBD",
        acceptanceCriteria: "Blocker is cleared and the card returns to the active flow.",
        body: "## Blocked by\nTBD\n\n## Owner of blocker\nTBD\n\n## Next check-in\nTBD\n",
    }),
};
export function runKanbanSetup(context) {
    applyPreset(context, {
        label: "Kanban board",
        settings: SETTINGS,
        templates: TEMPLATES,
        nextSteps: [
            'pm create --template card --title "Pull a card onto the board"',
            'pm create --template expedite --title "Expedite urgent work"',
            "pm list --type Card",
        ],
    });
}
//# sourceMappingURL=index.js.map