# frame/ — The Shell Revival

**Thesis:** ship the half of the chosen Warm direction that never shipped — the designed frame.
The 244px warm sidebar (`--density-sidebar` has sat unused in globals.css since the mockups),
workspace masthead, terracotta rail, and a real title line per surface. Surfaces stay close to
today's content; the frame is the argument.

**What moved vs today:**
- The horizontal pill switcher is dead. Navigation lives in a `--bg-sidebar` tree: workspace
  masthead + search (⌘K), Inbox/My Issues/Search, a TEAMS section with Engineering expanded
  [structural]; the top bar shrank to breadcrumb + GitHub-synced [structural].
- Terracotta rail marks the active nav item, the selected issue row, and the palette selection —
  one signature, three surfaces [token: `--accent`, `--accent-soft`] [structural].
- Masthead discipline: page name in display size, count in mono, actions right, one strong
  hairline (`--border-strong`) [structural]. Sections are rules, not cards.
- Rows keep 44px density and gain the connected reality strip (PR/CI/deploy/review-age, fixed
  ~100px slot) with the divergence triangle [structural; tones are existing status tokens].
- Detail: the deploy wall is replaced by a compact delivery rail — PR → review → CI → deploy as
  a drawn timeline plus a worded divergence note with "Move to Done" [structural].
- Delivery: card tiles flattened into a hairline lattice (1px `--border` grid gaps) and a new
  ship-cadence bar strip (production `--accent`, staging `--border-strong`, failures
  `--status-urgent`, superseded `--accent-line`) — team-level only [structural].
- Palette: 680px, workspace-masthead echo in its header, right-aligned mono key column, footer
  key choreography, warm ink scrim (`--text-1` at 22%) [structural + token].

**Token extensions (noted in each file's header comment):** row hairline `#efe9dd` (lightened
`--border`); `--urgent-soft` rgba(204,90,64,0.08) for the divergence surface — same derivation
rule as `--accent-soft`. No new hues anywhere.

**Self-critique:**
- issue-list: the frame carries it, but with only 11 pack rows the paper below the last group
  reads emptier than a real 120-issue list would.
- issue-detail: the delivery rail is the best moment; the main column is under-used at 1440
  and the composer floats in a lot of quiet paper.
- delivery: the lattice + cadence strip flatten well, but the empty eighth cell in DELIVERED
  betrays that the grid wants a fourth-row metric it doesn't have.
- palette: strongest surface — though the workspace echo header adds a row Linear wouldn't
  have, and judges may call it ceremony.
