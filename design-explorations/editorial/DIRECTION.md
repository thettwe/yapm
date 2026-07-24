# Editorial — visual design direction for yapm

A confident, print-inspired point of view: strong typographic hierarchy, a
crisp near-monochrome canvas, structural hairline rules, and a single decisive
vermilion accent. A serif masthead gives the tool a spine; a monospace carries
every key, number, and metadata read so it feels engineering-native. Bold, but
disciplined enough for a dense list.

---

## Palette (hex)

### Dark ("Ink") — default
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0B0B0C` | app canvas |
| `--bg-side` | `#0D0D0F` | sidebar / group headers |
| `--bg-elev` | `#161618` | command palette surface |
| `--row-hover` | `#151517` | row hover |
| `--txt` | `#F1EFEA` | primary ink (warm off-white) |
| `--txt-2` | `#9A988F` | secondary |
| `--txt-3` | `#67655E` | tertiary / muted metadata |
| `--line` | `#1F1F21` | hairline rules |
| `--line-2` | `#2B2B2E` | stronger borders / kbd |
| `--accent` | `#FF5A3C` | brand vermilion (focus, active nav, primary btn) |

### Light ("Paper")
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#FCFCFB` | app canvas (whisper-warm paper) |
| `--bg-side` | `#F6F5F2` | sidebar / group headers |
| `--bg-elev` | `#FFFFFF` | command palette surface |
| `--row-hover` | `#F2F0EB` | row hover |
| `--txt` | `#14130F` | primary ink |
| `--txt-2` | `#6B6860` | secondary |
| `--txt-3` | `#9C988E` | tertiary / muted metadata |
| `--line` | `#E9E7E1` | hairline rules |
| `--line-2` | `#DDDACF` | stronger borders / kbd |
| `--accent` | `#E5361B` | brand vermilion |

### Semantic (shared, tuned per theme)
| Meaning | Dark | Light |
|---|---|---|
| Status · Backlog / Todo (muted) | `#6E6C66` | `#A19E95` |
| Status · In Progress (amber) | `#E7A93A` | `#C98A15` |
| Status · In Review (violet) | `#9B8CF5` | `#6D5FE0` |
| Status · Done (green) | `#4FAE83` | `#2F9068` |
| Priority · Urgent (orange square) | `#F0872E` | `#D9741C` |
| Sync "connected" dot | Done-green | Done-green |

Priority (Low/Medium/High) uses neutral three-bar glyphs in `--txt-2` so red is
never overloaded — vermilion stays reserved for brand + interaction, Urgent gets
a distinct orange square. Assignee avatars are fixed muted editorial tones
(terracotta `#C2603F`, sage `#4F7A6B`, periwinkle `#6A6DB0`, ochre `#A9822F`,
plum `#9C5A7A`, steel `#3F6E9E`).

---

## Type

Three families, each with a job:

- **Fraunces** (variable serif, high optical contrast) — display only: the
  "Acme" wordmark and the big view title ("Active"). This is the editorial
  "spine." Fallback: Georgia.
- **Inter** — body/UI sans: issue titles, labels, buttons, nav. Tight tracking
  (`-0.006em`) keeps dense rows crisp. Fallback: system-ui.
- **JetBrains Mono** — every key, number, and metadata: issue keys (`ENG-142`),
  counts, dates, cycle, keyboard hints, and all uppercase section captions.
  Fallback: ui-monospace / Menlo.

### Scale
| Role | Font | Size / weight | Tracking |
|---|---|---|---|
| View title | Fraunces | 29px / 600 | -0.02em |
| Workspace wordmark | Fraunces | 16px / 600 | -0.01em |
| Issue title | Inter | 13px / 500 | -0.008em |
| Nav item | Inter | 12.5px / 500–600 | — |
| Issue key | JetBrains Mono | 11.5px / 400 (600 on focus) | -0.01em |
| Metadata (date, cycle, count) | JetBrains Mono | 10.5px / 400 | — |
| Section caption (VIEWS, uppercase) | JetBrains Mono | 10–10.5px / 400 | 0.14–0.16em |
| Label tag | JetBrains Mono | 10px / 400 | — |
| Keyboard hint (`kbd`) | JetBrains Mono | 10.5–11px | — |

---

## Density metrics

| Metric | Value |
|---|---|
| Issue row height | 42px |
| Group header height | 33px (sticky, with flex hairline rule) |
| Sidebar width | 248px |
| Sidebar nav item height | 29px (26px sub-item) |
| Command palette width | 664px |
| Palette result row height | 37px |
| Row horizontal padding | 22px |
| Row column order | check · priority · status · key(62px) · title(flex) · labels · cycle(44px) · date(46px) · avatar(21px) |
| Focus row | 3px vermilion left bar + 8–9% accent tint + key recolored + checked box |
| Hover row | `--row-hover` fill + revealed checkbox |
| Hairlines | 1px, on every row / group / header edge |

---

## Rationale

yapm's soul is speed, keyboard-first flow, and calm honesty — so this direction
spends its boldness on structure and type rather than chrome, giving a designed,
intentional feel without a single gradient, shadow-heavy card, or decorative
color to slow the eye down. The monospace treatment of keys, cycles, and metadata
reads as engineering-native and makes the work-graph data (PRs, deploys, DORA
views) look like first-class facts rather than form fields, while the lone
vermilion accent turns focus and the command palette into unmistakable, fast
signals. It looks like a tool someone with taste built — and stays legible and
dense enough that a 12-row list never fights the design.
