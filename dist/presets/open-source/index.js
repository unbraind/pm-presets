import fs from "node:fs";
import path from "node:path";
// ─── Settings ────────────────────────────────────────────────────────────────
export const SETTINGS = {
    id_prefix: "oss-",
    governance: {
        preset: "default",
        ownership_enforcement: "off",
        create_mode_default: "progressive",
        close_validation_default: "warn",
        metadata_profile: "core",
    },
    validation: {
        sprint_release_format: "off",
        parent_reference: "warn",
    },
    item_types: {
        definitions: [
            { name: "Epic", description: "A major feature or milestone release" },
            { name: "Feature", description: "A user-facing improvement or addition" },
            { name: "Issue", description: "A bug or regression report" },
            { name: "Task", description: "A contributor task or good-first-issue" },
        ],
    },
    search: { mode: "keyword" },
    calendar: { default_view: "month", first_day_of_week: 1 },
    telemetry: { enabled: false },
};
// ─── Templates ───────────────────────────────────────────────────────────────
const TEMPLATE_BUG_REPORT = {
    type: "Issue",
    priority: "medium",
    tags: ["bug", "community"],
    meta: {
        reported_by: "",
        version: "",
        os_platform: "",
        steps_to_reproduce: "",
        expected_behavior: "",
        actual_behavior: "",
        logs_or_screenshots: "",
        upstream_issue_url: "",
    },
};
const TEMPLATE_FEATURE_REQUEST = {
    type: "Feature",
    priority: "medium",
    tags: ["feature-request", "community"],
    meta: {
        requested_by: "",
        use_case: "",
        proposed_solution: "",
        alternatives_considered: "",
        upstream_issue_url: "",
        milestone: "",
    },
};
const TEMPLATE_GOOD_FIRST_ISSUE = {
    type: "Task",
    priority: "low",
    tags: ["good-first-issue", "help-wanted", "contributor-friendly"],
    meta: {
        skill_level: "beginner",
        estimated_hours: "",
        relevant_files: "",
        mentorship_contact: "",
        related_docs_url: "",
        pr_checklist: "tests passing, docs updated if needed, changelog entry",
    },
};
export const TEMPLATES = {
    "bug-report.json": TEMPLATE_BUG_REPORT,
    "feature-request.json": TEMPLATE_FEATURE_REQUEST,
    "good-first-issue.json": TEMPLATE_GOOD_FIRST_ISSUE,
};
// ─── Command Handler ──────────────────────────────────────────────────────────
export async function runOpenSourceSetup(context) {
    const { options, pm_root } = context;
    const force = Boolean(options["force"]);
    const dryRun = Boolean(options["dry-run"]);
    const prefix = options["prefix"] || "oss-";
    const cwd = pm_root ?? process.cwd();
    const pmDir = path.resolve(cwd, ".agents", "pm");
    const settingsPath = path.join(pmDir, "settings.json");
    const templatesDir = path.join(pmDir, "templates");
    // 1. Verify .agents/pm/ exists
    if (!fs.existsSync(pmDir)) {
        console.error(`pm workspace not found at ${pmDir}.\n` +
            `Run 'pm init' first to initialise the workspace, then re-run 'pm oss-setup'.`);
        process.exit(1);
    }
    // 2. Write settings.json
    const effectiveSettings = {
        ...SETTINGS,
        id_prefix: prefix,
    };
    const settingsExists = fs.existsSync(settingsPath);
    if (settingsExists && !force) {
        console.warn(`settings.json already exists at ${settingsPath}.\n` +
            `Use --force to overwrite it.`);
    }
    else {
        if (dryRun) {
            console.log(`[dry-run] Would write settings.json to ${settingsPath}`);
        }
        else {
            if (settingsExists && force) {
                console.warn(`Overwriting existing settings.json (--force).`);
            }
            fs.writeFileSync(settingsPath, JSON.stringify(effectiveSettings, null, 2) + "\n", "utf8");
            console.log(`Wrote settings.json to ${settingsPath}`);
        }
    }
    // 3. Create templates/ directory and write template files
    if (dryRun) {
        console.log(`[dry-run] Would create templates directory at ${templatesDir}`);
        for (const filename of Object.keys(TEMPLATES)) {
            console.log(`[dry-run] Would write template ${filename} to ${path.join(templatesDir, filename)}`);
        }
    }
    else {
        fs.mkdirSync(templatesDir, { recursive: true });
        console.log(`Created templates directory at ${templatesDir}`);
        for (const [filename, template] of Object.entries(TEMPLATES)) {
            const templatePath = path.join(templatesDir, filename);
            fs.writeFileSync(templatePath, JSON.stringify(template, null, 2) + "\n", "utf8");
            console.log(`Wrote template: ${filename}`);
        }
    }
    // 4. Print next steps
    console.log(dryRun
        ? "Dry-run complete — no files were written."
        : "Open-source preset applied successfully!");
    console.log([
        "",
        "Next steps:",
        "  Create a bug report:      pm create --template bug-report",
        "  Request a feature:        pm create --template feature-request",
        "  Add a good-first-issue:   pm create --template good-first-issue",
        "  List all items:           pm list",
        "  Open the board:           pm board",
        "",
        "Tip: tag your next milestone Epic with a target date and run",
        "  'pm board --group milestone' for a milestone-oriented view.",
    ].join("\n"));
}
//# sourceMappingURL=index.js.map