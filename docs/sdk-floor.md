# Published pm SDK capability floor

Audited main: `6c792db05bc05eabd75bb373e03feab68b7492aa`. Required API floor: **2026.9.30**.

Declared host floor: `2026.9.30`. npm peer: `>=2026.9.30`.

floor verified: the host declaration and the npm peer or exact runtime dependency already cover every API below. No floor change is needed.

## Artifact method and limits

The published version list was obtained with `npm view @unbrained/pm-cli versions --json`. Each capability was bisected over stable published releases, with its first providing release and adjacent previous stable release inspected. Prereleases do not satisfy these stable npm minimum ranges. Tarballs were downloaded with `npm pack @unbrained/pm-cli@VERSION --ignore-scripts` into an isolated scratch directory and inspected as data. No downloaded pm package code or lifecycle script was executed.

Public module exports were checked against both `package.json` entrypoints and the static ESM runtime export graph, then their `dist` declarations. Client methods and context members were read from the published declarations, including inherited members and static methods. A context property is attributed to the context used by this package, rather than a later base-interface refactor. TypeScript symbol resolution covers aliases, typed lazy loaders, destructuring, and clients passed through helpers. Erased interfaces do not create runtime requirements; imported function/constructor types used by loaders are retained conservatively.

This establishes API availability. It does not attest older-host runtime semantics, provider integration, or execution on the declared minimum. The current pinned SDK remains the local test host.

## API to first-version table

The machine-readable source inventory and artifact hashes are in [sdk-floor.json](sdk-floor.json). Source locations refer to the audited main commit.

| Used API | First stable release | Previous stable release lacking it | Source uses |
| --- | --- | --- | --- |
| `@unbrained/pm-cli/sdk :: createExtensionCommandSdk` | 2026.8.2 | 2026.8.1 | [src/stack.ts:198](../src/stack.ts#L198), [src/simulation.ts:8](../src/simulation.ts#L8) |
| `@unbrained/pm-cli/sdk :: getWorkspaceContracts` | 2026.5.24 | 2026.5.18 | [src/plan-command.ts:5](../src/plan-command.ts#L5) |
| `@unbrained/pm-cli/sdk :: loadCreateTemplateOptions` | 2026.5.14 | 2026.5.12 | [src/stack.ts:187](../src/stack.ts#L187) |
| `@unbrained/pm-cli/sdk :: planProfileApplication` | 2026.6.30 | 2026.6.24 | [src/stack.ts:210](../src/stack.ts#L210) |
| `@unbrained/pm-cli/sdk :: PmClient` | 2026.7.6 | 2026.7.5 | [src/seeds.ts:14](../src/seeds.ts#L14), [src/stack.ts:198](../src/stack.ts#L198), [src/simulation.ts:8](../src/simulation.ts#L8) |
| `@unbrained/pm-cli/sdk :: readFileIfExists` | 2026.5.14 | 2026.5.12 | [src/stack.ts:188](../src/stack.ts#L188) |
| `@unbrained/pm-cli/sdk :: readSettings` | 2026.5.14 | 2026.5.12 | [src/simulation.ts:8](../src/simulation.ts#L8) |
| `@unbrained/pm-cli/sdk :: runTemplatesList` | 2026.5.14 | 2026.5.12 | [src/stack.ts:186](../src/stack.ts#L186) |
| `CommandHandlerContext.args` | 2026.5.1 | 2026.3.12 | [src/presets/shared.ts:374](../src/presets/shared.ts#L374), [src/upgrade-command.ts:67](../src/upgrade-command.ts#L67), [src/plan-command.ts:41](../src/plan-command.ts#L41), [src/plan-command.ts:44](../src/plan-command.ts#L44), [src/index.ts:409](../src/index.ts#L409), [src/index.ts:427](../src/index.ts#L427), [src/index.ts:474](../src/index.ts#L474), [src/index.ts:529](../src/index.ts#L529), [src/index.ts:556](../src/index.ts#L556) |
| `CommandHandlerContext.global` | 2026.5.1 | 2026.3.12 | [src/presets/shared.ts:369](../src/presets/shared.ts#L369), [src/presets/shared.ts:374](../src/presets/shared.ts#L374), [src/plan-command.ts:27](../src/plan-command.ts#L27), [src/index.ts:334](../src/index.ts#L334), [src/index.ts:435](../src/index.ts#L435) |
| `CommandHandlerContext.options` | 2026.5.1 | 2026.3.12 | [src/upgrade-command.ts:46](../src/upgrade-command.ts#L46), [src/upgrade-command.ts:48](../src/upgrade-command.ts#L48), [src/upgrade-command.ts:49](../src/upgrade-command.ts#L49), [src/upgrade-command.ts:50](../src/upgrade-command.ts#L50), [src/plan-command.ts:38](../src/plan-command.ts#L38), [src/plan-command.ts:39](../src/plan-command.ts#L39), [src/plan-command.ts:40](../src/plan-command.ts#L40), [src/stack-command.ts:10](../src/stack-command.ts#L10), [src/index.ts:293](../src/index.ts#L293), [src/index.ts:430](../src/index.ts#L430), [src/index.ts:489](../src/index.ts#L489), [src/index.ts:494](../src/index.ts#L494), [src/index.ts:527](../src/index.ts#L527), [src/index.ts:562](../src/index.ts#L562), [src/index.ts:568](../src/index.ts#L568) |
| `CommandHandlerContext.pm_root` | 2026.5.1 | 2026.3.12 | [src/presets/shared.ts:110](../src/presets/shared.ts#L110) |
| `CommandHandlerContext.sdk` | 2026.7.19 | 2026.7.18 | [src/presets/shared.ts:278](../src/presets/shared.ts#L278), [src/presets/shared.ts:285](../src/presets/shared.ts#L285), [src/upgrade-command.ts:49](../src/upgrade-command.ts#L49), [src/upgrade-command.ts:67](../src/upgrade-command.ts#L67), [src/plan-command.ts:29](../src/plan-command.ts#L29), [src/plan-command.ts:30](../src/plan-command.ts#L30), [src/stack-command.ts:12](../src/stack-command.ts#L12), [src/index.ts:567](../src/index.ts#L567) |
| `ExtensionApi.registerCommand` | 2026.5.1 | 2026.3.12 | [src/upgrade-command.ts:34](../src/upgrade-command.ts#L34), [src/upgrade-command.ts:62](../src/upgrade-command.ts#L62), [src/plan-command.ts:52](../src/plan-command.ts#L52), [src/stack-command.ts:17](../src/stack-command.ts#L17), [src/index.ts:209](../src/index.ts#L209), [src/index.ts:218](../src/index.ts#L218), [src/index.ts:227](../src/index.ts#L227), [src/index.ts:236](../src/index.ts#L236), [src/index.ts:245](../src/index.ts#L245), [src/index.ts:254](../src/index.ts#L254), [src/index.ts:263](../src/index.ts#L263), [src/index.ts:280](../src/index.ts#L280), [src/index.ts:388](../src/index.ts#L388), [src/index.ts:400](../src/index.ts#L400), [src/index.ts:412](../src/index.ts#L412), [src/index.ts:455](../src/index.ts#L455), [src/index.ts:511](../src/index.ts#L511), [src/index.ts:519](../src/index.ts#L519), [src/index.ts:540](../src/index.ts#L540), [src/index.ts:577](../src/index.ts#L577), [src/index.ts:584](../src/index.ts#L584), [src/index.ts:591](../src/index.ts#L591) |
| `ExtensionApi.registerItemTypes` | 2026.5.1 | 2026.3.12 | [src/index.ts:272](../src/index.ts#L272), [src/index.ts:273](../src/index.ts#L273), [src/index.ts:274](../src/index.ts#L274) |
| `ExtensionCommandSdk.client` | 2026.7.19 | 2026.7.18 | [src/plan-command.ts:30](../src/plan-command.ts#L30), [src/index.ts:567](../src/index.ts#L567) |
| `ExtensionCommandSdk.mutateWorkspaceSettings` | 2026.9.30 | 2026.9.29 | [src/presets/shared.ts:278](../src/presets/shared.ts#L278), [src/presets/shared.ts:285](../src/presets/shared.ts#L285), [src/upgrade.ts:166](../src/upgrade.ts#L166), [src/upgrade.ts:168](../src/upgrade.ts#L168), [src/plan-command.ts:29](../src/plan-command.ts#L29), [src/stack.ts:169](../src/stack.ts#L169), [src/stack.ts:199](../src/stack.ts#L199), [src/simulation.ts:79](../src/simulation.ts#L79) |
| `PmClient.claim` | 2026.7.7 | 2026.7.6 | [src/simulation.ts:96](../src/simulation.ts#L96) |
| `PmClient.close` | 2026.7.6 | 2026.7.5 | [src/simulation.ts:102](../src/simulation.ts#L102), [src/simulation.ts:105](../src/simulation.ts#L105) |
| `PmClient.create` | 2026.7.6 | 2026.7.5 | [src/seeds.ts:166](../src/seeds.ts#L166), [src/seeds.ts:217](../src/seeds.ts#L217), [src/plan-command.ts:30](../src/plan-command.ts#L30), [src/simulation.ts:90](../src/simulation.ts#L90) |
| `PmClient.get` | 2026.7.6 | 2026.7.5 | [src/simulation.ts:114](../src/simulation.ts#L114) |
| `PmClient.update` | 2026.7.6 | 2026.7.5 | [src/simulation.ts:97](../src/simulation.ts#L97) |

## Tarball provenance

SHA-256 of the exact packed `.tgz` bytes; package archives and extracted files are not committed.

| pm release | Tarball SHA-256 |
| --- | --- |
| 2026.3.12 | `4e4e6a33cb45d665f072120e9e1ce25d2e5773e738cbc914b29e8f54367747fb` |
| 2026.5.1 | `730de8b79aa0074dc2ca81a54ce37f9aaa0a4167b690c9a62b87d2121a8b37f7` |
| 2026.5.12 | `42dcaef84dc441b7792aeffa059bfe10a86ae8b12b1084472229bba03fb29910` |
| 2026.5.14 | `7f7e9131afadb891344bf2fb93b15bc157d18c532a5da4ec31677957d37b7260` |
| 2026.5.18 | `df41d0df1f499a531d6a2cba134defa369870b2fe4b414c0517ef85e7c51db0e` |
| 2026.5.24 | `9d28fff4b06405ea5691ee919ad646c86c0a416a5007ca8104b19251306262af` |
| 2026.6.24 | `af33b996524c46bea935e96682ff6486bf0d7db01e21f5264af0d4137a75b209` |
| 2026.6.30 | `d2003d47a54b5df1f2162cb551af5efa4e617f805f9f5fde4e8942e6e221b8c2` |
| 2026.7.5 | `4a6664f68120cace5648faf48d51b08c14e969d9c7e185e592f1a0fceae57274` |
| 2026.7.6 | `0d6e446cf93a0f0660ce4e21943adf1e0c21381010ef67369f40cc9834b8d158` |
| 2026.7.7 | `c455dbda90d6f5aff55b23517683376ea6ab74d4a1540f3f8274590b1687c47e` |
| 2026.7.18 | `44b48fe680cf330254a4ab8d42b55cbcee81ba5cf21e4d4550b40413265d64b9` |
| 2026.7.19 | `513e0aead42767a113a26b8b2e2cbb8a22879d0cb0500d4d3cdd16d21d9f7a39` |
| 2026.8.1 | `242013e81ed2c4329a3cb20d3e70fa58f6dbb627d00c2c1e883562e786850f80` |
| 2026.8.2 | `c9f8e516319ba4d6609ea0272e4fa70360668531c379ec54b29df8aa418293e3` |
| 2026.9.29 | `fa52ca1b2512ee2ed15d348d393383706705f94479ba7432079bd8e14d57b97d` |
| 2026.9.30 | `a966b19b5d0e845bdc46df61f89d7c89800606821bcf1e061d619dfcfd0dc7db` |
