# PLAY — mockkinds: one design card, two kinds

**The idea.** Designers arrive two ways — they drop an image or they paste a Figma link —
and the triangle's design node must hold either without lying. So the design-artifact card
gets a `kind`: **upload** (an image yapm holds — the card shows the image itself) and
**figma link** (a pointer yapm respects — a drawn overlapping-shapes mark, the artifact
name, the address in mono, a loud "Open in Figma ↗", and the honest no-preview line
"preview arrives with the Figma connector" — never a fake thumbnail, never an iframe).
`mockkinds-specimen.html` runs the pair side by side through every context the card
already earned in earlier plays: the issue-detail Design card, the delivery-rail design
node's 198px payload, the gallery card (the link kind keeps the wall scannable with a
drawn 45° hatch + centered mark + a prominent open-out pill), the crit-queue row, and the
peek card (the one transient, so the one shadow). Both kinds carry the same bifact grammar
and the same **Approved in crit / In crit Thursday / Draft — not in crit yet** chips —
kind changes rendering, never status semantics. It closes with ENG-116's version list
carrying both kinds at once (v1 upload → v2 Figma link → v3 upload, the version crit
approved) — the chain doesn't care how each version arrived. `mockkinds-flow.html` is the
moment itself, on ENG-121: the description composer with a just-pasted raw Figma URL above,
the formed link card below, "attached as design · undo keeps it as plain text" in quiet
mono — beside it the upload path ("drop an image — it becomes a design card"), then the
issue's Design section holding one artifact of each kind, and the mono footnote naming
what stays out of scope: the Figma connector (thumbnails, "mock updated in Figma"
staleness, BYO token, same shape as the GitHub connector).

**Who finds what.** Designer: the paste path costs one keystroke and the card that forms
looks designed, not degraded — their link is not a second-class mock. PM: every visible
word on both faces cold-reads ("In crit Thursday", "linked just now"); the only mono is
addresses, filenames and derivations. Engineer: `open ↗` lands them in the real file
either way, and the version list tells them which version the crit actually approved.

**Assumes:** (1) a design-artifact entity with `kind: upload | link`, an attachment ref or
a URL ref, a version chain, and the crit states from the triangle play (`draft / in-crit /
approved`) living on the artifact, not the file; (2) URL-paste detection in the composer
scoped to figma.com file links, undoable back to plain text; (3) drag-drop images anywhere
on the issue become design cards (png/jpg/webp, pasted screenshots included); (4) the
newest version carries the state, older versions keep their kind and stay openable; (5) no
network fetch on paste — the card's name is typed or defaulted from the URL slug, nothing
scraped; (6) the Figma connector as a later, team-level BYO-token integration mirroring
the GitHub connector's shape.

**Graduates:** the `kind` split and its one law (kind changes rendering, never status
semantics); the link-card face (mark + name + mono address + Open in Figma ↗ + the honest
line) in detail, rail, and queue contexts; the paste-transform moment with its undo
microcopy; the version chain that mixes kinds; the never-fake-preview rule as written
("no iframe · no screenshot we didn't make"). **Stays a sketch:** the hatch-pattern
gallery tile (scannable, but a wall of them would read as a wall of holes — the gallery
may want to group link-kind cards below upload-kind instead); the neutral
overlapping-shapes mark (deliberately not the trademark, but it must survive a legal and
a squint test at 14px); "a pasted screenshot counts" (clipboard-paste plumbing is assumed,
not designed); the peek's `o opens Figma` key overload.

**Self-critique, one line per artifact.**
- `mockkinds-specimen.png` — the side-by-side proves the two faces speak one grammar and
  the honest line never wavers, but the link column's cards are so much shorter than the
  upload column's that the page's right half reads as the poor relation — which is honest,
  and still visually lopsided.
- `mockkinds-flow.png` — the paste→card transform with its undo line is the play's best
  moment and the footnote keeps the connector promise quiet, but the drop zone sits
  permanently beside the composer like a parking space, when in the real app it should
  only materialize while a file is actually being dragged.
