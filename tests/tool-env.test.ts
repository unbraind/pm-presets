/** Adversarial environment properties and package-wide shared-policy wiring. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { stripToolEnv } from "../scripts/tool-env.ts";

const sensitiveParts = ["TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "AUTH", "COOKIE", "PRIVATE_KEY", "NPM_MEDIA_SERVER"];

/** Generate an independent deny corpus across casing and substring positions. */
function credentialKeys(): string[] {
  return sensitiveParts.flatMap((part) => [part, part.toLowerCase(), [...part].map((letter, index) => index % 2 ? letter.toLowerCase() : letter).join("")]
    .flatMap((variant) => [variant, `PREFIX_${variant}`, `${variant}_SUFFIX`, `PREFIX_${variant}_SUFFIX`]));
}

test("shared tool policy removes every credential variant without mutating safe environment entries", () => {
  const blocked = [...credentialKeys(), "NPM_CONFIG_USERCONFIG", "npm_config_userconfig", "NpM_CoNfIg_UsErCoNfIg"];
  const safe = { PATH: "synthetic-bin", Path: "synthetic-bin", SystemRoot: "synthetic-system", HOME: "synthetic-home", LANG: "C", EMPTY: "", UNDEFINED: undefined,
    constructor: "safe-own-key", ...Object.fromEntries([["__proto__", "safe-own-key"]]) };
  const source = Object.freeze({ ...safe, ...Object.fromEntries(blocked.map((key) => [key, "synthetic-value"])) });
  const before = { ...source };
  assert.deepEqual(stripToolEnv(source), safe);
  assert.deepEqual(source, before, "filtering must not delete from the caller's environment");
  assert.deepEqual(stripToolEnv(stripToolEnv(source)), safe, "filtering is idempotent");
  assert.deepEqual(stripToolEnv({ ...source, GIT_CONFIG_COUNT: "1", KEEP: "yes" }, (key) => key.startsWith("GIT_")), { ...safe, KEEP: "yes" });
});

test("every isolated tool environment constructor applies the shared policy and its own exclusions", () => {
  const callers = [
    { path: "scripts/audit-prod.ts", git: false, allowScripts: true },
    { path: "tests/closeout-history.test.ts", git: true, allowScripts: false },
    { path: "tests/tool-config.test.ts", git: true, allowScripts: false },
    { path: "tests/windows-closeout.integration.ts", git: false, allowScripts: false },
  ];
  for (const caller of callers) {
    const sourceCode = readFileSync(caller.path, "utf8");
    // Only evaluate the constructor expression, without running fixture setup
    // or tools. This also exercises Windows-only construction on every host.
    const initializer = /\bconst\s+env(?:\s*:\s*NodeJS\.ProcessEnv)?\s*=\s*([^;]+);/.exec(sourceCode)?.[1];
    assert.ok(initializer, `${caller.path}: missing environment constructor`);
    // Extend only the shared policy with an independent canary. A copied filter
    // must fail even when it happens to recognize today's credential corpus.
    const source = { ...Object.fromEntries(credentialKeys().map((key) => [key, "synthetic-value"])),
      NPM_CONFIG_USERCONFIG: "untrusted-config", npm_config_userconfig: "untrusted-config", NpM_CoNfIg_UsErCoNfIg: "untrusted-config",
      POLICY_CANARY: "synthetic-value", GIT_CONFIG_COUNT: "1", npm_config_allow_scripts: "true", NPM_CONFIG_ALLOW_SCRIPTS: "true", PATH: "synthetic-bin" };
    const before = { ...source };
    const actual = runInNewContext(`(${initializer})`, {
      process: { env: source },
      stripToolEnv: (input: NodeJS.ProcessEnv, extra?: (key: string) => boolean) => stripToolEnv(input, (key) => key === "POLICY_CANARY" || (extra?.(key) ?? false)),
    }) as NodeJS.ProcessEnv;
    const expected = { PATH: source.PATH,
      ...(caller.git ? {} : { GIT_CONFIG_COUNT: "1" }),
      ...(caller.allowScripts ? {} : { npm_config_allow_scripts: "true", NPM_CONFIG_ALLOW_SCRIPTS: "true" }) };
    assert.deepEqual({ ...actual }, expected, `${caller.path}: shared policy or caller exclusions were bypassed`);
    assert.deepEqual(source, before, `${caller.path}: caller input was mutated`);
  }
});

test("package environment filters never duplicate the shared credential predicate", () => {
  const duplicates: string[] = [];
  /** Inspect every TypeScript module, including fixtures and SDK/CLI implementation. */
  function inspect(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (entry.name.endsWith(".ts") && path !== join("scripts", "tool-env.ts")) {
        const expressions = readFileSync(path, "utf8").match(/\/(?:\\.|[^/\\\r\n])+\/[a-z]*/g) ?? [];
        if (expressions.some((expression) => sensitiveParts.filter((part) => expression.toUpperCase().includes(part)).length >= 4)) duplicates.push(path);
      }
    }
  }
  for (const directory of ["src", "scripts", "tests"]) inspect(directory);
  assert.deepEqual(duplicates, [], "credential categories must be maintained only in scripts/tool-env.ts");
});
