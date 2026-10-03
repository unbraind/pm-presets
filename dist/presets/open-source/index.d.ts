import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
/**
 * The settings patch for the open-source preset.
 *
 * The host's `default` governance preset derives enforcement and metadata
 * policy for community contribution flow. The default create type is `Issue`
 * and new items are prefixed `oss-`. No testing block is set.
 */
export declare const SETTINGS: {
    id_prefix: string;
    governance: {
        preset: "default";
        create_default_type: string;
    };
    validation: {
        sprint_release_format: "warn";
    };
};
/**
 * The templates the open-source preset installs: a community `bug-report`, a
 * `feature-request`, and a `good-first-issue` scoped for a first-time
 * contributor.
 */
export declare const TEMPLATES: {
    "bug-report.json": import("../shared.ts").StoredCreateTemplateDocument;
    "feature-request.json": import("../shared.ts").StoredCreateTemplateDocument;
    "good-first-issue.json": import("../shared.ts").StoredCreateTemplateDocument;
};
/**
 * Command handler for the open-source setup command: delegates the settings,
 * templates, and next-steps to {@link applyPreset}.
 */
export declare function runOpenSourceSetup(context: CommandHandlerContext): Promise<void>;
//# sourceMappingURL=index.d.ts.map