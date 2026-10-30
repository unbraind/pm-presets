/** Keep the host's automatic error recovery from echoing raw parameter inputs. */
import { createRequire } from "node:module";
import type { ExtensionApi } from "@unbrained/pm-cli/sdk/authoring";
import type { PmCliError } from "@unbrained/pm-cli/sdk";
import { ParameterRefusal } from "./params.ts";
import { resolveSimulationSdk } from "./sdk-loader.ts";

/** Translate expected failures to safe host errors or typed refusal results.
 * Resolve lazily so importing this package keeps its type-only SDK dependency.
 * Untyped failures retain the existing extension-runtime error contract.
 */
function refuseCommand(error: unknown, parameters: boolean): unknown {
  if (!parameters && !(error instanceof ParameterRefusal)) throw error;
  if (!(error instanceof Error) || !("exitCode" in error) || typeof error.exitCode !== "number") throw error;
  const code = "code" in error && typeof error.code === "string" ? error.code : "preset_refused";
  const remedy = "remedy" in error && typeof error.remedy === "string" ? error.remedy : error instanceof ParameterRefusal ? "Check the command help and retry with external secret references." : "Check the command help and retry.";
  let refusal: PmCliError;
  try {
    const sdkPath = resolveSimulationSdk([process.argv[1], import.meta.url]);
    const host = createRequire(import.meta.url)(sdkPath) as { PmCliError: typeof PmCliError };
    refusal = new host.PmCliError(error.message, error.exitCode, {
      code, nextSteps: [remedy], recovery: {
        recovery_mode: "compact",
        attempted_command: "pm presets <command> (parameter values omitted)",
        suggested_retry: "pm presets show <preset>", suggested_retry_args: ["presets", "show", "<preset>"],
        normalized_args: ["presets"], provided_fields: [],
      },
    });
    // Keep direct command SDK consumers' stable producer code/remedy.
    Object.assign(refusal, { code, remedy });
  } catch {
    // A broken/missing SDK must not fall back to the host's argv-echoing error
    // formatter. Its public refusal-result contract still preserves exit/code.
    return { exit_code: error.exitCode, code, remediation: remedy };
  }
  throw refusal;
}

/** Preserve synchronous results/throws and async results/refusals while registering.
 * Promises and foreign thenables receive the same recovery protection. Direct
 * engine SDK APIs and unrelated refusal classes retain their original exceptions.
 */
export function parameterSafeApi(api: ExtensionApi): ExtensionApi {
  return new Proxy(api, {
    get(target, key, receiver) {
      if (key !== "registerCommand") return Reflect.get(target, key, receiver);
      return (definition: Parameters<ExtensionApi["registerCommand"]>[0]) => {
        const parameters = definition.flags?.some((flag) => flag.long === "--param") === true;
        const fail = (error: unknown): unknown => refuseCommand(error, parameters);
        const handler = definition.run;
        if (handler === undefined) return target.registerCommand(definition);
        return target.registerCommand({
          ...definition,
          run: (context) => {
            try {
              const result = handler(context);
              if (result && typeof (result as PromiseLike<unknown>).then === "function") {
                return Promise.resolve(result).catch(fail);
              }
              return result;
            } catch (error) { return fail(error); }
          },
        });
      };
    },
  });
}
