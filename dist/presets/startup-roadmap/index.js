import * as fs from "node:fs";
import * as path from "node:path";
import { readBooleanOption, readStringOption, resolvePmDir } from "../shared.js";
// ─── Settings ────────────────────────────────────────────────────────────────
export const SETTINGS = {
    id_prefix: "road-",
    governance: {
        preset: "default",
        ownership_enforcement: "warn",
        create_mode_default: "progressive",
        close_validation_default: "warn",
        metadata_profile: "strict",
    },
    validation: {
        sprint_release_format: "warn",
        parent_reference: "warn",
    },
    item_types: {
        definitions: [
            {
                name: "Epic",
                description: "A top-level strategic initiative on the roadmap",
            },
            {
                name: "Feature",
                description: "A product feature tied to a milestone",
            },
            {
                name: "Task",
                description: "Execution-level work item",
            },
        ],
    },
    testing: {
        record_results_to_items: false,
    },
    search: {
        mode: "keyword",
    },
    calendar: {
        default_view: "month",
        first_day_of_week: 1,
    },
    telemetry: {
        enabled: false,
    },
};
// ─── Templates ───────────────────────────────────────────────────────────────
const TEMPLATE_INITIATIVE = {
    type: "Epic",
    priority: "high",
    tags: ["initiative", "roadmap"],
    meta: {
        objective: "",
        business_value: "",
        target_outcome: "",
        success_metrics: "",
        owner: "",
        stakeholders: "",
        target_quarter: "",
        investment_level: "",
        dependencies: "",
        risks: "",
    },
};
const TEMPLATE_FEATURE = {
    type: "Feature",
    priority: "medium",
    tags: ["feature"],
    meta: {
        milestone: "",
        user_story: "",
        acceptance_criteria: "",
        business_value: "",
        impacted_personas: "",
        owner: "",
        design_link: "",
        effort_estimate: "",
        dependencies: "",
    },
};
const TEMPLATE_MILESTONE = {
    type: "Milestone",
    priority: "high",
    tags: ["milestone"],
    meta: {
        target_date: "",
        release_name: "",
        scope_summary: "",
        exit_criteria: "",
        owner: "",
        stakeholder_sign_off: "",
        investor_facing: "false",
        go_to_market_notes: "",
    },
};
export const TEMPLATES = {
    "initiative.json": TEMPLATE_INITIATIVE,
    "feature.json": TEMPLATE_FEATURE,
    "milestone.json": TEMPLATE_MILESTONE,
};
// ─── Helpers ─────────────────────────────────────────────────────────────────
function writeJsonFile(filePath, data, dryRun, label) {
    if (dryRun) {
        console.log(`[dry-run] Would write: ${filePath}`);
        return;
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`  wrote ${label}: ${filePath}`);
}
// ─── Command Handler ──────────────────────────────────────────────────────────
export async function runStartupRoadmapSetup(context) {
    const { options } = context;
    const force = readBooleanOption(options, "force");
    const dryRun = readBooleanOption(options, "dryRun", "dry-run");
    const prefixOverride = readStringOption(options, "prefix") ?? null;
    const pmDir = resolvePmDir(context);
    // 1. Verify .agents/pm/ exists
    if (!fs.existsSync(pmDir)) {
        throw new Error(`pm workspace not found at ${pmDir}\n` +
            `Run "pm init" first to initialise the workspace.`);
    }
    console.log(`Applying startup-roadmap preset to: ${pmDir}`);
    if (dryRun) {
        console.log("(dry-run mode — no files will be written)\n");
    }
    // 2. Write settings.json
    const settingsPath = path.join(pmDir, "settings.json");
    const settingsExist = fs.existsSync(settingsPath);
    if (settingsExist && !force) {
        console.warn(`Warning: ${settingsPath} already exists — skipping.\n` +
            `Pass --force to overwrite.`);
    }
    else {
        const finalSettings = {
            ...SETTINGS,
            id_prefix: prefixOverride ?? SETTINGS.id_prefix,
        };
        writeJsonFile(settingsPath, finalSettings, dryRun, "settings.json");
    }
    // 3. Create templates directory and write templates
    const templatesDir = path.join(pmDir, "templates");
    if (!dryRun && !fs.existsSync(templatesDir)) {
        fs.mkdirSync(templatesDir, { recursive: true });
        console.log(`  created directory: ${templatesDir}`);
    }
    else if (dryRun) {
        console.log(`[dry-run] Would create directory: ${templatesDir}`);
    }
    writeJsonFile(path.join(templatesDir, "initiative.json"), TEMPLATE_INITIATIVE, dryRun, "initiative.json");
    writeJsonFile(path.join(templatesDir, "feature.json"), TEMPLATE_FEATURE, dryRun, "feature.json");
    writeJsonFile(path.join(templatesDir, "milestone.json"), TEMPLATE_MILESTONE, dryRun, "milestone.json");
    // 4. Print next steps
    console.log(`
Startup-roadmap preset applied successfully.

Next steps:
  pm create --template initiative   # Create a strategic initiative (Epic)
  pm create --template feature      # Create a product feature
  pm create --template milestone    # Create a milestone

Tips:
  - Use "pm list --tag roadmap" to see all roadmap initiatives.
  - Use "pm list --tag milestone" to track milestones.
  - Investor-facing milestones: set meta.investor_facing = "true".
  - Run "pm calendar" to view items in the monthly calendar.
`);
}
//# sourceMappingURL=index.js.map