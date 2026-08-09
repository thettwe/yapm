# Design — render defects cleanup

## Context

Three defects, no shared code between them. They travel together because they are all "the shipped
thing is wrong in a way the gates cannot see", and because each is small.

### Evidence for defect 1 — the empty decision panel

`DecisionPanel` (`apps/web/src/triage/triage-view.tsx`) is:

```
flex items-start gap-10 … py-[17px] pr-10 pl-[34px]
├── min-w-0 max-w-[660px] flex-1     ← description (or nothing), then the provenance line
└── ml-auto w-[214px] flex-none flex-col gap-2.5
    ├── [A] Accept  [R] Route  [D] Decline      (three ~20px rows, gap 10)
    └── the movement hint, over a top rule       (~28px)
```

With no description the left column is one 10.5px line (~14px tall) and the right column is
~118px, so the panel is ~152px of which ~135px is nothing. `items-start` pins the one line to the
top-left corner and the verdicts hang alone on the right. The shipped scenario
"An issue with no description or attachments" already says the panel "states no placeholder text
for either" — so the bug is not that it says the wrong thing, it is that it **reserves the shape of
a fact it does not have**.

### Evidence for defect 2 — the colliding annotations

`DistributionStrip` places the outlier note on its own baseline only when

```ts
const collides = !crowd && crowdSpan !== null && span.from < crowdSpan.to && crowdSpan.from < span.to
```

— strict interval overlap of two **estimated** spans, `noteWidth(t) = t.length * 6.4`.

Reproduced numerically against the shipped constants (`LEFT=14`, `SPAN=1092`, `NOTE_INSET=10`,
`NOTE_CHAR_W=6.4`) with the reported strings `29 of 57 merged inside 26h` (26 chars) and
`8 changes waited 110h or more` (29 chars):

| longest change | axis max (`linearAxis`) | computed gap | `collides` |
|---|---|---|---|
| 193h–240h | 240 | **10.2px** | `false` |

10.2px is under two characters. And the estimate itself loses ground: both mono faces in the
palette advance **0.6em** (6.6px at 11px) — `--type-mono` is `"IBM Plex Mono"` in the warm preset
and `"JetBrains Mono Variable"` in the focused preset — so 26 + 29 characters lose ~11px against
the estimate, more than the whole computed gap. The *editorial* preset maps `--type-mono` to
`"Inter Variable"`, a proportional sans, where a per-character constant is not an estimate at all.

So the two failures compound: the estimate under-measures, and the test that would have caught the
under-measurement demands hard overlap instead of a gap.

### Evidence for defect 3 — the timestamp prefix

`team.key` carries `addUniqueConstraint('team_key_key', ['key'])` — unique across the **whole
database**, not per workspace. UUIDv7's layout is `unix_ts_ms` (48 bits) in the first 12 hex
characters, so:

| slice | bits of the ms timestamp | changes every |
|---|---|---|
| `newId().slice(0, 4)` | top 16 | ~49.7 days |
| `newId().slice(0, 8)` | top 32 | ~65.5 seconds |
| `newId().replaceAll('-','').slice(0, 12)` | all 48 | 1 ms |

Call sites deriving a uniqueness-bearing value from a prefix today:

- `packages/schema/src/db/invite.test.ts:180` — `key: newId().slice(0, 8)`
- `packages/schema/src/db/project.test.ts:32` — same
- `packages/schema/src/db/search.pg.test.ts:86-87` — `` `Q${newId().slice(0, 4)}` ``, `` `R…` ``
- `apps/server/src/search/routes.pg.test.ts:112,118` — `` `S…` ``, `` `T…` ``
- `apps/server/src/jobs/search.pg.test.ts:67` — `` `J…` ``
- `apps/server/src/sso/admin-routes.pg.test.ts:25` — `newId().replaceAll('-','').slice(0, 12)`

Call sites slicing the **tail** (`newId().slice(-6)`, `slice(-8)`) are drawing from the 62 random
bits and are correct; they are surveyed and left alone.

No **product** code derives a short unique value from an id — `team.key` is user-supplied and the
seeder's is the literal `'ENG'`. So the defect lives in the test harness, but the *derivation* is
the thing being fixed and its home is `packages/schema/src/id.ts`, beside `newId`, so a future
product call site cannot reinvent the bug.

## Goals / Non-Goals

Goals:

- Each of the three has a test that fails on today's `main`.
- Defects 1 and 2 are **re-rendered and looked at** after the fix, over the degenerate data that
  produced them.
- The distribution's layout stops being a property of one fixture.

Non-Goals:

- Restyling either surface. No new drawing, no new words, no test id renamed.
- Measuring real text at render time. The strip is static inline SVG, deliberately.
- Changing what `packages/schema` says in the annotations — the sentence and the note already
  agree; only where they land changes.
- Chasing the known multi-browser-context e2e flake.

## Decisions

### D1 — The decision panel becomes a single band when the issue has no words

**Chosen.** When `issue.description === null`, the panel does not render the prose column at all.
The provenance line and the verdicts lay out as **one band**: the verdict keys and the movement
hint run horizontally beside the provenance line rather than stacking in a 214px column, and the
panel's height is the height of one row of content (~58px including its `py-[17px]`).

Alternatives rejected:

- *Say something honest and short in place of the description* (e.g. "No description"). The
  shipped `triage` scenario says the panel "states no placeholder text for either", and the
  product's grammar for a missing fact is absence, not a euphemism. The row above already carries
  the issue's title, which for a terse bug report **is** its words.
- *Only drop the prose column's width and keep the vertical verdict rail*. The rail is what makes
  the panel 152px tall; folding the prose alone leaves the empty box exactly as tall.
- *Give the panel a `min-h` and shrink it*. Explicitly ruled out by the brief, and it encodes a
  magic number that the next font change invalidates.

Attachments are the second fact in that column. The band applies when there is **no description**;
attachment chips, when present, sit on the band beside the provenance line, which is where they
already sit relative to it. If an issue has attachments but no description the band still holds —
chips are one line tall. If the chips wrap, the band grows, which is the point: the panel is the
height of what it has.

Everything that must survive: `triage-decision`, `triage-provenance`, `triage-attachment`,
`triage-accept`, `triage-route`, `triage-decline`, `triage-open`; every `aria-label`,
`aria-keyshortcuts` and `aria-describedby` from the archived `triage-daylight` decision B2; the
`a`/`r`/`d`/`j`/`k`/`⏎` keys; and the route transient's position inside the panel (B3 — it is
positioned against `decisionRef`, so the band must remain the transient's owner).

### D2 — The note layout is a pure function with a stated minimum gap

**Chosen.** `layoutDistributionNotes({ notes, left, right, inset, charWidth, gap, rowHeight })`
returns, for each note, `{ id, anchorX, textAnchor, row, from, to }`. The invariant it guarantees:

> Any two placed notes assigned the same `row` are separated by at least `gap` px.

Notes are placed in a stable order (crowd first, then outliers by position), each taking the
lowest row on which its span clears every already-placed span on that row by `gap`. That
generalises the current two-note special case without pretending there will only ever be two, and
it removes the `crowd`-only asymmetry in the current check.

The two failing inputs are fixed by two separate corrections, both needed:

- **`gap`.** `NOTE_GAP = 18` (a little over two characters at 11px). Two notes closer than that on
  one baseline read as one sentence, which is the reported defect verbatim.
- **`charWidth`.** `NOTE_CHAR_W` rises from `6.4` to **`7.2`** (0.655em). Both mono faces advance
  0.6em; the extra 9% buys headroom for the editorial preset's proportional `--type-mono`, whose
  widest common glyphs exceed 0.6em. The comment claiming 6.4 is "deliberately generous" is
  replaced by the measurement it got wrong. Over-estimating costs a note an unnecessary extra row,
  which the existing comment already names as the acceptable failure direction.

Degenerate shapes the function must handle, each a test:

| shape | expected |
|---|---|
| no outliers | one note, row 0, never dropped |
| median sitting inside the outlier group | two rows, gap honoured |
| crowd compressed at the left of the axis | crowd still reads rightward; outlier that would start left of `left` turns around at the edge and still clears the crowd |
| a single merged change (median == max) | one note, and the median rule and the note do not overlap |
| axis max far larger than the median | the reported 26h/110h/240h case — two rows |

Rejected: measuring text with `getComputedTextLength` (needs a layout pass; the strip renders
server-side-shaped static SVG and in tests under happy-dom where SVG text measurement returns 0),
and letting the notes wrap into `<tspan>`s (the drawing has no wrap engine and a wrapped note
would collide vertically with the median label instead).

### D3 — `newKey(length = 8)` in `packages/schema/src/id.ts`, drawn from randomness

**Chosen.** A short unique value is minted, not sliced:

```ts
export const newKey = (length = 8): string => { /* crypto.getRandomValues → hex, sliced to length */ }
```

`crypto.getRandomValues` is a global in Node 24 and in every browser the SPA supports, so this adds
no dependency and no Node-only import — `packages/schema` is imported by the client.

Alternatives rejected:

- *Slice the UUIDv7 **tail*** (`newId().slice(-8)`). Correct today — the tail is `rand_b` — but it
  is the same shape of code as the bug, distinguishable only by a sign, and the next reader copies
  the wrong one. Existing `slice(-6)` call sites are left alone rather than churned; `newKey` is
  what new code reaches for.
- *Retry on unique violation*. Correct but it makes every caller carry a loop and a savepoint for a
  collision that a proper derivation does not have. Retry is the answer for a **short human-facing**
  key (`ENG`), which no code in this product generates.
- *A base32/Crockford alphabet*. `team.key` becomes an issue key's prefix, so a friendlier alphabet
  is arguably nicer — but this value is only ever a test fixture today, and inventing a
  human-facing key format is a product decision this change has no mandate for. Hex, 8 characters,
  4.3e9 values.

`length` is a parameter because two call sites need a 4-character tail behind a literal letter
(`` `Q${newKey(4)}` ``). 16^4 = 65 536 with a handful of teams per run is a birthday risk of well
under 0.1%, and those keys are already partitioned by their leading letter.

### D4 — What a test can and cannot prove here

Stated plainly, because two of these three defects exist precisely because a green suite was
mistaken for a look at the page:

- **A test cannot prove the visual composition.** For defect 1 the component test can assert that
  the panel renders no prose region and that its layout is the band, and for defect 2 the layout
  test can assert every same-row pair clears the gap — but neither can prove the result *looks*
  right in any of the six theme blocks. **The render is the real check**, and this change renders
  both surfaces over the degenerate data and looks at them.
- Defect 3 is fully test-provable: N teams inserted in one tight loop either collide or they do
  not.

## Risks / Trade-offs

- **The band changes the panel's shape based on data.** A reader moving `j`/`k` down a queue of
  mixed issues sees the panel change height. That is the intent — the panel is what it has — but
  it is a visible behaviour change and is why the render check matters more than the assertion.
- **A larger `charWidth` costs an extra row sometimes.** A note pushed to its own baseline when it
  did not need one is strictly better than two notes sharing a line, and the existing code already
  records that trade in the direction this change takes it.
- **`newKey` is production code with only test call sites today.** Justified in D3: the derivation
  is the thing being fixed, and its home is next to `newId` where the next caller will find it.

## Open Questions

None.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **No new table, no migration, no new mutator, no new named query, no new container.**
- **No test id renamed** and no accessible name, `aria-keyshortcuts` or `aria-describedby` changed
  on either surface — `apps/web/e2e/triage.spec.ts` and `delivery.spec.ts` drive both through them.
- **No assertion weakened.** If a shipped test disagrees with a fix, the fix is wrong or the test
  is asserting the defect; either way it is recorded here, never loosened.
- **`packages/ui/src/styles/contrast.test.ts` is extended only by an appended, clearly delimited
  block at the end of the file**, if at all — it has caused three painful cross-branch merges.
- **`ROADMAP.md` is not edited** (parallel build).
- **Both surfaces are rendered over the degenerate data and looked at** before the change is
  called done.

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->
