# PLAY — refs: every fact is a doorway

**The idea.** The maintainer's note was "internal linking is weak — no internal references here
and there." The answer isn't a `[[wiki-link]]` feature bolted on; in a work-graph product every
fact on screen already IS a node reference — so make the reference a **primitive** with four
faces. (1) **The chip**: one anatomy — kind glyph + key/name in the mono register + the node's
live state worn on the glyph — instantiated identically for all seven kinds (issue, change,
cycle, decision, mock, deploy, retro). The mono register itself is the signal: mono says "node",
Figtree says "word". A chip is never typed twice and never goes stale — ENG-116's chip carries
its status arc and its `//` everywhere it appears, and drops the `//` everywhere at once when
the board catches up. (2) **The peek**: hover/focus answers "what is this?" without navigation —
title, state in the app's words, the track so far, one bifact, and a `⏎ open · esc stay` footer;
a mock's peek leads with its thumbnail because the picture is the answer. (3) **Backlinks**:
citing a node writes the return path automatically — ENG-116 shows "Referenced in 3": cited by
the Cycle 2 report, weighed in the saved-cards decision, born from a Cycle 1 retro action.
(4) **Doors**: every computed number opens the set that produced it — "52 shipped" opens the
filtered issue list, the annunciator count opens the attention set, a flow-band segment opens
its cycle's shipped set. Rest affordance is a dotted ink underline; hover turns it accent and
names the destination in a mono `opens:` line. `refs-specimen.html` is the system sheet;
`refs-applied.html` is the Delivery page wearing it, plus ENG-116's right rail gaining its
return paths — the judge test being: pick any fact, reach the thing it is about in one ⏎, and
see at rest that you can.

**Assumes:** (1) seven referenceable node kinds exist as first-class entities — including the
decision entity (decisions play), mocks as artifacts (triangle play), deploys, and retros;
(2) a generated **cycle report** entity that can cite issues (new here — the digest/report
surface the PM-digest family implies); (3) retro actions can convert into issues and the edge
is recorded (`action → issue`); (4) references are stored as graph edges with a context
snippet captured at cite time, so backlinks render without scanning text; (5) computed metrics
keep their defining query, so any number can open as a filtered list ("if yapm counted it,
yapm can list it"); (6) auto-linking matches live keys (ENG-116, #188) and named artifacts
(payment-sheet-v3, Cycle 2) at word boundaries, seals on space, and one ⌫ reopens to plain
text; (7) peeks are keyboard-reachable (chips are focusable; ⏎ commits, esc dismisses) per the
keyboard-first constraint.

**Graduates:** the chip grammar itself (one anatomy, seven kinds — cheap, and it retires every
ad-hoc key rendering the app currently has); mono-register-means-node as a law; the `opens:`
door rule for computed numbers — it's pure work-graph honesty and no competitor does it; the
auto-written backlink block with cite-time snippets; ⏎/esc peek footer. **Stays a sketch:** the
cycle-report entity (nothing else in v1 emits one yet); the flow-band-segment door (needs the
band itself to graduate first); dotted-underline-at-rest on *every* number — drawn here on one
screen it's calm, but a 120-row list of dotted numbers could read as lint and needs the real
density test; chip-in-running-mono habitat (chips inside derivation footnotes may be one
register collision too many).

**Self-critique, per artifact.**
- `refs-specimen.html` — the seven-kind row proves one grammar really does stretch across the
  graph, but the decision chip's trimmed sentence ("Ship without saved cards…") is doing quiet
  heavy lifting: real decision sentences will truncate worse, and the chip may need a display
  alias the schema doesn't have yet.
- `refs-applied.html` — the round trip (52 → list → ENG-116 → the report/decision/retro that
  point back) lands on one screen, but both open peeks necessarily sit on top of content the
  page was already using — the timeline peek hides the cycle's last three days, which is the
  honest cost of peeks the static frame can't defuse.
