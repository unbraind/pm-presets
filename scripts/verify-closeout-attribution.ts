/** Refuse completion attribution for explicitly unresolved upstream follow-ups. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type * as Host from "@unbrained/pm-cli/sdk";
import { resolveSimulationSdk } from "../src/sdk-loader.ts";
import { isMainInvocation } from "./main-invocation.ts";

/** Read a complete real tracker and fail before changelog generation on false closeout. */
export async function verifyCloseoutAttribution(pmRoot: string): Promise<string[]> {
  const sdk = createRequire(import.meta.url)(resolveSimulationSdk([import.meta.url])) as typeof Host;
  const client = new sdk.PmClient({ pmRoot, noExtensions: true });
  const { items } = await client.listAllComplete();
  const registry = sdk.resolveRuntimeStatusRegistry((await sdk.readSettings(pmRoot)).schema);
  return items.filter((item) => item.tags.includes("upstream:unresolved")
    && registry.terminal_done_statuses.has(sdk.normalizeStatusInputWithRegistry(item.status, registry) ?? item.status))
    .map(({ id }) => `${id}: unresolved upstream work cannot be attributed as delivered; reopen it or record verified upstream repair evidence before removing upstream:unresolved.`);
}

if (isMainInvocation(process.argv, import.meta.url)) {
  const findings = await verifyCloseoutAttribution(resolve(process.argv[2] ?? ".agents/pm"));
  for (const finding of findings) console.error(finding);
  if (findings.length > 0) process.exitCode = 1;
  else console.log("closeout-attribution: unresolved upstream follow-ups remain outside completed work.");
}
