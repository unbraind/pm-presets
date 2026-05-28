/**
 * pm-presets — all 5 official pm-cli workspace presets in one package.
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
 */
declare const _default: {
    activate(api: import("@unbrained/pm-cli/sdk").ExtensionApi): void;
};
export default _default;
export { PRESET_REGISTRY } from "./registry.js";
export type { PresetDescriptor } from "./registry.js";
//# sourceMappingURL=index.d.ts.map