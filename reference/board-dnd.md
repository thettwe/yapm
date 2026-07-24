# Reference — `board-view`: keyboard-accessible Kanban DnD over Zero-synced issues

> Prep reference for yapm change #4 `board-view` (kanban grouped by status). Everything here is
> verified against npm metadata and installed `.d.ts` files (probe dir
> `scratchpad/probe-dnd/`, installed 2026-07-24) or official docs. Anything I could not confirm is
> marked **UNVERIFIED**. Prefer copying the quoted signatures over writing DnD code from memory.
>
> Context anchors from the repo:
> - `board-view` is roadmap change #4; issue-core (#3) **deliberately deferred** the ordering
>   column: "Manual drag-reordering / a `sort_order` column — belongs to board-view."
>   (`openspec/changes/issue-core/design.md:22`, `:96`, `proposal.md:43`).
> - Statuses are a **fixed** enum `backlog | todo | in_progress | in_review | done | canceled`
>   (issue-core D6) → the board's columns are fixed and known at build time.
> - Stack constraints (TECHSTACK.md): React 19.2, Vite 8 (Rolldown), TS7 (`tsc --noEmit` only —
>   no tool may import `typescript` programmatically), Zero 1.8 custom mutators, UUIDv7 client-minted
>   PKs, **100% AGPL-compatible deps**, sub-100ms interactions, keyboard-first, Zustand only for
>   ephemeral UI (Zero owns data state).

---

## 0. TL;DR recommendation

| Concern | Decision |
|---|---|
| **DnD library** | **`@dnd-kit` classic** (`@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0`), MIT. It ships a real **directional KeyboardSensor + ARIA live-region announcements out of the box** — the single best fit for a keyboard-first product. **Do NOT adopt `@dnd-kit/react@0.5.0`** — it is still **0.x / Beta**. |
| **Alternative kept in mind** | `@atlaskit/pragmatic-drag-and-drop@2.0.1` (Apache-2.0). Smaller, framework-agnostic, excellent perf, but **has no directional keyboard dragging by design** — its a11y model is an *action menu* ("Move to → In Review"). That model is actually very compatible with a keyboard-first command-driven app; keep it as the fallback / or even primary if you decide menu-based moves beat spatial dragging. |
| **Ordering scheme** | **`fractional-indexing@4.0.0`** (CC0-1.0, public domain) — `generateKeyBetween(a, b)` mints one string rank between two neighbours. A card move becomes a **single mutator** setting one issue's `rank`, no sibling renumbering. Needs a new `rank text` column (the deferred `sort_order`). |
| **Virtualization** | **`@tanstack/react-virtual@3.14.8`** (MIT, React 19 in peer range). Coexists with dnd-kit sortable but has **known friction** (scroll-lag during drag, transform conflicts) — mitigations below. Only virtualize columns that actually get long; a status column is rarely >200 cards. |
| **A11y baseline** | No dedicated APG pattern for kanban. Compose the **Grid pattern** (2-D arrow navigation) + a **"grab/move/drop" mode** with `aria-live` announcements. dnd-kit gives the live-region plumbing; you own the semantics. |

License check (all AGPL-compatible ✓): dnd-kit MIT, pragmatic Apache-2.0, fractional-indexing CC0-1.0, TanStack Virtual MIT.

---

## 1. DnD library — the 2026 landscape, verified

### 1.1 Installed versions & licenses (npm, 2026-07-24)

```
@dnd-kit/core            6.3.1   MIT        last publish 2024-12-05   peer react >=16.8.0
@dnd-kit/sortable       10.0.0   MIT
@dnd-kit/accessibility   3.1.1   MIT        (live-region + screen-reader helpers)
@dnd-kit/react           0.5.0   MIT        last publish 2026-07-13   peer react ^18||^19   << 0.x / BETA
@atlaskit/pragmatic-drag-and-drop            2.0.1   Apache-2.0  last publish 2026-06-17  peer: {} (framework-agnostic)
@atlaskit/pragmatic-drag-and-drop-hitbox     2.0.0   Apache-2.0
@atlaskit/pragmatic-drag-and-drop-react-accessibility 3.1.4 Apache-2.0  peer react ^18.2||^19
@atlaskit/pragmatic-drag-and-drop-live-region (installed) Apache-2.0
```

> **The dnd-kit fork in the road.** There are two dnd-kits:
> - **Classic** `@dnd-kit/core` **6.3.1** — last published **2024-12-05**. Its peerDeps still say
>   `react >=16.8.0` (i.e. they predate React 19), but React 19 has **no breaking change that
>   affects it** and the community + official TanStack examples run it on React 19. It is the
>   battle-tested, ~3,000-dependant, fully-keyboard-accessible line.
> - **New** `@dnd-kit/react` **0.5.0** — a ground-up rewrite (`@dnd-kit/dom` + `@dnd-kit/abstract`
>   engine) published **2026-07-13**, peer `react ^18||^19`. **Maintainer marked it "Beta"** and
>   there is an open, *unanswered* roadmap discussion asking whether `@dnd-kit/core` will be
>   deprecated (GitHub Discussion #1842). **A 0.x Beta is the wrong bet for a flagship OSS repo's
>   primary board surface right now.** Re-evaluate when it hits 1.0.

### 1.2 React 19 compatibility

- **`@dnd-kit/core` 6.3.1**: works on React 19 in practice (official TanStack Table Row-DnD example
  and pkgpulse/2026 comparisons run it on 19). The stale `>=16.8.0` peer is cosmetic; if the
  installer complains it is a warning, not a break. **UNVERIFIED at the source level** that there is
  zero React-19 StrictMode/ref edge case — smoke-test under `<StrictMode>` early. Source:
  <https://github.com/clauderic/dnd-kit/discussions/1980>, <https://tanstack.com/table/v8/docs/framework/react/examples/row-dnd>.
- **`@dnd-kit/react` 0.5.0**: explicit `^18||^19` peer — first-class React 19, but Beta.
- **`@atlaskit/pragmatic-drag-and-drop` 2.0.1**: core has **`peerDependencies: {}`** — it is
  framework-agnostic (operates on raw `HTMLElement`s via the native HTML Drag-and-Drop API), so it is
  trivially React-19-safe. Its React helper packages (`-react-accessibility` 3.1.4,
  `-react-drop-indicator`) declare `react ^18.2 || ^19`.

### 1.3 Keyboard accessibility — the deciding axis (yapm is keyboard-first)

**This is where the two libraries fundamentally differ.**

**`@dnd-kit` = built-in *directional* keyboard dragging.** The `KeyboardSensor` is one of the two
default sensors. Space/Enter picks up, arrow keys move, Space/Enter drops, Escape cancels — and it
emits ARIA live-region announcements automatically. Verified from the installed core `.d.ts`:

```ts
// @dnd-kit/core/dist/index.d.ts exports:  KeyboardSensor, KeyboardCode, KeyboardCoordinateGetter,
//                                          Announcements, ScreenReaderInstructions
```

For sortable specifically there is a ready-made coordinate getter that snaps arrow-key motion to the
next sortable slot (verified export):

```ts
// @dnd-kit/sortable/dist/index.d.ts (verbatim exports)
export { sortableKeyboardCoordinates } from './sensors';
export { arrayMove, arraySwap } from './utilities';
export { SortableContext } from './components';
export { useSortable, defaultAnimateLayoutChanges, defaultNewIndexGetter } from './hooks';
export { horizontalListSortingStrategy, rectSortingStrategy, rectSwappingStrategy,
         verticalListSortingStrategy } from './strategies';
```

**`pragmatic-drag-and-drop` = NO directional keyboard drag, on purpose.** Its official
accessibility guidelines (from Atlassian user testing) reject arrow-key dragging in favour of an
**action menu**: every draggable exposes a `DragHandleButton` that opens a menu ("Move up", "Move to
In Review"), and a visually-hidden **live region** announces the result. Verified from installed
packages:

```ts
// @atlaskit/pragmatic-drag-and-drop-live-region  (installed .d.ts, verbatim)
export declare const announceDelay = 1000;
export declare function announce(message: string): void;
export declare function cleanup(): void;
// usage from docs:
//   announce('Task "Clean dishes" moved to list "Doing" from "Todo".')

// @atlaskit/pragmatic-drag-and-drop-react-accessibility exports DragHandleButton (default export)
```
Source: <https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines>,
<https://deepwiki.com/atlassian/pragmatic-drag-and-drop/6.4-accessibility-guidelines>.

> **Design implication for yapm.** Both can be made WCAG-AA keyboard-accessible, but they impose
> different *interaction models*:
> - dnd-kit → **spatial** (grab, arrow between columns, drop). Linear-like. Zero extra UI.
> - pragmatic → **command** (focus card → open move-menu → pick target). This dovetails with yapm's
>   command-palette / keyboard-first ethos and is arguably *more* discoverable and reliable for AT
>   users, but it is more UI to design (menu + focus restoration).
>
> Recommendation: **dnd-kit for the pointer + spatial-keyboard drag**, and *additionally* expose a
> command-palette / context-menu "Move to status…" action for the same outcome (belt-and-braces,
> and it's cheap since statuses are a fixed enum). That satisfies APG's "every drag has a
> non-pointer equivalent" principle regardless of which sensor a user reaches for.

### 1.4 Performance with large columns

- **pragmatic** wins raw bundle/perf (native HTML DnD, no per-frame React re-render of siblings;
  built for Trello/Jira scale). Source: pkgpulse 2026 comparison.
- **dnd-kit** is also high-perf but re-renders sortable items via transforms; for very large columns
  you pair it with virtualization (§3). dnd-kit's guidance: **prefer CSS transforms over reordering
  the DOM mid-drag**, only fall back to `layoutShiftCompensation` when unavoidable.
- Practically: a status column in an issue tracker rarely exceeds a few hundred cards. Virtualize
  only when a column crosses a threshold (say >100 rendered cards); below that dnd-kit is smooth.

### 1.5 Recommended setup code — dnd-kit classic (VERIFIED API surface)

Verified `useSortable` return shape (from `@dnd-kit/sortable/dist/hooks/useSortable.d.ts`):

```ts
useSortable({ id, ... }): {
  attributes: DraggableAttributes;          // spread onto the card root (role, tabIndex, aria-*)
  listeners: SyntheticListenerMap | undefined;  // spread onto the drag handle / card
  setNodeRef: (node: HTMLElement | null) => void;
  setActivatorNodeRef: (element: HTMLElement | null) => void;   // if handle != whole card
  transform: Transform | null;
  transition: string | undefined;
  isDragging: boolean; isSorting: boolean; isOver: boolean;
  index: number; newIndex: number; over: Over | null; active: Active | null;
  // ...rect, node, overIndex, items, setDroppableNodeRef, setDraggableNodeRef
}
```

Board skeleton (columns = fixed status enum; each column is a droppable + a SortableContext):

```tsx
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  closestCorners, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, arrayMove,
  sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const STATUSES = ['backlog','todo','in_progress','in_review','done','canceled'] as const;

function Board({ issuesByStatus }: { issuesByStatus: Record<string, Issue[]> }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }), // <-- keyboard drag
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}       // live cross-column preview (optimistic, local only)
      onDragEnd={handleDragEnd}         // commit -> single Zero mutator (see §2)
      accessibility={{ announcements, screenReaderInstructions }}  // §4
    >
      <div className="board">
        {STATUSES.map(status => (
          <Column key={status} status={status} issues={issuesByStatus[status] ?? []} />
        ))}
      </div>
      <DragOverlay>{/* render the lifted card here for a smooth, transform-free drag image */}</DragOverlay>
    </DndContext>
  );
}

function Column({ status, issues }: { status: string; issues: Issue[] }) {
  return (
    <section aria-label={status} data-status={status}>
      <SortableContext items={issues.map(i => i.id)} strategy={verticalListSortingStrategy}>
        {issues.map(issue => <Card key={issue.id} issue={issue} />)}
      </SortableContext>
    </section>
  );
}

function Card({ issue }: { issue: Issue }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: issue.id, data: { status: issue.status, rank: issue.rank } });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <article ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {issue.title}
    </article>
  );
}
```

> Notes:
> - `data: { status, rank }` on `useSortable` carries what the drop handler needs to compute the new
>   rank without a lookup.
> - `DragOverlay` renders the dragged card outside the transformed list — this is what lets you keep
>   "CSS transforms over DOM reorder" and avoids janky reflows in big columns.
> - `onDragOver` should only mutate **local/ephemeral** state (Zustand or `useState`) for the live
>   cross-column preview; the **authoritative write happens once in `onDragEnd`** (§2). Do not fire a
>   Zero mutator per `dragOver` frame.

---

## 2. Ordering scheme — fractional indexing + a single-write Zero mutator

### 2.1 Why fractional indexing (lexicographic rank)

Goal: an optimistic card move must be **one mutator that writes one row's `rank`**, never a
renumbering of siblings (renumbering = N writes = N rows resynced = conflicts under concurrent edits
and violates the sub-100ms / minimal-write principle). Fractional indexing assigns each card a
**string** key; a new key can always be minted *between* any two neighbours, so inserting/moving is
O(1) and touches exactly one row. Keys sort with plain lexicographic `ORDER BY rank`.

### 2.2 The library (VERIFIED)

`fractional-indexing@4.0.0` — **license CC0-1.0** (public domain; AGPL-safe), by the author of the
technique (David Greenspan / Figma-style ordering). Verified exported API from installed
`node_modules/fractional-indexing/src/index.d.ts`:

```ts
export function generateKeyBetween(
  a: string | null | undefined,   // lower bound (null = start of list)
  b: string | null | undefined,   // upper bound (null = end of list)
  digits?: string,                // alphabet; default BASE_52 (A-Z a-z)
  intDigits?: string,
): string;

export function generateNKeysBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  n: number,                      // mint n evenly-spaced keys between a and b
  digits?: string,
  intDigits?: string,
): string[];

export const BASE_62_DIGITS: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const BASE_52_DIGITS: string;   // A-Z a-z (the default heads)
```

Behaviour (from the doc-comment, verbatim excerpts):
- `generateKeyBetween(null, null)` → first key (default alphabet → `"a0"`; with `BASE_62_DIGITS`
  passed explicitly, self-headed keys like `"V0"`).
- `generateKeyBetween(key, null)` → append after `key`. `generateKeyBetween(null, key)` → prepend.
- "When both are non-null, they may be passed in either order." → move-between-two-cards is
  `generateKeyBetween(prev.rank, next.rank)`.
- **Preconditions matter**: `a < b` when both provided; passing equal or out-of-order **throws**.
  Always read the *current* neighbours' ranks before minting.

> **Alphabet choice for yapm.** Use `BASE_62_DIGITS` explicitly (`0-9A-Za-z`) for shorter, URL/JSON-
> clean keys, and **use it consistently everywhere** (client optimistic mint + server) — mixing
> alphabets across a column corrupts ordering. Store `rank` as Postgres `text`, index it
> `(status, rank)`. Because Postgres default text collation can be locale-sensitive, pin the column
> to **`COLLATE "C"`** (byte-order) so DB sort matches the JS string sort exactly. **UNVERIFIED**
> (design assertion, not from a fetched doc — but this is the standard fractional-index footgun;
> confirm in a migration test that JS `<` order == `ORDER BY rank COLLATE "C"`).

### 2.3 The move mutator (fits Zero 1.8 custom-mutator API from `reference/zero.md`)

Zero mutators are `defineMutator(validator, async ({tx, args, ctx}) => Promise<void>)`, run
optimistically on the client then authoritatively on the server. Reads inside a mutator are **local**
on the client (only sees synced rows) — so the client passes the neighbour ranks it already has;
the server recomputes authoritatively from Postgres. Pattern:

```ts
// packages/schema/mutators.ts  (shared client+server — the yapm boundary rule)
import { defineMutator, defineMutators } from '@rocicorp/zero';
import { generateKeyBetween, BASE_62_DIGITS } from 'fractional-indexing';
import { z } from 'zod';

const rankBetween = (a: string | null, b: string | null) =>
  generateKeyBetween(a, b, BASE_62_DIGITS);

export const mutators = defineMutators({
  issue: {
    // Move a card to a target status at a position between prevId/nextId (either may be null).
    move: defineMutator(
      z.object({
        id: z.string(),
        toStatus: z.enum(['backlog','todo','in_progress','in_review','done','canceled']),
        prevRank: z.string().nullable(),   // rank of the card that will be ABOVE it (or null)
        nextRank: z.string().nullable(),   // rank of the card that will be BELOW it (or null)
      }),
      async ({ tx, args, ctx }) => {
        // authz first (existence-check second) — the zbugs ordering rule from reference/zero.md
        await assertCanEditIssue(tx, ctx, args.id);
        const newRank = rankBetween(args.prevRank, args.nextRank);
        await tx.mutate.issue.update({ id: args.id, status: args.toStatus, rank: newRank });
      },
    ),
  },
});
```

Client call site (from `onDragEnd`): compute the two neighbours in the *destination* column from the
already-synced ordered list, then:

```ts
zero.mutate.issue.move({ id, toStatus, prevRank, nextRank });   // ONE write, optimistic + authoritative
```

> Why compute rank in the **mutator** and not before: Zero re-runs the mutator authoritatively on
> the server against real Postgres. If two users drop into the same gap concurrently, both mint from
> the same neighbours and could collide on identical keys. **Two mitigations:**
> 1. Cheapest: keep `rank` non-unique and accept that a rare tie sorts by a stable tiebreaker
>    (`rank, id` — `id` is UUIDv7, monotonic). Ties self-heal on the next move.
> 2. Stronger: on the server, re-read the actual neighbour rows inside the mutator
>    (`tx.location === 'server'` sees all data) and regenerate `rank` from live neighbours, so the
>    authoritative value reflects true current state. This is the robust path for a shared board.
>
> **UNVERIFIED**: exact server-side neighbour-requery ZQL for "the card currently just above rank X
> in status S" — express with `builder.issue.where('status', S).where('rank','<',X).orderBy('rank','desc').limit(1)`
> (ZQL shape per reference/zero.md; confirm operator support for `orderBy`/`limit` in 1.8 against the
> installed `@rocicorp/zero` types before relying on it).

### 2.4 Migration (the deferred column)

issue-core explicitly left this out. `board-view` adds:

```sql
-- Kysely migration in packages/schema
ALTER TABLE issue ADD COLUMN rank text NOT NULL DEFAULT '';   -- backfill below, then drop default
CREATE INDEX issue_status_rank_idx ON issue (status, rank COLLATE "C");
```

Backfill: for each status group, order existing issues by the issue-core default sort
(`priority desc, updated desc`) and assign ranks with **`generateNKeysBetween(null, null, count)`** —
one batched pass mints evenly-spaced keys so the initial board matches the list's order. Mirror the
`rank` column in the hand-written Kysely `DB` type **and** the hand-written Zero schema (both are
drift-tested in CI per TECHSTACK.md).

---

## 3. Virtualization for large boards/columns

### 3.1 Library (VERIFIED)

`@tanstack/react-virtual@3.14.8` — **MIT**, peer `react ^16.8||^17||^18||^19` (React 19 ✓), last
publish 2026-07-22 (actively maintained). Verified signature (installed `.d.ts`):

```ts
// @tanstack/react-virtual/dist/esm/index.d.ts
declare function useVirtualizer<TScrollElement extends Element, TItemElement extends Element>(
  options: PartialKeys<ReactVirtualizerOptions<TScrollElement, TItemElement>,
                       'observeElementRect' | 'observeElementOffset' | 'scrollToFn'>
): ReactVirtualizer<TScrollElement, TItemElement>;

// key options (from @tanstack/virtual-core .d.ts):
//   count: number
//   getScrollElement: () => TScrollElement | null
//   estimateSize: (index: number) => number
//   overscan?: number
//   getItemKey?: (index: number) => Key      // <-- MUST be stable (issue.id), see below
//   measureElement?: (el, entry, instance) => number   // dynamic row heights
```

Each column scrolls independently, so **one `useVirtualizer` per column** (columns are short and
horizontal; only the vertical card list inside a column virtualizes).

### 3.2 How it coexists with DnD (the friction is real — verified)

Documented pain points (dnd-kit issues #1674, #1720; TanStack + dnd-kit threads):

1. **Scroll-lag during drag** — both libraries manage scroll/event listeners; combining them can
   make the virtual scroll janky mid-drag. Mitigation: use `DragOverlay` (so the dragged node is
   pulled out of the virtualized/transformed list), and keep the sortable strategy transform-based.
2. **Transform conflicts** — a virtualizer positions rows with `transform: translateY(px)`; a
   sortable *also* writes `transform`. If both target the same element they fight. Mitigation:
   apply the **virtualizer transform to an outer wrapper** and the **sortable transform to an inner
   card element** (two nested nodes, separate refs), so neither overwrites the other. This is the
   canonical fix and the same reason `DragOverlay` exists.
3. **`SortableContext items` must be the full ordered id list, not just the rendered window** —
   dnd-kit needs every item's id to compute drop indices even though only ~20 are mounted. Pass
   `items={allIssueIdsInColumn}` while rendering only `virtualizer.getVirtualItems()`.
4. **Stable keys** — set `getItemKey: (i) => issues[i].id` so a card keeps identity across
   virtualization + reorder (prevents dropped drags / focus loss).

Source: <https://github.com/clauderic/dnd-kit/issues/1720>,
<https://github.com/clauderic/dnd-kit/issues/1674>.

> **Pragmatic + virtualization**: pragmatic attaches via `draggable(element)` on mount; a
> virtualized item that scrolls out unmounts and its cleanup runs — generally fine because pragmatic
> re-registers on remount, but a card being *dragged* must not be unmounted by the virtualizer
> mid-drag. **UNVERIFIED** at doc level (the pragmatic a11y docs "do not address virtualization").
> If you go pragmatic, pin/overscan the in-flight dragged card.

> **Pragmatic guidance for yapm: virtualize lazily.** Do not virtualize every column from day one.
> Render plainly until a column exceeds a threshold; the ceremony (nested transform nodes, full-id
> `SortableContext`) is only worth it for genuinely long columns. Measure first (PRINCIPLES).

---

## 4. Accessibility — keyboard board navigation + move semantics + ARIA

### 4.1 There is no APG "kanban" pattern (VERIFIED)

The W3C ARIA Authoring Practices Guide has **no** drag-and-drop / kanban / sortable pattern
(confirmed against <https://www.w3.org/WAI/ARIA/apg/patterns/>). The closest reusable pieces:
- **Grid pattern** — a container navigated with **arrow keys / Home / End** across a 2-D structure.
  Best base for "board = grid of columns × cards".
- **Listbox** — single/multi-select list; models "cards within one column" but no reorder guidance.
- **Feed** — for infinite-scroll content, not reordering.

So the board a11y is **custom, composed from Grid navigation + an explicit grab/move/drop mode +
live-region announcements.** This matches WAI's general "keyboard + focus mgmt + status messages
(WCAG 4.1.3)" guidance and dnd-kit's own model.

### 4.2 Two-mode keyboard model (recommended)

**Navigation mode** (default — move focus, don't move cards):
- `Tab` moves between columns' focusable regions; **Arrow Up/Down** moves focus between cards in a
  column; **Arrow Left/Right** jumps to the adjacent column (Grid semantics); **Home/End** to
  first/last card in column. (roving `tabIndex`, one card tabbable per column.)

**Move mode** (grab a card and relocate it):
- **Space / Enter** on a focused card → *pick up* (enter move mode). Announce:
  `"Picked up {key} {title}. Use arrow keys to move, Space to drop, Escape to cancel."`
- **Arrow Up/Down** → move within column (rank changes between neighbours). **Arrow Left/Right** →
  move to adjacent column (status changes; lands at a sensible position). Announce each step:
  `"{title}, {status} column, position {n} of {m}."`
- **Space / Enter** → *drop* → fire the single `issue.move` mutator (§2). Announce:
  `"Dropped {title} in {status}, position {n} of {m}."`
- **Escape** → cancel, restore original position + focus.

dnd-kit's `KeyboardSensor` + `sortableKeyboardCoordinates` already implement the pick-up / arrow /
drop / escape loop for *within and across* SortableContexts; you supply the announcement strings.

### 4.3 ARIA wiring (verified hooks + standard attributes)

- dnd-kit exposes the a11y config on `DndContext` (types verified in core `.d.ts`:
  `Announcements`, `ScreenReaderInstructions`):

```tsx
import type { Announcements, ScreenReaderInstructions } from '@dnd-kit/core';

const screenReaderInstructions: ScreenReaderInstructions = {
  draggable: `To pick up an issue, press Space or Enter. Use arrow keys to move between
              positions and columns. Press Space or Enter again to drop, Escape to cancel.`,
};

const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up issue ${active.id}.`,
  onDragOver:  ({ active, over }) => over ? `Issue ${active.id} moved over ${over.id}.` : undefined,
  onDragEnd:   ({ active, over }) => over ? `Issue ${active.id} dropped onto ${over.id}.`
                                          : `Issue ${active.id} dropped.`,
  onDragCancel:({ active }) => `Move cancelled. Issue ${active.id} returned to its position.`,
};
// <DndContext accessibility={{ announcements, screenReaderInstructions }} ...>
```
dnd-kit renders the hidden `aria-live` region and the instructions node for you (`@dnd-kit/accessibility@3.1.1`).

- **Static ARIA on the DOM** (own this regardless of library):
  - Column: `role="group"` (or `role="region"`) + `aria-label="In progress"` +
    `aria-describedby` a count (`"12 issues"`).
  - Card list: consider `role="list"` / cards `role="listitem"`; or model the board as
    `role="grid"` with columns as `role="row"`/`rowgroup` if you want strict Grid nav.
  - Card: focusable (`tabIndex` roving), `aria-roledescription="draggable issue"`,
    `aria-label="{issue.key} {title}, {status}, priority {p}"`, and while grabbed
    `aria-grabbed="true"` (deprecated in ARIA 1.1 but still announced by several ATs — pair it with
    the live-region text, which is the reliable channel). **UNVERIFIED** which ATs honour
    `aria-grabbed` in 2026; rely on the live region as source of truth.
  - Respect `prefers-reduced-motion`: disable the drop/settle animation (dnd-kit `transition`/
    `DragOverlay` dropAnimation) when set.

- **Non-pointer equivalent (APG principle + pragmatic's whole thesis):** also wire a **"Move to
  status…" command** (command palette entry + right-click / `⋯` menu on each card) that calls the
  same `issue.move` mutator. Cheap because statuses are a fixed enum, and it's the most reliable
  path for switch/voice users. If you later prefer this over spatial dragging, `pragmatic`'s
  `DragHandleButton` + `announce()` is the drop-in for exactly this menu model.

### 4.4 Focus management (the subtle part)

When a card moves to a new column it **remounts** (new DOM node) → focus is lost. After a
keyboard-initiated move, **manually restore focus to the moved card in its new location** (find it by
`issue.id` post-render, e.g. a `ref` map or `document.getElementById(cardDomId)` in a
`useEffect`/`flushSync` after the mutator's optimistic state lands). Pragmatic's docs call this out
explicitly ("focus is restored to it after moving… requires manual focus restoration because the
button is moving to a new parent and will remount"); the same applies with dnd-kit. Do not leave
focus on `<body>` after a move.

---

## 5. Open items to verify during implementation (don't ship on faith)

1. **dnd-kit 6.3.1 under React 19 `<StrictMode>`** — smoke-test double-invoke/ref behaviour; the
   peer range predates 19. (UNVERIFIED at source; community says fine.)
2. **JS string order == Postgres `ORDER BY rank COLLATE "C"`** — add a migration/CI test that seeds
   `generateNKeysBetween` output and asserts DB order matches JS `.sort()`.
3. **Concurrent drop into the same gap** — decide tie policy (`ORDER BY rank, id` tiebreaker) vs
   server-side neighbour requery in the mutator; verify the ZQL `orderBy/limit/where('rank','<',x)`
   shape against installed `@rocicorp/zero@1.8` types (reference/zero.md shows the builder pattern).
4. **Virtualizer×sortable transform nesting** — prototype the nested-ref fix on a 1,000-card column
   before committing to virtualization; confirm no scroll-lag on the Warm-theme card (44px rows).
5. **`@dnd-kit/react` 1.0 watch** — if it GAs before board-view ships, re-evaluate: it's the
   long-term API, React-19-native, and drops the `SortableContext` wrapper (but changes `useSortable`
   to require `{id, index}` and removes `attributes/listeners/setActivatorNodeRef`). Not now (0.5.0 Beta).

---

## Sources

- npm metadata (probed 2026-07-24) + installed `.d.ts` in `scratchpad/probe-dnd/node_modules/…`:
  `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/react@0.5.0`,
  `@dnd-kit/accessibility@3.1.1`, `@atlaskit/pragmatic-drag-and-drop@2.0.1`,
  `@atlaskit/pragmatic-drag-and-drop-react-accessibility@3.1.4`,
  `@atlaskit/pragmatic-drag-and-drop-live-region`, `fractional-indexing@4.0.0`,
  `@tanstack/react-virtual@3.14.8`.
- dnd-kit roadmap (core vs react, Beta): <https://github.com/clauderic/dnd-kit/discussions/1842>,
  migration/API diff: <https://github.com/clauderic/dnd-kit/discussions/1980>,
  <https://dndkit.com/react/guides/migration/>.
- dnd-kit + virtualization issues: <https://github.com/clauderic/dnd-kit/issues/1720>,
  <https://github.com/clauderic/dnd-kit/issues/1674>.
- TanStack Table Row-DnD (dnd-kit classic on React 19): <https://tanstack.com/table/v8/docs/framework/react/examples/row-dnd>.
- pragmatic a11y (action-menu model, DragHandleButton, live region, focus restoration):
  <https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines>,
  <https://deepwiki.com/atlassian/pragmatic-drag-and-drop/6.4-accessibility-guidelines>.
- 2026 library comparisons: <https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026>,
  <https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react>.
- ARIA APG patterns (no kanban pattern; Grid/Listbox/Feed): <https://www.w3.org/WAI/ARIA/apg/patterns/>.
- fractional indexing technique background: <https://observablehq.com/@dgreensp/implementing-fractional-indexing> (author's writeup; API confirmed from installed v4 `.d.ts`).
- yapm repo: `TECHSTACK.md`, `DESIGN.md`, `ROADMAP.md`, `reference/zero.md` (§5 mutators),
  `openspec/changes/issue-core/{design.md,proposal.md}`.
