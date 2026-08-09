import type { CommandHandlerContext, SchemaItemTypeDefinition } from "@unbrained/pm-cli/sdk";
/**
 * The settings patch for the kanban preset.
 *
 * Minimal governance with warn-level parent references and no close
 * validation, tuned for flow-based board work; the default create type is the
 * custom `Card` and new items are prefixed `kan-`.
 */
export declare const SETTINGS: {
    id_prefix: string;
    governance: {
        preset: "minimal";
        ownership_enforcement: "warn";
        create_mode_default: "progressive";
        close_validation_default: "off";
        parent_reference: "warn";
        metadata_profile: "core";
        create_default_type: string;
    };
    validation: {
        sprint_release_format: "warn";
        parent_reference: "warn";
        metadata_profile: "core";
    };
    testing: {
        record_results_to_items: false;
    };
};
/**
 * Custom item types this preset contributes to the workspace schema, registered
 * at activation via `api.registerItemTypes` (see `../../index.ts`). Defines a
 * `Card` type whose options constrain a card's `column` and `swimlane`, so the
 * board state is validated rather than free-form.
 */
export declare const ITEM_TYPES: SchemaItemTypeDefinition[];
/**
 * The templates the kanban preset installs: a `card`, an `expedite` card in the
 * expedite swimlane, and a `blocked` card in the blocked swimlane.
 */
export declare const TEMPLATES: {
    "card.json": import("../shared.ts").StoredCreateTemplateDocument;
    "expedite.json": import("../shared.ts").StoredCreateTemplateDocument;
    "blocked.json": import("../shared.ts").StoredCreateTemplateDocument;
};
/**
 * Command handler for the kanban setup command: delegates the settings,
 * templates and next-steps to {@link applyPreset}.
 *
 * Item types are deliberately not part of this delegation. The `Card` type is
 * registered at activation through `api.registerItemTypes` (see
 * `../../index.ts`), because the type must exist for every command in the
 * session rather than only after setup has been run.
 */
export declare function runKanbanSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map