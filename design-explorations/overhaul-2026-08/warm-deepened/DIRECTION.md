# warm-deepened — the control

**Thesis:** keep the frame, draw the data. Same top bar, same horizontal view switcher, same
regions and 44px rows as today — the only spend is (1) a flat elevation budget and (2) replacing
glyph-soup with connected, drawn structure. If this direction wins, the overhaul is a re-render,
not a re-architecture.

What moved vs today:

- **Elevation budget** [structural]: every persistent surface is de-carded — pill-group nav, filter
  buttons, delivery tiles, detail panels all become flat regions separated by 1px `--border`
  hairlines. Rounded card + warm shadow survive only on the transient palette.
- **View switcher** [structural]: same tabs, now flat text with a 2px `--accent` underline [token].
- **Reality track** [structural]: the row's four disconnected glyphs become one drawn PR→CI→review
  →deploy track (~118px slot incl. mono age); segments/nodes filled in the existing status tones
  [token]. CI-failing is a square node (shape, not hue alone). Divergence is a drawn BREAK — two
  urgent slashes and a gap before a hollow urgent deploy node — replacing the corner triangle.
- **Issue detail** [structural]: the deploy text-wall becomes a vertical delivery rail (metro line,
  mono timestamps); the divergence sentence is a designed callout anchored at the rail's break, and
  the breadcrumb carries a compact `// status ≠ git` mark.
- **Delivery view** [structural]: same tile grid, flattened into a ledger of hairline cells; all
  sparklines share one 6-cycle axis (faint guide columns line up across every tile, drawn even when
  a metric has no series); a slim two-lane ship-cadence dot strip (production/staging, Feb→Aug)
  sits under the header. Trend glyphs toned better/worse/neutral with existing status hues [token].
- **Palette** [token]: structurally unchanged; mono section labels, hairline rules, mono key hints,
  lighter warm scrim.

Token extensions (noted in each file's head comment): a divergence callout border at
`rgba(204,90,64,.34)` — the urgent hue at `--accent-line`'s alpha; no other new values anywhere.

Self-critique per surface:
- `issue-list.html` — the empty four-dot tracks still spend ~118px per row saying "nothing yet";
  quiet, but six rows of nothing is a lot of drawn nothing.
- `issue-detail.html` — the rail is convincing but the main column is now emptier than the sidebar
  is interesting; the page's center of gravity sits right.
- `delivery.html` — guide-only sparklines on no-history tiles prove the shared axis yet can read as
  a rendering glitch at a glance.
- `palette.html` — safest surface, least evidence: it mostly proves the mono/rule language survives
  contact with a floating card.
