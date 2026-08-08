## Context

The mess this change cleans up, verified in the tree at `cc075bd`:

- `apps/web/src/components/app-shell.tsx` is 79 lines: one sticky header
  (`Switcher` · spacer · `ConnectionStatus` · `SearchEntry` · `PmDigestsEntry` · `InboxBadge`
  · `ThemeControls` · `UserMenu`) over a centred `<main>` at `max-w-3xl` (`max-w-[960px]`
  under the `wide` opt-in the Home digest added). There is no sidebar, no tabs and no bottom
  status line anywhere in the app.
- Eleven route files import `AppShell`; nine team-scoped routes do not. `teams.$teamId.
  issues.index`, `teams.$teamId.issues.$issueKey`, `teams.$teamId.delivery`,
  `teams.$teamId.board`, `teams.$teamId.cycles`, `teams.$teamId.triage`,
  `teams.$teamId.projects`, `teams.$teamId.roadmap`, `teams.$teamId.retros.index` and
  `teams.$teamId.retros.$retroId` each hand-roll
  `<header className="sticky top-0 z-10 flex items-center gap-3 border-b …">` with
  `Switcher` + `ViewSwitch` + `ConnectionStatus` + `ThemeControls` + `UserMenu` — and drop
  `SearchEntry`, `PmDigestsEntry` and `InboxBadge` entirely. On the overhaul's own surfaces,
  search, digests and inbox have no doorway.
- `apps/web/src/board/view-switch.tsx` (111 lines) is the de-facto navigation: an 8-item
  pill nav (List, Board, Cycles, Triage, Retros, Delivery, Projects, Roadmap) mounted by
  each peer route with its own `current` string.
- ⌘K is bound by four independent `window.addEventListener('keydown')` handlers —
  `apps/web/src/issues/command.tsx:202`, `apps/web/src/board/board.tsx:330`,
  `apps/web/src/retro/retro-command.tsx:188`, `apps/web/src/routes/showcase.tsx:302`
  (`apps/web/src/search/search-view.tsx:85` and `apps/web/src/retro/retro-view.tsx:544` are
  surface shortcuts, not ⌘K). There is no global palette: on `/`, `/inbox`, `/digests`,
  `/settings/*`, `/teams/$teamId`, `/teams/$teamId/cycles`, `/teams/$teamId/delivery`,
  `/teams/$teamId/projects`, `/teams/$teamId/roadmap` and `/teams/$teamId/members`, ⌘K does
  nothing.

The rulebook is `design-explorations/overhaul-2026-08/northstar/ia.html` §"The frame" and
§"Destinations", and the same frame is drawn identically in `home-digest-2.html`,
`issues.html`, `issue.html` and `delivery.html` — `NORTHSTAR.md` records that the normalized
`<header class="gbar">` markup is md5-identical (`571eee83506c`) across all five modulo the
active-tab class, and that the statusline markup is byte-identical across all five.

Facts the frame needs already exist. `packages/schema/src/zero/team-home.ts` derives, from
already-synced rows: the attention count over four disjoint exception classes
(`buildAttention`, `TeamHomeAttention.count`), the active cycle's `dayIndex`/`dayCount`,
`statusWords.shipped`, and `buildCadence`'s current week (`weeks[todayIndex].deploys`).
Those are exactly the statusline's four segments. Tokens exist too: `--statusline-bg`,
`--row-hairline`, `--urgent-soft` and `--status-urgent-ink` are defined in all six theme
blocks of `packages/ui/src/styles/globals.css` (PR #31), and the drawn vocabulary — track,
arcs, ticks, `Peek`, `How`, `ProvenanceMark` — is in `packages/ui/src/components/` (PR #32).

## Goals / Non-Goals

**Goals:**

- One frame component renders bands 1 and 3 on every authenticated route, pixel-faithful to
  `ia.html`'s deck (48px) and statusline (32px).
- Exactly one derivation of the attention number, structurally impossible to fork.
- Every hand-rolled header deleted; every page's controls preserved through a shared
  masthead with slots.
- One global owner of ⌘K; per-surface commands registered, not re-bound.
- Every route reachable from the frame, proven by test.
- Fully keyboard-operable frame; nothing in it waits on the network.

**Non-Goals:**

- Restyling page bodies. Only the header band changes owner on the nine migrated routes.
- New entities, queries, mutators or migrations.
- Decisions (`g d`) and the Gallery lens — no entity exists for either.
- A sidebar. `daylight/SIDEBAR-spine.md` and `SIDEBAR-signals.md` were explorations; the
  northstar frame is three horizontal bands.

## Decisions

### D1 — The frame owns bands 1 and 3; the page owns band 2

`AppShell` is rewritten as `AppFrame` (`apps/web/src/frame/app-frame.tsx`) and every
authenticated route renders through it. It emits, in document order: `<header>` (the deck),
`<main>` (the page's children — band 2 and the work surface), `<footer>` (the statusline).
The statusline is `margin-top:auto` in a `min-h-svh` flex column, exactly as the mocks do
it, so it sits at the bottom of short pages and after the content on long ones.

`AppShell` is kept as a thin named re-export for one commit only, then deleted; the eleven
current importers move in the same pass. **Alternative rejected**: keeping `AppShell` for
workspace routes and adding a second `TeamFrame` for team routes — two shells is exactly
the duplication this change exists to delete, and the deck is by rule identical on every
page.

The `wide` prop the Home digest added survives as a `measure` prop on the frame
(`'default' | 'wide' | 'full'`); the nine migrated routes are `full` (they already render
edge-to-edge work surfaces), Home is `wide`, the rest `default`.

### D2 — One attention number, guaranteed by construction, not by convention

`buildTeamHome` is refactored so its first act is to call a new exported
`buildTeamFrame(input, now): TeamFrameModel`, and it then builds the digest's bands *on top
of that result* — `attention` in `TeamHomeModel` is the identical object reference
`TeamFrameModel` carries. The frame renders `TeamFrameModel`; Home renders `TeamHomeModel`.
There is one `buildAttention` call site in the codebase, and the digest cannot disagree with
the deck because it does not compute the number.

```
TeamFrameModel = {
  teamId, teamName, teamKey,
  attention: TeamHomeAttention | null,          // the same four-class derivation
  cycle: { title, dayIndex, dayCount } | null,  // from the active cycle, or null
  shipped: number | null,                       // in-cycle done count, null without a cycle
  deploysThisWeek: number | null,               // buildCadence's weeks[todayIndex].deploys
}
```

`TeamFrameModel` needs five of Home's seven queries (`teams`, `cycles`, `issues`, `triage`,
`deployments`) — not `retros`, `notifications` or `digest`. Zero de-duplicates
subscriptions, so on `/teams/$teamId` the frame and the digest share them; on the other team
routes the frame adds `cycles`, `triage` and `deployments` to what the page already syncs.
All five are already-synced team-scoped queries; nothing new is fetched and no interaction
waits on the network.

**Alternative rejected**: the frame calling `buildTeamHome` and projecting. That builds
SINCE YESTERDAY, YOURS, RUNWAY, cadence and shipped rows on every page for four numbers.
**Alternative rejected**: a second, cheaper attention computation in the frame. That is
precisely the rot this change is written to prevent.

The frame's `now` ticks at minute granularity via the existing `useMinuteNow` pattern, and
the model is memoized on `[input, now]` — the same discipline `team-home.tsx` already uses.

### D3 — Honest degradation where there is no team (the one genuinely new IA decision)

The northstar assumes "Acme / Engineering". yapm is one workspace → many teams, and six
routes are workspace-level (`/`, `/inbox`, `/search`, `/digests`, `/settings/{ai,connectors,
sso}`). The resolution, in three cases:

| Case | Deck | Statusline |
|---|---|---|
| A team is in context (`/teams/$teamId/*`) | Full: switcher shows `Workspace / Team`, six stops point at that team, active stop marked | The team's day: `Cycle N, day X of Y · N shipped · N deploys this week · N need attention`, segments folding individually when their fact is absent; sync state right |
| No team in context, workspace has ≥1 team | Full, but **no stop is active**: switcher shows `Workspace`, six stops point at the *anchor team* (last visited, else the first team by the existing `queries.teams.all()` order) | Workspace name only, sync state right. **No cycle, no counts** — including no attention badge |
| Workspace has no teams at all | Switcher + right cluster only; the six stops are **absent** (not disabled, not greyed) | Sync state right only |

The anchor team is remembered in `localStorage` under `yapm.frame.team`, following
`apps/web/src/theme/theme.ts`'s guarded read/write shape, and is validated against the
synced team list on every read — a remembered team the caller has lost access to falls back
to the first team rather than producing six links that 404.

The rule this encodes: **the deck may point at a team; the statusline may only report one.**
Navigation is an offer and can be wrong without lying. A statusline fact is an assertion
about the reader's team, so off-team it says nothing rather than something plausible. That
is also why the attention badge is absent (not `0`) both at zero and off-team: a `0` badge
is a claim that four exception classes were evaluated.

### D4 — The statusline subsumes the connection pill

`ConnectionStatus` is deleted as a header pill; the statusline's right cluster renders the
same `ConnectionSummary` — the dot, `connection.label`, `role="status" aria-live="polite"`,
the `sr-only` detail and the `RetryButton` with its `fallbackRef`, all preserved. The sync
segment keeps `data-testid="connection-status"` and its `data-connection` / `data-recovery`
attributes, because fifteen Playwright specs use it as *the* "the app is live" signal and it
is still exactly that — the same state, in its new and only home. This is a relocation, not
a weakening: `local-first-sync`'s requirement that the recovering state be visible on every
authenticated surface is now *more* true, since band 3 is on every page and the old pill was
on ten. `reconnect.spec.ts`'s assertions on the retry control and the live region are
re-pointed at the statusline, unchanged in strength.

**Alternative rejected**: keeping the pill in the deck's right cluster *and* the statusline
segment. `ia.html` draws sync once, right-aligned in band 3; two indicators is the same
class of bug as two attention numbers.

### D5 — Six stops, and where the eighth pill went

`ViewSwitch` is deleted. Its eight items are redistributed:

| Was a pill | Becomes |
|---|---|
| List | The **Issues** bar stop (`/teams/$teamId/issues`) |
| Board | A **lens in the Issues masthead** (`List | Board`), per `issues.html` |
| Cycles | The **Cycles** bar stop |
| Triage | The **Triage** bar stop |
| Delivery | The **Delivery** bar stop |
| Retros | `more▾` → Retros, `g r` |
| Projects | `more▾` → Projects, `g p` |
| Roadmap | `more▾` → Roadmap, `g m` |

Home (`/teams/$teamId`) was never in `ViewSwitch` and becomes the first stop. The active
stop is accent text plus a 2px accent underline (`--accent`, `--accent-strong`); the deck's
`<nav aria-label="Destinations">` marks it with `aria-current="page"` — the same
"navigation links, not an ARIA tab widget" reading `view-switch.tsx` already documents.

Board's lens toggle lives in the Issues masthead on both `/teams/$teamId/issues` and
`/teams/$teamId/board`, so both routes highlight the **Issues** stop. `issues.html` draws a
third lens, Gallery; it folds away — no entity backs it.

`more▾` is a transient: a Base UI `Menu` (the `Switcher` precedent — arrow keys, Escape,
focus return for free), trigger in the tab order, items carrying their `g`-prefix kbd hints.
Decisions (`g d`) is drawn in the mock's open menu but has no entity, so it does not render
at all — a disabled row would be chrome making a promise the product cannot keep.

### D6 — One global ⌘K owner; surfaces register

A `CommandRegistryProvider` mounts in `routes/__root.tsx`, above the frame. It owns the one
`window.addEventListener('keydown')` for ⌘K/Ctrl-K and the one open/close state. Surfaces
call `useCommandSource(id, source)` — an effect that registers a command *source* (a
factory returning that surface's groups and its context target) on mount and unregisters on
unmount. The palette renders the union of the registered sources plus the frame's own
always-present group (the six destinations, Inbox, Search everything, theme).

Concretely: `issues/command.tsx`, `board/board.tsx`, `retro/retro-command.tsx` and
`routes/showcase.tsx` lose their `keydown` effects and register instead. Their imperative
APIs (`openStatus`, `openAssign`, `openLabel`, `openProject`, `openCreate`,
`setContextIssues`) survive unchanged — those are the surfaces' own affordances, not the
global binding. Non-⌘K surface shortcuts (`search-view.tsx:85`, `retro-view.tsx:544`, the
board's `j/k`, the inbox's `j/k`) are untouched.

The frame additionally owns the `g`-prefix go-to grammar (`g h/i/t/c/d/r/p/m`), suppressed
while a text input, `contenteditable` or an open dialog has focus — the same guard the
existing surface shortcut handlers already apply.

**Alternative rejected**: a global listener that dispatches a custom event each surface
listens for. That keeps four listeners and adds a protocol; registration makes the union of
commands inspectable from one place, which is what makes "every command reachable today
stays reachable" testable.

### D7 — The masthead contract

`Masthead` (`apps/web/src/frame/masthead.tsx`) takes: `title`, optional `count`, optional
`lens` slot, optional `meta` slot (filters, sub-line, window pickers), optional `actions`
slot. It renders `ia.html`'s band 2 anatomy — title + mono count left, lens toggle beside
it, meta below or right, actions right — and nothing else. Every migrated page fills it with
the controls it has today:

| Route | title / count | lens | meta | actions |
|---|---|---|---|---|
| `issues.index` | Issues / issue count | List \| Board | the existing filter bar | the existing new-issue / view controls |
| `board` | Issues / issue count | List \| **Board** | board's group control | board's actions |
| `issues.$issueKey` | issue key + title | — | the existing status/cycle/label line | Follow / status actions |
| `delivery` | Delivery | — | the existing window picker + `Cycle N` | — |
| `cycles` / `triage` / `projects` / `roadmap` / `retros.*` | that page's noun + count | — | that page's existing controls | that page's existing actions |
| `teams.$teamId` (Home) | **opts out** | — | — | — |

Home opts out because in `home-digest-2.html` the hero *is* band 2 — the page owns the band,
and owning it includes declining to draw a masthead. The rule is not "every page renders a
`Masthead`"; it is **no page hand-rolls chrome**, enforced by a repo guard (task 6.4) that
fails on a `sticky top-0` header outside `apps/web/src/frame/`.

Word diet: masthead content is labels only. The one binding-rule sentence
("team-level only — never a per-person number") stays on Delivery's masthead sub-line, where
`delivery.html` puts it, once per app.

### D8 — Route inventory: every route's honest home

| Route | Home in the frame |
|---|---|
| `/teams/$teamId` | Bar stop **Home** (`g h`) |
| `/teams/$teamId/issues` | Bar stop **Issues** (`g i`) |
| `/teams/$teamId/issues/$issueKey` | Doorway from an Issues row; Issues stop stays current |
| `/teams/$teamId/board` | **Board lens** in the Issues masthead; Issues stop stays current |
| `/teams/$teamId/triage` | Bar stop **Triage** (`g t`) |
| `/teams/$teamId/cycles` | Bar stop **Cycles** (`g c`) |
| `/teams/$teamId/delivery` | Bar stop **Delivery** (`g d`) |
| `/teams/$teamId/retros` | `more▾` → Retros (`g r`) |
| `/teams/$teamId/retros/$retroId` | Doorway from the Retros list |
| `/teams/$teamId/projects` | `more▾` → Projects (`g p`) |
| `/teams/$teamId/roadmap` | `more▾` → Roadmap (`g m`) |
| `/teams/$teamId/members` | Workspace/team switcher, under the current team |
| `/` (workspace) | Workspace/team switcher, top entry |
| `/inbox` | Deck right cluster — **Inbox** + unread count |
| `/search` | Deck right cluster — the ⌘K pill is a `Link` to `/search`; ⌘K itself opens the palette |
| `/digests` | User menu, conditional — the `PmDigestsEntry` audience+content gate is preserved verbatim, so an unnamed reader still constructs no query |
| `/settings/ai`, `/settings/connectors`, `/settings/sso` | User menu |
| `/showcase` | User menu, dev-only (unchanged visibility rules) |
| `/login`, `/invite` | Unauthenticated — no frame, as today |

The ⌘K pill being a real `<Link to="/search">` preserves `app-shell.tsx`'s existing
reasoning verbatim: it is in the tab order, so `/search` is reachable with no pointer and
without a second keybinding, while ⌘K remains the one global shortcut. Theme controls move
into the user menu (they are settings, not destinations) and stay keyboard-reachable there.

A `routes.test.tsx` case asserts the inventory: every path in `routeTree.gen` is either
listed as unauthenticated or is reachable from the frame's rendered link set.

### D9 — Deferred, folded, and why

Decisions (`g d` in the mock's menu) and the Gallery lens fold away entirely — no entity
backs either, and `ia.html`'s own rule is that a doorway leads somewhere. They are not
shipped disabled. Note the `g d` collision: with Decisions folded, `g d` is Delivery's, as
`ia.html`'s bar order implies.

## Risks / Trade-offs

- **The frame builds a model on every page** → It is five already-synced Zero queries and a
  pure fold, memoized per minute, over rows the page mostly holds already. Sub-100ms is
  measured on interaction, and no interaction in the frame waits on anything. If a large
  team makes the fold visible in practice, the mitigation is memoizing `buildTeamFrame` by
  `teamId` at the provider — not a second, cheaper attention number.
- **Fifteen e2e specs wait on `connection-status`** → The testid moves with the indicator
  rather than being dropped, so those specs keep asserting the same fact about the same
  state. `retro-ai.spec.ts:104`'s `navigation { name: 'Issue views' }` assertion has no
  equivalent — it is re-pointed at `navigation { name: 'Destinations' }` with
  `aria-current` on the expected stop, which is a stronger assertion than the pill nav
  supported.
- **The deck must fit six stops plus four right-cluster items at 1280px** → the mocks are
  drawn at 1440. Below the deck's comfortable width the six stops collapse into the `more▾`
  menu from the right (Delivery first), never wrapping the band to a second row; the band's
  48px height is a rule.
- **A remembered anchor team can go stale** → validated against the synced team list on
  every read; an unknown id falls back to the first team, and an empty list drops the stops.
- **`aria-current` on Issues while Board is open** → deliberate: Board is a lens, not a
  destination. The masthead's lens toggle carries `aria-pressed` so a screen-reader user can
  tell which lens is active without the bar claiming two current pages.
- **Word diet regressions are invisible to CI** → the chrome-is-labels rule is enforced by
  review, not by test. Named in `humanJudgement`.

## Migration Plan

Pure front-end; no schema, no data, no deploy step. Rollback is `git revert` of the branch.
Order matters only within the build: `buildTeamFrame` and the frame components must exist
before the nine hand-rolled routes can be migrated onto them.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **No new tables, no new named queries, no mutators, no migration.** This is chrome over
  facts that already sync.
- **Decisions (`g d`) and the Gallery lens are deferred** — no entity exists for either.
  They fold away; they do not ship disabled.
- **Word diet, enforced:** chrome (bands 1 and 3, mastheads, nav) is labels only, never
  sentences. The binding rule "team-level only — never a per-person number" belongs on
  Delivery, once per app, not in the frame.
- **Keyboard-first is non-negotiable:** the deck is fully operable without a pointer, the
  `g`-prefixed go-to shortcuts work, and `more▾` is focus-reachable and escapable.
- **Sub-100ms:** everything renders from already-synced Zero rows; no interaction newly waits
  on the network.
- **Accessibility:** a nav landmark with truthful current-page semantics, an accessible
  label on the attention badge, and theme contrast held in every theme block —
  `packages/ui/src/styles/contrast.test.ts` extends to the frame's pairs.
- **The one genuinely new IA decision is D3** — the deck may point at a team, the statusline
  may only report one.

### Stage 1 — the derivation and the frame (built)

**The mess, confirmed in the tree at `cc075bd`.** Every claim in §Context held: `app-shell.tsx`
was 79 lines; ten team-scoped routes hand-rolled
`<header className="sticky top-0 z-10 …">` with `Switcher` + `ViewSwitch` + `ConnectionStatus` +
`ThemeControls` + `UserMenu` and dropped `SearchEntry`, `PmDigestsEntry` and `InboxBadge`;
`view-switch.tsx` was 111 lines of eight pills; and ⌘K was bound by four independent
`window.addEventListener('keydown')` handlers (`issues/command.tsx:202`, `board/board.tsx:330`,
`retro/retro-command.tsx:188`, `routes/showcase.tsx:302`). All of it is deleted.

**DI-1 — `buildTeamFrame` shares intermediates, not just a call.** `buildTeamHome` and
`buildTeamFrame` both call one internal `buildTeamFrameCore`, which walks the issues once, calls
`buildAttention` once and selects the active cycle once. `TeamHomeModel.attention` IS
`TeamFrameModel.attention` inside one build; across two calls the test asserts deep equality of
every class, not just the total. A source-level case asserts exactly two `buildAttention`
occurrences in the repo (the definition and the one call site), so a second derivation cannot be
added without turning CI red. `TeamHomeInput` now `extends TeamFrameInput`, whose `retros` is
optional — the frame never draws the cadence chart's retro ticks.

**DI-2 — the deck's active stop is `--text-1`, not accent ink.** `ia.html` draws the active stop as
accent text plus a 2px accent underline. `--accent-strong` on `--bg` measures **4.44** in editorial
light — under AA. The underline stays the accent's (a non-text indicator, 3:1 under WCAG 1.4.11);
the ink is `--text-1` at semibold. This follows the precedent already recorded in
`packages/ui/src/styles/contrast.test.ts` for the mention typeahead: a marker a screen reader
announces but a sighted reader has to squint at is the same bug twice. Asserted in all six themes.

**DI-3 — TanStack's own `aria-current` cannot be overridden, so `Home` is `exact`.** `Link` appends
`{'aria-current': 'page'}` LAST when it considers itself active, after any explicit prop. Since
`/teams/$teamId` is a prefix of every other stop, the Home stop would have claimed a second current
page on every team route. It carries `activeOptions={{ exact: true }}`; every other stop's natural
prefix match is exactly the frame's own rule (Issues stays current on an issue detail, Retros on a
retro). Board is the case the router cannot express, and the explicit `aria-current` covers it
because the router does not consider the Issues link active on `/board`.

**DI-4 — one ⌘K owner, with delegation rather than one palette instance.** The registry owns the
single `window` listener and a single open/close state. A surface registers either `open` (its own
palette's opener) or `groups` (rows the registry's palette renders). ⌘K delegates to the
most-recently-mounted `open`, and falls back to the registry's own palette — the six destinations,
Inbox, search everything, the workspace overview — when none is registered. Merging the four
existing palettes into one instance would have been a redesign of palette contents, which this
change explicitly is not: `issues/command.tsx` alone carries five sub-pages, its own cursor and its
own server-search seam. Every command reachable before is reachable after, and every imperative API
(`openStatus`/`openAssign`/`openLabel`/`openProject`/`openCreate`/`setContextIssues`) is untouched.

**DI-5 — Appearance is a dialog, not a popover.** `ThemeControls` folded into the account menu per
§D8, and a Base UI menu cannot host a popover without the two fighting over dismissal. The fields
moved verbatim into `frame/appearance-dialog.tsx` behind a menu item, mounted only when opened so
the account menu does not require a `ThemeProvider` to render. `theme.spec.ts` and `triage.spec.ts`
open it through the menu; `data-testid="email-notifications"` and every field label survive.

**DI-6 — the responsive fold is CSS, not measurement.** Stops carry `hidden sm:flex` / `md:flex` /
`lg:flex` and `more▾` carries mirrored `sm:hidden` / `md:hidden` duplicates, so below the deck's
comfortable width the stops fold from the right — Delivery first, then Cycles, then Triage — with no
`ResizeObserver` and no layout thrash. The band never wraps; its 48px is a rule.

**DI-7 — the repo guard is narrowed to `<header>`.** Task 6.4's guard fires on a
`sticky top-0` **`<header>`** outside `apps/web/src/frame/`, not on any sticky element: the inbox's
sticky group headings and the roadmap's sticky month ruler are a surface's own furniture, not
chrome. `/showcase` is exempt by name — a dev-only component gallery that deliberately sits outside
the frame, since the app's chrome would fight the three theme blocks it renders.

**DI-8 — the Masthead migration is partial by design at this stage.** Every hand-rolled *chrome*
header is gone, and `Masthead` ships and is adopted where a route previously had only chrome
(`board`, `issues/$issueKey`) plus the Issues toolbar, which now renders through it and carries the
`List | Board` lens. The other pages' existing in-page headers are band 2 already and are page-owned;
the three page rebuilds that follow restyle their own mastheads onto the component. The rule
enforced now is the one that matters: **no page hand-rolls chrome**, by guard.

**DI-9 — `/showcase` is a plain anchor in the account menu.** The showcase route is stripped from
production builds (`routeFileIgnorePattern`), so a typed `<Link to="/showcase">` would point at a
destination the production router does not have. It renders behind `import.meta.env.DEV` as an
`<a href>`.
