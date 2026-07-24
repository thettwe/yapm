# Direction: **Warm**

A warm-neutral, paper-toned take on a keyboard-first issue tracker. One committed accent —
**terracotta / clay** — carries every interactive state (selection, focus, links, primary action,
the palette highlight). The base is a soft off-white paper in light and a warm espresso charcoal in
dark, never cold slate. Typography is **Figtree** (a friendly geometric-humanist sans) for UI and
**IBM Plex Mono** for issue keys, counts and keyboard hints. The feel: a tool made by people who
care — calm and inviting — without giving up the density an issue list needs.

## Palette (hex)

### Accent — terracotta (the one committed color)
| Token | Light | Dark |
|---|---|---|
| accent (primary) | `#C15A38` | `#DE7A4F` |
| accent-strong (text / links) | `#A94D2F` | `#E88E63` |
| accent-soft (selected-row tint) | `#F6E6DA` | `rgba(222,122,79,0.15)` |
| accent-line (selected border) | `rgba(193,90,56,0.34)` | `rgba(222,122,79,0.42)` |

### Warm neutrals
| Token | Light | Dark |
|---|---|---|
| bg (main list, paper) | `#FAF7F1` | `#1B1613` |
| bg-sidebar | `#F0EAE0` | `#141010` |
| bg-elevated (palette / popover) | `#FFFFFF` | `#241E19` |
| bg-hover | `#F2ECE2` | `rgba(255,247,240,0.04)` |
| border | `#E7E0D4` | `#2C2621` |
| border-strong | `#DCD3C4` | `#38312A` |
| text-1 (primary) | `#2B2620` | `#F1EBE3` |
| text-2 (secondary) | `#6B6357` | `#A79E93` |
| text-3 (muted) | `#9A9186` | `#746B61` |

### Status & signal (earthy, one cool pop for review)
| Token | Light | Dark |
|---|---|---|
| backlog | `#A79E92` | `#7C736A` |
| todo | `#8A8175` | `#948A80` |
| in progress (honey) | `#CE8A26` | `#E7AB44` |
| in review (indigo) | `#6A62C2` | `#9089DA` |
| done (green) | `#3E8C63` | `#59A57B` |
| urgent | `#CC5A40` | `#DF6A4E` |
| sync (connected dot) | `#3E8C63` | `#5EB489` |

Label dots: graph `#C1663E`, github-sync `#7C8794`, perf `#DFA53C`, a11y `#5AA0C4`,
feature `#5E9E6A`, dora `#B47BC0`, triage `#CE824A`, self-hosting `#4FA88E`, ci `#8892A0`.

## Type scale
- **Fonts:** Figtree (300–700 variable, UI) · IBM Plex Mono (400/500 — issue keys, counts, kbd hints). Inlined as base64 for deterministic rendering.
- Issue title — 13.5px / weight 450 / tracking −0.008em
- Issue key (mono) — 12px / 500
- Sidebar nav — 13px / 500
- Header breadcrumb — 13.5px / 600
- Group header label — 12.5px / 600
- Section labels (TEAMS, group names) — 10.5–11px / 600 / uppercase / tracking 0.07em
- Labels & chips — 11.5px / 500
- Palette input — 16px / 450
- Palette item — 14px / 450
- Keyboard hints / footer — 11.5px (mono keys 10.5px)

## Density metrics
- Sidebar width — **244px**
- Topbar height — **52px**; toolbar (filter/display bar) — 41px
- Group header height — **35px**
- **Issue row height — 44px** (a touch more generous than Linear's ~40, still efficient)
- Row inner rhythm — priority 24px · status 24px · key 62px · title (flex) · right cluster (labels · cycle · date 42px · avatar 21px)
- Command palette — 640px wide · input 54px · result row 40px · max results 376px
- Radii — rows & buttons 7–8px · chips/pills 20px · palette card 15px · workspace logo / team squares 5–7px
- Elevation — soft warm shadow (`0 24px 60px -18px rgba(78,52,28,0.28)` light; deep, low-key in dark)

## Why this fits yapm
yapm is the honest, self-hostable alternative built by a small team for small teams, so its surface
should feel human and cared-for rather than enterprise-cold — the terracotta-on-paper warmth signals
exactly that without ever reading as toy-like. The density stays serious (44px rows, tabular mono keys,
grouped-by-status list) because speed and scan-ability are the product's whole promise, and the single
committed accent keeps focus, selection and the command palette unmistakably fast and keyboard-native.
Warm neutrals also make the calm, no-surveillance ethos legible at a glance: this is a tool that invites
you in and gets out of your way.
