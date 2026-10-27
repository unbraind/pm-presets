# Typed parameter binding manifests

This walkthrough shows how a pm-presets preset declares project parameters
**once** and resolves them consistently through settings, templates and seeds —
and how every unanswered, unknown or invalid choice refuses before any write.

The bundled `startup-roadmap` preset ships the same mechanism described here;
its `projectKey` parameter drives the `id_prefix`, the roadmap template prose
and the starter initiative seed.

## 1. Declare the manifest once

A parameter manifest is an array of typed declarations. It is the single
authoring source of truth — every binding occurrence in the preset resolves
against it, and `pm presets show <id>` renders it:

```typescript
import type { PresetParameter, PresetParameterManifest } from "pm-presets";

export const PARAMETERS: PresetParameterManifest = [
  {
    name: "projectKey",
    type: "string",
    required: true,
    default: "road",
    pattern: "[a-z][a-z0-9-]{0,15}",
    maxLength: 16,
    description: "Project key used for prefixes, template prose and the seed.",
  } satisfies PresetParameter,
  {
    name: "deployToken",
    type: "secret",
    required: false,
    description: "Webhook token; may only bind into settings values.",
  },
];
```

Rules the engine enforces on every manifest:

- names match `[A-Za-z][A-Za-z0-9_-]{0,31}` and are declared exactly once;
- `enum` parameters declare unique allowed values; `string` parameters may
  declare a full-match pattern and a length bound (1–1024, default 256);
- `secret` parameters never carry a default (a default secret would ship in
  the package source) and may bind only into **settings** values.

## 2. Reference parameters with binding occurrences

Inside settings patch values, template option values (including list-valued
options) and seed fields, reference a declared parameter with
`${param:<name>}`:

```typescript
export const SETTINGS = { id_prefix: "${param:projectKey}-" };

export const TEMPLATES = {
  "initiative.json": storedTemplate("initiative", {
    type: "Epic",
    tags: ["initiative", "${param:projectKey}"],
    body: "## Project\n${param:projectKey}\n",
  }),
};

// seeds reference the same declaration:
{ type: "Feature", title: "Define the ${param:projectKey} first roadmap initiative" }
```

One supplied value reaches every occurrence: apply substitutes the same
resolved value into the settings leaf, both template values and the seed prose,
and reports the count (`Resolved 1 parameter(s), 5 binding occurrence(s)`).

## 3. Supply values and read back the choices

```bash
pm presets show startup-roadmap          # lists declared parameters + unanswered choices
pm presets apply startup-roadmap --param projectKey=acme --with-seeds
pm presets diff startup-roadmap --param projectKey=acme   # preview resolves like apply
```

Values can also come from a `--params-file <file>` (a JSON object of
`name → string`); a name supplied through both is a refusal.

## 4. The refusal contract (before any write)

Every refusal is typed (`code: remedy`, exit code 2) and happens before any
tracker state is read or written:

| Code | Cause | Remedy |
|---|---|---|
| `unknown_parameter` | a supplied name the preset never declared | check `pm presets show <id>` |
| `unanswered_parameter` | a required parameter with no value and no default | supply `--param name=value` for each listed choice |
| `invalid_value` | pattern/enum/length violation, control characters, line breaks | use a value that satisfies the declared constraint |
| `invalid_param_flag` / `invalid_params_file` | malformed `k=v` entry, duplicate name, or a non-string JSON value | fix the flag or file |
| `unknown_binding` / `malformed_binding` | authoring bug: a binding references an undeclared name or is not `${param:<name>}` | fix the manifest or the occurrence |
| `secret_in_public_prose` | a `secret` parameter bound in template or seed text | bind secrets only into settings values |

Refusal messages never echo secret values (secrets render as `<redacted>`).
Secret values reach exactly one place — the private `settings.json` an apply
writes; the apply summary, `--dry-run` patch dumps and every `presets diff`
settings entry render them as `<redacted>` on both sides.

## 6. Resolution is computed once and holds under concurrency

The unified apply resolves your input exactly once (flags plus at most one
params file), pre-validates the seed bindings at that same boundary, and
threads the effective values through settings, templates and seeds — so
editing the params file mid-apply cannot split the workspace across two
values. Real applies hold a workspace-scoped lock across the settings mutation
and the template writes, keeping concurrent applies internally consistent;
dry-runs skip the lock and create no files.

## 5. Programmatic use

The same engine is exported from the package root for SDK consumers:

```typescript
import {
  ParameterRefusal,
  resolveParameterValues,
  resolveParameterizedPreset,
} from "pm-presets";

const resolved = resolveParameterValues(manifest, { projectKey: "acme" });
const parts = resolveParameterizedPreset(manifest, resolved.values, {
  settings,   // PresetSettingsPatch
  templates,  // PresetTemplateMap
  seeds,      // SeedItem[]
});
```

All three resolvers return substituted deep copies; their inputs are never
mutated, and any secret occurrence in the public parts (templates, seeds)
throws `ParameterRefusal("secret_in_public_prose")` before a write can happen.