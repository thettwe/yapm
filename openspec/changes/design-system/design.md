## Context

foundation shipped the Zero pipeline; workspace-auth shipped the identity/access graph with server-side row-level permissions (`packages/schema/src/zero/queries.ts` and `mutators.ts`, driven by a verified `ctx = {userID, role}`), a minimal Base-UI-scaffolded component set in `packages/ui` (`button`, `input`, `label`, `dialog`, `menu`, `select`), and `apps/web` wired to Zero through `ZeroRoot` (`apps/web/src/zero/provider.tsx`). The current `packages/ui/src/styles/globals.css` is the raw shadcn/Base-UI (`base-nova`) output: neutral `oklch` tokens, a `:root`/`.dark` split, an `@theme inline` block mapping `--color-*` utilities to bare CSS vars, and `@custom-variant dark (&:is(.dark *))`. Fonts are Geist only.

DESIGN.md chose the **Warm** direction and mandated a **tokenized theme system built from the start**: every component references semantic tokens, themes are token-set swaps via `data-theme`, three presets ship (Warm default, Focused, Editorial) each with first-class light/dark, accent is user-customizable with auto-safe contrast, and the `{theme, accent}` preference is per-user and synced via Zero with a localStorage bootstrap. Each `design-explorations/<preset>/DIRECTION.md` fixes the exact palette hex, type scale, and density metrics; the mockups are the visual target.

Fixed constraints (CLAUDE.md / VISION.md): three containers only (the preference table lives in the existing Postgres); all ZQL and mutators only in `packages/schema`; client-minted UUIDv7 PKs at the call site; kysely 0.28.17, no kysely-codegen, no `baseUrl`; keyboard-first everywhere; sub-100ms interactions; must not regress workspace-auth. The stack (Tailwind v4.3 CSS-first `@theme`, Base UI, TS7, Zero 1.8) postdates training data — `reference/frontend-build.md` §6 and `reference/zero.md` §4–5 are the verified sources used below.

## Goals / Non-Goals

**Goals:**
- A token architecture where no component in `packages/ui` or `apps/web` contains a hardcoded color, font family, radius, or density value — everything resolves through semantic tokens.
- Three presets as pure token sets (Warm default, Focused, Editorial), each light + dark, matching their `DIRECTION.md`, all passing WCAG AA.
- Themes switch via `data-theme`; light/dark is orthogonal via `.dark`; the two axes compose to six combinations.
- Free accent customization with auto-derived shades and an auto-computed, contrast-safe on-accent color the user cannot make unreadable.
- A per-user `{theme, accent}` preference synced via Zero, owner-only, with a no-first-paint-flash localStorage bootstrap.
- A strictly-tokenized core component set incl. the issue-row primitive with reserved reality-strip and divergence-flag slots, plus a themed showcase.
- No new container; no regression to auth/teams/invites/e2e.

**Non-Goals:**
- The full multi-color theme editor (arbitrary per-token colors, contrast-validation UI, theme-JSON import/export) — deferred to a dedicated later change.
- Any issue data/behavior, list keyboard navigation (j/k/x), or real reality/divergence signals — `issue-core` / `github-sync`.
- Per-theme structural chrome from the explorations (Editorial's serif masthead, bespoke rule-fills).
- Syncing light/dark mode; a broader settings surface.

## Decisions

### 1. Token naming scheme — two tiers, semantic names, DIRECTION vocabulary

**Tier 1 — raw palette variables**, set per preset+mode, named `--<category>-<role>` in the flat vocabulary the DIRECTION.md files already use, so a preset block is a near-verbatim transcription of its table:

- Surfaces: `--bg`, `--bg-sidebar`, `--bg-elevated`, `--bg-hover`, `--bg-selected`
- Lines: `--border`, `--border-strong`
- Text: `--text-1` (primary), `--text-2` (secondary), `--text-3` (muted)
- Accent (brand): `--accent`, `--accent-strong` (links/emphasis), `--accent-hover`, `--accent-active`, `--accent-soft` (selected tint), `--accent-line` (selected border), `--on-accent` (auto-computed text-on-accent)
- Status/signal: `--status-backlog`, `--status-todo`, `--status-in-progress`, `--status-in-review`, `--status-done`, `--status-urgent`, `--signal-sync`
- Type families: `--font-ui`, `--font-heading`, `--font-mono`
- Density: `--density-row`, `--density-sidebar`, `--density-topbar`, `--density-group-header`
- Radius: `--radius-control`, `--radius-pill`, `--radius-card` (alongside the existing numeric `--radius` scale)

**Tier 2 — Tailwind theme tokens**, declared once in `@theme inline`, mapping each utility to a Tier-1 var (e.g. `--color-bg: var(--bg)` → `bg-bg`; `--color-accent: var(--accent)` → `bg-accent`/`text-accent`; `--color-on-accent`, `--color-status-in-progress`, `--font-ui`, `--font-mono`, `--radius-control`, `--density-row` via a `--spacing-*`/named var). Components use ONLY Tier-2 utilities. Swapping a preset rewrites Tier-1; Tier-2 and every component are untouched.

*Alternative rejected:* a single flat set of CSS vars consumed directly with `[color:var(--...)]` arbitrary values — loses Tailwind's utility ergonomics and makes "no hardcoded values" unenforceable by lint. Two tiers keep the palette swappable and the components idiomatic.

### 2. Brand accent reclaims `--accent`; the scaffold's neutral hover-surface token is folded away

The shadcn/Base-UI scaffold uses `--accent`/`--accent-foreground` to mean a **neutral hover fill**, but every DIRECTION.md and DESIGN.md use "accent" for the **single committed brand color** (terracotta / iris / vermilion) that carries selection, focus, links, and the primary action. Keeping two conflicting meanings of "accent" guarantees mistakes. **Decision:** the yapm semantic layer defines `--accent` as the brand accent; the scaffold's former neutral-hover meaning moves to `--bg-hover`/`--muted`; `--primary` and `--ring` map to `--accent` (primary buttons and focus rings are brand-colored, per Warm "one accent carries every interactive state"). The generated `globals.css` and the six scaffold components are re-pointed once as an explicit task. The shadcn contract tokens (`--background`, `--foreground`, `--card`, `--popover`, `--muted`, `--border`, `--input`, `--destructive`, `--radius`) are retained as aliases onto Tier-1 so scaffolded/added components keep working with zero per-component special-casing.

### 3. Light/dark composes with `data-theme` orthogonally

`<html>` carries `data-theme ∈ {warm, focused, editorial}` (identity axis) and, independently, the `.dark` class (mode axis). Tier-1 variables are emitted as:

- `:root, :root[data-theme="warm"] { … warm light … }` (Warm is the no-attribute default)
- `:root[data-theme="warm"].dark { … warm dark … }`
- `:root[data-theme="focused"] { … }` / `:root[data-theme="focused"].dark { … }`
- `:root[data-theme="editorial"] { … }` / `:root[data-theme="editorial"].dark { … }`

The existing `@custom-variant dark (&:is(.dark *))` is kept so any residual `dark:` utility still works, but because components read tokens, per-component `dark:` variants are essentially unneeded — dark is a token swap. Result: any preset × either mode = six valid, independently-correct combinations. *Alternative rejected:* encoding mode into `data-theme` (e.g. `warm-dark`) — doubles the attribute space, breaks the "orthogonal" mandate, and defeats `prefers-color-scheme` reacting to the mode axis alone.

### 4. The preference entity: `user_preference`, user-scoped, owner-only, in the existing Postgres

**Placement in the work graph.** `user_preference` is a **user-scoped leaf** hanging off `user` (identity) — deliberately *orthogonal* to the workspace/team membership graph, because a person's theme is personal and independent of any workspace role. It is the first **user-scoped** (as opposed to membership-scoped) synced entity, and a good exercise of the sync permission model's other axis.

**Schema.** `user_preference(id text pk, user_id text not null unique, theme text not null default 'warm' check (theme in ('warm','focused','editorial')), accent text null, created_at timestamptz default now() not null, updated_at timestamptz default now() not null)`. `accent = null` ⇒ the preset's own default accent. `id` is a client-minted UUIDv7; `user_id` is a plain `text` column with no hard FK to better-auth's `user` (same rationale as workspace-auth: boot order means `user` may not exist when our migration runs). Zero schema mirrors it (`userId from('user_id')`, `theme`, `accent` optional, timestamps `number().from(...)`), with a `user` relationship for symmetry.

**Permission story — owner-only, gated on authentication not membership.** Read: a new synced query `preferences.mine = zql.user_preference.where('userId', ctx.userID).one()`, returned only when `ctx` is authenticated (a new `isAuthenticated(ctx) = ctx !== undefined` predicate), `denyAll` otherwise. The `where('userId', ctx.userID)` is driven off the verified `ctx`, never args, so no user can widen it to another user's row and a foreign row's existence is never revealed. Write: a shared `preference.set` mutator authorizes on `ctx` being authenticated, **sets `user_id` from `ctx.userID` (never from args)**, and on update checks the target row's `userId === ctx.userID` before mutating (auth-before-existence). Crucially the gate is **authentication, not membership** (`isMember`), because theming must work for an authenticated non-member sitting on the access gate. This is looser than workspace data on purpose and is safe: the only rows exposed or writable are the caller's own. *Alternative rejected:* storing the preference in `workspace_member` — it would tie a personal setting to a workspace role, break for non-members, and conflate two lifecycles.

### 5. No-flash bootstrap: a tiny inline script + a reconciling provider; mode is device-local

First paint must already carry the right theme, so a **small synchronous inline script** in `apps/web/index.html` (before the stylesheet/app load) reads `localStorage['yapm:pref']` — a cached JSON blob of `{theme, mode, accent, onAccent, accentHover, accentActive, accentSoft, accentLine}` (the *resolved* accent shades, so bootstrap needs no computation) — and sets `document.documentElement.dataset.theme`, toggles `.dark`, and writes the accent override vars as inline styles on `<html>`. Missing/invalid cache ⇒ default `data-theme="warm"` + mode from `prefers-color-scheme`.

A **theme provider** in `apps/web` then: (a) subscribes to the synced `preferences.mine`; (b) when it resolves, treats the synced `{theme, accent}` as source of truth, applies it to `<html>`, recomputes accent shades, and rewrites the localStorage cache; (c) exposes setters that optimistically apply to the DOM + cache and call `preference.set`. **Light/dark mode is device-local** (localStorage + `prefers-color-scheme`), NOT part of the synced entity — matching DESIGN.md's exact `{theme, accent}` sync scope and the reality that mode is often per-device. Last-writer-wins across devices for `{theme, accent}` is acceptable for a cosmetic preference. *Alternative rejected:* a blocking network fetch of the preference before paint — violates the sub-100ms/offline-first posture and reintroduces flash on slow links.

### 6. Accent derivation and guaranteed-safe contrast

The user sets a single base accent color; everything else is derived so it can never be unreadable:

- **Shades (CSS-native where possible):** `--accent-hover = color-mix(in oklch, var(--accent), black 8%)`, `--accent-active = …black 14%` (in dark mode, mix toward white); `--accent-soft = color-mix(in oklch, var(--accent), transparent 88%)` (selected-row tint); `--accent-line = …transparent 66%` (selection border). These are set as inline overrides when a custom accent exists; otherwise the preset's own `--accent*` apply.
- **On-accent text is auto-computed, never user-set.** A pure `packages/ui` utility parses the accent to sRGB, computes WCAG 2.x contrast against two candidates (a near-white token and the darkest text token), and picks the candidate meeting ≥ 4.5:1; if both do, the higher; if neither reaches 4.5:1 (extreme mid-tone), the higher-contrast candidate is chosen so on-accent is always the *most* readable option available. Because the user controls only the base accent and never on-accent, they cannot produce unreadable text.
- **Validation:** `preference.set` validates `accent` with a Zod refine to a parseable hex/oklch color (or null); an unparseable value is rejected by the mutator on both client and server. The color math lives in `packages/ui` (presentational); the schema layer only stores and validates the string.

### 7. Command-palette shell via cmdk; other primitives via Base UI

The command palette is a first-class keyboard surface (VISION #1). **Decision:** build the shell on `cmdk` (add to the catalog) — it provides the filtered-list, keyboard, and a11y semantics that would be error-prone to reimplement — styled entirely through tokens to the Warm palette (640px, 54px input, 40px result rows, accent-highlighted active row). This change ships only the *shell* (input, list, item, empty, group, keyboard hints); `issue-core` wires real commands. Popover, tooltip, and avatar use existing Base UI primitives. *Alternative rejected:* a bespoke palette — reinventing focus/roving-tabindex/filtering for no benefit.

### 8. Fonts inlined as tokenized families

Warm needs Figtree + IBM Plex Mono; Focused needs Inter; Editorial needs Fraunces (serif headings) + JetBrains Mono. **Decision:** add the required `@fontsource`/variable font packages, load them in `globals.css`, and expose them only through `--font-ui` / `--font-heading` / `--font-mono` Tier-1 vars per preset — so switching a preset switches fonts as a token swap. No component names a font family directly.

### 9. Showcase: Ladle stories + a dev-only `/showcase` route

Every component gets a Ladle story (the existing `packages/ui` workbench), and `apps/web` gains a **dev-only** `/showcase` route rendering the full component set plus a representative **static** issue-list mockup (using the issue-row primitive with placeholder data), with controls to switch `data-theme` and `.dark` so all six preset×mode combinations are visually verifiable. The route is guarded to dev builds so it never ships in production. *Alternative rejected:* Ladle only — a live in-app route is the fastest way to judge the real issue-list against the Warm mockup across presets.

## Risks / Trade-offs

- **Re-pointing `--accent` breaks existing components mid-change** → do it as an early, atomic task that updates `globals.css` and all six scaffold components together; `pnpm turbo typecheck lint build test` must stay green after it (tasks are ordered so the app runs after every step).
- **WCAG AA across 3 presets × 2 modes × arbitrary accents** → the six preset palettes are transcribed from DIRECTION.md (already AA-designed) and verified with a contrast test over every text-on-surface pair; custom accents are protected by the auto-computed on-accent (Decision 6). A contrast unit test guards the presets so a future token edit that fails AA fails CI.
- **First-paint flash if the inline script drifts from the provider's cache shape** → the cache shape is defined once and shared; the inline script is intentionally tiny and dependency-free, and a Playwright check asserts `data-theme`/`.dark` are set before first contentful paint.
- **`color-mix`/`oklch` browser support** → both are baseline-widely-available in the Vite 8 target (`baseline-widely-available`); the derived shades are also cached as resolved values so bootstrap never depends on `color-mix` at parse time.
- **Preference gated on authentication, not membership, is looser than other rows** → justified and bounded: the query and mutator are hard-scoped to `ctx.userID`'s own single row, so the wider gate exposes nothing but the caller's own preference; covered by a `denyAll`-for-unauthenticated scenario and an owner-only test.
- **Drift-test surface grows** → add `user_preference` to the Kysely `DB` interface, the Zero schema, and the drift test's expected map, keeping the CI drift guard a hard failure (same pattern as workspace-auth).
- **cmdk + Base UI focus interplay** → the palette is a self-contained overlay; its Ladle story and the `/showcase` route exercise keyboard open/filter/select/escape so regressions surface early.

## Migration Plan

Forward-only Kysely migration `0003_user_preference` adds the single `user_preference` table (unique on `user_id`, CHECK on `theme`), registered in `migrations/index.ts`; it runs at boot after `0002` and before better-auth's `getMigrations()` is irrelevant (no FK to `user`). No data backfill — absence of a row means "defaults," created lazily on first preference write. Rollback within v1 pre-release is a DB reset (`pnpm dev:reset`); no production data exists. The three-container contract is unchanged (the table is in the existing Postgres); no new env vars. UI/token work is additive and reversible per task.

## Open Questions

- (none blocking — the four product decisions the Propose phase was asked to make are decided and logged below.)

## Decisions made during implementation

<!-- Populated during the apply phase per CLAUDE.md's decide-log-continue policy. The
     up-front product decisions the Propose phase was asked to make and log: -->

- **Token naming scheme**: two-tier — raw per-preset `--<category>-<role>` CSS vars (Decision 1) → Tailwind `@theme inline` `--color-*`/`--font-*`/`--radius-*` utilities; brand accent reclaims `--accent`, scaffold's neutral hover-surface folded into `--bg-hover`/`--muted`, `--primary`/`--ring` map to `--accent` (Decision 2).
- **Light/dark × data-theme composition**: orthogonal — `data-theme` selects the preset identity, `.dark` selects the mode; six independent preset×mode token blocks; `prefers-color-scheme` drives the default mode (Decision 3).
- **Preference entity placement + permission**: new user-scoped `user_preference` table in the existing Postgres, owner-only read/write gated on authentication (not membership) via `ctx.userID`, `user_id` set from `ctx` never args; a leaf off `user`, orthogonal to the membership graph (Decision 4).
- **localStorage bootstrap strategy**: a tiny synchronous inline script in `index.html` applies the cached `{theme, mode, accent + resolved shades}` before first paint; a provider reconciles the synced `{theme, accent}` as source of truth and rewrites the cache; mode is device-local, not synced (Decision 5).

### Tokens phase (token layer only; no component work)

- **AA precedence over exact DIRECTION hex on two light accents.** DESIGN.md line 30 makes AA non-negotiable. Two light-mode brand accents host their conventional white on-accent text below AA-normal: warm-light `#C15A38` gives white 4.39:1 and editorial-light `#E5361B` gives 4.31:1 (both < 4.5). Both were deepened minimally, hue-preserving, to reach AA with white: warm `#C15A38 → #BD5837` (4.56:1), editorial `#E5361B → #DE341A` (4.56:1) — a ~2–3% luminance shift, visually indistinguishable. All other DIRECTION hex is transcribed verbatim. `--accent-soft`/`--accent-line` keep the original DIRECTION rgba tints.
- **`--on-accent` is the auto-safe max-contrast candidate per preset/mode** (white for the three light presets, the theme's darkest ink for the three dark presets, whose accents are bright). This yields text-on-accent ≥ 4.5 for all six combinations and matches Decision 6's rule (near-white vs darkest-text, pick the AA-meeting/higher one). A full `deriveAccent()`/on-accent computation for *custom* user accents remains task 3.1 (accent phase); this phase only fixes the six preset `--on-accent` tokens and ships the `contrastRatio` check.
- **Tier-1 raw font vars are named `--type-ui/--type-heading/--type-mono`** (not `--font-*`) to avoid colliding with Tailwind v4's `--font-*` `@theme` namespace; the `@theme inline` layer maps `--font-ui/--font-heading/--font-mono/--font-sans` onto them. Deviates from Decision 1's `--font-*` raw naming for that reason only.
- **Focused `--type-mono` = Inter and Editorial radii are chosen.** Focused's DIRECTION names no monospace (keys use Inter with `tabular-nums`), so its `--font-mono` token resolves to Inter. Editorial's DIRECTION fixes no control radius, so its print-crisp identity uses `--radius: 4px`, card/pill 6px. IBM Plex Mono (Warm) has no variable build; the static `@fontsource/ibm-plex-mono` 400/500 weights are imported.
- **Orthogonal selector scheme supports nested per-panel theming.** Blocks are `:root,[data-theme="warm"]` (warm light + theme-level fonts/density/radius), `[data-theme="focused"|"editorial"]` (their light + fonts/density/radius), then colors-only `.dark,[data-theme="warm"].dark`, `[data-theme="focused"].dark`, `[data-theme="editorial"].dark`. A bare `.dark` resolves to Warm dark (the unset default). The shadcn contract aliases live in one `:root,[data-theme]` rule that re-resolves per themed element, so a nested `<div data-theme=…>` in the showcase themes correctly (not just the document root). The six scaffold components needed no edits: reclaiming `--accent` = brand and mapping `--primary`/`--ring` → `--accent`, `--accent-foreground` → `--on-accent`, `--muted` → `--bg-hover` re-points them through the contract aliases (task 2.5's intent met without component changes, honoring the tokens-only scope).
- **Tooling.** Added `vitest` to `packages/ui` (no prior test runner there) for the preset-contrast test, wired via a `test` script into `pnpm turbo test`. Excluded `design-explorations/` from Biome: its six design-history HTML mockups carry 287 pre-existing a11y lint errors and are explicitly "not part of the build" (already partially ignored in `.gitignore`); the exclusion is unrelated to the token work and keeps `pnpm lint` green.
