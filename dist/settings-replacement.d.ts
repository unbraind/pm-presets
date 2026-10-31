import type { PresetSettingsPatch } from "./presets/shared.ts";
/** Normalize only public owned settings trees; workspace values and secret maps never enter the scratch tracker. */
export declare function replacementSettings(patch: PresetSettingsPatch): Promise<Record<string, unknown>>;
//# sourceMappingURL=settings-replacement.d.ts.map