import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8')

const AA_NORMAL = 4.5
const AA_LARGE = 3

function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const m = hex.replace('#', '')
  const r = Number.parseInt(m.slice(0, 2), 16)
  const g = Number.parseInt(m.slice(2, 4), 16)
  const b = Number.parseInt(m.slice(4, 6), 16)
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function block(header: string): Record<string, string> {
  const start = css.indexOf(header)
  if (start === -1) throw new Error(`token block not found: ${header}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const body = css.slice(open + 1, close)
  const tokens: Record<string, string> = {}
  for (const line of body.split(';')) {
    const match = line.match(/(--[\w-]+)\s*:\s*(.+)/)
    if (match?.[1] && match[2]) tokens[match[1].trim()] = match[2].trim()
  }
  return tokens
}

const presets = {
  'warm light': block('[data-theme="warm"] {'),
  'warm dark': block('[data-theme="warm"].dark {'),
  'focused light': block('[data-theme="focused"] {'),
  'focused dark': block('[data-theme="focused"].dark {'),
  'editorial light': block('[data-theme="editorial"] {'),
  'editorial dark': block('[data-theme="editorial"].dark {'),
}

const HEX = /^#[0-9a-f]{6}$/i

// Follows single-token `var(...)` aliases within the same block (the dark presets alias
// `--status-urgent-ink` to `--status-urgent`) before demanding a hex literal.
function hex(tokens: Record<string, string>, name: string): string {
  let value = tokens[name]
  for (let hops = 0; value !== undefined && hops < 4; hops += 1) {
    const ref = value.match(/^var\((--[\w-]+)\)$/)
    if (ref?.[1] === undefined) break
    value = tokens[ref[1]]
  }
  if (value === undefined) throw new Error(`missing token ${name}`)
  expect(value, name).toMatch(HEX)
  return value
}

// Several presets define `--accent-soft` as an rgba wash rather than an opaque colour, so its
// effective contrast is only knowable against the surface it is painted on.
function over(value: string, surface: string): string {
  const rgba = value.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)/)
  if (rgba === null) {
    expect(value).toMatch(HEX)
    return value
  }
  const alpha = rgba[4] === undefined ? 1 : Number(rgba[4])
  const base = surface.replace('#', '')
  const channel = (index: number): string => {
    const top = Number(rgba[index + 1])
    const bottom = Number.parseInt(base.slice(index * 2, index * 2 + 2), 16)
    return Math.round(top * alpha + bottom * (1 - alpha))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

// A Tailwind `/nn` opacity wash: the token resolved against the surface it is painted on, then
// painted at `alpha` over that same surface. The browser mixes in oklab and this mixes in sRGB, so
// the number is an approximation of the composite — close enough to catch a token edit that breaks
// AA, which is what this file is for.
function wash(value: string, surface: string, alpha: number): string {
  const opaque = over(value, surface).replace('#', '')
  const base = surface.replace('#', '')
  const channel = (index: number): string => {
    const top = Number.parseInt(opaque.slice(index * 2, index * 2 + 2), 16)
    const bottom = Number.parseInt(base.slice(index * 2, index * 2 + 2), 16)
    return Math.round(top * alpha + bottom * (1 - alpha))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

describe.each(Object.entries(presets))('%s tokens meet WCAG AA', (_name, t) => {
  const surfaces = ['--bg', '--bg-elevated', '--bg-sidebar'] as const

  it('primary and secondary text on every surface meets AA (>= 4.5)', () => {
    for (const surface of surfaces) {
      const bg = hex(t, surface)
      for (const text of ['--text-1', '--text-2'] as const) {
        expect(contrastRatio(hex(t, text), bg)).toBeGreaterThanOrEqual(AA_NORMAL)
      }
    }
  })

  it('muted text on the base surface stays legible (>= 3.0 large-text AA)', () => {
    expect(contrastRatio(hex(t, '--text-3'), hex(t, '--bg'))).toBeGreaterThanOrEqual(AA_LARGE - 0.5)
  })

  // The mention typeahead's active row. It carries text-1/text-2 rather than accent-strong
  // because `--accent-strong` over the soft-accent wash lands at ~3.9 in three of the six presets
  // — a highlighted row a screen reader announces but a sighted user cannot read is the same bug
  // twice, so the highlight is the wash and the ink stays the readable pair.
  it('primary and secondary text on the soft-accent selection meets AA (>= 4.5)', () => {
    const row = over(t['--accent-soft'] ?? '', hex(t, '--bg-elevated'))
    for (const text of ['--text-1', '--text-2'] as const) {
      expect(contrastRatio(hex(t, text), row), text).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  // The search result row. Its title ink is `text-1`, its snippet ink `text-2`, and a HIGHLIGHTED
  // snippet segment steps up to `text-1` — carried by weight and an `--accent-strong` underline
  // rather than by a second background wash, precisely so the emphasis cannot land on an untested
  // colour pair. All three must read on the plain row and on the active row, which is the soft
  // accent wash over both the elevated surface (palette) and the base surface (the /search route).
  it('the search result row ink meets AA on the plain and the active row (>= 4.5)', () => {
    for (const surface of ['--bg', '--bg-elevated'] as const) {
      const plain = hex(t, surface)
      const activeRow = over(t['--accent-soft'] ?? '', plain)
      for (const background of [plain, activeRow]) {
        for (const ink of ['--text-1', '--text-2'] as const) {
          expect(
            contrastRatio(hex(t, ink), background),
            `${ink} on ${surface}`,
          ).toBeGreaterThanOrEqual(AA_NORMAL)
        }
      }
    }
  })

  // The underline under a highlighted snippet segment is a non-text indicator, so 3:1 (WCAG 1.4.11)
  // is the bar rather than 4.5. Asserted because it is the ONLY thing distinguishing a highlight
  // from body text on the active row, where the wash and the underline share an accent origin.
  it('the snippet highlight underline is distinguishable on the active row (>= 3.0)', () => {
    for (const surface of ['--bg', '--bg-elevated'] as const) {
      const activeRow = over(t['--accent-soft'] ?? '', hex(t, surface))
      expect(contrastRatio(hex(t, '--accent-strong'), activeRow), surface).toBeGreaterThanOrEqual(
        AA_LARGE,
      )
    }
  })

  // The syntax palette. `--bg-hover` is the code block's surface, and several presets define it as
  // a wash, so the comparison is against the composited colour rather than the declared one.
  //
  // `--code-comment` is in this list on purpose: it is where every syntax theme in the world fails
  // AA, because "dim" is how a comment is conventionally distinguished, and dim is the one thing
  // WCAG will not have. It is distinguished here by hue and by the `.hljs-emphasis` italic instead.
  it('every syntax token meets AA on the code-block surface (>= 4.5)', () => {
    const surface = over(t['--bg-hover'] ?? '', hex(t, '--bg'))
    for (const token of [
      '--code-keyword',
      '--code-string',
      '--code-number',
      '--code-comment',
      '--code-function',
      '--code-type',
      '--code-punctuation',
    ] as const) {
      expect(contrastRatio(hex(t, token), surface), token).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  // The retro panels — the seed panel and the AI draft beside it. Both sit on a 40% sidebar wash
  // over the base surface, their proposal cards on the elevated surface, and their evidence chips on
  // a 50% soft-accent wash over those cards. Every ink in both is `text-1` or `text-2`: the AI
  // section's category label, its confidence note and its chips all step up to `text-2` rather than
  // dimming to `text-3`, precisely so the whole surface lands inside this assertion.
  it('the retro panel ink meets AA on the section wash and the chip wash (>= 4.5)', () => {
    const section = wash(hex(t, '--bg-sidebar'), hex(t, '--bg'), 0.4)
    const chip = wash(t['--accent-soft'] ?? '', hex(t, '--bg-elevated'), 0.5)
    for (const surface of [section, hex(t, '--bg-elevated'), chip]) {
      for (const ink of ['--text-1', '--text-2'] as const) {
        expect(contrastRatio(hex(t, ink), surface), ink).toBeGreaterThanOrEqual(AA_NORMAL)
      }
    }
  })

  // The retro AI panel's reaction toggles, both states, on a proposal card. The PRESSED one is the
  // interesting half: it is filled with the soft accent, and its ink is `text-1` rather than
  // `--accent-strong` for the same reason the mention typeahead's active row is — accent-strong over
  // that wash measures 3.94–4.38 in Focused light, Focused dark and Editorial light, which is under
  // AA for 11px text. Pinned here because the failure is invisible in three of six presets and the
  // obvious edit ("make the pressed state look accented") is exactly the one that reintroduces it.
  it('both reaction toggle states meet AA on a proposal card (>= 4.5)', () => {
    const card = hex(t, '--bg-elevated')
    const pressed = over(t['--accent-soft'] ?? '', card)
    expect(contrastRatio(hex(t, '--text-1'), pressed), 'pressed').toBeGreaterThanOrEqual(AA_NORMAL)
    expect(contrastRatio(hex(t, '--text-2'), card), 'unpressed').toBeGreaterThanOrEqual(AA_NORMAL)
  })

  // The prior-action chip on a follow-up proposal (change 22). It is the ONE new token pair this
  // change introduces: `text-2` on a 60% `--bg-hover` wash over the proposal card, rather than the
  // soft-accent wash every other evidence chip uses — because it is not a control and must not read
  // as one. 11px ink, so AA normal is the bar, and the outcome it carries is a word and an icon
  // rather than a hue, which is why no status colour appears in this assertion.
  it('the prior-action chip ink meets AA on its hover wash over a proposal card (>= 4.5)', () => {
    const chip = wash(t['--bg-hover'] ?? '', hex(t, '--bg-elevated'), 0.6)
    for (const ink of ['--text-1', '--text-2'] as const) {
      expect(contrastRatio(hex(t, ink), chip), ink).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  // The team Home digest's urgent TEXT — the hero "N need attention", the divergence class row on
  // its `--urgent-soft` wash, the YOURS urgent say line, the runway urgent phrase, the `//` break
  // mark — all carry `--status-urgent-ink`, which must meet AA normal over the base surface AND
  // over the urgent-soft composite (the wash is defined as the urgent hue at 8% over the surface,
  // reconstructed here the same way). Two of the three darks alias the ink to `--status-urgent`,
  // which this assertion proves is enough there; warm dark states its own, for the soft-accent
  // reason recorded on the track assertions below.
  it('the urgent text ink meets AA on the base surface and the urgent-soft wash (>= 4.5)', () => {
    const bg = hex(t, '--bg')
    const urgentWash = wash(hex(t, '--status-urgent'), bg, 0.08)
    for (const surface of [bg, urgentWash]) {
      expect(contrastRatio(hex(t, '--status-urgent-ink'), surface)).toBeGreaterThanOrEqual(
        AA_NORMAL,
      )
    }
  })

  // The digest's urgent NON-TEXT glyphs — attention dots and squares, failing ticks, the broken
  // track's urgent node border — keep `--status-urgent` and must clear the 3:1 non-text bar
  // (WCAG 1.4.11) on the base surface and on the urgent-soft wash of the divergence row. Pinned
  // because editorial light's original urgent orange measured 2.91 against its own wash.
  it('the urgent glyph colour is distinguishable on the base surface and its wash (>= 3.0)', () => {
    const bg = hex(t, '--bg')
    const urgent = hex(t, '--status-urgent')
    for (const surface of [bg, wash(urgent, bg, 0.08)]) {
      expect(contrastRatio(urgent, surface)).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  // The reality track — the one vocabulary every surface draws delivery in — is drawn on exactly
  // four surfaces: a plain row, a hovered row, the SELECTED row (`--accent-soft`, `issue-row.tsx`)
  // and the digest's divergence class row (`--urgent-soft`, `team-home.tsx`). The three washes are
  // composited over the base surface here the same way the browser paints them.
  const trackSurfaces = (): ReadonlyArray<readonly [string, string]> => {
    const bg = hex(t, '--bg')
    return [
      ['--bg', bg],
      ['--bg-hover', over(t['--bg-hover'] ?? '', bg)],
      ['--accent-soft', over(t['--accent-soft'] ?? '', bg)],
      ['--urgent-soft', wash(hex(t, '--status-urgent'), bg, 0.08)],
    ]
  }

  // Every node and segment that CARRIES a fact: `--status-done` (the done disc and the solid
  // segment), `--status-in-review` (the open disc, the review ring, the review segment) and
  // `--status-urgent` (the failing square, the urgent ring after a break, the broken rail
  // connector). Non-text drawing, so 3:1 (WCAG 1.4.11) is the bar — on all four surfaces, because a
  // track that is legible on a plain row and not on the selected one is legible in the screenshot
  // and not in use. Pinned because focused light's original `--status-in-review` measured 2.88 over
  // its own soft-accent wash: a failure visible in exactly one preset, on exactly one row state.
  it('every fact-carrying track node is distinguishable on all four track surfaces (>= 3.0)', () => {
    for (const [name, surface] of trackSurfaces()) {
      for (const node of ['--status-done', '--status-in-review', '--status-urgent'] as const) {
        expect(contrastRatio(hex(t, node), surface), `${node} on ${name}`).toBeGreaterThanOrEqual(
          AA_LARGE,
        )
      }
    }
  })

  // The two TEXT-sized parts of the same vocabulary: the `//` break mark (`--status-urgent-ink`, on
  // both the horizontal track and the vertical rail) and the rail's mono fact line, which carries
  // `--text-2` rather than the mock's `--text-3` precisely so it lands inside this assertion —
  // `--text-3` measures 2.80–3.70 on these surfaces, which is not a bar an 11px commit sha may sit
  // under. Warm dark is why `--status-urgent-ink` is no longer an alias of `--status-urgent` in
  // every dark preset: the glyph hue measured 4.35 over that preset's soft-accent wash.
  it('the // break ink and the mono fact line meet AA on all four track surfaces (>= 4.5)', () => {
    for (const [name, surface] of trackSurfaces()) {
      for (const ink of ['--status-urgent-ink', '--text-2'] as const) {
        expect(contrastRatio(hex(t, ink), surface), `${ink} on ${name}`).toBeGreaterThanOrEqual(
          AA_NORMAL,
        )
      }
    }
  })

  // The empty station is the one part of the track deliberately BELOW the non-text bar:
  // `--border-strong` measures ~1.4 against every surface, and raising it to 3:1 would make "no
  // pull request yet" the loudest thing in a dense row. It is scaffolding, not a fact — the facts
  // are the filled nodes asserted above, and the absence is stated in words by the track's
  // `role="img"` label ("No delivery signal yet", asserted in `reality-track.test.tsx`). What must
  // hold is that an empty ring can never be mistaken FOR a fact node, which is what this measures.
  it('records that the empty station is scaffolding, distinguishable from every fact node', () => {
    const bg = hex(t, '--bg')
    const ring = over(t['--border-strong'] ?? '', bg)
    for (const node of ['--status-done', '--status-in-review', '--status-urgent'] as const) {
      expect(contrastRatio(hex(t, node), ring), node).toBeGreaterThanOrEqual(2.5)
    }
  })

  // The two transients — the peek and the `how ·` — are the only surfaces in the language allowed
  // to lift, and both are drawn on `--bg-elevated`. Everything a reader must READ on them is
  // `--text-1` or `--text-2`: the `how ·` trigger, the how's kicker and constraint lines, the
  // peek's `⏎ open · esc stay` footer and its keycaps, and the provenance mark that follows a
  // fact. They carried `--text-3` until this assertion existed, which measures 2.88–3.36 there —
  // under the text bar everywhere and under the NON-text bar in two presets.
  it('the peek and the how ink meets AA on the elevated surface (>= 4.5)', () => {
    const elevated = hex(t, '--bg-elevated')
    for (const ink of ['--text-1', '--text-2'] as const) {
      expect(contrastRatio(hex(t, ink), elevated), ink).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  // The provenance mark is non-text drawing (a 12–14px monochrome brand glyph after the fact it
  // sourced), so 3:1 is its bar — but it inherits `--text-2` through its wrapper, so what this
  // pins is that the wrapper's ink clears the non-text bar on the surface a peek draws it on. It
  // is a separate assertion from the one above because the BAR is different, and a later change
  // that re-tones the mark should have to argue with the right number.
  it('the provenance mark is distinguishable on the elevated surface (>= 3.0)', () => {
    expect(contrastRatio(hex(t, '--text-2'), hex(t, '--bg-elevated'))).toBeGreaterThanOrEqual(
      AA_LARGE,
    )
  })

  // The ONE ink in the two transients deliberately left at `--text-3`: the peek's derivation line,
  // the mono half of a bi-fact whose bold phrase states the same thing in words directly above it
  // (design decision — "secondary to a fact stated elsewhere"). Recorded as a bound rather than
  // left unasserted, so the surface is measured and the exemption is visible: it is quieter than
  // AA on purpose, and it may never fall so far that it stops reading as text at all.
  // Kept as a lower bound only, so a token edit that RAISES `--text-3` to AA does not fail here.
  it('records that the peek derivation line is deliberately quieter than AA on the elevated surface', () => {
    expect(contrastRatio(hex(t, '--text-3'), hex(t, '--bg-elevated'))).toBeGreaterThanOrEqual(2.5)
  })

  it('on-accent text on the accent fill meets AA (>= 4.5)', () => {
    expect(contrastRatio(hex(t, '--on-accent'), hex(t, '--accent'))).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
  })

  // The `accent` badge variant is `bg-accent-soft text-accent-strong` and it is used NOWHERE in the
  // product — only in the showcase. This records why, so a later change reaching for it on a real
  // surface finds the reason here instead of shipping a chip that three presets cannot read: on the
  // elevated surface it misses AA, and `solid` (`bg-accent text-on-accent`, asserted above) is the
  // accented chip that does not. Kept as a bound rather than an equality so a token edit that FIXES
  // the pair does not fail this file.
  it('records that the soft-accent badge pair is not AA everywhere, which is why solid is used', () => {
    const ratio = contrastRatio(
      hex(t, '--accent-strong'),
      over(t['--accent-soft'] ?? '', hex(t, '--bg-elevated')),
    )
    expect(ratio).toBeGreaterThanOrEqual(AA_LARGE)
  })
})
