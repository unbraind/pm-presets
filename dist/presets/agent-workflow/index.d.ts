import type { CommandHandlerContext, SchemaItemTypeDefinition } from "@unbrained/pm-cli/sdk";
/**
 * agent-workflow — project management for teams orchestrating AI agents.
 *
 * The workspace centers on agent runs (delegated, observable units of work),
 * prompt experiments (iterating on instructions/tooling), and eval runs
 * (measuring agent quality). A custom `AgentRun` item type carries the
 * agent lifecycle status (`agentStatus`, kept distinct from pm's built-in
 * `status` field), autonomy mode, and target model so the board reads
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
export declare const ITEM_TYPES: SchemaItemTypeDefinition[];
export declare const TEMPLATES: {
    "agent-task.json": import("../shared.js").StoredCreateTemplateDocument;
    "prompt-experiment.json": import("../shared.js").StoredCreateTemplateDocument;
    "eval-run.json": import("../shared.js").StoredCreateTemplateDocument;
};
export declare function runAgentWorkflowSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map