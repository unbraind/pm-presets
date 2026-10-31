/** Reproducible agent lifecycle probes against disposable, integration-free trackers. */
import { spawnSync } from "node:child_process";
import { initialPresetSettings } from "./artifact-ownership.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { findPresetDefinition, requirePresetDefinition } from "./catalog.js";
import { PRESET_HANDLERS } from "./setup.js";
import { resolveSimulationSdk, SimulationRefusal } from "./sdk-loader.js";
export { resolveSimulationSdk, SimulationRefusal } from "./sdk-loader.js";
/** Versioned, bounded probes; arbitrary commands and caller workspaces are never accepted. */
export const PRESET_SCENARIOS = Object.freeze(["create-task", "claim-start", "close-without-evidence", "close-with-evidence"]);
/** Apply settings and execute real SDK operations; called only inside the isolated process. */
export async function executeSyntheticScenarios(root, preset, scenarios, sdkPath) {
    const sdk = createRequire(import.meta.url)(sdkPath);
    const definition = requirePresetDefinition(preset);
    const pmRoot = join(root, ".agents", "pm");
    mkdirSync(pmRoot, { recursive: true });
    writeFileSync(join(pmRoot, "settings.json"), JSON.stringify(await initialPresetSettings()), { flag: "wx", mode: 0o600 });
    const client = new sdk.PmClient({ pmRoot, cwd: root, author: "preset-simulation", noExtensions: true });
    const commandSdk = sdk.createExtensionCommandSdk(pmRoot, client, "preset-simulation", "presets simulate");
    // Audited SDK initialization avoids the host init command's optional Git discovery.
    await commandSdk.mutateWorkspaceSettings({
        operationId: "simulation-init", mutate: (current) => current,
    });
    await PRESET_HANDLERS[definition.id]({
        command: "presets simulate", args: [], options: {}, global: { quiet: true }, pm_root: pmRoot,
        sdk: commandSdk,
    });
    const results = [];
    for (const id of scenarios) {
        const expected = id === "create-task" ? "open" : id === "claim-start" ? "in_progress"
            : id === "close-without-evidence" && definition.id === "bug-triage" ? "refused" : "closed";
        const created = await client.create({
            type: "Task", title: `Synthetic ${id}`, createMode: "progressive", allowDuplicate: true,
            acceptanceCriteria: "The synthetic task has the declared final state.",
        });
        const itemId = created.item.id;
        if (id === "claim-start") {
            await client.claim(itemId);
            await client.update(itemId, { status: "in_progress" });
        }
        let refused = false;
        try {
            if (id === "close-without-evidence") {
                await client.close(itemId, "Synthetic completion");
            }
            if (id === "close-with-evidence") {
                await client.close(itemId, "Synthetic completion", {
                    resolution: "Synthetic work completed.", expectedResult: "Declared final state reached.",
                    actualResult: "Declared final state reached.",
                });
            }
        }
        catch (error) {
            if (error.code !== "close_validation_missing_fields")
                throw error;
            refused = true;
        }
        const observed = await client.get(itemId, { full: true });
        const actual = refused && observed.item.status === "open" ? "refused" : observed.item.status;
        results.push({ id, expected, actual, passed: expected === actual,
            remedy: actual === "refused" ? "Supply acceptance criteria and resolution/expected/actual evidence; rerun the complete suite." : "" });
    }
    const coverageGaps = PRESET_SCENARIOS.filter((id) => !scenarios.includes(id));
    const passed = results.filter((result) => result.passed).length;
    return {
        ok: passed === results.length && coverageGaps.length === 0,
        suiteVersion: 1, preset: definition.id, isolation: "synthetic-no-extensions", checked: results.length, passed,
        coverageGaps, limitations: ["Built-in Task lifecycle only; templates and custom item types are not exercised.", "External integrations, user configuration and real agent inference are not exercised."],
        scenarios: results,
    };
}
/** Simulate before installing: no caller tracker is read, copied, installed into, or mutated. */
export function simulatePreset(options) {
    const definition = findPresetDefinition(options.preset);
    if (!definition) {
        throw new SimulationRefusal("unknown_preset", "Choose a bundled id from pm presets list.");
    }
    const selected = options.scenarios ?? PRESET_SCENARIOS;
    if (selected.some((id) => !PRESET_SCENARIOS.includes(id))) {
        throw new SimulationRefusal("unknown_scenario", `Choose scenario ids from: ${PRESET_SCENARIOS.join(", ")}.`);
    }
    if (new Set(selected).size !== selected.length) {
        throw new SimulationRefusal("duplicate_scenario", "Select each scenario at most once.");
    }
    const sdkPath = resolveSimulationSdk([import.meta.url, pathToFileURL(process.argv[1] ?? process.execPath).href]);
    const root = mkdtempSync(join(tmpdir(), "pm-presets-simulation-"));
    try {
        const output = join(root, "report.json");
        const script = `import {executeSyntheticScenarios} from ${JSON.stringify(import.meta.url)};\nimport {writeFileSync} from 'node:fs';\nconst report = await executeSyntheticScenarios(${JSON.stringify(root)}, ${JSON.stringify(definition.id)}, ${JSON.stringify(PRESET_SCENARIOS.filter((id) => selected.includes(id)))}, ${JSON.stringify(sdkPath)});\nwriteFileSync(${JSON.stringify(output)}, JSON.stringify(report));`;
        const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script, sdkPath], {
            cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024,
            env: { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, TMPDIR: root, TMP: root, TEMP: root,
                PATH: "", GIT_CEILING_DIRECTORIES: root, PM_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", CI: "true", TZ: "UTC" },
        });
        if (child.status !== 0) {
            throw new SimulationRefusal("simulation_failed", "Check the supported pm host and rerun; no caller workspace was changed.", 1);
        }
        return JSON.parse(readFileSync(output, "utf8"));
    }
    finally {
        rmSync(root, { recursive: true, force: true });
    }
}
//# sourceMappingURL=simulation.js.map