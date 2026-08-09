import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
/**
 * The settings patch for the bug-triage preset.
 *
 * Strict, custom governance (`metadata_profile: strict`, close validation
 * `strict`, stale-lock force required) tuned for production incidents and
 * hotfixes; the default create type is `Issue` and new items are prefixed
 * `bug-`.
 */
export declare const SETTINGS: {
    id_prefix: string;
    governance: {
        preset: "custom";
        ownership_enforcement: "strict";
        create_mode_default: "progressive";
        close_validation_default: "strict";
        parent_reference: "strict_error";
        metadata_profile: "strict";
        force_required_for_stale_lock: true;
        create_default_type: string;
    };
    validation: {
        sprint_release_format: "strict_error";
        parent_reference: "warn";
        metadata_profile: "strict";
    };
    testing: {
        record_results_to_items: true;
    };
};
/**
 * The templates the bug-triage preset installs: an `incident` report, a
 * `hotfix-task`, and a `regression` tracker, each seeded with the incident/
 * hotfix fields that workflow expects.
 */
export declare const TEMPLATES: {
    "incident.json": import("../shared.ts").StoredCreateTemplateDocument;
    "hotfix-task.json": import("../shared.ts").StoredCreateTemplateDocument;
    "regression.json": import("../shared.ts").StoredCreateTemplateDocument;
};
/**
 * Command handler for `pm triage-setup`: hand the bug-triage settings, templates,
 * and next-steps to {@link applyPreset}, which writes them to the workspace
 * (unless `--dry-run`).
 */
export declare function runBugTriageSetup(context: CommandHandlerContext): void;
//# sourceMappingURL=index.d.ts.map