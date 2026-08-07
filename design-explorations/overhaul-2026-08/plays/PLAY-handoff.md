# PLAY — handoff: the two seams as designed moments

**The idea.** The triangle (PM's why → Design's what → Engineering's how → live) has two seams,
and today both are silent status changes. This play renders each seam as the most designed moment
in the product. `handoff-moment.html` is ENG-121 at the instant design hands to engineering: a
composed **Ready to build** block sits above the description — the approved mock as an inline-SVG
wireframe with numbered redline markers, three plain acceptance notes written by the designer
(numbers matching the frame), a **decided / still open** split that says which questions are
closed and which are the builder's to make, and the page's ONE terracotta action, **Start
building ⏎** (flips todo → in-progress, assigns you, carries the notes into the change). Below
it, ghosted at 62% with a dashed border, the second seam for contrast: **Built — ready to
verify**, which composes itself when the change merges — the same acceptance notes returned as a
checklist, where it runs (`pay.acme.dev/eng-121 · card 4242…`), Verify ✓ / Reopen. The rail draws
the whole triangle as a track (Why · Product ● — What · Design ● — How · Engineering ○ — Live ○)
over the PM's why in full sentences. `handoff-queue.html` is **Ready for you** — one compact
queue off Home of everything waiting at a seam: Ready to build (2, engineers), Awaiting design
(2, designers), Ready to verify (1, product), sections ordered by count so the biggest pile wins,
every 44px row a doorway with its mock-thumb / brief-mini / track-mini and a bifact
("Design approved yesterday" / `mock v3 · 3 acceptance notes · waiting 18h`).

**Why it's yapm's own.** Trackers record that a status changed; none of them design the moment
work crosses a craft boundary. And the bifact + glyph vocabulary already speaks both registers,
so the same block serves the PM (plain sentences, the why), the designer (the mock is a
first-class citizen, notes travel with it), and the engineer (mono facts, one keystroke to take
it) without three views.

**Assumes:**
- A **handoff state pair** on the status machine: `ready-to-build` (design → eng) and
  `ready-to-verify` (eng → product), each with an enter timestamp ("waiting 18h").
- **Transition notes**: 1–5 plain acceptance lines authored at handoff, stored on the issue,
  echoed back as the verify checklist when the linked change merges.
- **Design artifacts on issues**: versioned mock attachments (v1..v3) with an approved flag and
  a thumbnail render.
- A **decided / open** list per issue (two short arrays of sentences, each open item ownable by
  a role).
- A **preview-environment URL** surfaced from the connector (deploy/staging link per change).
- "Start building" as a compound mutator: status flip + self-assign + note propagation.

**Graduate:** the two-seam status pair and its queue (order by count is the whole politics of the
page); the acceptance-notes-become-verify-checklist loop; the Start building compound action with
its plain "what this does" line; numbered notes ↔ numbered markers on the mock. **Stay a
sketch:** the rail's FROM WHY TO LIVE track (fourth vertex "Live" may belong to the delivery rail
instead), the decided/open split as structured data (might just be prose conventions), redline
markers drawn by hand in the SVG (real mocks need an annotation tool or nothing), and the ghosted
way-back block — teaching UI that may only deserve to appear the first few times.

**Self-critique, one line each:**
- `handoff-moment.html` — the Ready to build card earns its size, but it pushes the description
  below the second seam, and on an issue with a long discussion the "moment" would have to
  collapse to a strip after the handoff is taken — that collapsed state is undesigned.
- `handoff-queue.html` — three seams, five rows, and each role's lane reads in one scan, but the
  page is so calm it borders on empty; it hasn't proven what 30 waiting handoffs look like, and
  "the why is written, needs a what" is one clever line away from cute.
