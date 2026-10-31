/**
 * params.test.ts — engine tests for typed parameter binding manifests.
 *
 * Covers the whole resolution engine: manifest validation, the strict input
 * boundary (flags, params file, value constraints), binding substitution in
 * settings/templates/seeds, secret containment and every typed refusal —
 * including the must-allow corpus (defaults, whitespace variants, unicode,
 * list-valued template options) and the must-refuse corpus (unknown, missing,
 * invalid, malformed, secret-in-prose).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertResolvedParameterValues,
  buildParameterViews,
  collectParameterValues,
  parseParameterFlagEntries,
  redactSecretValues,
  parseParamsFile,
  ParameterRefusal,
  readSuppliedParameterValues,
  resolveParameterizedPreset,
  resolveParameterValues,
  resolveSeedsWithParameters,
  resolveSettingsWithParameters,
  resolveTemplatesWithParameters,
  validateParameterManifest,
  type PresetParameter,
  type ResolvedParameterValues,
  type PresetParameterManifest,
} from "../src/params.ts";
import type { PresetSettingsPatch, PresetTemplateMap } from "../src/presets/shared.ts";
import { storedTemplate } from "../src/presets/shared.ts";
import type { SeedItem } from "../src/seeds.ts";

/** A minimal valid string parameter for reuse across assertions. */
const KEY_PARAMETER: PresetParameter = {
  name: "projectKey",
  type: "string",
  required: true,
  default: "road",
  pattern: "[a-z][a-z0-9-]{0,15}",
  maxLength: 16,
  description: "Project key.",
};

/** Assert a call refuses with a specific typed parameter code. */
function refuses(code: string, run: () => unknown): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ParameterRefusal, `expected ParameterRefusal, got ${String(error)}`);
    assert.equal(error.code, code);
    assert.equal(error.exitCode, 2);
    assert.match(error.message, new RegExp(`^${code}: `));
    return true;
  });
}

test("validateParameterManifest accepts an empty manifest as the explicit no-parameters case", () => {
  validateParameterManifest([]);
});

test("validateParameterManifest accepts a well-formed manifest and rejects each malformed class", () => {
  validateParameterManifest([KEY_PARAMETER]);
  const entry: PresetParameter = {
    name: "owner",
    type: "enum",
    required: false,
    values: ["core", "community"],
  };
  validateParameterManifest([entry]);

  const bad: Array<[string, unknown]> = [
    ["not an array", { nope: true }],
    ["too many parameters", Array.from({ length: 33 }, (_, index): PresetParameter => ({ name: `p${index}`, type: "string", required: false }))],
    ["non-object entry", ["projectKey"]],
    ["bad name", [{ ...KEY_PARAMETER, name: "9bad" }]],
    ["wrong-type name", [{ ...KEY_PARAMETER, name: 42 }]],
    ["duplicate name", [KEY_PARAMETER, { ...KEY_PARAMETER }]],
    ["unknown type", [{ ...KEY_PARAMETER, type: "number" }]],
    ["enum without values", [{ name: "owner", type: "enum", required: false }]],
    ["enum with empty values", [{ name: "owner", type: "enum", required: false, values: [] }]],
    ["enum with untrimmed value", [{ name: "owner", type: "enum", required: false, values: ["core", " spaced "] }]],
    ["enum with empty value", [{ name: "owner", type: "enum", required: false, values: ["core", ""] }]],
    ["enum with non-string value", [{ name: "owner", type: "enum", required: false, values: ["core", 3] }]],
    ["enum with duplicate values", [{ name: "owner", type: "enum", required: false, values: ["core", "core"] }]],
    ["non-enum with values", [{ ...KEY_PARAMETER, values: ["a"] }]],
    ["non-compiling pattern", [{ ...KEY_PARAMETER, pattern: "([unclosed" }]],
    ["pattern on non-string", [{ name: "owner", type: "enum", required: false, values: ["core"], pattern: "core" }]],
    ["maxLength zero", [{ ...KEY_PARAMETER, maxLength: 0 }]],
    ["maxLength too large", [{ ...KEY_PARAMETER, maxLength: 1025 }]],
    ["maxLength fractional", [{ ...KEY_PARAMETER, maxLength: 1.5 }]],
    ["required not boolean", [{ ...KEY_PARAMETER, required: "yes" }]],
    ["empty description", [{ ...KEY_PARAMETER, description: "" }]],
    ["over-long description", [{ ...KEY_PARAMETER, description: "x".repeat(201) }]],
    ["non-string description", [{ ...KEY_PARAMETER, description: 5 }]],
    ["secret with default", [{ name: "token", type: "secret", required: true, default: "hunter2" }]],
    ["default that violates its own enum", [{ name: "owner", type: "enum", required: false, values: ["core"], default: "community" }]],
    ["default that violates its own pattern", [{ ...KEY_PARAMETER, default: "ROAD" }]],
    ["default longer than its own maxLength", [{ ...KEY_PARAMETER, default: "a".repeat(17) }]],
    ["whitespace-only default", [{ name: "k", type: "string", required: false, default: "   " }]],
    ["default with control characters", [{ name: "k", type: "string", required: false, default: "a\nb" }]],
  ];
  for (const [label, manifest] of bad) {
    refuses("invalid_manifest", () => validateParameterManifest(manifest as PresetParameterManifest));
    assert.ok(label.length > 0);
  }
});

test("resolveParameterValues merges supplied values with defaults and records sources", () => {
  const resolved = resolveParameterValues([KEY_PARAMETER], {});
  assert.deepEqual(resolved.values, { projectKey: "road" });
  assert.deepEqual(resolved.sources, { projectKey: "default" });

  const supplied = resolveParameterValues([KEY_PARAMETER], { projectKey: "  acme  " });
  assert.deepEqual(supplied.values, { projectKey: "acme" });
  assert.deepEqual(supplied.sources, { projectKey: "supplied" });

  const optional = resolveParameterValues(
    [{ name: "k", type: "string", required: false }],
    {},
  );
  assert.deepEqual(optional.values, {});
  assert.deepEqual(optional.sources, {});
});

test("resolveParameterValues refuses unknown, non-string, empty, control, over-long and constraint-violating values", () => {
  refuses("unknown_parameter", () => resolveParameterValues([KEY_PARAMETER], { other: "x" }));
  refuses("unknown_parameter", () => resolveParameterValues([], { other: "x" }));
  refuses("invalid_value", () => resolveParameterValues([KEY_PARAMETER], { projectKey: 5 as never }));
  refuses("invalid_value", () => resolveParameterValues([KEY_PARAMETER], { projectKey: "" }));
  refuses("invalid_value", () => resolveParameterValues([KEY_PARAMETER], { projectKey: "a\nb" }));
  refuses("invalid_value", () => resolveParameterValues([KEY_PARAMETER], { projectKey: "a".repeat(17) }));
  refuses("invalid_value", () => resolveParameterValues([KEY_PARAMETER], { projectKey: "ACME" }));
  refuses("invalid_value", () =>
    resolveParameterValues([{ name: "owner", type: "enum", required: true, values: ["core"] }], { owner: "community" }));
  refuses("invalid_value", () =>
    resolveParameterValues([{ name: "token", type: "secret", required: true }], { token: "bad\rkey" }));
  const freeForm: PresetParameterManifest = [{ name: "label", type: "string", required: true }];
  for (const separator of ["\u0085", "\u0080", "\u009F", "\u2028", "\u2029"]) {
    refuses("invalid_value", () => resolveParameterValues(freeForm, { label: `a${separator}b` }));
  }
  for (const allowed of ["caf\u00E9", "\u00A0a", "a\u00A0b", "\u65E5\u672C"]) {
    assert.equal(resolveParameterValues(freeForm, { label: allowed }).values.label, allowed.trim());
  }

  const noDefault: PresetParameterManifest = [{ name: "a", type: "string", required: true }, { name: "b", type: "string", required: true }];
  refuses("unanswered_parameter", () => resolveParameterValues(noDefault, {}));
});

test("buildParameterViews exposes declarations, redacts secrets and flags unanswered choices", () => {
  const manifest: PresetParameterManifest = [
    KEY_PARAMETER,
    { name: "owner", type: "enum", required: true, values: ["core", "community"] },
    { name: "token", type: "secret", required: true },
    { name: "nickname", type: "string", required: false },
  ];
  const views = buildParameterViews(manifest);
  assert.deepEqual(views.map((view) => view.name), ["projectKey", "owner", "token", "nickname"]);
  assert.equal(views[0].hasDefault, true);
  assert.equal(views[0].default, "road");
  assert.equal(views[0].unanswered, false);
  assert.deepEqual(views[1].values, ["core", "community"]);
  assert.equal(views[1].unanswered, true);
  assert.equal(views[2].hasDefault, false);
  assert.equal("default" in views[2], false);
  assert.equal(views[2].unanswered, true);
  assert.equal(views[3].unanswered, false);

  const answered = buildParameterViews(manifest, { token: "x" });
  assert.equal(answered[2].unanswered, false);
});

test("parseParameterFlagEntries accepts scalar, list, and absent input and refuses malformed entries", () => {
  assert.deepEqual(parseParameterFlagEntries(undefined), []);
  assert.deepEqual(parseParameterFlagEntries(null), []);
  assert.deepEqual(parseParameterFlagEntries("k=v"), [{ name: "k", value: "v" }]);
  assert.deepEqual(parseParameterFlagEntries(["a=1", "b=2=x"]), [
    { name: "a", value: "1" },
    { name: "b", value: "2=x" },
  ]);
  refuses("invalid_param_flag", () => parseParameterFlagEntries(5 as never));
  refuses("invalid_param_flag", () => parseParameterFlagEntries([5 as never]));
  refuses("invalid_param_flag", () => parseParameterFlagEntries("novalue"));
  refuses("invalid_param_flag", () => parseParameterFlagEntries("=value"));
  refuses("invalid_param_flag", () => parseParameterFlagEntries("9bad=v"));
  refuses("invalid_param_flag", () => parseParameterFlagEntries("k="));
  refuses("invalid_param_flag", () => parseParameterFlagEntries("k=  "));
  refuses("invalid_param_flag", () => parseParameterFlagEntries(["k=1", "k=2"]));
});

test("parseParamsFile accepts a bounded string-valued JSON object and refuses everything else", () => {
  assert.deepEqual(parseParamsFile('{"a":"1"}'), { a: "1" });
  assert.deepEqual(parseParamsFile("{}"), {});
  refuses("invalid_params_file", () => parseParamsFile("x".repeat(65 * 1024)));
  refuses("invalid_params_file", () => parseParamsFile("{nope"));
  refuses("invalid_params_file", () => parseParamsFile('[{"a":"1"}]'));
  refuses("invalid_params_file", () => parseParamsFile("null"));
  refuses("invalid_params_file", () => parseParamsFile('"text"'));
  refuses("invalid_params_file", () => parseParamsFile('{"a":1}'));
  refuses("invalid_params_file", () => parseParamsFile('{"9bad":"v"}'));
});

test("readSuppliedParameterValues combines flags with the params file and refuses collisions and bad paths", (t) => {
  const root = mkdtempSync(join(tmpdir(), "presets-params-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "params.json");
  writeFileSync(file, '{"projectKey":"file","owner":"core"}', "utf8");

  const combined = readSuppliedParameterValues({ param: ["a=1"], paramsFile: file });
  assert.deepEqual(combined, { a: "1", projectKey: "file", owner: "core" });
  assert.deepEqual(readSuppliedParameterValues({}), {});
  assert.deepEqual(readSuppliedParameterValues({ paramsFile: undefined }), {});
  assert.deepEqual(readSuppliedParameterValues({ paramsFile: null }), {});
  refuses("invalid_params_file", () => readSuppliedParameterValues({ paramsFile: "" }));
  refuses("invalid_params_file", () => readSuppliedParameterValues({ paramsFile: "   " }));
  refuses("invalid_params_file", () => readSuppliedParameterValues({ paramsFile: 5 as never }));
  refuses("invalid_param_flag", () =>
    readSuppliedParameterValues({ param: ["projectKey=flag"], paramsFile: file }));
});

test("resolveSettingsWithParameters substitutes settings leaves once and leaves non-strings untouched", () => {
  const settings = {
    id_prefix: "${param:projectKey}-",
    governance: { create_default_type: "Feature" },
    testing: { record_results_to_items: false },
  } as unknown as PresetSettingsPatch;
  const resolved = resolveSettingsWithParameters([KEY_PARAMETER], { projectKey: "acme" }, settings);
  assert.equal(resolved.settings.id_prefix, "acme-");
  assert.deepEqual(
    (resolved.settings as unknown as Record<string, unknown>).governance,
    settings.governance,
  );
  assert.equal(resolved.occurrences, 1);
  assert.equal(settings.id_prefix, "${param:projectKey}-", "the input must never be mutated");
});

test("resolveTemplatesWithParameters substitutes option values and list options", () => {
  const templates = {
    "card.json": storedTemplate("card", {
      type: "Card",
      tags: ["${param:projectKey}", "kanban"],
      body: "Project ${param:projectKey} board; again ${param:projectKey}.",
    }),
  } as PresetTemplateMap;
  const resolved = resolveTemplatesWithParameters([KEY_PARAMETER], { projectKey: "acme" }, templates);
  assert.deepEqual(resolved.templates["card.json"].options.tags, ["acme", "kanban"]);
  assert.equal(resolved.templates["card.json"].options.body, "Project acme board; again acme.");
  assert.equal(resolved.occurrences, 3);
});

test("resolveTemplatesWithParameters refuses malformed, unknown and secret bindings and name bindings", () => {
  const manifest: PresetParameterManifest = [KEY_PARAMETER, { name: "token", type: "secret", required: false }];
  refuses("malformed_binding", () =>
    resolveTemplatesWithParameters(manifest, { projectKey: "a" }, {
      "card.json": storedTemplate("card", { body: "${param:projectKey" }),
    } as PresetTemplateMap));
  refuses("malformed_binding", () =>
    resolveTemplatesWithParameters(manifest, { projectKey: "a" }, {
      "card.json": storedTemplate("card", { body: "${param:bad name}" }),
    } as PresetTemplateMap));
  refuses("unknown_binding", () =>
    resolveTemplatesWithParameters(manifest, { projectKey: "a" }, {
      "card.json": storedTemplate("card", { body: "${param:other}" }),
    } as PresetTemplateMap));
  refuses("invalid_binding_location", () =>
    resolveTemplatesWithParameters(manifest, { projectKey: "a" }, {
      "card.json": { name: "${param:projectKey}", created_at: "1970-01-01T00:00:00.000Z", updated_at: "1970-01-01T00:00:00.000Z", options: { type: "Card" } },
    } as unknown as PresetTemplateMap));
  refuses("secret_in_public_prose", () =>
    resolveTemplatesWithParameters(manifest, { projectKey: "a" }, {
      "card.json": storedTemplate("card", { body: "Token ${param:token} inline" }),
    } as PresetTemplateMap));
});

test("resolveSeedsWithParameters substitutes seed prose and refuses malformed and secret bindings", () => {
  const seeds: SeedItem[] = [
    { type: "Feature", title: "Define the ${param:projectKey} initiative", priority: "2", tags: "roadmap", body: "Start ${param:projectKey} now." },
  ];
  const resolved = resolveSeedsWithParameters([KEY_PARAMETER], { projectKey: "acme" }, seeds);
  assert.equal(resolved.seeds[0].title, "Define the acme initiative");
  assert.equal(resolved.seeds[0].body, "Start acme now.");
  assert.equal(resolved.occurrences, 2);
  assert.equal(seeds[0].title, "Define the ${param:projectKey} initiative", "the input must never be mutated");

  const manifest: PresetParameterManifest = [{ name: "token", type: "secret", required: false }];
  refuses("malformed_binding", () =>
    resolveSeedsWithParameters(manifest, {}, [{ type: "Task", title: "${param:token" }]));
  refuses("secret_in_public_prose", () =>
    resolveSeedsWithParameters(manifest, {}, [{ type: "Task", title: "Token ${param:token}" }]));
});

test("supplied binding syntax refuses instead of entering tracked files", () => {
  refuses("invalid_value", () => resolveParameterValues([KEY_PARAMETER], { projectKey: "${param:projectKey}" }));
  refuses("invalid_value", () => resolveParameterizedPreset([KEY_PARAMETER], { projectKey: "${param:projectKey}" }, {
    settings: { id_prefix: "${param:projectKey}-" } as PresetSettingsPatch,
    templates: { "card.json": storedTemplate("card", { body: "${param:projectKey}" }) },
    seeds: [{ type: "Task", title: "${param:projectKey}" }],
  }));
});

test("resolveParameterizedPreset resolves only the parts it is given", () => {
  const values = { projectKey: "acme" };
  assert.equal(resolveParameterizedPreset([KEY_PARAMETER], values, {}).occurrences, 0);
  const settingsOnly = resolveParameterizedPreset([KEY_PARAMETER], values, {
    settings: { id_prefix: "${param:projectKey}-" } as PresetSettingsPatch,
  });
  assert.equal(settingsOnly.settings?.id_prefix, "acme-");
  assert.equal(settingsOnly.templates, undefined);
  assert.equal(settingsOnly.seeds, undefined);
  const templatesOnly = resolveParameterizedPreset([KEY_PARAMETER], values, {
    templates: { "card.json": storedTemplate("card", { body: "${param:projectKey}" }) } as PresetTemplateMap,
  });
  assert.equal(templatesOnly.settings, undefined);
  assert.equal(templatesOnly.seeds, undefined);
  const seedsOnly = resolveParameterizedPreset([KEY_PARAMETER], values, {
    seeds: [{ type: "Task", title: "${param:projectKey}" }],
  });
  assert.equal(seedsOnly.settings, undefined);
  assert.equal(seedsOnly.templates, undefined);
});

test("secret references bind only into explicit settings and refusals never echo credentials", () => {
  const manifest: PresetParameterManifest = [{ name: "token", type: "secret", required: true }];
  refuses("invalid_secret_reference", () => resolveParameterValues(manifest, { token: "super-secret-value" }));
  const values = resolveParameterValues(manifest, { token: "@DEPLOY_TOKEN" }).values;
  const resolved = resolveSettingsWithParameters(manifest, values, {
    id_prefix: "k-",
    secret_references: { webhook: "${param:token}" },
  } as unknown as PresetSettingsPatch);
  assert.equal(
    (resolved.settings as unknown as Record<string, Record<string, unknown>>).secret_references.webhook,
    "@DEPLOY_TOKEN",
  );
  try {
    resolveSeedsWithParameters(manifest, values, [{ type: "Task", title: "${param:token}" }]);
    assert.fail("expected a refusal");
  } catch (error) {
    assert.ok(error instanceof ParameterRefusal);
    assert.equal(error.code, "secret_in_public_prose");
    assert.ok(!error.message.includes("super-secret-value"), "refusals must never echo secret values");
  }
});
test("collectParameterValues is lenient: unanswered parameters are listed, not thrown", () => {
  const manifest: PresetParameterManifest = [
    { name: "a", type: "string", required: true },
    { name: "b", type: "string", required: false, default: "bee" },
  ];
  const collected = collectParameterValues(manifest, {});
  assert.deepEqual(collected.values, { b: "bee" });
  assert.deepEqual(collected.sources, { b: "default" });
  assert.deepEqual(collected.unanswered, ["a"]);
  // Supplied invalid values still refuse at the lenient boundary.
  refuses("invalid_value", () => collectParameterValues([{ name: "a", type: "string", required: true, pattern: "[a-z]+" }], { a: "A" }));
  refuses("unknown_parameter", () => collectParameterValues(manifest, { ghost: "1" }));
});

test("assertResolvedParameterValues re-validates injected resolutions", () => {
  const manifest: PresetParameterManifest = [{ name: "a", type: "string", required: true, pattern: "[a-z]+" }];
  const good: ResolvedParameterValues = { values: { a: "abc" }, sources: { a: "supplied" }, unanswered: [] };
  assertResolvedParameterValues(manifest, good);
  refuses("unknown_parameter", () => assertResolvedParameterValues(manifest, { values: { ghost: "x" }, sources: { ghost: "supplied" }, unanswered: [] }));
  refuses("invalid_value", () => assertResolvedParameterValues(manifest, { values: { a: 5 as never }, sources: { a: "supplied" }, unanswered: [] }));
  refuses("invalid_value", () => assertResolvedParameterValues(manifest, { values: { a: "ABC" }, sources: { a: "supplied" }, unanswered: [] }));
  refuses("invalid_value", () => assertResolvedParameterValues(manifest, { values: { a: "abc" }, sources: { a: "injected" as never }, unanswered: [] }));
  refuses("unanswered_parameter", () => assertResolvedParameterValues(manifest, { values: {}, sources: {}, unanswered: ["a"] }));
});

test("substitution refuses declared-but-unanswered bindings on write paths and leaves them raw for declarations", () => {
  const manifest: PresetParameterManifest = [{ name: "a", type: "string", required: true }];
  // Write mode (default): a missing binding refuses.
  refuses("unanswered_parameter", () =>
    resolveParameterizedPreset(manifest, {}, { settings: { id_prefix: "${param:a}-" } as never }));
  refuses("unanswered_parameter", () =>
    resolveSettingsWithParameters(manifest, {}, { id_prefix: "${param:a}-" } as never));
  refuses("unanswered_parameter", () =>
    resolveTemplatesWithParameters(manifest, {}, { "card.json": storedTemplate("card", { body: "${param:a}" }) }));
  refuses("unanswered_parameter", () =>
    resolveSeedsWithParameters(manifest, {}, [{ type: "Task", title: "${param:a}" }]));
  // Declaration mode: the authored occurrence survives for inspection.
  const declared = resolveParameterizedPreset(manifest, {}, { settings: { id_prefix: "${param:a}-" } as never }, true);
  assert.equal(declared.settings?.id_prefix, "${param:a}-");
  assert.equal(declared.occurrences, 0);
});

test("redactSecretValues replaces exact secret matches and tolerates edge inputs", () => {
  assert.equal(redactSecretValues("token hunter2 inside longer hunter2 text", ["hunter2"]), "token <redacted> inside longer <redacted> text");
  assert.equal(redactSecretValues("no secrets", []), "no secrets");
  assert.equal(redactSecretValues("empty secret", [""]), "empty secret");
});
