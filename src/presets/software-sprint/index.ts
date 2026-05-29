import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
import * as fs from "node:fs";
import * as path from "node:path";

import { readBooleanOption, readStringOption, resolvePmDir } from "../shared.js";

// ─── Settings ────────────────────────────────────────────────────────────────

export const SETTINGS = {
  id_prefix: "sprint-",
  governance: {
    preset: "default",
    ownership_enforcement: "warn",
    create_mode_default: "progressive",
    close_validation_default: "warn",
    metadata_profile: "core",
  },
  search: { mode: "keyword" },
  calendar: { default_view: "week", first_day_of_week: 1 },
  telemetry: { enabled: false },
} as const;

// ─── Templates ───────────────────────────────────────────────────────────────

const TEMPLATE_BUG = {
  name: "bug",
  type: "Issue",
  priority: "high",
  tags: ["bug"],
  meta: {
    sprint: "",
    severity: "",
    environment: "",
    steps_to_reproduce: "",
    expected_behavior: "",
    actual_behavior: "",
    assignee: "",
    pr_link: "",
  },
};

const TEMPLATE_EPIC = {
  name: "epic",
  type: "Epic",
  priority: "medium",
  tags: ["epic"],
  meta: {
    objective: "",
    success_criteria: "",
    target_quarter: "",
    stakeholder: "",
    estimated_sprints: "",
  },
};

const TEMPLATE_FEATURE = {
  name: "feature",
  type: "Feature",
  priority: "medium",
  tags: ["feature"],
  meta: {
    sprint: "",
    acceptance_criteria: "",
    design_link: "",
    story_points: "",
    reviewer: "",
  },
};

const TEMPLATE_TASK = {
  name: "task",
  type: "Task",
  priority: "medium",
  tags: ["task"],
  meta: {
    sprint: "",
    estimate_hours: "",
    assignee: "",
    pr_link: "",
    blocked_by: "",
  },
};

export const TEMPLATES: Record<string, object> = {
  "bug.json": TEMPLATE_BUG,
  "epic.json": TEMPLATE_EPIC,
  "feature.json": TEMPLATE_FEATURE,
  "task.json": TEMPLATE_TASK,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function writeJsonFile(filePath: string, data: object, dryRun: boolean): void {
  if (dryRun) {
    console.log(`  [dry-run] Would write: ${filePath}`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ─── Command Handler ──────────────────────────────────────────────────────────

export async function runSoftwareSprintSetup(context: CommandHandlerContext): Promise<void> {
  const { options } = context;
  const force = readBooleanOption(options, "force");
  const dryRun = readBooleanOption(options, "dryRun", "dry-run");
  const prefixOverride = readStringOption(options, "prefix");

  const pmDir = resolvePmDir(context);
  const settingsPath = path.join(pmDir, "settings.json");
  const templatesDir = path.join(pmDir, "templates");

  // Step 1: verify pm workspace exists
  if (!fs.existsSync(pmDir)) {
    throw new Error(
      `pm workspace not found. Expected directory: ${pmDir}\n` +
        "Run `pm init` first to initialise a pm workspace, then re-run `pm sprint-setup`."
    );
  }

  console.log(
    dryRun
      ? "Dry-run mode — no files will be written.\n"
      : "Applying software-sprint preset...\n"
  );

  // Step 2: write settings.json
  if (fs.existsSync(settingsPath) && !force) {
    console.warn(
      `Warning: ${settingsPath} already exists. Use --force to overwrite.`
    );
  } else {
    const settings = {
      ...SETTINGS,
      ...(prefixOverride !== undefined
        ? { id_prefix: prefixOverride }
        : {}),
    };
    writeJsonFile(settingsPath, settings, dryRun);
    if (!dryRun) {
      console.log(`  Wrote settings.json (id_prefix: "${settings.id_prefix}")`);
    }
  }

  // Step 3: write templates
  for (const [filename, template] of Object.entries(TEMPLATES)) {
    const templatePath = path.join(templatesDir, filename);

    if (fs.existsSync(templatePath) && !force) {
      console.warn(
        `Warning: ${templatePath} already exists. Use --force to overwrite.`
      );
      continue;
    }

    writeJsonFile(templatePath, template, dryRun);
    if (!dryRun) {
      console.log(`  Wrote templates/${filename}`);
    }
  }

  // Step 4: next-steps
  if (!dryRun) {
    console.log(`
Setup complete!

Next steps:
  - Create your first bug:     pm create --template bug
  - Create a feature:          pm create --template feature
  - Create a sprint epic:      pm create --template epic
  - Create a task:             pm create --template task
  - View your workspace:       pm ls
  - Open the calendar:         pm calendar

Tip: items created with this preset use the "${
      prefixOverride ?? SETTINGS.id_prefix
    }" id prefix.
`);
  } else {
    console.log(`
[dry-run] The following would be written:
  ${settingsPath}
  ${path.join(templatesDir, "bug.json")}
  ${path.join(templatesDir, "epic.json")}
  ${path.join(templatesDir, "feature.json")}
  ${path.join(templatesDir, "task.json")}

Re-run without --dry-run to apply.
`);
  }
}
