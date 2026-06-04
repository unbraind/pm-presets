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

import * as fs from "node:fs";
import * as path from "node:path";

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

const EXPORT_NOTE =
  "Custom item-field values are not captured: custom scalar fields have no " +
  "`pm create --<field>` setter (pm-cli #97). This snapshot reconstructs the " +
  "preset from settings + templates only.";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pure: assemble an ExportedPreset from already-read workspace inputs. */
export function buildExportedPreset(input: {
  name: string;
  displayName?: string;
  settings: Record<string, unknown> | undefined;
  templates: ExportedTemplate[];
  now?: Date;
}): ExportedPreset {
  const settings = input.settings ?? {};
  const idPrefixRaw = settings["id_prefix"];
  const idPrefix = typeof idPrefixRaw === "string" ? idPrefixRaw : "";
  const now = input.now ?? new Date();
  const templates = [...input.templates].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  return {
    $schema: "pm-presets/exported-preset@1",
    id: input.name,
    displayName: input.displayName ?? input.name,
    idPrefix,
    settings,
    templates,
    meta: {
      exportedAt: now.toISOString(),
      note: EXPORT_NOTE,
    },
  };
}

/** Read every user template document from the workspace `templates/` directory. */
export function readWorkspaceTemplates(pmDir: string): ExportedTemplate[] {
  const templatesDir = path.join(pmDir, "templates");
  if (!fs.existsSync(templatesDir)) {
    return [];
  }
  const out: ExportedTemplate[] = [];
  for (const entry of fs.readdirSync(templatesDir)) {
    if (!entry.toLowerCase().endsWith(".json")) {
      continue;
    }
    const filePath = path.join(templatesDir, entry);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    } catch {
      continue;
    }
    if (!isJsonObject(parsed)) {
      continue;
    }
    const name =
      typeof parsed.name === "string" && parsed.name.trim().length > 0
        ? parsed.name
        : entry.slice(0, -".json".length);
    const options = isJsonObject(parsed.options)
      ? (parsed.options as CreateTemplateOptions)
      : ({} as CreateTemplateOptions);
    out.push({ name, options });
  }
  return out;
}

/** Read the workspace settings.json (or `undefined` if absent/unreadable). */
export function readWorkspaceSettings(pmDir: string): Record<string, unknown> | undefined {
  const settingsPath = path.join(pmDir, "settings.json");
  if (!fs.existsSync(settingsPath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as unknown;
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export type { StoredCreateTemplateDocument };
