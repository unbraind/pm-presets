import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
import * as fs from "node:fs";
import * as path from "node:path";

import { readBooleanOption, readStringOption, resolvePmDir } from "../shared.js";

// ─── Settings ────────────────────────────────────────────────────────────────

export const SETTINGS = {
  id_prefix: "indie-",
  governance: {
    preset: "minimal",
    ownership_enforcement: "off",
    create_mode_default: "progressive",
    close_validation_default: "off",
    metadata_profile: "core",
  },
  validation: {
    sprint_release_format: "off",
    parent_reference: "off",
  },
  testing: {
    record_results_to_items: false,
  },
  telemetry: {
    enabled: false,
  },
} as const;

// ─── Templates ───────────────────────────────────────────────────────────────

export const TEMPLATES: Record<string, object> = {
  "idea.json": {
    type: "Decision",
    priority: "low",
    tags: ["idea"],
    meta: {
      hypothesis: "",
      motivation: "",
      effort_estimate: "small",
      decision: "",
      outcome: "",
    },
  },
  "task.json": {
    type: "Task",
    priority: "medium",
    tags: [],
    meta: {
      notes: "",
      due_date: "",
      project: "",
    },
  },
};

// ─── Command Handler ──────────────────────────────────────────────────────────

export async function runIndieDevSetup(context: CommandHandlerContext): Promise<void> {
  const { options } = context;
  const force = readBooleanOption(options, "force");
  const dryRun = readBooleanOption(options, "dryRun", "dry-run");
  const prefixOverride = readStringOption(options, "prefix") ?? "";

  const pmDir = resolvePmDir(context);
  const settingsPath = path.join(pmDir, "settings.json");
  const templatesDir = path.join(pmDir, "templates");

  // 1. Verify .agents/pm/ exists
  if (!fs.existsSync(pmDir)) {
    throw new Error(
      `pm workspace not found. Expected directory: ${pmDir}\n` +
        `Run \`pm init\` first to initialise a pm workspace in this project.`
    );
  }

  // 2. Build settings (apply prefix override if provided)
  const settings = {
    ...SETTINGS,
    id_prefix: prefixOverride || SETTINGS.id_prefix,
  };

  // 3. Write settings.json
  const settingsJson = JSON.stringify(settings, null, 2);

  if (fs.existsSync(settingsPath) && !force) {
    console.log(
      `warn: ${settingsPath} already exists. ` +
        `Pass --force to overwrite.`
    );
  } else {
    if (dryRun) {
      console.log(`[dry-run] Would write ${settingsPath}:`);
      console.log(settingsJson);
    } else {
      fs.writeFileSync(settingsPath, settingsJson + "\n", "utf8");
      console.log(`wrote ${settingsPath}`);
    }
  }

  // 4. Create templates directory and write template files
  if (dryRun) {
    console.log(`[dry-run] Would create directory: ${templatesDir}`);
  } else {
    fs.mkdirSync(templatesDir, { recursive: true });
  }

  for (const [filename, template] of Object.entries(TEMPLATES)) {
    const templatePath = path.join(templatesDir, filename);
    const templateJson = JSON.stringify(template, null, 2);

    if (dryRun) {
      console.log(`[dry-run] Would write ${templatePath}:`);
      console.log(templateJson);
    } else {
      fs.writeFileSync(templatePath, templateJson + "\n", "utf8");
      console.log(`wrote ${templatePath}`);
    }
  }

  // 5. Print next-steps
  console.log(``);
  console.log(`Indie-dev preset applied. Next steps:`);
  console.log(`  pm create --template idea`);
  console.log(`  pm create --template task`);
  console.log(``);
  console.log(
    `Tip: edit ${settingsPath} at any time to adjust your workspace settings.`
  );
}
