# Render defects cleanup

## Why

Two of these three defects were found by starting the app, seeding it, opening the page and
**looking at it**. Neither is catchable by an assertion; both passed every gate on the way in. The
third is a latent id-derivation bug that only surfaces when tests run fast enough to notice.

1. **Triage's decision panel is a large empty box.** On `/teams/{teamId}/triage` the head of the
   queue unfolds into a decision panel. Its left column reserves a 660px prose measure for the
   issue's own words; its right column stacks three verdict keys and a movement hint, ~150px tall.
   When the head issue has **no description** — the common case for a terse bug report — the left
   column holds one 10.5px provenance line and the panel is a ~150px empty region with the verdicts
   stranded on the right. The shipped `triage` spec already forbids *placeholder text* for that
   case; nothing forbids the panel **reserving the space anyway**, which is what it does.

2. **Delivery's distribution annotations collide.** On `/teams/{teamId}/delivery`, OPEN TO MERGED
   draws two callouts — the crowd note beside the median rule and the outlier note beside the
   giants. Over a seeded team with 57 historical pull requests they render as
   `…merged inside 26h8 changes waited 110h or more`. `DistributionStrip` *does* have a collision
   test, and it does not fire, for two compounding reasons:
   - it demands **strict geometric overlap** of the two estimated spans, with no minimum gap, so
     two mono sentences 10px apart are declared "apart" and share a baseline;
   - the width estimate `NOTE_CHAR_W = 6.4` is documented as "deliberately generous" and is
     **not**: both mono faces in the palette (IBM Plex Mono, JetBrains Mono) advance 0.6em = 6.6px
     at 11px, and the *editorial* preset maps `--type-mono` to **Inter Variable**, a proportional
     sans. So the estimate under-measures by ~3% on two presets and is simply wrong on the third.

   Reproduced numerically against the shipped code: with a median of 26h, a slowest outlier of
   110h and a longest change between 193h and 240h (axis max 240), the two spans are computed
   **10.2px apart** — under two characters, and less than the ~11px the width estimate loses. The
   drawing therefore puts them on one line and they run together.

3. **Team keys collide because the id prefix is a timestamp.**
   `packages/schema/src/db/invite.test.ts` fails intermittently with
   `duplicate key value violates unique constraint "team_key_key"`. `team.key` is unique
   **workspace-wide across the whole database** (`0002_workspace_auth.ts`), and the key is derived
   as `newId().slice(0, 8)`. yapm's ids are UUIDv7: the first 12 hex characters are a 48-bit
   millisecond timestamp, so the first 8 characters are its top 32 bits and change once every
   2^16 ms ≈ **65 seconds**. Two teams created inside the same minute get the same key. The same
   derivation appears with `slice(0, 4)` — the top 16 bits, which change once every **~50 days**,
   i.e. effectively a constant — in three more test files.

Vision principles served: **honesty** (a surface may only state a fact some stored row supports,
and may only reserve space for a fact it has), **keyboard-first and sub-100ms** (unchanged;
nothing here newly waits on the network), and the working agreement's rule that a derivation is
correct or it is a defect, not a flake.

## What Changes

- **Triage's decision panel folds when the issue has no words of its own.** The panel becomes what
  it actually has: with no description the prose measure is not reserved, the verdict keys and the
  movement hint lay out in a single band beside the provenance line, and the panel's height is the
  height of its content. **No placeholder sentence is invented** — the shipped `triage` scenario
  already forbids one, and inventing prose is exactly "reserving space for a fact you do not have".
  This applies the shipped `reality-vocabulary` principle ("a stage no entity backs folds away")
  to a second surface rather than restating it.
- **The distribution's note layout becomes a pure, tested function.** `DistributionStrip` gains an
  exported `layoutDistributionNotes(...)` that places every note on a baseline row and guarantees
  a **minimum legibility gap** between any two notes sharing a row, with a width estimate that is
  genuinely conservative (never under-measures either mono face, and tolerant of the editorial
  preset's proportional `--type-mono`). The component renders what the function returns.
- **A short unique value gets one honest derivation.** `packages/schema/src/id.ts` gains
  `newKey(length)`, drawn from cryptographic randomness — never from a prefix of a UUIDv7 — and
  every uniqueness-bearing `newId().slice(0, n)` call site moves onto it.
- **Tests that pin the behaviour rather than the fixture**: a triage component test over an issue
  with no description; a distribution layout test over a generated matrix of data shapes (median
  adjacent to the outlier group, no outliers, crowd compressed at the left of the axis, giant
  axis, single change); an id test proving many rapid `newKey()` values are distinct; and a
  Postgres test creating many teams in rapid succession without collision.

Non-goals, folded deliberately:

- **No restyle of either surface.** The decision panel keeps its three verdicts, its keycaps, its
  test ids and its route transient; the distribution keeps its linear axis, its dots, its median
  rule and its sentences. Only the degenerate shapes change.
- **No measuring of real text.** The drawing is static inline SVG with no layout pass; the fix is a
  conservative estimate plus a real gap, not a `getComputedTextLength` round trip.
- **No new named query, no new table, no migration, no new mutator, no new container.**
- **No change to what the annotations say.** The words are `packages/schema`'s; only where they are
  drawn changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `triage`: the decision panel folds to what it has when the issue carries no description —
  the prose measure is not reserved and no placeholder stands in for it.
- `delivery-metrics`: the distribution's callouts SHALL remain legible at every data shape —
  two callouts never share a baseline unless a stated gap separates them.
- `local-first-sync`: no uniqueness-bearing value is derived from a prefix of a UUIDv7, because
  the leading characters are a timestamp.

## Impact

- `apps/web/src/triage/triage-view.tsx` — the decision panel's layout for the description-less case.
- `apps/web/src/triage/triage-view.test.tsx` — the degenerate-shape test.
- `packages/ui/src/components/distribution-strip.tsx` — the extracted note layout, the gap, the
  width estimate.
- `packages/ui/src/components/distribution-strip.test.tsx` (new) — the layout matrix.
- `packages/ui/src/components/distribution-strip.stories.tsx` — a story for the colliding shape.
- `packages/schema/src/id.ts`, `packages/schema/src/index.ts`, `packages/schema/src/id.test.ts` —
  `newKey`.
- Call sites moving off the prefix slice: `packages/schema/src/db/invite.test.ts`,
  `packages/schema/src/db/project.test.ts`, `packages/schema/src/db/search.pg.test.ts`,
  `apps/server/src/search/routes.pg.test.ts`, `apps/server/src/jobs/search.pg.test.ts`,
  `apps/server/src/sso/admin-routes.pg.test.ts`.
- No API, dependency, container or migration impact.

Docs: none of README, ROADMAP, TECHSTACK, `.env.example` or `reference/` describes any behaviour
this change alters — all three fixes are interior. `apps/docs` carries no page describing the
decision panel's empty case, the distribution's callout placement, or id derivation. The
Documentation task group re-checks this claim by grep rather than asserting it, and updates
whatever it finds.
