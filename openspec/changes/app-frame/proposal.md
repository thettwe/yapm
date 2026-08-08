## Why

Every page in yapm currently draws its own chrome. `AppShell` (79 lines: one sticky header,
a centred `<main>`, no tabs, no statusline) is used by ~10 routes; the nine team-scoped
routes being overhauled — issues list, issue detail, delivery, board, cycles, triage,
projects, roadmap, retros — each hand-roll a copy-pasted duplicate of that header and
silently drop `SearchEntry`, `PmDigestsEntry` and `InboxBadge`. So on exactly the surfaces
the overhaul is about, the search, digests and inbox doorways are invisible. Navigation is
`ViewSwitch`, an 8-item pill nav mounted separately by every peer route with its own
`current`. ⌘K is bound by four independent `window.addEventListener('keydown')` handlers
and does nothing on most pages.

`design-explorations/overhaul-2026-08/northstar/ia.html` settles this: three bands, six
destinations, one attention number. All five northstar mocks draw that frame identically
(the normalized `<header class="gbar">` markup is md5-identical across them modulo the
active-tab class). PR #31 shipped the Home digest and PR #32 unified the drawn vocabulary;
the chrome is the remaining gap, and the three page rebuilds that follow — issues list,
issue detail, delivery — all need this frame's masthead contract to fill.

This serves VISION's keyboard-first and sub-100ms principles (every stop reachable without
a pointer, everything rendered from already-synced rows) and its honesty principle: the
frame states team facts only where a team is in context, and never fabricates one.

## What Changes

- **New three-band frame, applied to every authenticated route.** Band 1 the deck (48px,
  identical on every page): workspace mark · org `/` team · chevron switcher, then the six
  stops Home · Issues · Triage · Cycles · Delivery · more▾, then the ⌘K pill, the attention
  badge, Inbox + count, the user chip. Band 2 the masthead, owned and adapted by the page.
  Band 3 the statusline (32px): the team's day in one line, sync state right-aligned.
- **One attention number, app-wide.** The deck badge, the statusline segment and Home's
  NEEDS ATTENTION count all render the value produced by the *existing* four-class
  derivation in `packages/schema/src/zero/team-home.ts`. No second computation. At zero the
  badge and the statusline segment are absent, not zeroed.
- **The statusline subsumes the connection pill.** `ConnectionStatus` stops being a separate
  header pill; its state, its polite live region and its retry control move into band 3's
  right-hand sync segment. The two never ship together.
- **The masthead contract.** A shared masthead (title + count, a lens-toggle slot, a
  filter/meta slot, an actions slot) replaces every hand-rolled page header. **No page may
  hand-roll chrome after this change.** Each page keeps its present controls working; the
  three page rebuilds that follow will restyle their own mastheads.
- **`ViewSwitch` is retired.** Its eight items are redistributed honestly: five become bar
  stops, three (Retros `g r`, Projects `g p`, Roadmap `g m`) move into `more▾`, and Board
  becomes a lens in the Issues masthead per `issues.html`.
- **One global ⌘K owner.** A single palette owner holds the one global keybinding; the
  per-surface palettes (issues, board, retro, showcase) *register* their commands with it
  instead of each binding its own window listener. Every command reachable today stays
  reachable; the existing per-surface shortcuts keep working. **BREAKING** for nothing
  user-visible — it is a registration refactor, not a redesign of palette contents.
- **Honest degradation off-team.** The deck is present and useful on the workspace-level
  routes (`/`, `/inbox`, `/search`, `/digests`, `/settings/*`), pointing its six stops at a
  remembered or first team. Where no team is in context the statusline says only what is
  true — no invented cycle, no invented counts.
- **`more▾` is a transient, never a destination**, drawn with kbd hints and focus-reachable.
  Decisions (`g d`) appears in the mock but has no entity: it folds away entirely rather
  than shipping as a dead or disabled link.
- **No route is lost.** Every existing route gets an honest home — bar stop, `more▾`, the
  workspace/team switcher, the user menu, or a doorway from a page — asserted by a test.

## Non-goals

- No new tables, no new named queries, no mutators, no migration. This is chrome over facts
  that already sync.
- Not restyling the page bodies. The issues list, issue detail and delivery surfaces keep
  their current content; only their header band changes owner. Their rebuilds are the three
  changes that follow.
- Not shipping Decisions or the Gallery lens — no entity exists for either.
- Not redesigning what the command palette offers, only who owns its keybinding.
- No sidebar. The northstar frame is three horizontal bands; the sidebar explorations
  (`daylight/SIDEBAR-*.md`) were not selected.

## Capabilities

### New Capabilities

- `app-frame`: the three-band application frame — the deck's six destinations and their
  keyboard grammar, the statusline, the masthead contract every page fills, the one
  attention number shared across bands, honest degradation where no team is in context, and
  the guarantee that no route is unreachable from the frame.

### Modified Capabilities

- `command-palette`: one global owner of the ⌘K binding, with per-surface command sets
  registered into it rather than each surface binding its own listener.
- `team-home`: the one-attention-number requirement widens from "everywhere on the page" to
  "everywhere in the app" — the same derivation feeds the deck badge and the statusline.
- `local-first-sync`: the connection indicator's home is band 3 of the frame; the
  reconnecting state, its live region and its retry control are visible there on every
  authenticated surface instead of in a separate header pill.
- `notifications`: the unread badge's home is the deck's right cluster, present on every
  authenticated surface rather than only the ~10 shell routes.

## Impact

- **Code**: new `apps/web/src/frame/*` (deck, statusline, masthead, more menu, go-to
  shortcuts, team context); `apps/web/src/components/app-shell.tsx` rewritten as the frame's
  entry point; `apps/web/src/board/view-switch.tsx` deleted; `apps/web/src/components/
  connection-status.tsx` folded into the statusline; every file under
  `apps/web/src/routes/` migrated; `apps/web/src/issues/command.tsx`,
  `apps/web/src/board/board.tsx`, `apps/web/src/retro/retro-command.tsx`,
  `apps/web/src/routes/showcase.tsx` converted to palette registration.
- **Schema**: `packages/schema/src/zero/team-home.ts` exposes its attention derivation to
  the frame — one shared builder, no duplicated computation. No entity or query changes.
- **UI package**: `packages/ui` gains no new drawn vocabulary; the frame reuses the track,
  arcs, ticks, Peek, How and provenance mark shipped by PR #32. `contrast.test.ts` extends
  to the frame's token pairs in every theme block.
- **Tests**: existing Playwright specs that wait on `[data-testid="connection-status"]` and
  the `Issue views` navigation landmark must be updated to the new frame — updated to match,
  never weakened.
- **Docs**: `apps/docs/src/content/docs/features/app-frame.md` (new — the three bands, the
  six destinations, the one-attention-number rule, the keyboard grammar); updates to
  `features/team-home.md`, `features/board.md`, `features/notifications.md`,
  `features/search.md`; `README.md` and `ROADMAP.md` where they describe navigation.
