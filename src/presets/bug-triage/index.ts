import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Settings ────────────────────────────────────────────────────────────────

export const SETTINGS = {
  id_prefix: "bug-",
  governance: {
    preset: "strict",
    ownership_enforcement: "strict",
    create_mode_default: "strict",
    close_validation_default: "strict",
    metadata_profile: "strict",
  },
  validation: {
    sprint_release_format: "strict_error",
    parent_reference: "warn",
  },
  item_types: {
    definitions: [
      {
        name: "Issue",
        description:
          "A defect, incident, or regression requiring investigation and resolution",
      },
      {
        name: "Task",
        description:
          "A remediation, hotfix, or follow-up task linked to an incident",
      },
    ],
  },
  testing: { record_results_to_items: true },
  search: { mode: "keyword" },
  calendar: { default_view: "agenda", first_day_of_week: 1 },
  telemetry: { enabled: false },
} as const;

// ─── Templates ───────────────────────────────────────────────────────────────

const TEMPLATE_INCIDENT = {
  type: "Issue",
  priority: "1",
  tags: ["incident"],
  meta: {
    severity: "sev2",
    environment: "production",
    detected_at: "",
    reported_by: "",
    owner: "",
    affected_systems: "",
    affected_users: "",
    steps_to_reproduce: "",
    root_cause: "",
    mitigation_applied: "",
    resolution: "",
    postmortem_url: "",
    linked_hotfix: "",
  },
};

const TEMPLATE_HOTFIX_TASK = {
  type: "Task",
  priority: "1",
  tags: ["hotfix"],
  meta: {
    linked_incident: "",
    assignee: "",
    fix_description: "",
    pr_link: "",
    target_branch: "main",
    deploy_target: "production",
    rollback_plan: "",
    reviewed_by: "",
    deployed_at: "",
    verified_by: "",
  },
};

const TEMPLATE_REGRESSION = {
  type: "Issue",
  priority: "2",
  tags: ["regression"],
  meta: {
    severity: "sev3",
    environment: "",
    introduced_in: "",
    last_known_good_version: "",
    steps_to_reproduce: "",
    expected_behavior: "",
    actual_behavior: "",
    owner: "",
    affected_tests: "",
    root_cause: "",
    fix_pr: "",
    verified_fixed_in: "",
  },
};

export const TEMPLATES: Record<string, unknown> = {
  "incident.json": TEMPLATE_INCIDENT,
  "hotfix-task.json": TEMPLATE_HOTFIX_TASK,
  "regression.json": TEMPLATE_REGRESSION,
};

// ─── Command Handler ──────────────────────────────────────────────────────────

export function runBugTriageSetup(context: CommandHandlerContext): void {
  const { options, pm_root } = context;
  const cwd = pm_root ?? process.cwd();
  const pmDir = path.resolve(cwd, ".agents/pm");
  const settingsPath = path.join(pmDir, "settings.json");
  const templatesDir = path.join(pmDir, "templates");
  const isDryRun = Boolean(options["dry-run"]);
  const isForce = Boolean(options["force"]);
  const prefixOverride = options["prefix"] as string | undefined;

  // 1. Check .agents/pm/ exists
  if (!fs.existsSync(pmDir)) {
    console.error(
      `pm workspace not found. Expected directory: ${pmDir}\n` +
        `Run "pm init" first to initialise a pm workspace in this project.`
    );
    return;
  }

  // 2. Build settings (optionally override prefix)
  const settings =
    prefixOverride !== undefined
      ? { ...SETTINGS, id_prefix: prefixOverride }
      : SETTINGS;

  if (isDryRun) {
    console.log("[dry-run] Would write settings.json:");
    console.log(JSON.stringify(settings, null, 2));
  } else {
    if (fs.existsSync(settingsPath) && !isForce) {
      console.warn(
        `settings.json already exists at ${settingsPath}. ` +
          `Use --force to overwrite.`
      );
    } else {
      if (fs.existsSync(settingsPath) && isForce) {
        console.warn(`Overwriting existing settings.json (--force)`);
      }
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(settings, null, 2) + "\n",
        "utf8"
      );
      console.log(`Wrote settings.json → ${settingsPath}`);
    }
  }

  // 3. Create templates directory and write template files
  if (isDryRun) {
    console.log(`[dry-run] Would create directory: ${templatesDir}`);
    for (const [filename, template] of Object.entries(TEMPLATES)) {
      console.log(`[dry-run] Would write template: ${path.join(templatesDir, filename)}`);
      console.log(JSON.stringify(template, null, 2));
    }
  } else {
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
      console.log(`Created templates directory → ${templatesDir}`);
    }

    for (const [filename, template] of Object.entries(TEMPLATES)) {
      const templatePath = path.join(templatesDir, filename);
      fs.writeFileSync(
        templatePath,
        JSON.stringify(template, null, 2) + "\n",
        "utf8"
      );
      console.log(`Wrote template → ${templatePath}`);
    }
  }

  // 4. Print next steps
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Bug triage preset applied. Next steps:");
  console.log("");
  console.log("  Create a new production incident:");
  console.log("    pm create --template incident");
  console.log("");
  console.log("  Create a hotfix task (linked to an incident):");
  console.log("    pm create --template hotfix-task");
  console.log("");
  console.log("  Track a regression:");
  console.log("    pm create --template regression");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  // 5. Strict governance warning
  console.warn(
    "STRICT GOVERNANCE ACTIVE: All close operations require " +
      "'root_cause' and 'resolution' metadata fields to be set. " +
      "Items cannot be closed without this information."
  );
}
