import type { ExtensionApi } from "@unbrained/pm-cli/sdk/authoring";
/** Preserve synchronous results/throws and async results/refusals while registering.
 * Promises and foreign thenables receive the same recovery protection. Direct
 * engine SDK APIs and unrelated refusal classes retain their original exceptions.
 */
export declare function parameterSafeApi(api: ExtensionApi): ExtensionApi;
//# sourceMappingURL=command-errors.d.ts.map