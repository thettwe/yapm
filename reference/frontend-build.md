# Frontend & Build Toolchain Reference

Target audience: coding agents whose training data predates these releases. Everything below was
fetched from official sources or **empirically verified** on 2026-07-23 by building and running a
throwaway monorepo with the exact versions listed. Nothing here is recalled from memory.

Anything not verified is explicitly marked `UNVERIFIED`.

---

## 0. Verified version baseline

Resolved with `npm view <pkg> version` on 2026-07-23.

| Package | Latest | Notes |
|---|---|---|
| `typescript` | **7.0.2** | Go-native compiler. GA 2026-07-08. |
| `pnpm` | **11.16.0** | |
| `turbo` | **2.10.6** | |
| `vite` | **8.1.5** | Rolldown + Oxc + Lightning CSS |
| `@vitejs/plugin-react` | **6.0.4** | peer `vite: ^8.0.0` |
| `@vitejs/plugin-react-oxc` | 0.4.3 | peer `vite: ^6.3.0 \|\| ^7.0.0` — **not Vite 8** |
| `react` / `react-dom` | **19.2.8** | |
| `@tanstack/react-router` | **1.170.18** | peer `react >=18 \|\| >=19` |
| `@tanstack/router-plugin` | **1.168.23** | peer `vite >=5 \|\| >=6 \|\| >=7 \|\| >=8`, `@tanstack/react-router ^1.170.18` |
| `tailwindcss` / `@tailwindcss/vite` | **4.3.3** | `@tailwindcss/vite` peer `vite: ^5.2.0 \|\| ^6 \|\| ^7 \|\| ^8` |
| `shadcn` (CLI) | **4.14.0** | engines `node >=20.18.1` |
| `vitest` | **4.1.10** | peer `vite: ^6.0.0 \|\| ^7.0.0 \|\| ^8.0.0` |
| `@playwright/test` | **1.61.1** | |
| `@biomejs/biome` | **2.5.5** | |
| `lefthook` | **2.1.10** | |
| `@types/node` | 26.1.1 (24-line: **24.13.3**) | pin the 24 line for Node 24 LTS |
| `@types/react` / `@types/react-dom` | 19.2.17 / 19.2.3 | |
| `jsdom` | 29.1.1 | |
| `@testing-library/react` / `jest-dom` | 16.3.2 / 7.0.0 | |

**Verification harness.** A three-package pnpm workspace (`apps/web`, `apps/server`, `packages/ui`)
was created, installed with pnpm 11.16.0, and run through `turbo run build typecheck test`, `biome ci .`,
`playwright test --list`, `lefthook validate`, and `tsc -b`. All passed. Every config block below marked
**VERIFIED** is copied from that working repo.

---

## 1. TypeScript 7

Sources:
- <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/> (2026-07-08)
- <https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/> (deprecation details)
- `tsc --all` / `tsc --build --help` from `typescript@7.0.2` (empirical)

### 1.1 What TS 7 is

> "Today we are proud to announce the availability of TypeScript 7, a 10x faster native port of TypeScript!"
> … "TypeScript 7 brings native code speed, shared memory multithreading, and a number of new
> optimizations that typically yield speedups between 8x and 12x on full builds."

Install is unchanged — same `typescript` package, same `tsc` binary:

```bash
npm install -D typescript
```

### 1.2 Removed options (empirically confirmed against `typescript@7.0.2`)

The announcement's list:

> The deprecations that have turned into hard errors with no-op behavior are:
> - `target: es5` is no longer supported.
> - `downlevelIteration` is no longer supported.
> - `moduleResolution: node/node10` are no longer supported, with `nodenext` and `bundler` being recommended instead.
> - `module: amd, umd, systemjs, none` are no longer supported, with `esnext` or `preserve` being recommended in conjunction with bundlers or browser-based module resolution.
> - `baseUrl` is no longer supported, and `paths` can be updated to be relative to the project root instead of `baseUrl`.
> - `moduleResolution: classic` is no longer supported, and `bundler` or `nodenext` are the recommended replacements.
> - `esModuleInterop` and `allowSyntheticDefaultImports` cannot be set to `false`.
> - `alwaysStrict` is assumed to be `true` and can no longer be set to `false`.
> - The `module` keyword cannot be used in namespace declarations.
> - The `asserts` keyword cannot be used on imports, and must use the `with` keyword instead …
> - `/// <reference no-default-lib />` directives are no longer respected under `skipDefaultLibCheck`.
> - Command line builds cannot take file paths when the current directory contains a `tsconfig.json` file unless passed an explicit `--ignoreConfig` flag.

Actual error output observed (each option set alone in a tsconfig, `tsc --noEmit`):

```
"target": "es5"                        → error TS5108: Option 'target=ES5' has been removed. Please remove it from your configuration.
"moduleResolution": "node10"           → error TS5108: Option 'moduleResolution=node10' has been removed. ...
"moduleResolution": "classic"          → error TS5108: Option 'moduleResolution=Classic' has been removed. ...
"module": "amd"                        → error TS5108: Option 'module=AMD' has been removed. ...
"baseUrl": "./src"                     → error TS5102: Option 'baseUrl' has been removed. Please remove it from your configuration.
                                          Use '"paths": {"*": ["./src/*"]}' instead.
"esModuleInterop": false               → error TS5108: Option 'esModuleInterop=false' has been removed. ...
"allowSyntheticDefaultImports": false  → error TS5108: Option 'allowSyntheticDefaultImports=false' has been removed. ...
"downlevelIteration": true             → error TS5102: Option 'downlevelIteration' has been removed. ...
"outFile": "./out.js"                  → error TS5102: Option 'outFile' has been removed. ...
"alwaysStrict": false                  → error TS5108: Option 'alwaysStrict=false' has been removed. ...
```

**`ignoreDeprecations` does not rescue you.** Setting `"ignoreDeprecations": "6.0"` alongside
`baseUrl` still produced `error TS5102`. That escape hatch existed only in TS 6.0.

**Correction to a common assumption: `preserveConstEnums` was NOT removed.** Setting
`"preserveConstEnums": true` under TS 7.0.2 type-checks cleanly (exit 0, no diagnostic), and it is
still listed by `tsc --all`:

```
--preserveConstEnums
Disable erasing 'const enum' declarations in generated code.
type: boolean
default: false
```

`esModuleInterop` is **forced on**: `tsc --all` reports `--esModuleInterop … default: true`, and
`false` is a hard error. Same for `allowSyntheticDefaultImports`. You may still write
`"esModuleInterop": true` (it is a no-op); omit it for cleanliness.

### 1.3 Allowed enum values in TS 7.0.2 (from `tsc --all`)

```
--target      one of: es6/es2015, es2016, es2017, es2018, es2019, es2020, es2021,
                      es2022, es2023, es2024, es2025, esnext
              default: es2025
--module      one of: commonjs, es6/es2015, es2020, es2022, esnext,
                      node16, node18, node20, nodenext, preserve
--moduleResolution  one of: node16, nodenext, bundler
              default: `nodenext` if `module` is `nodenext`; `node16` if `module` is `node16`
                       or `node18`; otherwise, `bundler`.
--jsx         one of: preserve, react-native, react-jsx, react-jsxdev, react
```

### 1.4 New defaults inherited from 6.0

> - `strict` is `true` by default.
> - `module` defaults to `esnext`.
> - `target` defaults to the current stable ECMAScript version immediately preceding `esnext`.
> - `noUncheckedSideEffectImports` is `true` by default.
> - `libReplacement` is `false` by default.
> - `stableTypeOrdering` is `true` by default, and cannot be turned off.
> - `rootDir` now defaults to `./`, and inner source directories must be explicitly set.
> - `types` now defaults to `[]`, and the old behavior can be restored by setting it to `["*"]`.

The `types: []` default is the one that bites hardest. In the verification repo, omitting it produced:

```
playwright.config.ts(6,17): error TS2591: Cannot find name 'process'. Do you need to install type
  definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
vite.config.ts(1,36): error TS2591: Cannot find name 'node:url'. ...
```

Fix: `"types": ["node", "vite/client"]` plus a real `@types/node` dependency.

`tsc --all` also shows a new option not present in 5.x: `--deduplicatePackages` (default `true`).

### 1.5 New CLI flags: `--checkers`, `--builders`, `--singleThreaded`

> "TypeScript 7 introduces the experimental `--checkers` and `--builders` flags to fine-tune the
> parallelization behavior for less-trivial steps like type-checking and project reference building.
> It also introduces a `--singleThreaded` flag to disable parallelization entirely…"

- `--checkers <n>` — number of type-checking workers. **Default 4.** Higher = faster but more memory.
  `--checkers 1` makes checking single-threaded and eliminates duplicated work.
  > "In rare cases, varying the number of `--checkers` may surface order-dependent results."
- `--builders <n>` — **only exists in `--build` mode** (confirmed: absent from `tsc --all`, present in
  `tsc --build --help` as "Set the number of projects to build concurrently"). Multiplies with
  `--checkers`: "building with `--checkers 4 --builders 4` allows up to 16 type-checkers to run at once,
  which may be excessive."
- `--singleThreaded` — caps checkers to 1 *and* serialises parsing/emit.

VERIFIED: `tsc -b tsconfig.build.json --builders 2 --checkers 2 --verbose` runs cleanly.

CI guidance: on small runners, `tsc --noEmit --checkers 2` (or `1`) usually beats the default 4.

`--watch` was rebuilt on a Go port of `@parcel/watcher`.

### 1.6 The Compiler API is gone in 7.0 — this is the big ecosystem break

> "While TypeScript 7.0 is here, it does not ship with an API. We expect TypeScript 7.1 to ship with a
> new (and different) API…"

Empirically, `require('typescript')` under 7.0.2 returns only two keys:

```js
> Object.keys(require('typescript'))
[ 'version', 'versionMajorMinor' ]
```

`node_modules/typescript/package.json` exports map (7.0.2):

```json
"exports": {
  "./package.json": "./package.json",
  ".": "./lib/version.cjs",
  "./unstable/sync": "./dist/api/sync/api.js",
  "./unstable/async": "./dist/api/async/api.js",
  "./unstable/fs": "./dist/api/fs.js",
  "./unstable/proto": "./dist/api/proto.js",
  "./unstable/ast": "./dist/ast/index.js",
  "./unstable/ast/is": "./dist/ast/is.js",
  "./unstable/ast/factory": "./dist/ast/factory.generated.js",
  "./unstable/ast/utils": "./dist/ast/utils.js",
  "./unstable/ast/scanner": "./dist/ast/scanner.js",
  "./unstable/ast/visitor": "./dist/ast/visitor.js",
  "./unstable/ast/clone": "./dist/ast/clone.js"
}
```

There *is* an `typescript/unstable/sync` surface (exports `API`, `Checker`, `Emitter`, `InternalAPI`, …)
but it is explicitly unstable and is **not** the classic Compiler API. No existing tool consumes it.

**Tools that therefore cannot use TypeScript 7 (quoted from the announcement):**

> "workflows that use Vue, MDX, Astro, Svelte, and others will likely not yet be able to leverage
> TypeScript 7. Similarly, specialized type-checking within templates like Angular will also likely not
> use TypeScript 7. This is mainly because TypeScript 7 does not yet expose a stable programmatic API,
> and so tools (such as Volar) which embed TypeScript into their own compilers and language services
> can only currently rely on TypeScript 6.0."

Practical incompatible list: **typescript-eslint**, **Volar-based** tooling (Vue `vue-tsc`, Astro
`astro check`, Svelte, MDX), **Angular** template checking, and anything that does
`import ts from 'typescript'` — `ts-morph`, `knip`, `vite-plugin-dts`, webpack `ts-loader`, `ts-node`,
`tsup`'s dts step, API Extractor. (Category `UNVERIFIED` for individual packages; the mechanism —
no `typescript` API export — is verified.)

Side-by-side escape hatch, quoted:

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

> "This package provides an executable named `tsc6`, so that if needed, you can install TypeScript 7.0
> (which ships its own `tsc` binary) side-by-side without naming conflicts."

Nightlies moved: `npm install -D typescript@next` (the `@typescript/native-preview` package is retired).

Editors: VS Code needs the "TypeScript (Native Preview)" extension until built-in support ships
("In the coming weeks support for TypeScript 7 will ship as part of VS Code itself").

### 1.7 `tsc --init` output under 7.0.2 (verbatim)

```jsonc
{
  // Visit https://aka.ms/tsconfig to read more about this file
  "compilerOptions": {
    // File Layout
    // "rootDir": "./src",
    // "outDir": "./dist",

    // Environment Settings
    // See also https://aka.ms/tsconfig/module
    "module": "nodenext",
    "target": "esnext",
    "types": [],
    // For nodejs:
    // "lib": ["esnext"],
    // "types": ["node"],
    // and npm install -D @types/node

    // Other Outputs
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true,

    // Stricter Typechecking Options
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,

    // Style Options
    // "noImplicitReturns": true,
    // ...

    // Recommended Options
    "strict": true,
    "jsx": "react-jsx",
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noUncheckedSideEffectImports": true,
    "moduleDetection": "force",
    "skipLibCheck": true,
  }
}
```

### 1.8 Known-good tsconfigs under TS 7 (VERIFIED — `tsc --noEmit` exits 0)

**Shared base — `tsconfig.base.json`:**

```json
{
  "compilerOptions": {
    "strict": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2024",
    "types": [],
    "moduleDetection": "force",
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true
  }
}
```

**Vite React SPA — `apps/web/tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts", "playwright.config.ts", "e2e"]
}
```

Notes:
- **No `baseUrl`.** `paths` entries are relative to the directory containing this tsconfig, and they
  resolve correctly — verified by importing `@/lib/util` from a test file (tsc exit 0; Vitest resolved
  it through the matching Vite `resolve.alias`). You must mirror `paths` in `vite.config.ts`
  `resolve.alias` — TypeScript `paths` do not affect the bundler.
- `types: ["node", "vite/client"]` is mandatory once your config files touch `process` / `node:*`.
- Include the config files themselves in `include`, or they go unchecked.

**Node server — `apps/server/tsconfig.json`:**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2024",
    "lib": ["ES2024"],
    "types": ["node"],
    "rootDir": "./src",
    "outDir": "./dist",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

**Node server emit — `apps/server/tsconfig.build.json`:**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "incremental": true,
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  }
}
```

VERIFIED: `tsc -p tsconfig.build.json` emitted `dist/index.js`, `index.d.ts`, `.map` files.
`rootDir` is set explicitly because of the TS 6/7 default change.

---

## 2. pnpm 11 — workspaces + catalogs

Sources: <https://pnpm.io/catalogs>, <https://pnpm.io/pnpm-workspace_yaml>, <https://pnpm.io/settings>,
plus empirical runs of `pnpm@11.16.0`.

### 2.1 `pnpm-workspace.yaml` (VERIFIED — this exact file installs cleanly)

```yaml
packages:
  - 'apps/*'
  - 'packages/*'

allowBuilds:
  lefthook: true

catalog:
  react: ^19.2.8
  react-dom: ^19.2.8
  '@types/node': ^24.13.3
  '@types/react': ^19.2.17
  '@types/react-dom': ^19.2.3
  vite: ^8.1.5
  '@vitejs/plugin-react': ^6.0.4
  '@tanstack/react-router': ^1.170.18
  '@tanstack/router-plugin': ^1.168.23
  tailwindcss: ^4.3.3
  '@tailwindcss/vite': ^4.3.3
  typescript: ^7.0.2
  vitest: ^4.1.10
  '@vitest/coverage-v8': ^4.1.10
  jsdom: ^29.1.1
  '@testing-library/react': ^16.3.2
  '@testing-library/jest-dom': ^7.0.0
  '@playwright/test': ^1.61.1
  '@biomejs/biome': ^2.5.5

catalogs:
  build:
    turbo: ^2.10.6
```

`packages` uses globs; per the docs: "The root package is always included, even when custom location
wildcards are used." Docs example:

```yaml
packages:
  - 'my-app'
  - 'packages/*'
  - 'components/**'
  - '!**/test/**'
```

- `catalog:` (singular) = the **default** catalog.
- `catalogs:` (plural) = **named** catalogs, one map per name.

### 2.2 Referencing catalogs from `package.json` (VERIFIED)

```json
{
  "name": "@yapm/web",
  "private": true,
  "type": "module",
  "dependencies": {
    "@tanstack/react-router": "catalog:",
    "@yapm/ui": "workspace:*",
    "react": "catalog:",
    "react-dom": "catalog:"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:"
  }
}
```

Root `package.json` mixing default and named catalogs:

```json
{
  "devDependencies": {
    "@biomejs/biome": "catalog:",
    "turbo": "catalog:build",
    "typescript": "catalog:",
    "lefthook": "^2.1.10"
  }
}
```

The protocol is valid in `dependencies`, `devDependencies`, `peerDependencies`,
`optionalDependencies`, and in `pnpm-workspace.yaml` `overrides`. It "is removed when running
`pnpm publish` or `pnpm pack`", replaced by the concrete range — so private workspaces are unaffected.

### 2.3 Lockfile interaction (VERIFIED — real `pnpm-lock.yaml` excerpt)

`pnpm-lock.yaml` (lockfileVersion `'9.0'`) gains a top-level `catalogs:` block resolving each catalog
entry to a concrete version:

```yaml
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

catalogs:
  build:
    turbo:
      specifier: ^2.10.6
      version: 2.10.6
  default:
    '@biomejs/biome':
      specifier: ^2.5.5
      version: 2.5.5
    react:
      specifier: ^19.2.8
      version: 19.2.8
    typescript:
      specifier: ^7.0.2
      version: 7.0.2
    vite:
      specifier: ^8.1.5
      version: 8.1.5
```

Changing a catalog range invalidates the lockfile; `pnpm install --frozen-lockfile` (VERIFIED to pass in
CI mode) fails if `pnpm-workspace.yaml` and the lock disagree. Renovate therefore only needs to edit
`pnpm-workspace.yaml` + refresh the lock.

### 2.4 Adding to a catalog from the CLI (VERIFIED)

```
--save-catalog                  Save package to the default catalog
--save-catalog-name=<name>      Save package to the specified catalog
```

```bash
pnpm --filter @yapm/web add -D --save-catalog @vitest/coverage-v8
# → writes "@vitest/coverage-v8": "catalog:" into the package, and the range into pnpm-workspace.yaml
```

Related settings: `catalogMode` (added v10.12.1, default `manual`; `strict`/`prefer`/`manual`) controls
whether plain `pnpm add` routes into the catalog. `cleanupUnusedCatalogs` (v10.15.0, default `false`)
prunes dead entries on install.

### 2.5 pnpm 11 behaviours that will surprise you (both VERIFIED live)

1. **`minimumReleaseAge` now defaults to 1440 minutes (24h) in v11** (0 before v11). Freshly published
   versions are held back. On first install, pnpm auto-appended to `pnpm-workspace.yaml`:

   ```yaml
   minimumReleaseAgeExclude:
     - '@turbo/darwin-arm64@2.10.6'
     - turbo@2.10.6
   ```

   with the message *"Added 7 entries to minimumReleaseAgeExclude in pnpm-workspace.yaml (set
   minimumReleaseAgeStrict to true to gate these updates with a prompt)"*. `minimumReleaseAgeStrict`
   (v11.0.0) defaults to `true` when `minimumReleaseAge` is explicitly configured, else `false`.

2. **Build scripts are opt-in via `allowBuilds`** (v10.26.0), *not* the older `onlyBuiltDependencies`.
   Install failed with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: lefthook@2.1.10` and pnpm
   wrote a placeholder `allowBuilds: { lefthook: "set this to true or false" }` for me to resolve.

3. `packageConfigs` (v11.0.0+) allows per-workspace-package settings:

   ```yaml
   packageConfigs:
     "project-1":
       saveExact: true
   ```
   or pattern form:
   ```yaml
   packageConfigs:
     - match: ["project-1", "project-2"]
       modulesDir: "node_modules"
   ```

Pin the toolchain with `"packageManager": "pnpm@11.16.0"` in the root `package.json`.

---

## 3. Turborepo 2.10

Source: <https://turborepo.dev/docs/reference/configuration> — **note the domain moved from
`turborepo.com` to `turborepo.dev` (301)**, and the schema URL moved with it.

### 3.1 Working `turbo.json` (VERIFIED — `turbo run build typecheck test` = 6/6 tasks green)

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "globalDependencies": ["tsconfig.base.json", "pnpm-lock.yaml"],
  "globalEnv": ["NODE_ENV"],
  "ui": "stream",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["$TURBO_DEFAULT$", "!**/*.test.*"],
      "outputs": ["dist/**"],
      "env": ["VITE_*"]
    },
    "typecheck": { "dependsOn": ["^build"], "outputs": [] },
    "lint": { "outputs": [] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "e2e": { "dependsOn": ["^build"], "cache": false, "outputs": ["playwright-report/**"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

Matching root scripts:

```json
{
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "biome ci .",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  }
}
```

### 3.2 Task option semantics (quoted)

- `tasks` — "Each key in the `tasks` object is the name of a task that can be executed by `turbo run`."
  (In Turborepo 1.x this key was `pipeline`; it is `tasks` in 2.x.)
- `dependsOn` — tasks that must finish first. `^build` = "run `build` in all *dependencies* first";
  a bare name (`"dependsOn": ["lint", "build"]`) means same-package tasks.
- `outputs` — "A list of file glob patterns relative to the package's `package.json` to cache when the
  task is successfully completed." Empty array = nothing to cache but the task is still hashed/cached
  by exit status (correct for `typecheck`/`lint`).
- `inputs` — default is all checked-in files; `$TURBO_DEFAULT$` re-includes that default alongside your
  extra globs.
- `cache` (default `true`) — set `false` for `dev` and `e2e`.
- `persistent` (default `false`) — "Label a task as `persistent` to prevent other tasks from depending
  on long-running processes." Required for `dev`.
- `interactive` (default `false`) — for stdin-reading tasks, e.g. `{"test:watch": {"interactive": true, "persistent": true}}`.
- `env` / `passThroughEnv` — hashed vs. runtime-only env. `env: ["VITE_*"]` wildcards are supported.
- `outputLogs` — `full` | `hash-only` | `new-only` | `errors-only` | `none`.
- `with` — "A list of tasks that will be ran alongside this task", e.g. `{"dev": {"with": ["api#dev"]}}`.
  Useful for `pnpm dev` starting web + server together.

Global: `globalDependencies` ("If any file matching these globs changes, all tasks will miss cache"),
`globalEnv`, `ui` (`"tui"` | `"stream"`, default `"stream"`), `remoteCache` (`{"enabled": false}` to
disable entirely), `daemon` (deprecated, "no longer used for `turbo run`").

Per-package override — `apps/web/turbo.json`:

```json
{ "extends": ["//"] }
```

**Gotcha (observed):** a task declaring `outputs` that produces none logs
`WARNING no output files found for task <pkg>#test`. Either drop `outputs` or actually emit coverage.

---

## 4. Vite 8 (Rolldown)

Sources: <https://vite.dev/blog/announcing-vite8> (2026-03-12), <https://vite.dev/guide/migration>,
<https://vite.dev/config/server-options>, <https://vite.dev/blog/announcing-vite8-1>.

### 4.1 What changed

> "Vite 8 ships with Rolldown as its single, unified, Rust-based bundler, delivering up to 10-30x
> faster builds while maintaining full plugin compatibility. This is the most significant architectural
> change since Vite 2."

From the migration guide: "Vite 8 uses Rolldown and Oxc based tools instead of esbuild and Rollup."
Concretely:

| Concern | Vite 7 | Vite 8 |
|---|---|---|
| Bundling | Rollup | **Rolldown** |
| Dep optimizer | esbuild | **Rolldown** (`optimizeDeps.rolldownOptions`; `esbuildOptions` deprecated shim) |
| JS transform | esbuild | **Oxc** (`oxc` option; `esbuild` option deprecated shim) |
| JS minify | esbuild | **Oxc minifier** (`build.minify: 'esbuild'` still selectable) |
| CSS minify | esbuild | **Lightning CSS** (`build.cssMinify: 'esbuild'` still selectable) |

> "`esbuild` is no longer directly used by Vite and is now an optional dependency."

Renames / removals to know:
- `build.rollupOptions` → **`build.rolldownOptions`** (old name deprecated); `worker.rollupOptions` likewise.
- `build.commonjsOptions` — "it is now no-op".
- `output.manualChunks` object form **removed**, function form deprecated → use Rolldown `codeSplitting`.
- `build.rollupOptions.watch.chokidar` removed → `build.rolldownOptions.watch.watcher`.
- `output.format: 'system'` and `'amd'` unsupported by Rolldown.
- Rollup hooks `shouldTransformCachedModule`, `resolveImportMeta`, `renderDynamicImport`,
  `resolveFileUrl` unsupported. "All parallel hooks in Rollup work as sequential hooks."
- `transformWithEsbuild` deprecated → `transformWithOxc`.
- **Consistent CJS interop.** The `default` import from a CJS module now resolves by fixed rules;
  breakage escape hatch is the deprecated `legacy.inconsistentCjsInterop: true`.
- `build()` (JS API) now throws a `BundleError` wrapping `.errors`.
- Default `build.target` / `'baseline-widely-available'` bumped: Chrome 107→111, Edge 107→111,
  Firefox 104→114, Safari 16.0→16.4.
- Oxc "does not support lowering native decorators" yet — use `@rolldown/plugin-babel` or
  `@rollup/plugin-swc` if you need them.
- `plugin-legacy` cannot transform to ES5 any more.

Vite 8.1 adds experimental bundled dev mode:

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  experimental: {
    bundledDev: true,
  },
})
```

### 4.2 Plugin compatibility flags

- ✅ `@vitejs/plugin-react@6.0.4` — peer `vite: ^8.0.0`. This is the plugin for Vite 8.
- 🚩 `@vitejs/plugin-react-oxc@0.4.3` — peer `vite: ^6.3.0 || ^7.0.0`. **Do not install it with Vite 8.**
  It existed to bring Oxc transforms to Vite 6/7; Vite 8 uses Oxc natively, so `@vitejs/plugin-react`
  is the correct choice.
- ✅ `@tailwindcss/vite@4.3.3` — peer includes `^8`. (Earlier 4.0.x releases capped at `^6`; upgrade
  `@tailwindcss/vite` in lockstep with `tailwindcss`.)
- ✅ `@tanstack/router-plugin@1.168.23` — peer includes `>=8.0.0`.
- ✅ `vitest@4.1.x` — see §7 for the 4.0 vs 4.1 trap.
- Rolldown-specific plugin note: if a `load`/`transform` hook converts non-JS content to JS, you may
  need to return `moduleType: 'js'`.

### 4.3 Working `apps/web/vite.config.ts` (VERIFIED — `vite build` succeeds, 105 modules, 4 chunks)

```ts
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '\\.(test|spec)\\.[tj]sx?$',
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true, rewriteWsOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'baseline-widely-available',
  },
})
```

**Plugin order matters:** TanStack's docs say *"Please make sure that `@tanstack/router-plugin` is
passed before `@vitejs/plugin-react`"*.

**Do not put a `test` key in this file.** Under Vite 8 + Vitest 4 that is a type error:

```
vite.config.ts(29,3): error TS2769: No overload matches this call.
  Object literal may only specify known properties, and 'test' does not exist in type 'UserConfigExport'.
```

Use a separate `vitest.config.ts` (§7).

### 4.4 Dev-server proxy (verbatim from vite.dev/config/server-options)

```js
export default defineConfig({
  server: {
    proxy: {
      // string shorthand:
      // http://localhost:5173/foo
      //   -> http://localhost:4567/foo
      '/foo': 'http://localhost:4567',
      // with options:
      // http://localhost:5173/api/bar
      //   -> http://jsonplaceholder.typicode.com/bar
      '/api': {
        target: 'http://jsonplaceholder.typicode.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // with RegExp:
      '^/fallback/.*': {
        target: 'http://jsonplaceholder.typicode.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/fallback/, ''),
      },
      // Using the proxy instance
      '/api': {
        target: 'http://jsonplaceholder.typicode.com',
        changeOrigin: true,
        configure: (proxy, options) => {
          // proxy will be an instance of 'http-proxy-3'
        },
      },
      // Proxying websockets or socket.io:
      '/socket.io': {
        target: 'ws://localhost:5174',
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
})
```

For a Hono/Node backend on `:3000`, keep the path prefix (no `rewrite`) so `/api/v1/...` reaches the
server unchanged — that is what the verified config above does.

`server.port` default 5173; `server.strictPort: true` "exit if port is already in use, instead of
automatically trying the next available port" — use it so Playwright's `webServer.url` is deterministic.
`server.host: '0.0.0.0' | true` to expose on LAN / inside Docker.

---

## 5. TanStack Router 1.170 (SPA, file-based)

Sources: <https://tanstack.com/router/v1/docs/installation/with-vite>,
`docs/router/routing/routing-concepts.md`, `docs/router/guide/creating-a-router.md`,
`docs/router/routing/file-based-routing.md` (github.com/TanStack/router @ main), and the
`examples/react/quickstart-file-based` example. Note the docs URL scheme is now
`tanstack.com/router/v1/docs/...` and every page has a plain-markdown twin at `<url>.md`.

### 5.1 Install and plugin

```bash
pnpm add @tanstack/react-router
pnpm add -D @tanstack/router-plugin
# optional: pnpm add -D @tanstack/react-router-devtools
```

Docs' `vite.config.ts` (verbatim):

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    // Please make sure that '@tanstack/router-plugin' is passed before '@vitejs/plugin-react'
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    // ...
  ],
})
```

Plugin defaults (verbatim):

```json
{
  "routesDirectory": "./src/routes",
  "generatedRouteTree": "./src/routeTree.gen.ts",
  "routeFileIgnorePrefix": "-",
  "quoteStyle": "single"
}
```

The import is the **named** export `tanstackRouter` from `@tanstack/router-plugin/vite` (older releases
used a default export named `TanStackRouterVite`).

### 5.2 Generated route tree

`src/routeTree.gen.ts` is written by the plugin on dev/build. VERIFIED header:

```ts
/* eslint-disable */
// @ts-nocheck
// noinspection JSUnusedGlobalSymbols
// This file was automatically generated by TanStack Router.
// You should NOT make any changes in this file as it will be overwritten.
// Additionally, you should also exclude this file from your linter and/or formatter ...

import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as IssuesIssueIdRouteImport } from './routes/issues.$issueId'
...
export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/issues/$issueId': typeof IssuesIssueIdRoute
}
```

Practical consequences (all observed):
- **`tsc --noEmit` fails on a clean clone** with `Cannot find module './routeTree.gen'` until the file
  exists. Either commit `routeTree.gen.ts` (what the TanStack examples do) or run `vite build` /
  `tsr generate` (`@tanstack/router-cli`, binary `tsr`) before typecheck in CI. `@tanstack/router-plugin`
  ships **no** binary.
- Exclude it from Biome (`"!**/routeTree.gen.ts"`, §8) — the docs explicitly link to Biome's ignore docs.
- Recommended `.vscode/settings.json` from the docs:
  ```json
  {
    "files.readonlyInclude": { "**/routeTree.gen.ts": true },
    "files.watcherExclude": { "**/routeTree.gen.ts": true },
    "search.exclude": { "**/routeTree.gen.ts": true }
  }
  ```
- **Gotcha (observed):** a `*.test.tsx` inside `src/routes/` triggers
  `Warning: Route file "…/index.test.tsx" does not export a Route.` Either keep tests outside
  `src/routes` or set `routeFileIgnorePattern: '\\.(test|spec)\\.[tj]sx?$'`.

### 5.3 File naming (from `file-based-routing.md`)

| Filename | Route path | Component output |
|---|---|---|
| `__root.tsx` | | `<Root>` |
| `index.tsx` | `/` (exact) | `<Root><RootIndex>` |
| `about.tsx` | `/about` | `<Root><About>` |
| `posts.tsx` | `/posts` | `<Root><Posts>` |
| `posts.index.tsx` | `/posts` (exact) | `<Root><Posts><PostsIndex>` |
| `posts.$postId.tsx` | `/posts/$postId` | `<Root><Posts><Post>` |
| `posts_.$postId.edit.tsx` | `/posts/$postId/edit` | `<Root><EditPost>` (trailing `_` breaks nesting) |
| `_pathlessLayout.tsx` | | `<Root><PathlessLayout>` (leading `_` = pathless layout) |
| `files.$.tsx` | `/files/$` | splat |
| `account/route.tsx` | `/account` | directory layout route |

Directories and `.` separators are interchangeable.

### 5.4 Real code (VERIFIED — builds, typechecks, tests)

`src/routes/__root.tsx`:

```tsx
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => <div>404 Not Found</div>,
})

function RootComponent() {
  return (
    <>
      <nav className="flex gap-2 p-2">
        <Link to="/" activeOptions={{ exact: true }} activeProps={{ className: 'font-bold' }}>
          Home
        </Link>
        <Link to="/issues/$issueId" params={{ issueId: 'abc' }}>
          Issue abc
        </Link>
      </nav>
      <Outlet />
    </>
  )
}
```

The root route "has no path, is **always** matched, and its `component` is **always** rendered".
For a context-carrying root (e.g. a Zero/Query client) use:

```tsx
import { createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

export interface MyRouterContext {
  queryClient: QueryClient
}
export const Route = createRootRouteWithContext<MyRouterContext>()
```

`src/routes/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@yapm/ui/components/button'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="p-4">
      <h1 className="text-brand-500 text-2xl">yapm</h1>
      <Button>Click me</Button>
    </main>
  )
}
```

The string passed to `createFileRoute` is *"automatically written and managed by the router for you via
the TanStack Router Bundler Plugin or Router CLI"* — never hand-edit it.

`src/routes/issues.$issueId.tsx` — dynamic segment + typed params + loader:

```tsx
import { createFileRoute, useParams } from '@tanstack/react-router'

export const Route = createFileRoute('/issues/$issueId')({
  loader: ({ params }) => ({ id: params.issueId }),
  component: IssueDetail,
})

function IssueDetail() {
  const { issueId } = useParams({ from: '/issues/$issueId' })
  const data = Route.useLoaderData()
  return <div>Issue {issueId} / {data.id}</div>
}
```

`src/main.tsx` — router creation + the mandatory type registration:

```tsx
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './routeTree.gen'
import './styles.css'

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('app')
if (rootElement && !rootElement.innerHTML) {
  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}
```

> "DO NOT SKIP THIS SECTION! ⚠️ … you must register your router's types using TypeScript's Declaration
> Merging feature… With your router registered, you'll now get type-safety across your entire project."

Without the `Register` augmentation you get exactly the errors observed pre-generation:
`Argument of type '"/"' is not assignable to parameter of type 'undefined'` and
`Property 'issueId' does not exist on type 'never'`.

### 5.5 What a pure SPA needs — nothing more

Confirmed by building the verification app: `@tanstack/react-router` + `@tanstack/router-plugin` +
`RouterProvider` in `main.tsx` + an `index.html` with a mount node is the complete set. **TanStack Start
is not required and must not be installed** — it is the SSR/full-stack layer. No `ssr.tsx`, no server
entry, no `@tanstack/react-start`. Deploy `dist/` as static files with an SPA fallback rewrite
(all unmatched paths → `/index.html`); `notFoundComponent` on the root route handles unknown routes
client-side.

Requirements from the docs: React ≥18 with `createRoot`, react-dom ≥18, and
*"Using TypeScript (v5.3.x or higher) is recommended… We aim to support the last 5 minor versions of
TypeScript"*. TS 7.0.2 worked in the verification build.

---

## 6. Tailwind CSS 4.3 + shadcn/ui

Sources: <https://tailwindcss.com/docs/installation/using-vite>, <https://tailwindcss.com/docs/theme>,
<https://ui.shadcn.com/docs/monorepo>, <https://ui.shadcn.com/docs/components-json>,
<https://ui.shadcn.com/docs/installation/vite>, plus `shadcn@4.14.0 init --help`.
(shadcn docs are also available as raw markdown at `<url>.md`.)

### 6.1 Tailwind v4 with the Vite plugin

```bash
pnpm add tailwindcss @tailwindcss/vite
```

```ts
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
  ],
})
```

```css
@import "tailwindcss";
```

There is **no `tailwind.config.js`** and no PostCSS config in the v4 CSS-first model.

### 6.2 `@theme` — CSS-first config

> "Theme variables do more than regular CSS variables—they instruct Tailwind to create new utility
> classes… Theme variables must be defined top-level and not nested under other selectors or media
> queries."

```css
@import "tailwindcss";

@theme {
  --color-mint-500: oklch(0.72 0.11 178);
}
```

Namespaces → utilities: `--color-*` (`bg-*`, `text-*`), `--font-*`, `--text-*`, `--font-weight-*`,
`--tracking-*`, `--leading-*`, `--breakpoint-*` (responsive variants), `--container-*`, `--spacing-*`,
`--radius-*`, `--shadow-*`, `--inset-shadow-*`, `--drop-shadow-*`, `--blur-*`, `--perspective-*`,
`--zoom-*`, `--aspect-*`, `--ease-*`, `--animate-*`.

Override / erase defaults:

```css
@theme {
  --color-*: initial;      /* drop an entire namespace */
  --color-midnight: #121063;
}
```

```css
@theme {
  --*: initial;            /* drop the whole default theme */
  --spacing: 4px;
}
```

`@theme inline` when a token references another variable (`--font-sans: var(--font-inter)`), so the
utility bakes in the resolved value.

Shared theme across a monorepo (docs pattern — matches `packages/ui` owning the design system):

```css
/* packages/ui/src/styles/globals.css */
@theme { ... }
```
```css
/* apps/web/src/styles.css */
@import "tailwindcss";
@import "../../../packages/ui/src/styles/globals.css";
```

**VERIFIED end-to-end** `packages/ui/src/styles/globals.css`:

```css
@import 'tailwindcss';
@source '../../../../apps/web/src';

@theme {
  --color-brand-500: oklch(0.62 0.19 259);
  --font-sans: 'Inter Variable', ui-sans-serif, system-ui, sans-serif;
  --radius-card: 0.75rem;
}

@layer base {
  body {
    @apply bg-white text-neutral-900;
  }
}
```

with `apps/web/src/styles.css` being just `@import '@yapm/ui/globals.css';`. After `vite build`,
`dist/assets/*.css` contained `--color-brand-500:oklch(62% .19 259)` and
`.text-brand-500{color:var(--color-brand-500)}` — proving cross-package `@theme` + `@source` works.

**`@source` is required in a monorepo.** Tailwind v4 auto-detects sources relative to the CSS file; when
the CSS lives in `packages/ui` but the classes live in `apps/web/src`, add
`@source '<relative-path-to-app-src>'` (the TanStack example uses the `source()` function form:
`@import 'tailwindcss' source('../');`).

### 6.3 shadcn CLI (v4.14.0)

Verified `shadcn@latest init --help` options:

```
-t, --template <template>  the template to use. (next, start, vite, react-router, laravel, astro)
-b, --base <base>          the component library to use. (base, radix, aria)
--monorepo                 scaffold a monorepo project.
--no-monorepo              skip the monorepo prompt.
-p, --preset [name]        use a preset configuration
-y, --yes                  skip confirmation prompt. (default: true)
-d, --defaults             use default configuration: --template=next --preset=base-nova
-c, --cwd <cwd>            the working directory.
--css-variables / --no-css-variables
--rtl / --no-rtl
--pointer / --no-pointer
--reinstall / --no-reinstall
```

`add`:

```
-y, --yes  -o, --overwrite  -c, --cwd <cwd>  -a, --all  -p, --path <path>
-s, --silent  --dry-run  --diff [path]  --view [path]
```

🚩 **shadcn 4.x defaults to Base UI, not Radix.** `-b, --base` accepts `base | radix | aria` and the
documented default preset is `base-nova`. If the project spec says "Radix primitives", you must pass
`--base radix` at init; it cannot be changed later without reinstalling components.

### 6.4 Monorepo support (this is first-class — verbatim from the docs)

```bash
npx shadcn@latest init --monorepo
```

> "This will create a new monorepo project with two workspaces: `web` and `ui`, and Turborepo as the
> build system."

Then: *"To add components to your project, run the `add` command **in the path of your app**."*

```bash
cd apps/web
npx shadcn@latest add button      # → installs into packages/ui, rewrites imports in apps/web
npx shadcn@latest add login-01    # → button/label/input/card → packages/ui; login-form → apps/web/components
```

From the repo root you can instead scope with `-c`: `npx shadcn@latest add card -c apps/web`.

Generated layout:

```txt
apps
└── web
    ├── app
    ├── components
    ├── components.json
    └── package.json
packages
└── ui
    ├── src
    │   ├── components
    │   ├── hooks
    │   ├── lib
    │   └── styles
    ├── components.json
    └── package.json
package.json
turbo.json
```

Requirements (verbatim): *"Every workspace must have a `components.json` file"*, aliases must be
defined, *"Ensure you have the same `style`, `iconLibrary` and `baseColor` in both `components.json`
files"*, and **"For Tailwind CSS v4, leave the `tailwind` config empty in the `components.json` file."**

`apps/web/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "../../packages/ui/src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "hooks": "@/hooks",
    "lib": "@/lib",
    "utils": "@workspace/ui/lib/utils",
    "ui": "@workspace/ui/components"
  }
}
```

`packages/ui/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@workspace/ui/components",
    "utils": "@workspace/ui/lib/utils",
    "hooks": "@workspace/ui/hooks",
    "lib": "@workspace/ui/lib",
    "ui": "@workspace/ui/components"
  }
}
```

Consumption: `import { Button } from "@workspace/ui/components/button"`, plus
`import { cn } from "@workspace/ui/lib/utils"`.

For a Vite SPA (no RSC) set `"rsc": false` so the CLI stops emitting `"use client"`.
`"style"`, `"tailwind.baseColor"` and `"tailwind.cssVariables"` **cannot be changed after
initialization**. `baseColor` accepts `neutral | stone | zinc | mauve | olive | mist | taupe`.

Alternative alias mechanism (no tsconfig `paths`): `package.json#imports`. shadcn supports it and it
sidesteps the TS7 `baseUrl` problem entirely:

```json
// packages/ui/package.json
{
  "name": "@workspace/ui",
  "private": true,
  "type": "module",
  "imports": {
    "#components/*": "./src/components/*.tsx",
    "#lib/*": "./src/lib/*.ts",
    "#hooks/*": "./src/hooks/*.ts"
  },
  "exports": {
    "./globals.css": "./src/styles/globals.css",
    "./components/*": "./src/components/*.tsx",
    "./lib/*": "./src/lib/*.ts",
    "./hooks/*": "./src/hooks/*.ts"
  }
}
```

> "**Important:** If you're using package imports, enable `resolvePackageJsonImports` and use
> `moduleResolution: "bundler"` in your `tsconfig.json`."

(The verification repo used the `exports`-only variant of this shape for `@yapm/ui` and it worked with
`moduleResolution: "bundler"` under TS 7.)

### 6.5 🚩 shadcn's Vite guide conflicts with TypeScript 7

The "Existing Project" section of <https://ui.shadcn.com/docs/installation/vite> instructs:

```jsonc
// tsconfig.json  ← as printed in the shadcn docs
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

Under TS 7 that is `error TS5102: Option 'baseUrl' has been removed`. **Drop `baseUrl` and keep only
`paths`** (paths are resolved relative to the tsconfig's directory) — or use `package.json#imports`.
Also, that guide assumes the `create vite` multi-file `tsconfig.app.json` / `tsconfig.node.json` split;
a single tsconfig per package (as in §1.8) is simpler and works.

---

## 7. Vitest 4.1 + Playwright 1.61

Sources: <https://vitest.dev/guide/migration>, <https://vitest.dev/guide/projects>,
<https://playwright.dev/docs/test-webserver>, npm registry metadata, plus live runs.

### 7.1 🚩 Vitest ↔ Vite version trap (VERIFIED from registry metadata)

| Vitest | How it relates to Vite |
|---|---|
| `4.0.x` | **`dependencies.vite: "^6.0.0 \|\| ^7.0.0"`** — Vite is a *direct dependency*, no `^8`. Installing it next to Vite 8 duplicates Vite and breaks. |
| `4.1.0+` | Vite moved to `peerDependencies`: `"^6.0.0 \|\| ^7.0.0 \|\| ^8.0.0-0"` |
| `4.1.10` | `peerDependencies.vite: "^6.0.0 \|\| ^7.0.0 \|\| ^8.0.0"` ✅ |

**Vitest ≥ 4.1.0 is required for Vite 8.** Vitest 4 also requires Node ≥ 20.

Migration guide highlights:
- `workspace` → `projects` (the `vitest.workspace.ts` file is gone; move it into `test.projects`).
- Browser mode: `@vitest/browser` is superseded by provider packages —
  `@vitest/browser-playwright`, `@vitest/browser-webdriverio`, `@vitest/browser-preview` — and
  `provider` now takes an object: `provider: playwright({ launchOptions: { slowMo: 100 } })`.
  Context import moved to `import { page } from 'vitest/browser'`.
- Pools rewritten: `maxThreads`/`maxForks` → `maxWorkers`; `singleThread`/`singleFork` →
  `maxWorkers: 1, isolate: false`; `poolOptions` removed (options are top-level);
  `memoryLimit` → `vmMemoryLimit`.
- Coverage: define `coverage.include` explicitly; `ignoreEmptyLines` and
  `experimentalAstAwareRemapping` removed (AST-aware remapping is now default).
- Mocks: default mock name is `vi.fn()` (was `spy`); `mock.invocationCallOrder` starts at `1`;
  `vi.restoreAllMocks` only restores manual spies.
- Removed: `poolMatchGlobs`, `environmentMatchGlobs`, `deps.external`, `deps.inline`,
  `browser.testerScripts`, `minWorkers`.

### 7.2 Per-app Vitest config (VERIFIED — 2 tests pass under jsdom + React 19)

`apps/web/vitest.config.ts`:

```ts
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'web',
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: true,
    },
  }),
)
```

`apps/web/src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

Deps: `vitest jsdom @testing-library/react @testing-library/jest-dom` (+ `@vitest/coverage-v8`).
`@testing-library/react@16.3.2` peers accept React 19.

React component test (VERIFIED, crosses the workspace boundary into `packages/ui`):

```tsx
import { greet } from '@/lib/util'
import { render, screen } from '@testing-library/react'
import { Button } from '@yapm/ui/components/button'
import { expect, test } from 'vitest'

test('renders the shared button', () => {
  render(<Button>Click me</Button>)
  expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
})

test('alias resolves', () => {
  expect(greet('x')).toBe('hi x')
})
```

Because the config `mergeConfig`s the Vite config, `resolve.alias` (`@/*`) and the Tailwind/router
plugins apply to tests too — that is why `@/lib/util` resolves without a second alias table.

### 7.3 Monorepo: one root Vitest run (alternative to per-package `turbo run test`)

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/web',
    ],
  },
})
```

Docs example with an inline project:

```ts
export default defineConfig({
  test: {
    projects: [
      'packages/*',
      '!packages/excluded',
      {
        extends: true,
        test: {
          include: ['tests/**/*.{browser}.test.{ts,js}'],
          name: 'happy-dom',
          environment: 'happy-dom',
        }
      }
    ]
  }
})
```

> "All projects must have unique names; otherwise, Vitest will throw an error."

The verification repo used the per-package approach (`turbo run test` → each package's `vitest run`),
which gives Turborepo per-package caching. Pick one; running both double-executes tests.

### 7.4 Playwright 1.61 config (VERIFIED — `playwright test --list` resolves 1 test)

`apps/web/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      },
})
```

The `E2E_BASE_URL` switch is the key pattern for a docker-compose stack: when the compose stack is
already up, export `E2E_BASE_URL=http://localhost:8080` and Playwright skips `webServer` entirely and
tests the running stack. Locally it boots Vite itself.

Docs' multi-server form, if you want Playwright to own both processes:

```ts
webServer: [
  {
    command: 'npm run start',
    url: 'http://localhost:3000',
    name: 'Frontend',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
  {
    command: 'npm run backend',
    url: 'http://localhost:3333',
    name: 'Backend',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  }
],
```

Test file:

```ts
import { expect, test } from '@playwright/test'

test('home renders', async ({ page }) => {
  await page.goto('/')                       // resolved against use.baseURL
  await expect(page.getByRole('heading', { name: 'yapm' })).toBeVisible()
})
```

CI: `pnpm exec playwright install --with-deps chromium`. Keep the `e2e` turbo task `"cache": false`.
Vite's `server.strictPort: true` (§4.3) prevents port drift breaking `webServer.url`.

---

## 8. Biome 2.5

Sources: <https://biomejs.dev/guides/getting-started/>, <https://biomejs.dev/guides/big-projects/>,
and `node_modules/@biomejs/biome/configuration_schema.json` from `@biomejs/biome@2.5.5`.

Install pinned (the docs stress `-E`: "ensures that the package manager pins the version of Biome"):

```bash
pnpm add -D -E @biomejs/biome
pnpm exec biome init          # writes biome.json
```

Config file may be `biome.json` **or** `biome.jsonc` (comments allowed in the latter).

### 8.1 Working root `biome.json` (VERIFIED — `biome ci .` exits clean over 23 files)

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.5/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "includes": ["**", "!**/dist", "!**/coverage", "!**/routeTree.gen.ts"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "recommended"
    }
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded"
    }
  },
  "css": {
    "parser": {
      "tailwindDirectives": true
    }
  }
}
```

Three findings you will hit otherwise — all reproduced live:

1. 🚩 **`linter.rules.recommended` is deprecated in 2.5.** Biome emits:
   > "The use of the recommended field has been deprecated, and will removed in the next major version
   > of Biome. Use preset instead."

   Schema: `linter.rules.preset` is a string enum `"recommended" | "all" | "none"`.
   Run `biome migrate` to auto-convert.

2. 🚩 **Tailwind v4 CSS fails to parse by default.**
   ```
   packages/ui/src/styles/globals.css:12:6 parse ✖ Tailwind-specific syntax is disabled.
     ℹ Enable `tailwindDirectives` in the css parser options, or remove this if you are not using Tailwind CSS.
   ```
   Fix is `"css": { "parser": { "tailwindDirectives": true } }` — schema description: *"Enables parsing of
   Tailwind CSS 4.0 directives and functions."* Without it, `@apply`/`@theme` files are unformattable.

3. `"vcs": { "useIgnoreFile": true }` **hard-fails if no ignore file exists**:
   `✖ Biome couldn't find an ignore file in the following folder: …`. Make sure `.gitignore` is present
   (it will be, in a real repo).

Also: writing negated globs as `"!**/dist/**` triggers the fixable lint
`lint/suspicious/useBiomeIgnoreFolder` — use the folder form `"!**/dist"`.

### 8.2 Monorepo / nested configs (VERIFIED)

Biome 2.x has real monorepo support: a **root** config plus **nested** configs per package.

`packages/ui/biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.5/schema.json",
  "extends": "//",
  "linter": { "rules": { "suspicious": { "noConsole": "off" } } }
}
```

> "This syntax tells Biome to extend from the **root configuration**, regardless of where the nested
> configuration is." … "For convenience, when you use the microsyntax `extends: \"//\"`, you can **omit**
> `\"root\": false`."

A package that should *not* inherit root settings keeps `"root": false` and omits `extends`.
After adding the nested config, `biome ci .` checked 23 files (up from 22) and stayed green.

### 8.3 Commands

| Purpose | Command |
|---|---|
| Format only | `biome format --write` |
| Lint (+safe fixes) | `biome lint --write` |
| Format + lint + organize imports | `biome check --write` |
| **CI** | `biome ci .` |

`biome ci` is "optimized for CI environments" — it never writes, and exits non-zero on any diff or
diagnostic. Root script: `"lint": "biome ci ."`. One invocation covers the whole monorepo (Biome is fast
enough that a Turborepo `lint` task per package is usually unnecessary; the verified run was 3–24 ms).

---

## 9. lefthook 2.1

Sources: <https://lefthook.dev/configuration/index.html>, and the v2.1.10 docs in
github.com/evilmartians/lefthook (`docs/index.md`, `docs/configuration/{jobs,run,Commands}.md`,
`docs/examples/commitlint.md`).

Config file names accepted: `lefthook.yml`, `lefthook.yaml`, `.lefthook.yml`, `.lefthook.yaml`,
`.config/lefthook.yml`, `.config/lefthook.yaml`; also `.toml`, `.json`, `.jsonc` variants. An extra
`lefthook-local.*` file is merged if present (for per-developer overrides, gitignored).

Install: `pnpm add -D lefthook` then `pnpm exec lefthook install` (installs scripts into `.git/hooks/`).
Under pnpm 11 you must allow its postinstall script:

```yaml
# pnpm-workspace.yaml
allowBuilds:
  lefthook: true
```

### 9.1 Working `lefthook.yml` (VERIFIED — `lefthook validate` → "All good")

```yaml
pre-commit:
  parallel: true
  jobs:
    - name: biome
      run: pnpm exec biome check --write --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}
      glob: '*.{js,jsx,ts,tsx,json,jsonc,css}'
      stage_fixed: true

commit-msg:
  jobs:
    - name: conventional-commit
      run: pnpm exec commitlint --edit {1}
```

`lefthook dump` echoes it back normalised (glob promoted to a list), confirming the parse.

### 9.2 Semantics

- **`jobs:` is the modern form** (added in lefthook 1.10.0) — a list, supporting `run:` commands,
  `script:`, and nested `group:` blocks with `piped`/`parallel` flow. The older map form is still valid:

  ```yaml
  pre-commit:
    commands:
      lint:
        glob: "*.{js,ts,jsx,tsx}"
        run: yarn eslint {staged_files}
  ```

- File templates available in `run` (verbatim):
  > - `{files}` - custom `files` command result.
  > - `{staged_files}` - staged files which you try to commit.
  > - `{push_files}` - files that are committed but not pushed.
  > - `{all_files}` - all files tracked by git.
  > - `{cmd}` - shorthand for the command from `lefthook.yml`.
  > - `{0}` - shorthand for the single space-joint string of git hook arguments.
  > - `{1}` - shorthand for the 1-st git hook argument (and so on for `{2}`, `{3}`, etc.)
  > - `{lefthook_job_name}` - current job/command/script name

  For `commit-msg`, `{1}` is the path to the commit-message file — hence `commitlint --edit {1}`.

- `stage_fixed: true` re-stages files that the command rewrote, so Biome's autofixes land in the commit.
- `glob` filters which staged files reach the job; with no match the job is skipped.
- `--no-errors-on-unmatched` and `--files-ignore-unknown=true` keep Biome quiet when the filtered file
  list ends up empty or contains file types it does not handle.
- `parallel: true` runs sibling jobs concurrently. Do not combine with `stage_fixed` on jobs that touch
  the same files.
- Other useful keys: `skip`, `only`, `tags`, `exclude`, `priority`, `interactive`, `root` (for
  per-package commands), `fail_text`.

Official commitlint pairing (verbatim from `docs/examples/commitlint.md`):

```yml
# lefthook.yml

# Build commit messages
prepare-commit-msg:
  commands:
    commitzen:
      interactive: true
      run: yarn run cz --hook # Or npx cz --hook
      env:
        LEFTHOOK: 0

# Validate commit messages
commit-msg:
  commands:
    "lint commit message":
      run: yarn run commitlint --edit {1}
```

For a DCO `Signed-off-by` requirement, add a second `commit-msg` job, e.g.
`run: grep -qiE '^Signed-off-by: ' {1} || (echo "Missing Signed-off-by (use git commit -s)" && exit 1)`
(`UNVERIFIED` — pattern not executed here).

Debug helpers: `lefthook validate`, `lefthook dump`, `lefthook run pre-commit --all-files`,
and `LEFTHOOK=0 git commit …` to bypass.

---

## 10. Compatibility flags — consolidated

| # | Risk | Detail |
|---|---|---|
| 1 | 🚩 **Vitest 4.0.x ✗ Vite 8** | `vitest@4.0.x` has `dependencies.vite: ^6 \|\| ^7`. Require `vitest >= 4.1.0`. |
| 2 | 🚩 **`@vitejs/plugin-react-oxc` ✗ Vite 8** | peer `vite ^6.3 \|\| ^7`. Use `@vitejs/plugin-react@6` (peer `^8`). |
| 3 | 🚩 **shadcn Vite guide ✗ TS 7** | It tells you to add `baseUrl` → `TS5102: Option 'baseUrl' has been removed`. Use `paths` only, or `package.json#imports`. |
| 4 | 🚩 **TS 7 has no Compiler API** | Breaks typescript-eslint, Volar (Vue/Astro/Svelte/MDX), Angular templates, `vite-plugin-dts`, `ts-morph`, `knip`, `ts-loader`. If an Astro/Starlight docs app is in the repo, it must stay on `typescript@6` (alias `npm:@typescript/typescript6`). |
| 5 | ⚠️ **`types: []` default** | Every package touching `process`/`node:*` needs `@types/node` **and** `"types": ["node", …]`. |
| 6 | ⚠️ **`rootDir` default `./`** | Emitting packages must set `"rootDir": "./src"` or output lands in `dist/src/`. |
| 7 | ⚠️ **`test` key in `vite.config.ts`** | Type error under Vite 8 + Vitest 4. Use `vitest.config.ts` with `defineConfig` from `vitest/config`. |
| 8 | ⚠️ **Biome ✗ Tailwind v4 CSS by default** | Needs `css.parser.tailwindDirectives: true`. |
| 9 | ⚠️ **Biome `rules.recommended` deprecated** | Use `rules.preset: "recommended"`; run `biome migrate`. |
| 10 | ⚠️ **`routeTree.gen.ts` not in a clean clone** | `tsc --noEmit` fails. Commit the file or generate it (`vite build` / `tsr generate` from `@tanstack/router-cli`) before typecheck. |
| 11 | ⚠️ **TanStack route files vs test files** | `*.test.tsx` under `src/routes/` warns; set `routeFileIgnorePattern` or move tests. |
| 12 | ⚠️ **pnpm 11 `minimumReleaseAge: 1440`** | New releases are held 24 h by default; CI may resolve differently from a fresh local install. |
| 13 | ⚠️ **pnpm 11 `allowBuilds`** | Postinstall scripts (lefthook, esbuild, sharp…) are blocked until explicitly allowed. |
| 14 | ⚠️ **Turborepo domain/schema moved** | `turborepo.com` → `turborepo.dev`; use `https://turborepo.dev/schema.json`. |
| 15 | ⚠️ **shadcn base library default** | 4.x defaults to Base UI; pass `--base radix` at init if Radix is required (irreversible afterwards). |
| 16 | ⚠️ **Tailwind v4 `@source` in monorepos** | CSS in `packages/ui` will not scan `apps/web/src` without `@source` / `source()`. |
| 17 | ℹ️ **`preserveConstEnums` survives** | Contrary to common assumption it was *not* removed in TS 7 (verified). `outFile` *was*. |

---

## 11. Source URLs

- TypeScript 7 — <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>
- TypeScript 6 deprecations — <https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/>
- TS Go port changes log — <https://github.com/microsoft/typescript-go/blob/main/CHANGES.md>
- pnpm catalogs — <https://pnpm.io/catalogs>
- pnpm-workspace.yaml — <https://pnpm.io/pnpm-workspace_yaml>
- pnpm settings — <https://pnpm.io/settings>
- pnpm workspaces — <https://pnpm.io/workspaces>
- Turborepo config — <https://turborepo.dev/docs/reference/configuration>
- Vite 8 announcement — <https://vite.dev/blog/announcing-vite8>
- Vite 8.1 announcement — <https://vite.dev/blog/announcing-vite8-1>
- Vite v7→v8 migration — <https://vite.dev/guide/migration>
- Vite server options — <https://vite.dev/config/server-options>
- TanStack Router + Vite — <https://tanstack.com/router/v1/docs/installation/with-vite>
- TanStack routing concepts — <https://tanstack.com/router/v1/docs/routing/routing-concepts>
- TanStack file-based routing — <https://tanstack.com/router/v1/docs/routing/file-based-routing>
- TanStack creating a router — <https://tanstack.com/router/v1/docs/guide/creating-a-router>
- TanStack quickstart example — <https://github.com/TanStack/router/tree/main/examples/react/quickstart-file-based>
- Tailwind + Vite — <https://tailwindcss.com/docs/installation/using-vite>
- Tailwind theme variables — <https://tailwindcss.com/docs/theme>
- shadcn monorepo — <https://ui.shadcn.com/docs/monorepo>
- shadcn components.json — <https://ui.shadcn.com/docs/components-json>
- shadcn Vite install — <https://ui.shadcn.com/docs/installation/vite>
- shadcn CLI — <https://ui.shadcn.com/docs/cli>
- Vitest 4 migration — <https://vitest.dev/guide/migration>
- Vitest projects — <https://vitest.dev/guide/projects>
- Playwright webServer — <https://playwright.dev/docs/test-webserver>
- Biome getting started — <https://biomejs.dev/guides/getting-started/>
- Biome big projects / monorepo — <https://biomejs.dev/guides/big-projects/>
- lefthook configuration — <https://lefthook.dev/configuration/index.html>
- lefthook commitlint example — <https://github.com/evilmartians/lefthook/blob/master/docs/examples/commitlint.md>
