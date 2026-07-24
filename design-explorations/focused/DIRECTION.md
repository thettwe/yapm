# Direction: "Focused"

A precision instrument for work tracking. Linear-grade density and restraint: a
near-monochrome neutral field, one restrained iris accent, hairline borders instead
of shadows, and a tight-but-breathable row rhythm tuned for scanning long lists.
Dark is the primary target; light is a faithful sibling built from the same tokens.

---

## Palette

The system is deliberately near-monochrome. Color is spent only where it carries
meaning: the single iris accent (selection, focus, "done", brand) and the small set
of semantic status/label hues.

### Dark (primary)
| Token | Hex | Use |
|---|---|---|
| `bg` | `#0B0C0E` | app base |
| `bg-sidebar` | `#0A0B0D` | sidebar (deepest) |
| `bg-content` | `#0D0E11` | list surface |
| `bg-elevated` | `#17181C` | command palette |
| `bg-hover` | `rgba(255,255,255,.035)` | row / control hover |
| `bg-selected` | `rgba(255,255,255,.055)` | focused row |
| `border` | `rgba(255,255,255,.07)` | hairline dividers |
| `border-strong` | `rgba(255,255,255,.11)` | palette edge, kbd |
| `text-1` | `#E9EAEC` | primary |
| `text-2` | `#9A9EA6` | secondary |
| `text-3` | `#676C74` | tertiary / meta |
| `text-4` | `#474B52` | faint (empty bars, dots) |
| **`accent`** | **`#6E79F0`** | selection, focus, done, brand |
| `accent-muted` | `rgba(110,121,240,.15)` | active row wash |

### Light
| Token | Hex |
|---|---|
| `bg` / `bg-content` | `#FFFFFF` |
| `bg-sidebar` | `#FBFBFA` (warm off-white) |
| `bg-elevated` | `#FFFFFF` |
| `border` | `rgba(0,0,0,.09)` |
| `text-1` | `#17181A` |
| `text-2` | `#5F636B` |
| `text-3` | `#898E96` |
| **`accent`** | **`#5B63D6`** (deepened for AA on white) |
| `accent-muted` | `rgba(91,99,214,.10)` |

### Semantic hues (both themes, used sparingly)
| Meaning | Hex |
|---|---|
| Backlog | `#6B7078` (dashed ring) |
| Todo | `#8A8F97` (solid ring) |
| In Progress | `#E0A63C` amber (45% pie) |
| In Review | `#3F9E7C` green (75% pie) |
| Done | `accent` (filled + check) |
| Urgent priority | `#E2593F` vermilion square |
| Label dots | violet `#8B7FF0` · slate `#7F96B8` · teal `#3F9E7C` · blue `#4F8FD6` · pink `#D06FA0` · green `#4F9D5B` · cyan `#3FB0C2` · iris `#6E79F0` |

---

## Typography

- **Family:** `"Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`
  — a clean modern sans; renders as Inter/SF, tuned for scanning.
- **Global tracking:** `-0.006em` (tightens the grotesque for density without hurting legibility).
- **Numerals:** `font-variant-numeric: tabular-nums` on every issue key, count, cycle, and age so columns align and never jitter.

| Role | Size | Weight |
|---|---|---|
| Palette search input | 15px | 400 |
| Header / palette section title | 14px | 600 |
| Row title, sidebar item, palette row | 13px | 400–500 |
| Issue key, counts, ages, kbd | 12px | 400 (tabular) |
| Labels, section headers, meta, hints | 11px | 400 / 600 caps |

Scale (px): **11 · 12 · 13 · 14 · 15**. A single restrained ramp — no display sizes;
the surface is a working list, not a marketing page.

---

## Density metrics

| Element | Value |
|---|---|
| Sidebar width | 236px |
| Issue row height | **36px** (tight but breathable) |
| Group header height | 34px |
| App header height | 48px |
| Filter sub-bar height | 38px |
| Sidebar nav item | 29px |
| Command palette row | 38px |
| Status / priority mark | 14px |
| Assignee avatar | 20px (18px in palette) |
| Corner radius | 6–8px controls · 14px palette |
| Elevation | hairline borders everywhere; a real shadow **only** on the command palette |

Selection & focus: the focused row carries a 2px iris left-rail plus a faint wash and
a revealed checkbox; hover is a lighter wash only. In the palette, the active row uses
an iris-muted fill with a 1px iris inset ring.

---

## Why this fits yapm

**Speed is the feature, so the UI should feel like an instrument, not an app** — hairline
borders, a monochrome field, and tabular numerals keep the eye moving down a long list
at a glance, and the keyboard-native command palette is treated as a first-class surface
rather than a bolt-on. **Restraint signals trust**: spending color only on meaning (status,
one accent) mirrors yapm's "reality over ritual, metrics not surveillance" ethos — nothing
shouts, nothing nags, no upgrade banners. **Calm and self-hostable**: a single token set
drives both dark and light with no heavy chrome, so the product reads as fast, quiet, and
professional — the open-source Linear alternative it claims to be.
