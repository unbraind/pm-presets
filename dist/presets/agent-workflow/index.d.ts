import type { CommandHandlerContext, SchemaItemTypeDefinition } from "@unbrained/pm-cli/sdk";
/**
 * agent-workflow — project management for teams orchestrating AI agents.
 *
 * The workspace centers on agent runs (delegated, observable units of work),
 * prompt experiments (iterating on instructions/tooling), and eval runs
 * (measuring agent quality). A custom `AgentRun` item type carries the
 * agent lifecycle phase, autonomy mode, and target model so the board reads
 * like a CI dashboard for autonomous work.
 */
export declare const SETTINGS: {
    id_prefix: string;
    governance: {
        preset: "default";
        ownership_enforcement: "warn";
        create_mode_default: "progressive";
        close_validation_default: "warn";
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
        record_results_to_items: true;
    };
};
/**
 * Custom item types this preset contributes to the workspace schema, registered
 * at activation via `api.registerItemTypes` (see `../../index.ts`). Defines an
 * `AgentRun` type whose options capture the agent lifecycle `phase`, the
 * autonomy `mode`, and the target `model`, so an agent board reads like a CI
 * dashboard.
 */
export declare const ITEM_TYPES: SchemaItemTypeDefinition[];
/**
 * The templates the agent-workflow preset installs: an `agent-task`, a
 * `prompt-experiment`, and the remaining agent-run templates, each shaped
 * around the `AgentRun` item type.
 */
export declare const TEMPLATES: {
    "agent-task.json": import("../shared.ts").StoredCreateTemplateDocument;
    "prompt-experiment.json": import("../shared.ts").StoredCreateTemplateDocument;
    "eval-run.json": import("../shared.ts").StoredCreateTemplateDocument;
};
/**
 * Command handler for the agent-workflow setup command: delegates the settings,
 * templates and next-steps to {@link applyPreset}.
 *
 * Item types are deliberately not part of this delegation. The `AgentRun` type
 * is registered at activation through `api.registerItemTypes` (see
 * `../../index.ts`), because the type must exist for every command in the
 * session rather than only after setup has been run.
 */
export declare function runAgentWorkflowSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map