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
    description: "Environment reference; binds only into settings.secret_references.",
  },
];
```

Rules the engine enforces on every manifest:

- names match `[A-Za-z][A-Za-z0-9_-]{0,31}` and are declared exactly once;
- `enum` parameters declare unique allowed values; `string` parameters may
  declare a full-match pattern and a length bound (1–1024, default 256);
- `secret` parameters never carry a default (a default secret would ship in
  the package source) and accept only `@ENV_NAME` references, bound as entire values in
  `settings.secret_references.<name>`. Identifiers and tracked prose refuse secrets.

## 2. Reference parameters with binding occurrences

Inside settings patch values, template option values (including list-valued
options) and seed fields, reference a declared parameter with
`${param:<name>}`:

```typescript
export const SETTINGS = { id_prefix: "${param:projectKey}-" };

export const TEMPLATES = {
  "initiative.json": {
    name: "initiative",
    created_at: "1970-01-01T00:00:00.000Z",
    updated_at: "1970-01-01T00:00:00.000Z",
    options: {
      type: "Epic",
      tags: ["initiative", "${param:projectKey}"],
      body: "## Project\n${param:projectKey}\n",
    },
  },
};

// seeds reference the same declaration:
export const SEEDS = [
  { type: "Feature", title: "Define the ${param:projectKey} first roadmap initiative" },
];
```

One supplied value reaches every occurrence: apply substitutes the same
resolved value into the settings leaf, both template values and the seed prose.
The summary counts the settings and template occurrences
(`Resolved 1 parameter(s), 3 binding occurrence(s)`); seeds resolve separately.

## 3. Supply values and read back the choices

```bash
pm presets show startup-roadmap          # lists declared parameters + unanswered choices
pm presets apply startup-roadmap --param projectKey=acme --with-seeds
pm presets diff startup-roadmap --param projectKey=acme   # preview resolves like apply
```

Values can also come from a `--params-file <file>` (a JSON object of
`name → string`); a name supplied through both is a refusal.

## 4. The refusal contract (before any write)

The parameter and binding refusals below are typed (`code: remedy`, exit code 2)
and happen before tracker state is read or written. Ownership and recovery
refusals inspect tracker provenance first; write failures may retain earlier
audited work:

| Code | Cause | Remedy |
|---|---|---|
| `unknown_parameter` | a supplied name the preset never declared | check `pm presets show <id>` |
| `unanswered_parameter` | a required parameter with no value and no default | supply `--param name=value` for each listed choice |
| `invalid_value` | pattern/enum/length violation, control characters, line breaks | use a value that satisfies the declared constraint |
| `invalid_param_flag` / `invalid_params_file` | malformed `k=v` entry, duplicate name, or a non-string JSON value | fix the flag or file |
| `unknown_binding` / `malformed_binding` | authoring bug: a binding references an undeclared name or is not `${param:<name>}` | fix the manifest or the occurrence |
| `secret_in_public_prose` | a `secret` parameter bound in template or seed text | bind references only into settings.secret_references.<name> |

Literal secret inputs refuse with `invalid_secret_reference` (exit 2). Supply
`--param deployToken=@DEPLOY_TOKEN` and author
`secret_references: { deploy: "${param:deployToken}" }` in settings. Only the
reference enters settings, append-only history, summaries and dry-run previews.
Credentials remain outside the tracker. Consumers call `resolveSecretReference`
at use time and must not emit or persist the returned value. Missing environment
values refuse with `unavailable_secret_reference`; commands never dereference.

## 5. Resolution is computed once and holds under concurrency

The unified apply resolves your input exactly once (flags plus at most one
params file), pre-validates the seed bindings at that same boundary, and
threads the effective values through settings, templates and seeds — so
editing the params file mid-apply cannot split the workspace across two
values. Real applies hold a workspace-scoped lock across the settings mutation
and the template writes, keeping concurrent applies internally consistent;
dry-runs skip the preset apply lock. The host audit may create its own lock
file and may refuse on a read-only tracker; preset artifacts stay unchanged.

## 6. Programmatic use

The same engine is exported from the package root for SDK consumers:

```typescript
import {
  ParameterRefusal,
  resolveParameterValues,
  resolveParameterizedPreset,
} from "pm-presets";
// PARAMETERS, SETTINGS, TEMPLATES and SEEDS are the declarations from sections 1 and 2.
import { PARAMETERS, SEEDS, SETTINGS, TEMPLATES } from "./preset-definition.ts";

const resolved = resolveParameterValues(PARAMETERS, { projectKey: "acme" });
const parts = resolveParameterizedPreset(PARAMETERS, resolved.values, {
  settings: SETTINGS,
  templates: TEMPLATES,
  seeds: SEEDS,
});
```

All three resolvers return substituted deep copies; their inputs are never
mutated, and any secret occurrence in the public parts (templates, seeds)
throws `ParameterRefusal("secret_in_public_prose")` before a write can happen.
