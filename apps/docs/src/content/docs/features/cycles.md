---
title: Cycles
description: The register of a team's cycles and the work that persists between them — one row per cycle, a scope ledger, carry chains, and no burndown.
---

A cycle is a time-boxed iteration for a team — a sprint by another name. Each cycle has a
name, a per-team number, a start and end date, and a status (**Upcoming**, **Active**, or
**Completed**). Issues can belong to a cycle, and unfinished work rolls forward automatically
when a cycle ends. Open the view at `/teams/<teamId>/cycles`, or take the **Cycles** stop in
[the deck](/features/app-frame/).

The Cycles view is **the register**: the history of the team's cycles and the work that
survived a boundary between them. It is deliberately not the active cycle's plan —
[Team Home](/features/team-home/)'s hero already answers *how is this cycle going*, and the
[Delivery view](/features/delivery/) already draws the trend across cycles. What neither shows
is the record itself, which is what this page is for.

## The register

One row per cycle, newest first. Left to right, a row states:

| Part | What it states |
| --- | --- |
| Cycle glyph | The cycle's status, drawn on the same grid as the issue status glyph: a dashed ring (upcoming), a half arc (active), a filled disc carrying a check (completed) |
| Mono key | `Cycle 7` — the per-team number the server assigns |
| Name | The cycle's name |
| Dates | Its range, as mono text |
| Scope ledger | The scope band and its reading (see below) |
| Carry fact | `3 carried forward`, where the cycle handed work on and that set is still countable |
| Artifact chips | `Cycle report ·` and `Wrapped ·`, where those artifacts exist |

The team's current cycle — the earliest active one, or the earliest upcoming one when none is
active — is **selected on arrival**. Selecting another row re-points the carried-in band and
the report below it. Selection is local: it waits on no network round trip.

The cycle glyph is a **shape with a word**. It carries a text label (`Active cycle`,
`Completed cycle`, `Upcoming cycle`), so nothing on the row is read by colour alone.

## The scope ledger

The ledger is the same three-segment encoding Team Home's hero draws, at row scale, from one
shared rule — so the two surfaces cannot disagree about a cycle:

- **Landed** — a filled block per issue that reached **Done** *while this cycle held it*. An issue
  the cycle rolled forward did not land in it, by construction, so it never draws filled here
  however far it has travelled since.
- **Still open** — a hollow outlined block per committed issue that has not. The set a cycle
  carried **out** is always counted open against the cycle it left, including issues that have
  since reached **Done** somewhere later.
- **Added** — an outlined block carrying a `+` per issue assigned **after the cycle started**.
  An issue that carried in from an earlier cycle is *not* an add: it stays committed.

Beside the band is its reading: `8/12` — eight of the twelve issues the cycle committed to have
landed. Work added mid-cycle is drawn as its own blocks and named in the label; it never enters
the ratio, because a cycle should not be credited with delivering scope it never committed to.
A cycle that committed to nothing at all reads `3 added` rather than `0/0`.

The whole cell carries a text label stating those counts (`8 landed of 12 committed, 3 added
after the cycle started`). **A cycle holding no issues draws no ledger at all** — the slot is
absent, not an empty rail and not a zero.

### Why the older rows stop claiming a total

Completing a cycle re-points each unfinished issue at the next cycle and stamps it with the
cycle it just left. **That stamp is overwritten the next time the issue carries.** So a
completed cycle's carried set — and with it the total it committed to — is reconstructible only
until one of those issues moves again.

The register says exactly that by degrading rather than guessing:

- An **open** cycle, and the **latest completed** cycle with no completed cycle after it, still
  have an addressable carried set. Their rows show the full band with a hollow remainder and a
  `landed/committed` reading.
- Every **earlier completed** cycle shows what landed and what was added, draws **no** hollow
  remainder, and reads `10 landed` rather than `10/12`.

The rule itself is one keystroke away, under the `how ·` in the register's header. A derived
number never explains itself at rest.

## Carried in

Below the register, the work that persisted across a boundary into the selected cycle. This is
the fact no other surface in yapm states.

Each carried row states the issue's status glyph, its key, its title, its delivery phrase, a
drawn chain, and the count in words: `carried 2×`. The band's header names the origin once where
**every** row left the same cycle; where they did not, each row names its own beside the count.
Activating a row opens that issue, by pointer or by keyboard. Where the selected cycle carried
nothing in, **the whole band is absent** — no header, no zero, no empty frame.

**The chain has exactly one nameable hop.** yapm stores a monotone carryover count and a single
rolled-over-from reference, and that reference holds the *last* origin only — every earlier one
was overwritten. So the chain is drawn from the count alone:

- one node per boundary the issue crossed, plus a node for now — **bounded at four nodes**, so the
  drawing keeps a fixed width however long the issue has been carried;
- a **dotted lead-in** standing for the part of the chain before the record begins, *and* for every
  hop past that bound. It is the **tail** of the chain that is kept, so the one hop yapm can still
  name is never the one dropped;
- a **solid** node for the one origin the record still names;
- **hollow** nodes for hops yapm cannot name;
- an **accent** node for the cycle the issue is in now.

Nothing on the chain is inferred from cycle ordering, and the bound hides nothing: the true count
is always beside the drawing in words. The drawing is hidden from assistive technology and the same
fact is stated in text (`carried 6×`, and a sentence naming the cycle it last left), because a
private notation may never be the only carrier of a fact.

An issue carried three times or more takes a quiet amber wash and a left rail. It is **not**
urgent ink and **not** a badge: carrying is not one of the four attention classes, so it never
adds a second attention number.

## Artifacts

Two chips, and each appears **only where its artifact exists**:

- **`Cycle report ·`** — a stored [cycle digest](/features/cycle-digest/) that is ready and has
  content.
- **`Wrapped ·`** — that cycle's [retrospective](/features/retrospectives/), closed.

Where an artifact does not exist the slot draws nothing at all — never a label saying it is
missing, which on a register would repeat down the whole column.

The selected cycle's report itself is drawn below, under **THE LAST REPORT**, with the doorway
into its retrospective in that band's header.

## No burndown

There is no burndown on this page, and there will not be one. A burndown needs to know *when*
each issue changed state; yapm stores no issue status-history entity — only a single
last-human-status timestamp, a cycle-assignment timestamp, and a monotone carryover count.
Remaining scope over the days of a cycle is not reconstructible at any fidelity, so any line
falling over time here would be an invention. The page says this once, in one sentence, and
draws no chart of something else in its place.

With it go **velocity, capacity, forecasts** and every **per-person number** — no load, no
throughput, no attribution of a carry to a person. yapm's metrics are team-level only.

## Keyboard

| Key | What it does |
| --- | --- |
| `↑` / `↓` | Move between register rows |
| `⏎` / `Space` | Select the focused row |
| `Tab` | Reach every row, control and `how ·` in order |
| `⏎` on a carried row | Open that issue |
| `Esc` | Fold an open `how ·` |

Every control on the page is reachable and operable without a pointer, and each keyboard action
behaves identically to its pointer equivalent.

## Creating and completing a cycle

Anyone who can write (admins and members — viewers are read-only) can create a cycle with
**+ New cycle**: give it a name and a start and end date. New cycles start as **Upcoming**. A
per-team cycle number is assigned by the server, so it is gap-free even when two people create
cycles at once (it appears a moment after the cycle first shows up).

**Complete cycle** acts on the **selected** row, and is offered only for a cycle that is not
already completed.

## Automatic rollover

The signature behavior of cycles is **auto-rollover**: when a cycle is completed, its
unfinished issues are not dropped — they move to the next cycle. An issue is *unfinished* if
its status is anything other than **Done** or **Canceled**. The destination is the next open
cycle for the team (the earliest **Upcoming** or **Active** cycle after the one completing);
if there is no such cycle, the issues are simply unassigned from any cycle and stay visible in
the list, never lost. Every rollover increments the issue's carryover count, which is what the
carried-in band reads.

A cycle is completed in one of two ways, and both do exactly the same rollover:

- **Deliberately** — press **Complete cycle** on the selected cycle. Its unfinished issues roll
  forward immediately.
- **Automatically** — a scheduled job on the server promotes cycles whose start date has
  passed to **Active**, and completes cycles whose end date has passed, rolling their
  unfinished work forward. The job runs on the same Postgres the rest of yapm uses (no extra
  service), and it is idempotent: completing an already-completed cycle does nothing, so the
  scheduler and a manual **Complete cycle** can never double-move an issue.

Either way, completing a cycle also opens its [retrospective](/features/retrospectives/) —
already seeded with what the cycle actually delivered. Opening one is idempotent too: the
scheduler and the button can race and still produce exactly one retro.

## Grouping and filtering by cycle in the list

The Cycles view does **not** list the selected cycle's issues. That lens belongs to the issue
list, which already owns it: **filter by cycle** — pick one or more cycles (or **No cycle**) to
narrow the list to that work — and **group by cycle**, which buckets issues under each cycle
with a **No cycle** group last. Cycle grouping is a view-only convenience; saved views persist
the other groupings.

## Viewers

Viewers are free and unlimited and read the whole register — every row, ledger, carry chain and
chip — like anyone else. They cannot create, complete, or edit cycles, they cannot open a
retrospective, and they cannot assign issues to a cycle: those controls are not rendered and
never written for a viewer.
