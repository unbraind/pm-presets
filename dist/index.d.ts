/**
 * pm-presets — all 7 official pm-cli workspace presets in one package.
 *
 * Each preset registers a setup command with the pm CLI extension API.
 * Install this package once and get all presets:
 *
 *   pm install github.com/unbraind/pm-presets --project
 *
 * Available commands after installation:
 *   pm triage-setup      # bug-triage preset
 *   pm indie-setup       # indie-dev preset
 *   pm oss-setup         # open-source preset
 *   pm sprint-setup      # software-sprint preset
 *   pm roadmap-setup     # startup-roadmap preset
 *   pm kanban-setup      # kanban preset
 *   pm agent-setup       # agent-workflow preset
 *
 * Plus a unified, read-only management surface:
 *   pm presets list                 # enumerate presets + what each configures
 *   pm presets show <id>            # full definition of one preset
 *   pm presets diff <id>            # workspace vs preset differences
 *   pm presets validate             # validate all bundled presets parse/load
 *   pm presets apply <id>           # scaffold a preset into this workspace
 */
import type { ExtensionApi } from "@unbrained/pm-cli/sdk/authoring";
declare const _default: {
    activate(api: ExtensionApi): void;
};
export default _default;
export { PRESET_REGISTRY } from "./registry.ts";
export { collectPresetParameterIssues, projectPresetDefinition } from "./catalog.ts";
export type { PresetDescriptor } from "./registry.ts";
export { simulatePreset, SimulationRefusal, PRESET_SCENARIOS } from "./simulation.ts";
export type { PresetSimulationOptions, PresetSimulationReport, PresetScenarioId, PresetScenarioResult, SimulationRefusalCode } from "./simulation.ts";
export { comparePresetUpgrade, planPresetUpgrade, executePresetUpgrade, parseUpgradeReceipt, summarizePresetUpgrade, UpgradeRefusal } from "./upgrade.ts";
export type { VersionedPreset, UpgradeSettings, UpgradeValue, UpgradeDecisions, UpgradeChange, PresetUpgradeReceipt, PresetUpgradeSummary, PresetUpgradeResult, UpgradeRefusalCode } from "./upgrade.ts";
export { compilePresetPlan, bundledPresetComposition, summarizePresetPlan, PlanRefusal } from "./plan.ts";
export type { PresetRequirement, PresetPlanFeature, PresetComposition, PresetPlanTarget, PresetPlanGap, PresetPlan, PlanRefusalCode } from "./plan.ts";
export { planPresetStack, summarizePresetStack, StackRefusal } from "./stack.ts";
export type { PresetStackSelection, PresetStackInput, PresetStackOwnership, PresetStackPlan, StackRefusalCode } from "./stack.ts";
export { ParameterRefusal, assertResolvedParameterValues, buildParameterViews, collectParameterValues, collectSecretSettingPaths, parseParameterFlagEntries, parseParamsFile, readSuppliedParameterValues, redactSecretValues, redactSecretValuesDeep, resolveParameterValues, resolveParameterizedPreset, resolveSeedsWithParameters, resolveSettingsWithParameters, resolveTemplatesWithParameters, validateParameterManifest, } from "./params.ts";
export type { ParameterRefusalCode, ParameterBindingOccurrence, PresetParameter, PresetParameterManifest, PresetParameterType, PresetParameterView, ResolvedParameterValues, } from "./params.ts";
export { PRESET_PARAMETERS } from "./registry.ts";
export { resolvePresetApplication, contextWithResolvedParameters } from "./apply-command.ts";
export type { ResolvedPresetApplication } from "./apply-command.ts";
export { resolvedSeedsForPreset } from "./seeds.ts";
//# sourceMappingURL=index.d.ts.map