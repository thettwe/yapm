## 1. Dependencies and fonts

- [x] 1.1 Add `cmdk` and the preset font packages (Figtree, IBM Plex Mono, Inter, Fraunces, JetBrains Mono via `@fontsource`/variable packages) to the pnpm catalog and to `packages/ui`; run `pnpm install` and confirm `pnpm turbo build` still passes.

## 2. Token architecture (packages/ui)

- [x] 2.1 Rewrite `packages/ui/src/styles/globals.css` into the two-tier scheme: define the Tailwind `@theme inline` utility layer (`--color-*`, `--font-ui/heading/mono`, `--radius-control/pill/card`, density vars) mapping to a raw per-theme layer; keep the shadcn contract aliases (`--background`, `--foreground`, `--card`, `--popover`, `--muted`, `--border`, `--input`, `--destructive`, `--radius`) pointing at raw tokens. Reclaim `--accent` as the single brand accent; fold the scaffold's neutral-hover meaning into `--bg-hover`/`--muted`; map `--primary` and `--ring` to `--accent`.
- [x] 2.2 Emit the Warm raw-token block for `:root`/`[data-theme="warm"]` (light) and `[data-theme="warm"].dark` (dark), transcribed from `design-explorations/warm/DIRECTION.md` (surfaces, borders, text-1/2/3, accent + strong/hover/active/soft/line, status/signal, `--font-ui`=Figtree/`--font-mono`=IBM Plex Mono, density, radius). App must run in Warm light + dark after this task.
- [x] 2.3 Add the Focused preset blocks (`[data-theme="focused"]` light + `.dark`), transcribed from its DIRECTION.md (Inter, iris accent, 36px rows, hairline borders).
- [x] 2.4 Add the Editorial preset blocks (`[data-theme="editorial"]` light + `.dark`), transcribed from its DIRECTION.md (Fraunces `--font-heading`, JetBrains Mono `--font-mono`, vermilion accent, 42px rows) — tokens only, no serif-masthead chrome.
- [ ] 2.5 Update the six existing scaffold components (`button`, `input`, `label`, `dialog`, `menu`, `select`) to the re-pointed token utilities; `pnpm turbo typecheck lint build test` stays green and `apps/web` renders unchanged in Warm.

## 3. Accent derivation and contrast (packages/ui)

- [x] 3.1 Add `packages/ui/src/lib/color.ts`: a pure `contrastRatio(a, b)` (WCAG 2.x) and `deriveAccent(base)` returning `{accent, hover, active, soft, line, onAccent}` — hover/active via `color-mix(in oklch, …)` (mode-aware), soft/line via transparent mix, and an auto-computed `onAccent` that picks the AA-meeting candidate (higher-contrast when tied or when neither reaches AA). Unit-test dark/light/mid-tone accents and the "never unreadable" guarantee.
- [x] 3.2 Add a preset-contrast unit test asserting every preset's text-on-surface and text-on-accent pairs meet WCAG AA in both light and dark; wire it into `pnpm turbo test` so an AA-failing token edit fails CI.

## 4. Preference entity (packages/schema)

- [x] 4.1 Extend the hand-written `DB` interface (`src/db/types.ts`) with `UserPreferenceTable` (`id`, `user_id` unique, `theme`, `accent` nullable, `created_at`/`updated_at` Generated) and its Selectable/Insertable/Updateable exports.
- [x] 4.2 Write forward-only migration `0003_user_preference` (unique on `user_id`, CHECK `theme in ('warm','focused','editorial')`, no FK to `user`); register it in `migrations/index.ts`. App boots and migrates cleanly.
- [x] 4.3 Add `user_preference` to the Zero schema (`userId from('user_id')`, `theme`, `accent` optional, timestamps `number().from(...)`) with a `user` relationship; export via the schema.
- [x] 4.4 Add `isAuthenticated(ctx)` to `src/zero/context.ts`; add the `preferences.mine` user-scoped synced query (`where('userId', ctx.userID).one()`, `denyAll` when unauthenticated) to `queries.ts`.
- [x] 4.5 Add the `preference.set` shared mutator to `mutators.ts`: authenticated-only, `user_id` set from `ctx.userID`, Zod-validated `theme` and parseable-or-null `accent`, auth-before-existence on update, UUIDv7 minted at the call site; upsert semantics for the single per-user row.
- [x] 4.6 Extend the schema-drift test to cover `user_preference` (Kysely `DB` map + Zero schema); keep it a hard CI failure. Unit-test the query (owner-only/denyAll) and mutator (own-row-only, invalid-accent rejection, client-minted id).

## 5. Bootstrap and theme provider (apps/web)

- [x] 5.1 Add the synchronous inline bootstrap script to `apps/web/index.html`: read `localStorage['yapm:pref']` `{theme, mode, accent + resolved shades}`, set `data-theme`/`.dark` and inline accent override vars on `<html>` before the bundle loads; default to Warm + `prefers-color-scheme` when absent/invalid.
- [x] 5.2 Add a theme provider in `apps/web` that subscribes to `preferences.mine`, applies the synced `{theme, accent}` (recomputing accent shades via `deriveAccent`) to `<html>`, writes back the localStorage cache as source of truth, and exposes optimistic setters that also call `preference.set`. Mode is device-local (localStorage + `prefers-color-scheme`), not synced. Mount it inside `ZeroRoot`.

## 6. Core components (packages/ui)

- [x] 6.1 Add tokenized `badge`, `popover` (Base UI), `avatar` (Base UI), and `tooltip` (Base UI) components; ensure keyboard operation, focus-return, and accent focus indicators.
- [x] 6.2 Add `status-glyph` and `priority-mark` components drawing from status/signal tokens (separate from accent), each with an accessible label.
- [x] 6.3 Add the `command-palette` shell on `cmdk` (input, grouped list, item, empty, keyboard hints) styled to tokens with an accent-highlighted active row; keyboard open/filter/arrow/Enter/Escape; placeholder items only.
- [x] 6.4 Add the `issue-row` primitive styled to the Warm mockup density/layout with reserved reality-strip and divergence-flag slots (quiet placeholders), hover/focus/selected states from accent tokens, keyboard-focusable.

## 7. Showcase

- [x] 7.1 Add Ladle stories for every component (button, input, label, badge, dialog, popover, menu, avatar, tooltip, command palette, status glyphs, priority marks, issue-row) rendering across presets and modes.
- [x] 7.2 Add the theme switcher (preset select + light/dark toggle) and accent picker UI, fully keyboard-operable, wired to the theme provider; place it in the app shell (e.g. user menu) and the showcase.
- [x] 7.3 Add the dev-only `/showcase` route in `apps/web` rendering the full component set plus a representative static issue-list mockup built from the issue-row primitive, with keyboard-operable `data-theme`/mode controls; guard it out of production builds.

## 8. Verification

- [x] 8.1 `pnpm turbo typecheck lint build test` green; boundary guard clean (ZQL/mutators only in `packages/schema`, no package→app imports); drift test run against live Postgres including `user_preference`.
- [ ] 8.2 Add/adjust a Playwright check: no first-paint flash (document root carries `data-theme`/mode before first contentful paint), keyboard-only theme + accent change persists, and the existing workspace-auth e2e still passes (no regression). Prod build contains no `/showcase` route.
