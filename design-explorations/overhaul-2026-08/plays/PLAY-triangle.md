# PLAY — triangle: the design edge joins the graph

**The idea.** yapm draws the PM→eng pipe; the triangle adds the third vertex. Design artifacts
become first-class nodes on the same reality track, so the chain a PM, a designer, and an
engineer all read is one line: **idea → designed → built → live**. `triangle-detail.html` puts
the design node at the head of ENG-116's delivery rail — "Designed — approved in crit ·&nbsp;Tue"
with the mock thumbnail as the node's payload (openable, captioned `payment-sheet-v3 · open ↗`)
— and, because the change is visual, the description gains a before/after diptych with mono
captions and a bifact beneath ("The sheet leads with Apple Pay; the card form becomes the
fallback." / `payment-sheet-v3 · approved in crit Tue · built as merged 8f21c4a`). The bifact
grammar now speaks a third dialect: design facts get the same plain-sentence-over-mono pairing
git facts got. `triangle-gallery.html` adds the third lens to the Issues masthead —
List | Board | **Gallery** — rendering the six issues that carry designs as visual cards:
thumbnail, status arc, key, reality-track mini (same glyph DNA, 64px), title, and a design
bifact ("Approved with notes" / `refund-flow-v2 · 2 comments to resolve`). Everything without
a design collapses into one quiet dashed cell: "14 more in this view without designs · List
view →". It is design crit held ON tracked work — the crit wall and the tracker are the same
surface, so "approved in crit" and "checks failing" sit two lines apart on the same card.

**Who finds what.** PM: the chain finally starts at the idea, and "In crit Thursday" is a
schedule fact they can read cold. Designer: their artifact is a node with standing — a
thumbnail, an approval state, a crit date — not an attachment link; Gallery is their homepage.
Engineer: the mock they're building against is one glance from the merge line, and the mono
lines still carry `8f21c4a`.

**Assumes:** (1) a design-artifact attachment kind on issues — name, wireframe/image payload,
version suffix (`-v3`); (2) an `approved`/`in-crit`/`draft` state plus a crit timestamp and a
comment count on that artifact (team-level facts, no reviewer names surfaced); (3) "crit" as a
first-class team event yapm knows about; (4) a Gallery sub-view on saved issue views; (5) the
extended content pack: ENG-117 "Manage saved cards in settings" and artifact names
(`payment-sheet-v3`, `guest-checkout-v2`, `autocomplete-v1`, `refund-flow-v2`,
`empty-states-v1`, `saved-cards-v1`).

**Graduates:** the design node in the delivery rail (say/git bifact + thumbnail payload); the
"idea → designed → built → live" chain caption on the rail header; the quiet-collapse rule
(no design ⇒ no empty thumbnail, ever — same law as the unlinked track); the design bifact
vocabulary ("Approved in crit", "In crit Thursday", "Approved with notes", "Draft — not in
crit yet"). **Stays a sketch:** the Gallery as a full third view (it likely earns its keep
only for design-heavy teams — could ship as a saved-view lens instead of a masthead-level
peer of List|Board); the diptych (needs real image plumbing and a crop story); "Exploring —
three directions" as a state (charming, but a state machine shouldn't be charming).

**Self-critique, one line per artifact.**
- `triangle-detail.png` — the rail now tells the whole triangle and the mock payload feels
  genuinely openable, but the rail has become the page: six stops + thumbnail + callout push
  the properties below the fold, and the doc column's right half is still air.
- `triangle-gallery.png` — the cards read instantly as "designs on tracked work" and the
  quiet cell keeps the view honest, but the dashed collapse cell is large enough to read as
  a dropzone, and two of six thumbnails (empty-state, saved-cards) are generic enough that
  the lens's value depends on real mocks being better than my fakes.
