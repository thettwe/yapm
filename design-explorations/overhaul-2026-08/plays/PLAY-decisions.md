# PLAY — decisions: memory for the triangle

**The idea.** The triangle's most expensive failure isn't a missed deadline — it's re-litigating
a settled debate six weeks later because the settlement lived in comment 47. So yapm gets a
**decision entity**: any thread can end in one sentence. The "Decide" affordance sits in the
comment composer; the result is a **decision chip** pinned above the thread (plain sentence in
Figtree, provenance as a mono line: "from a thread of 5 · the team's call, no owner"), and the
thread beneath collapses to quiet. Comments keep authors and role labels — Product asks, Design
proposes with inline wireframes, Eng flags the constraint bifact-style — but the decision itself
carries no owner, only a date and the thread it distilled. `decisions-thread.html` is ENG-116's
saved-cards debate resolving; its right rail is the triangle in miniature: DELIVERY (eng's how),
DESIGN (the frames this thread produced), THE RECORD (the team's why). `decisions-record.html`
is the record itself: a team page of decision chip-rows grouped by cycle, searchable, standfirst
"Why did we do it this way? — answered here, six weeks from now.", one row unfolded to prove the
page answers *why* without a click. A decision can carry a **revisit marker** ("resurfaces at
Cycle 3 planning") — decisions never expire, they get revisited, and every glyph stays
full-strength regardless of age because the record does not fade.

**Assumes:** (1) a `decision` entity — team-scoped, one plain sentence, `decided_at`, links to
issue + source thread/comment range, optional `revisit_cycle`, deliberately **no author column**
in the schema; (2) thread resolution — a resolved thread renders quiet and pins its chip;
(3) a "Decide" affordance on any thread (composer button, and presumably `D` from the thread);
(4) comments can embed design frames (wireframe artifacts) as first-class attachments;
(5) role labels on comments derived from team membership (Product/Design/Eng); (6) area labels
on decisions reusing yapm's computed change areas (checkout, refunds, payments…); (7) a
Decisions team page under `more ▾` with search and cycle grouping; (8) revisit markers resurface
at the next cycle's planning surface.

**Graduates:** the decision entity + Decide-in-composer (cheap to build, pure yapm: the
work-graph finally remembers *why*); the chip's anatomy (glyph · DECIDED · sentence · mono
provenance · revisit pill); the record page's chip-row (44px, sentence + area + key + date, no
owner column); the decision glyph itself — a fact (filled dot) held inside a promise (ring),
drawn on the 20-grid DNA. **Stays a sketch:** the triangle rail's DESIGN section (assumes frame
attachments that don't exist yet); the quiet-thread treatment (opacity alone may not read as
"resolved" without the real unfold interaction); "Before cycles" as a group name; the
`resurfaces at Cycle 3 planning` mechanics, which need the planning surface to exist first.

**Self-critique, per artifact.**
- `decisions-thread.html` — the chip-above-quiet-thread story lands and each role has an anchor
  above the fold, but the resolved thread is only *typographically* quiet; a real 40-comment
  thread would need true collapse, and the rail's STATUS section is inherited furniture the
  triangle story doesn't strictly earn.
- `decisions-record.html` — eleven one-sentence decisions read like a house style guide for the
  product, which is exactly the pitch; the risk is the inverse: real teams write mushier
  sentences, and the page's dignity depends on an editing discipline the tool can suggest but
  not enforce.
