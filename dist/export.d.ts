/**
 * export.ts — snapshot the CURRENT pm workspace into a preset definition.
 *
 * `presets export <name>` reads the live workspace settings.json + installed
 * templates and emits a self-contained preset definition (JSON) that mirrors
 * the shape of the bundled presets. The intended flow is:
 *
 *   1. apply a bundled preset,
 *   2. customize settings + templates by hand,
 *   3. `presets export our-config` to lock the result as a reusable definition.
 *
 * The interesting logic is pure (`buildExportedPreset`) so it is unit-testable;
 * `readWorkspaceSnapshot` (in diff.ts) is the only filesystem-touching input.
 *
 * MVP scope: settings + templates. Custom item-field VALUES are intentionally
 * out of scope because custom scalar fields have no `pm create --<field>`
 * setter (pm-cli #97), so they cannot be round-tripped through workspace items
 * — the exported definition records only the settings tree and template
 * documents, which fully reconstruct an applied preset.
 */
import type { CreateTemplateOptions, StoredCreateTemplateDocument } from "./presets/shared.js";
export interface ExportedTemplate {
    name: string;
    options: CreateTemplateOptions;
}
export interface ExportedPreset {
    /** Identifies this as a pm-presets export and pins the shape version. */
    $schema: "pm-presets/exported-preset@1";
    id: string;
    displayName: string;
    /** id_prefix lifted from settings for convenience (mirrors bundled descriptors). */
    idPrefix: string;
    /** The full settings.json the workspace currently has. */
    settings: Record<string, unknown>;
    /** Every user template installed in the workspace, name + options. */
    templates: ExportedTemplate[];
    meta: {
        exportedAt: string;
        /** Honest note about the #97 custom-field limitation. */
        note: string;
    };
}
/** Pure: assemble an ExportedPreset from already-read workspace inputs. */
export declare function buildExportedPreset(input: {
    name: string;
    displayName?: string;
    settings: Record<string, unknown> | undefined;
    templates: ExportedTemplate[];
    now?: Date;
}): ExportedPreset;
/** Read every user template document from the workspace `templates/` directory. */
export declare function readWorkspaceTemplates(pmDir: string): ExportedTemplate[];
/** Read the workspace settings.json (or `undefined` if absent/unreadable). */
export declare function readWorkspaceSettings(pmDir: string): Record<string, unknown> | undefined;
export type { StoredCreateTemplateDocument };
//# sourceMappingURL=export.d.ts.map