/** Shared dispatch used by actual installation and disposable simulations. */
import type { CommandHandlerContext } from "@unbrained/pm-cli/sdk";
import type { PresetId } from "./registry.ts";
/** Complete setup handlers, keyed by the closed bundled-preset union. */
export declare const PRESET_HANDLERS: Record<PresetId, (ctx: CommandHandlerContext) => Promise<void>>;
//# sourceMappingURL=setup.d.ts.map