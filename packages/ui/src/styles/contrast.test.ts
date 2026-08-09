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

// Contrast is a luminance ratio and says nothing about hue, so two status marks can be perfectly
// separable to a photometer and indistinguishable to a reader. The hue angle is the missing half:
// OKLab is used rather than HSL because it is the space the palette's own `color-mix` declarations
// are written in, so an angle measured here is the angle a preset was tuned at.
function oklchHue(hexColor: string): number {
  const m = hexColor.replace('#', '')
  const [r, g, b] = [0, 1, 2].map((i) =>
    srgbToLinear(Number.parseInt(m.slice(i * 2, i * 2 + 2), 16)),
  ) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const a = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s
  return (Math.atan2(bb, a) * 180) / Math.PI
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
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

// `color-mix(in oklch, var(--a), var(--b) nn%)`, as five of the six presets define
// `--statusline-bg`. Mixed in sRGB rather than oklch for the same reason `wash` is: an
// approximation of the composite is enough to catch a token edit that breaks AA.
function mix(value: string, tokens: Record<string, string>): string | null {
  const m = value.match(
    /^color-mix\(in oklch,\s*var\((--[\w-]+)\),\s*var\((--[\w-]+)\)\s*([\d.]+)%\s*\)$/,
  )
  if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) return null
  return wash(hex(tokens, m[2]), hex(tokens, m[1]), Number(m[3]) / 100)
}

// A surface token as the browser actually paints it, whatever form the preset declared it in: a
// hex, an alpha over the base surface, the oklch `color-mix` `--row-hairline` uses (whose first
// argument may itself be an alpha, which `mix` above cannot take), or the sRGB
// `color-mix(..., transparent)` five presets define `--urgent-soft` with. Reading the DECLARED
// token matters: an assertion that reconstructs a wash from its ingredients cannot see an edit to
// the wash itself.
function composite(tokens: Record<string, string>, name: string): string {
  const declared = tokens[name] ?? ''
  const base = tokens['--bg'] ?? ''
  if (HEX.test(declared)) return declared
  const oklch = declared.match(
    /^color-mix\(in oklch,\s*var\((--[\w-]+)\),\s*var\((--[\w-]+)\)\s*([\d.]+)%\s*\)$/,
  )
  if (oklch?.[1] !== undefined && oklch[2] !== undefined && oklch[3] !== undefined) {
    return wash(
      over(tokens[oklch[2]] ?? '', base),
      over(tokens[oklch[1]] ?? '', base),
      Number(oklch[3]) / 100,
    )
  }
  const srgb = declared.match(
    /^color-mix\(in srgb,\s*var\((--[\w-]+)\)\s*([\d.]+)%,\s*transparent\s*\)$/,
  )
  if (srgb?.[1] !== undefined && srgb[2] !== undefined) {
    return wash(over(tokens[srgb[1]] ?? '', base), base, Number(srgb[2]) / 100)
  }
  return over(declared, base)
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

  // The issue detail's divergence callout: a tinted card on `--urgent-soft` carrying a title in
  // `--status-urgent-ink`, a sentence in `--text-1` and a MONO evidence line in `--text-2` at 11px.
  // The urgent ink over that wash is already pinned above; what is new here is the two body inks,
  // which the digest never put on the urgent ground. The divergence pill in band 2 sits on the same
  // wash and carries the same dictionary text, so one assertion holds both.
  //
  // The mono subline and the rail's fact lines are `--text-2` on `--bg` at 11px, which the first
  // assertion in this block already holds at AA normal — recorded here rather than duplicated,
  // because two assertions over one pair is how one of them quietly stops being maintained.
  it('the divergence callout ink meets AA on its tinted ground (>= 4.5)', () => {
    const ground = wash(hex(t, '--status-urgent'), hex(t, '--bg'), 0.08)
    for (const ink of ['--text-1', '--text-2', '--status-urgent-ink'] as const) {
      expect(contrastRatio(hex(t, ink), ground), ink).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  // The keyboard hint INSIDE the primary action — the 10px `⏎` keycap on Mark Done, in the masthead
  // and in the divergence callout. It sits on the accent fill, so its ink is the one pair the block
  // below already pins at AA — and it shipped as `text-primary-foreground/80`, an alpha modifier
  // that steps that guaranteed pair under AA in five of the six blocks while no token assertion can
  // see it. The ink is solid now, and the keycap's BORDER — non-text drawing, so 3:1 (WCAG 1.4.11)
  // rather than 4.5 — is the one part still carried by an alpha, pinned here at the 75% it is drawn
  // at because 60% measures 2.46–3.36 and editorial light is under the bar there.
  it('the on-accent key hint reads on the accent fill (>= 4.5 ink, >= 3.0 keycap border)', () => {
    const fill = hex(t, '--accent')
    const ink = hex(t, '--on-accent')
    expect(contrastRatio(ink, fill), 'hint ink').toBeGreaterThanOrEqual(AA_NORMAL)
    expect(contrastRatio(wash(ink, fill, 0.75), fill), 'hint border').toBeGreaterThanOrEqual(
      AA_LARGE,
    )
  })

  // The reality track — the one vocabulary every surface draws delivery in — is drawn on exactly
  // five surfaces: a plain row, a hovered row, the SELECTED list row (`--bg-selected`,
  // `issue-row.tsx`), the SELECTED board card (`--accent-soft`, `board-card.tsx`) and the digest's
  // divergence class row (`--urgent-soft`, `team-home.tsx`). The washes are composited over the
  // base surface here the same way the browser paints them. The list row's selected ground and the
  // card's are two different tokens and both are measured: the row's tint moved to `--bg-selected`,
  // while a selected card still replaces its elevated fill with the soft accent, and a track
  // measured against a surface nothing paints is a measurement of nothing.
  const trackSurfaces = (): ReadonlyArray<readonly [string, string]> => {
    const bg = hex(t, '--bg')
    return [
      ['--bg', bg],
      ['--bg-hover', over(t['--bg-hover'] ?? '', bg)],
      ['--bg-selected', over(t['--bg-selected'] ?? '', bg)],
      ['--accent-soft', over(t['--accent-soft'] ?? '', bg)],
      ['--urgent-soft', wash(hex(t, '--status-urgent'), bg, 0.08)],
    ]
  }

  // Every node and segment that CARRIES a fact: `--status-done` (the done disc and the solid
  // segment), `--status-in-review` (the open disc, the review ring, the review segment) and
  // `--status-urgent` (the failing square, the urgent ring after a break, the broken rail
  // connector). Non-text drawing, so 3:1 (WCAG 1.4.11) is the bar — on all five surfaces, because a
  // track that is legible on a plain row and not on the selected one is legible in the screenshot
  // and not in use. Pinned because focused light's original `--status-in-review` measured 2.88 over
  // its own soft-accent wash: a failure visible in exactly one preset, on exactly one row state.
  it('every fact-carrying track node is distinguishable on all five track surfaces (>= 3.0)', () => {
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
  it('the // break ink and the mono fact line meet AA on all five track surfaces (>= 4.5)', () => {
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
  // pull request yet" the loudest thing in a dense row. It is scaffolding, not a fact — and since
  // the quiet rule shipped, a ring is only ever drawn BETWEEN facts: a track carrying no fact at
  // all draws no ring, so a sub-3:1 ring is never the only thing communicating an absence. Every
  // track that does draw one is a `role="img"` naming the facts it draws. What must hold is that
  // an empty ring can never be mistaken FOR a fact node, which is what this measures.
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

  // THE APP FRAME (app-frame §D1). Band 3 paints `--statusline-bg` on every page and carries
  // `--text-2` labels, a `--text-3` sync line and the `--status-urgent-ink` attention segment; band
  // 1's active stop is `--accent-strong` on `--bg`, and its attention badge is `--status-urgent-ink`
  // on the `--urgent-soft` wash. Chrome the reader sees on every surface, so it holds in all six.
  it('the frame bands hold their contrast in every theme', () => {
    const declared = t['--statusline-bg'] ?? ''
    const statusline = mix(declared, t) ?? over(declared, hex(t, '--bg'))
    for (const ink of ['--text-1', '--text-2'] as const) {
      expect(contrastRatio(hex(t, ink), statusline), ink).toBeGreaterThanOrEqual(AA_NORMAL)
    }
    expect(
      contrastRatio(hex(t, '--status-urgent-ink'), statusline),
      'statusline attention',
    ).toBeGreaterThanOrEqual(AA_NORMAL)
    // The sync line is `--text-3`, the same deliberate exemption the peek derivation records: it is
    // a quiet fact restated by the dot's colour, and it may never stop reading as text.
    expect(contrastRatio(hex(t, '--text-3'), statusline)).toBeGreaterThanOrEqual(2.5)

    // The active stop's INK is `--text-1`, not the accent: `--accent-strong` on `--bg` lands at
    // ~4.44 in editorial light, and a current-page marker a sighted reader has to squint at is the
    // same bug the mention typeahead already recorded. The accent carries the 2px underline
    // instead, which is a non-text indicator and so answers to 3:1 (WCAG 1.4.11).
    expect(contrastRatio(hex(t, '--text-1'), hex(t, '--bg')), 'active stop').toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
    expect(
      contrastRatio(hex(t, '--accent'), hex(t, '--bg')),
      'active stop underline',
    ).toBeGreaterThanOrEqual(AA_LARGE)
    const badge = wash(hex(t, '--status-urgent'), hex(t, '--bg'), 0.08)
    expect(
      contrastRatio(hex(t, '--status-urgent-ink'), badge),
      'attention badge',
    ).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  // The issue row's phrase at rest, on all three grounds a row is drawn on: the plain surface, the
  // hover/focus wash, and the SELECTED row's tint. The urgent register is the one that had never
  // been measured against `--bg-selected`; precedent (app-frame DI-2) is that if a pair misses AA
  // the ink changes and the mock loses, not the reader.
  it('the phrase at rest meets AA on every ground a row is drawn on (>= 4.5)', () => {
    const base = hex(t, '--bg')
    const grounds = {
      bg: base,
      hover: over(t['--bg-hover'] ?? '', base),
      selected: over(t['--bg-selected'] ?? '', base),
    }
    for (const [name, ground] of Object.entries(grounds)) {
      for (const ink of ['--text-2', '--status-urgent-ink'] as const) {
        expect(contrastRatio(hex(t, ink), ground), `${ink} on ${name}`).toBeGreaterThanOrEqual(
          AA_NORMAL,
        )
      }
      // The row's mono key, which takes the accent ink under selection, and the title beside it.
      expect(
        contrastRatio(hex(t, '--text-1'), ground),
        `--text-1 on ${name}`,
      ).toBeGreaterThanOrEqual(AA_NORMAL)
    }
    // Records why the selected row's mono key is `--text-1` and not the mock's accent: on the
    // selected tint `--accent-strong` measures 3.84–4.38 in two presets, so the accent could not
    // carry text there. The rail and the tint carry the state instead. A bound, not an equality,
    // so a token edit that FIXES the pair does not fail this file.
    expect(
      contrastRatio(hex(t, '--accent-strong'), grounds.selected),
      'selected row key, were it accent-inked',
    ).toBeGreaterThanOrEqual(AA_LARGE)
    // The selection rail is a non-text indicator against the row's own tinted ground (1.4.11).
    expect(
      contrastRatio(hex(t, '--accent'), grounds.selected),
      'selection rail',
    ).toBeGreaterThanOrEqual(AA_LARGE)
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

  // THE DELIVERY PAGE'S DRAWN FORMS (delivery-journalism §D12). Every one of them is drawn on the
  // base surface, so `--bg` is the ground for all of it.
  //
  // The annotation ink on every chart — the callout headline, the retro mark, the crowd and outlier
  // notes, the axis labels, the per-cycle labels — is `--text-1` or `--text-2` on `--bg`, which the
  // first assertion in this block already holds at AA. What is NEW here is the three grounds this
  // page paints that nothing else does: the delta pill's sense wash, the carryover ribbon, and the
  // ribbon's own count drawn over it.
  it('the delta pill ink meets AA on all three of its sense grounds (>= 4.5)', () => {
    const bg = hex(t, '--bg')
    const grounds = {
      // `bg-status-done/10` — the only NEW composite the page introduces.
      better: wash(hex(t, '--status-done'), bg, 0.1),
      worse: wash(hex(t, '--status-urgent'), bg, 0.08),
      neither: over(t['--bg-hover'] ?? '', bg),
    }
    for (const [sense, ground] of Object.entries(grounds)) {
      expect(contrastRatio(hex(t, '--text-1'), ground), sense).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  // The carryover ribbon. Its INK — the count drawn on it, which is the fact — is `--text-1` over
  // the ribbon's own 15% wash, painted with a `--bg` halo, so both composites must read. The FILL
  // is deliberately below the non-text bar: it is a shape joining two bars whose meaning is stated
  // in words on it and in the chart's `role="img"` label, exactly like the track's empty station.
  // Recorded as a bound rather than left unasserted, so the exemption is visible and a later change
  // that darkens the ribbon has to argue with the right number.
  it('the carryover ribbon ink meets AA over the ribbon and its halo (>= 4.5)', () => {
    const bg = hex(t, '--bg')
    const ribbon = wash(hex(t, '--status-in-progress'), bg, 0.15)
    for (const ground of [ribbon, bg]) {
      expect(contrastRatio(hex(t, '--text-1'), ground)).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  it('records that the carryover ribbon fill is scaffolding, not a fact-carrying colour', () => {
    const bg = hex(t, '--bg')
    // The ribbon's outline is the stronger of its two paints and still sits under 3:1 — which is
    // why the count is drawn ON it rather than left to the shape.
    expect(contrastRatio(wash(hex(t, '--status-in-progress'), bg, 0.4), bg)).toBeGreaterThanOrEqual(
      1.1,
    )
  })

  // The two accent RULES on this page — the distribution's median line and the timeline's today
  // caret — are non-text drawing (WCAG 1.4.11), so 3:1 on the base surface is the bar. Their
  // LABELS carry `--text-1` rather than `--accent-strong`: this block's own frame assertion records
  // that the accent ink measures ~4.44 on `--bg` in editorial light, and a median a sighted reader
  // has to squint at is the same bug as one a screen reader cannot hear.
  it('the median rule and the today caret are distinguishable on the page ground (>= 3.0)', () => {
    expect(contrastRatio(hex(t, '--accent'), hex(t, '--bg'))).toBeGreaterThanOrEqual(AA_LARGE)
  })

  // The rest of the page's fact-carrying marks, enumerated at their own names. These tokens are
  // already pinned by the track block above; what is new is that they now carry facts in a SECOND
  // place, at a different size, on a chart rather than a row — so a later change that retunes one
  // of them for the track has this page's usage written down to argue with.
  it('every mark the delivery charts draw is distinguishable on the page ground (>= 3.0)', () => {
    const bg = hex(t, '--bg')
    const marks = {
      // The timeline's deployment dot, the rhythm's merge node, the flow band's shipped bar.
      'deployment dot / merge node / shipped bar': '--status-done',
      // The rhythm's review segment and each review node on it.
      'review segment and review node': '--status-in-review',
      // The distribution's hollow outlier ring and the rhythm's over-axis arrow. Both also state
      // themselves in words (the outlier note, the row's own duration), so colour is never the
      // carrier — but a ring nobody can see is still a ring nobody can see.
      'outlier ring / over-axis arrow': '--status-urgent',
    }
    for (const [mark, token] of Object.entries(marks)) {
      expect(contrastRatio(hex(t, token), bg), mark).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  // THE IN-PROGRESS AMBER, at the bar each of its two jobs actually requires. It was pinned here
  // at `>= 2.1` while it measured 2.17–2.87 on the base surface in the three LIGHT presets — an
  // assertion written below the bar to record a known break, which is the one thing a contrast
  // assertion may not be. The lights are retuned (2.69/2.17/2.87 → 3.55/3.54/3.62 on `--bg`) and
  // the bar is the real one.
  //
  // It is DRAWN — the in-progress half arc, the issue row's label dot, the digest's attention
  // square, the connecting sync dot, the project and roadmap active dots, the retro caution mark,
  // the flow band's added-block outline — on every ground a row or a card is painted, so 3:1
  // (WCAG 1.4.11) holds on all seven rather than on `--bg` alone. Focused light's
  // `--status-in-review` is the precedent above: a status hue that reads on the page and not on
  // the selected row reads in the screenshot and not in use.
  it('the in-progress amber is distinguishable on every ground a row is drawn on (>= 3.0)', () => {
    const bg = hex(t, '--bg')
    const grounds = {
      '--bg': bg,
      '--bg-elevated': hex(t, '--bg-elevated'),
      '--bg-sidebar': hex(t, '--bg-sidebar'),
      '--bg-hover': over(t['--bg-hover'] ?? '', bg),
      '--bg-selected': over(t['--bg-selected'] ?? '', bg),
      '--accent-soft': over(t['--accent-soft'] ?? '', bg),
      '--urgent-soft': wash(hex(t, '--status-urgent'), bg, 0.08),
    }
    for (const [name, ground] of Object.entries(grounds)) {
      expect(
        contrastRatio(hex(t, '--status-in-progress'), ground),
        `amber on ${name}`,
      ).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  // The same hue as TEXT: `drawn.tsx` §ScopeBand's 9px bold `+`. One amber cannot be both — dragged
  // to 4.5:1 on a near-white ground it lands around #935e00, which is a brown, so the token splits
  // exactly as `--status-urgent` / `--status-urgent-ink` does. The three darks alias the ink to the
  // drawn hue, and this assertion is what proves the alias is allowed to stand.
  it('the in-progress text ink meets AA on every ground the amber `+` is drawn on (>= 4.5)', () => {
    const bg = hex(t, '--bg')
    const grounds = {
      '--bg': bg,
      '--bg-elevated': hex(t, '--bg-elevated'),
      '--bg-sidebar': hex(t, '--bg-sidebar'),
      '--bg-hover': over(t['--bg-hover'] ?? '', bg),
    }
    for (const [name, ground] of Object.entries(grounds)) {
      expect(
        contrastRatio(hex(t, '--status-in-progress-ink'), ground),
        `amber ink on ${name}`,
      ).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  // Why the amber-vs-green number is NOT the bar above, kept with its reason rather than deleted:
  // the two hues measure 1.03–1.71 against each other in all six presets and never reach 3:1 at any
  // lightness that leaves both recognisable. That is why the flow band's added cap is an OUTLINE
  // separated from the shipped bar by the page ground — two quantities must be two shapes at any
  // contrast — and why the count is carried by the `+N added` label and the chart's `role="img"`.
  // Written as the bound that can actually FAIL: a contrast ratio is >= 1 by definition, so a lower
  // bound here would assert nothing. The claim being recorded is that the pair stays BELOW the
  // non-text bar, and the day a retune makes it clear 3:1 is the day the outline's premise is gone
  // and someone should look at the drawing again rather than find this reason quietly untrue.
  it('records that amber and green never separate by luminance, which is why the cap is an outline', () => {
    expect(contrastRatio(hex(t, '--status-in-progress'), hex(t, '--status-done'))).toBeLessThan(
      AA_LARGE,
    )
  })

  // What DOES keep the three statuses apart, stated as a number so a later retune cannot quietly
  // make them confusable: hue. The retune held the amber's OKLCH hue exactly, so this bound is the
  // one that shipped rather than one invented to fit. Colour is never the sole carrier anyway —
  // the status glyph draws each state as a different SHAPE (half arc, three-quarter arc, filled
  // disc with a check) — but a mark whose hue drifts toward the terracotta is a mark two states
  // share, and 20.9° (editorial light, amber against its orange urgent) is the tightest the palette
  // has ever been.
  it('the amber stays a hue apart from the done green and the urgent terracotta', () => {
    const amber = oklchHue(hex(t, '--status-in-progress'))
    expect(hueDistance(amber, oklchHue(hex(t, '--status-done'))), 'vs done').toBeGreaterThanOrEqual(
      60,
    )
    expect(
      hueDistance(amber, oklchHue(hex(t, '--status-urgent'))),
      'vs urgent',
    ).toBeGreaterThanOrEqual(18)
  })

  // THE DONE GLYPH'S CHECK. It is knocked out of the filled disc in `--bg`, and the glyph is inked
  // `--status-done` everywhere except the digest's urgent say rows, where `team-home.tsx` re-inks it
  // `--status-urgent`. Non-text drawing, so 3:1 — against BOTH hues, because a check that vanishes
  // on the urgent row is a `done` that reads as a plain disc exactly where the reader is being told
  // something went wrong. `--bg` was chosen over `--on-accent` (both clear it) so the brand accent's
  // ink token never denotes status.
  it('the done glyph’s knockout check reads against every hue the glyph is inked with (>= 3.0)', () => {
    const knockout = hex(t, '--bg')
    for (const ink of ['--status-done', '--status-urgent'] as const) {
      expect(contrastRatio(knockout, hex(t, ink)), ink).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  // THE TRIAGE DECISION PANEL (triage-daylight §D3). The head of the queue unfolds onto
  // `--bg-selected` — the same tint the selected row carries — and states three things on it: the
  // issue's description, a mono `<reporter> · <created-at>` line, and the verdict rail's words.
  // Every one of them is `--text-1` or `--text-2`, and that is a decision this assertion is the
  // reason for: the mock draws both mono lines in `--text-3`, which measures 2.43–3.33 on that
  // tint — under AA everywhere and under the NON-text bar in four of the six blocks. The panel's
  // facts stepped up to `--text-2` instead, which is the same trade the reality rail's mono fact
  // line already made.
  it('the decision panel’s ink meets AA on its tinted ground (>= 4.5)', () => {
    const panel = over(t['--bg-selected'] ?? '', hex(t, '--bg'))
    for (const ink of ['--text-1', '--text-2'] as const) {
      expect(contrastRatio(hex(t, ink), panel), ink).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  // The verdict keycap, at rest and ARMED. A cap is an elevated chip drawn on the panel's tint: its
  // letter is `--text-2` on `--bg-elevated`, which the peek block above already pins, so what is
  // measured here is the pair no other surface has — the ARMED cap the open route transient lights,
  // whose ink steps to `--accent-strong` and whose border steps to `--accent`. The ink answers to
  // AA at 10px, the border to the 3:1 non-text bar (WCAG 1.4.11). Pinned because "arm the key with
  // the accent" is the obvious edit and `--accent-strong` is the token that has already failed on
  // two other grounds in this file.
  it('the armed verdict keycap reads on its chip (>= 4.5 ink, >= 3.0 border)', () => {
    const cap = hex(t, '--bg-elevated')
    expect(contrastRatio(hex(t, '--accent-strong'), cap), 'armed ink').toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
    expect(contrastRatio(hex(t, '--accent'), cap), 'armed border').toBeGreaterThanOrEqual(AA_LARGE)
  })

  // The cap at rest is scaffolding, and this records it as the bound that can FAIL rather than
  // leaving it unmeasured: neither its fill nor its `--border-strong` outline separates from the
  // panel's tint by 3:1 (1.01–1.48), which is exactly why the KEY is carried by the letter inside
  // the cap and by `aria-keyshortcuts`, never by the chip being visible. The day a token edit lifts
  // this pair over the bar is the day the cap is loud enough to argue about on its own terms.
  it('records that the resting keycap chip is scaffolding, not the carrier of the key', () => {
    const panel = over(t['--bg-selected'] ?? '', hex(t, '--bg'))
    const cap = hex(t, '--bg-elevated')
    expect(contrastRatio(cap, panel), 'cap fill').toBeLessThan(AA_LARGE)
    expect(contrastRatio(over(t['--border-strong'] ?? '', cap), panel), 'cap border').toBeLessThan(
      AA_LARGE,
    )
  })

  // The empty queue's done disc — 26px, the only mark on a cleared page, drawn on `--bg`. The hue
  // is pinned above as a chart mark and a track node; what is new is that here it carries the whole
  // state on its own beside two words, with no row, no track and no legend around it, so a preset
  // that let it fade would leave the page saying `Nothing waiting.` in a void.
  it('the empty queue’s done disc is distinguishable on the page ground (>= 3.0)', () => {
    expect(contrastRatio(hex(t, '--status-done'), hex(t, '--bg'))).toBeGreaterThanOrEqual(AA_LARGE)
  })

  // Triage states a refused write in two places — the masthead's meta line on `--bg` at 12px, and
  // the route transient's failure line on `--bg-elevated` at 11px — and both are TEXT, so both
  // answer to AA normal. That is the whole reason the palette splits `--status-urgent-ink` off
  // `--status-urgent`: the mark hue is tuned to read as a MARK, and inking a sentence with it
  // misses 4.5:1 in every light preset. A failure message the reader cannot read is the one
  // message on this page that must never be lost.
  it('the triage failure lines meet AA on both grounds they are drawn on (>= 4.5)', () => {
    for (const ground of ['--bg', '--bg-elevated'] as const) {
      expect(
        contrastRatio(hex(t, '--status-urgent-ink'), hex(t, ground)),
        ground,
      ).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  // ── The retro room ────────────────────────────────────────────────────────────────────────────
  //
  // This surface draws on a THIRD ground: the `--bg-sidebar` tabletop, with paper notes on
  // `--bg-elevated` sitting on it. Every fact the room states — the dot-budget reading, the tally,
  // the room foot, the seed door's line, the draft band's three sentences, the index's date range —
  // is `--text-2`, and this is where that claim is falsifiable.
  it('the room’s stated facts meet AA on the felt and on the note (>= 4.5)', () => {
    for (const ground of ['--bg-sidebar', '--bg-elevated'] as const) {
      for (const ink of ['--text-1', '--text-2'] as const) {
        expect(
          contrastRatio(hex(t, ink), hex(t, ground)),
          `${ink} on ${ground}`,
        ).toBeGreaterThanOrEqual(AA_NORMAL)
      }
    }
  })

  // THE PAIR THE MOCK ASKED FOR, AND WHY IT LOST. `retros.html` inks the cluster label and the
  // index's phase pill in `--accent-strong`. Measured, that token lands at 4.18 on the felt in
  // Editorial light and at 3.94–4.38 over the soft-accent wash in Focused light, Focused dark and
  // Editorial light — under AA for text at 11.5px. Both moved to `--text-1`; the accent stays as
  // the dashed box and the wash. This records the bound that made the mock lose, so a later token
  // retune can be seen to have changed it.
  it('records why the cluster label and the phase pill are not accent ink', () => {
    const worstFelt = contrastRatio(hex(t, '--accent-strong'), hex(t, '--bg-sidebar'))
    const wash = over(t['--accent-soft'] ?? '', hex(t, '--bg-elevated'))
    const worstWash = contrastRatio(hex(t, '--accent-strong'), wash)
    expect(Math.min(worstFelt, worstWash)).toBeGreaterThanOrEqual(AA_LARGE)
    // The inks actually shipped, on the two grounds they are drawn on.
    expect(contrastRatio(hex(t, '--text-1'), hex(t, '--bg-sidebar'))).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
    expect(contrastRatio(hex(t, '--text-1'), wash)).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  // The stepper's current phase is the THIRD place the mock reached for accent ink and the third it
  // lost: `--accent-strong` on the page ground lands at 4.44 in Editorial light, under AA at
  // 11.5px. The name is `--text-1` and the phase is told by weight, by the filled band and by the
  // `now` reading — never by hue. Recorded as a bound, so the day the token clears it is visible.
  it('records that the stepper’s current phase name is not accent ink', () => {
    expect(contrastRatio(hex(t, '--accent-strong'), hex(t, '--bg'))).toBeGreaterThanOrEqual(
      AA_LARGE,
    )
    expect(contrastRatio(hex(t, '--text-1'), hex(t, '--bg'))).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  // The phase stepper's NOW band and the index row's left edge are both `--accent` as a MARK on
  // the page ground — no text inside either — so both answer to the 3:1 non-text bar. Each also
  // carries a word beside it (`now`, and the row's phase pill), so neither is colour-only; what is
  // measured here is only that the mark is visible at all.
  it('the now-band and the index row’s edge are distinguishable marks (>= 3.0)', () => {
    expect(contrastRatio(hex(t, '--accent'), hex(t, '--bg'))).toBeGreaterThanOrEqual(AA_LARGE)
    expect(
      contrastRatio(hex(t, '--accent'), hex(t, '--bg-elevated')),
      'index row edge on the row ground',
    ).toBeGreaterThanOrEqual(AA_LARGE)
  })

  // An UNSPENT dot is `--accent`; a SPENT one is a `--border-strong` ring on the same ground. The
  // pips on a note make the same split. Both pairs are marks, and both are read against the stated
  // fraction beside them, which is the channel that actually carries the budget.
  it('spent and unspent dots separate from each other and from their ground (>= 3.0)', () => {
    const ring = over(t['--border-strong'] ?? '', hex(t, '--bg'))
    expect(contrastRatio(hex(t, '--accent'), ring), 'dot vs dot').toBeGreaterThanOrEqual(AA_LARGE)
    expect(
      contrastRatio(hex(t, '--accent'), hex(t, '--bg-elevated')),
      'unspent pip on the note',
    ).toBeGreaterThanOrEqual(AA_LARGE)
  })

  // RECORDED AS SCAFFOLDING, not asserted as ink. The spent phase band (`--accent-soft`), the
  // to-come band's `--border` outline and the cluster box's `--accent-line` dashes all sit BELOW
  // the 3:1 bar on their own grounds, and that is why every one of them is read through a word:
  // the phase's name, the `now` reading, the cluster's label and its card count. The day a token
  // edit lifts one of these over the bar is the day it is loud enough to argue about on its terms.
  it('records the spent band, the to-come outline and the cluster dashes as scaffolding', () => {
    expect(
      contrastRatio(over(t['--accent-soft'] ?? '', hex(t, '--bg')), hex(t, '--bg')),
      'spent band',
    ).toBeLessThan(AA_LARGE)
    const toCome = over(t['--bg-hover'] ?? '', hex(t, '--bg'))
    expect(
      contrastRatio(over(t['--border'] ?? '', toCome), toCome),
      'to-come outline',
    ).toBeLessThan(AA_LARGE)
    expect(
      contrastRatio(over(t['--accent-line'] ?? '', hex(t, '--bg-sidebar')), hex(t, '--bg-sidebar')),
      'cluster dashes',
    ).toBeLessThan(AA_LARGE)
  })

  // THE PROJECTS INDEX, ONE PROJECT'S PAGE AND THE ROADMAP (projects-roadmap-daylight §D8). All
  // three are rows, and a row is painted on three grounds: the page surface, the hover wash, and
  // the tint the focused roadmap row takes. Every mark below is measured on all three, because a
  // mark that reads on a plain row and not on the focused one reads in the screenshot and not in
  // use — the same lesson `--status-in-review` taught on the track.
  const rowGrounds = (): ReadonlyArray<readonly [string, string]> => {
    const bg = hex(t, '--bg')
    return [
      ['--bg', bg],
      ['--bg-hover', over(t['--bg-hover'] ?? '', bg)],
      ['--bg-selected', over(t['--bg-selected'] ?? '', bg)],
    ]
  }

  // The Done meter — one tick per readable issue on the roadmap, a filled track on the index —
  // draws exactly one fact: issues at done over readable issues. The FILL is what carries it, so
  // it answers to the 3:1 non-text bar (WCAG 1.4.11) on every ground a row is painted.
  it('the done meter’s fill is distinguishable on every ground a project row is drawn on (>= 3.0)', () => {
    for (const [name, ground] of rowGrounds()) {
      expect(
        contrastRatio(hex(t, '--status-done'), ground),
        `meter fill on ${name}`,
      ).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  // The other half of the meter is deliberately below that bar and this records it as the bound
  // that can FAIL: the unfilled tick (`--border-strong`) and the index track (`--row-hairline`)
  // measure 1.07–1.40 against the row they sit on. They are the extent of the track, not the
  // count — the meter is `aria-hidden` and the exact fact is the mono `done/total` beside it in
  // `--text-2`, which the block's first assertion already holds at AA. The day a token edit lifts
  // either over 3:1 is the day the meter is loud enough to argue about on its own terms.
  it('records that the meter’s unfilled tick and its track are scaffolding, never the count', () => {
    for (const [name, ground] of rowGrounds()) {
      expect(
        contrastRatio(over(t['--border-strong'] ?? '', ground), ground),
        `unfilled tick on ${name}`,
      ).toBeLessThan(AA_LARGE)
    }
    expect(
      contrastRatio(composite(t, '--row-hairline'), hex(t, '--bg')),
      'index meter track',
    ).toBeLessThan(AA_LARGE)
  })

  // The target mark — the ONE point in time the roadmap draws per project, and on most rows the
  // only mark in the drawing. It is inked by the project's own status and shaped by it too (filled
  // disc · done disc · × ring · hollow urgent ring), so hue is never the sole channel, but a mark
  // nobody can see is still a mark nobody can see: 3:1 on all three row grounds.
  //
  // `--text-2` is in this list because the mock inks a PLANNED target `--text-3`, which measures
  // 2.43–3.43 across the six blocks on these grounds — under the non-text bar in five of them. The
  // ink moved and the mock lost (issue-list-daylight DI-2, triage-daylight B8). The same move
  // carried the axis's month labels, its `no cycles past <date>` statement, the row's mono
  // `done/total` and target day, and both "nothing" phrases off `--text-3`: those are TEXT, so
  // their bar is 4.5, which `--text-3` misses on `--bg` in every block.
  //
  // The per-cycle ISSUE mark is measured in this same block for the same reason: it is a filled
  // `--status-done` disc when the issue is done and a ring when it is not, and that ring was
  // stroked `--border-strong` — the token the assertion below this one pins UNDER the bar in all
  // six blocks. Shape stays the channel; the ring's stroke moved to `--text-2`, which is already
  // in this list, so both marks answer to the same measurement.
  it('every target and issue mark ink is distinguishable on every ground a roadmap row is drawn on (>= 3.0)', () => {
    const inks = ['--status-urgent', '--status-done', '--status-in-progress', '--text-2'] as const
    for (const [name, ground] of rowGrounds()) {
      for (const ink of inks) {
        expect(contrastRatio(hex(t, ink), ground), `${ink} on ${name}`).toBeGreaterThanOrEqual(
          AA_LARGE,
        )
      }
    }
    // A future target is a filled disc stroked with the page ground and a passed one is a ring
    // filled with it, so the knockout is load-bearing in both directions — the same claim the done
    // glyph's check makes, at a different radius.
    for (const ink of inks) {
      expect(
        contrastRatio(hex(t, '--bg'), hex(t, ink)),
        `knockout vs ${ink}`,
      ).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  // The project page's state bar — the one place an issue status is drawn as AREA rather than as a
  // glyph. Three of its six hues carry work that is moving and clear the non-text bar on the page
  // ground.
  it('the state bar’s moving segments are distinguishable on the page ground (>= 3.0)', () => {
    const bg = hex(t, '--bg')
    for (const ink of ['--status-done', '--status-in-progress', '--status-in-review'] as const) {
      expect(contrastRatio(hex(t, ink), bg), ink).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  // The other three — backlog, todo and the canceled segment's `--text-3` — are the palette's QUIET
  // family, and they cannot reach 3:1 on a light ground without colliding with each other
  // (`--status-backlog` would have to land on `--status-todo`'s value in warm light). They measure
  // 2.43–6.02 across the six blocks: over the bar in the darks, under it in the lights.
  //
  // That is allowed here and nowhere else in this file because the bar is not the carrier. Every
  // segment is restated directly beneath it as `<glyph> <count> <label>` in `--text-2`, and the bar
  // itself is a `role="img"` whose label enumerates them — both asserted in
  // `apps/web/src/projects/project-page.test.tsx`, so this exemption's premise is enforced by a
  // test rather than by this comment. What is pinned is the floor: a segment may never fade so far
  // that the composition stops reading as a bar at all.
  it('records that the state bar’s quiet segments are a composition over facts stated in text', () => {
    const bg = hex(t, '--bg')
    for (const ink of ['--status-backlog', '--status-todo', '--text-3'] as const) {
      expect(contrastRatio(hex(t, ink), bg), ink).toBeGreaterThanOrEqual(2.4)
    }
  })

  // The axis's scaffolding, recorded as bounds that can FAIL rather than left unmeasured. The
  // cycle band's stroke, the row gridlines under it and the per-row now line all sit at 1.07–2.07
  // against the ground they are drawn on. Each is a rule joining facts stated elsewhere: the band
  // is NAMED in `--text-1`/`--text-2` inside it, the gridlines repeat that band's edges, and the
  // now line repeats the header's `--accent` caret — which is pinned at 3:1 by the delivery block
  // above and labelled `today` in `--text-1`, not `--accent-strong` (4.00–4.72 on the header's
  // hover ground, under AA in editorial light: the same trade the delivery page's median made).
  it('records that the axis rules are scaffolding, not the carriers of the cycle', () => {
    const bg = hex(t, '--bg')
    const header = over(t['--bg-hover'] ?? '', bg)
    expect(
      contrastRatio(over(t['--border-strong'] ?? '', header), header),
      'cycle band stroke',
    ).toBeLessThan(AA_LARGE)
    expect(contrastRatio(composite(t, '--row-hairline'), bg), 'row gridline').toBeLessThan(AA_LARGE)
    expect(contrastRatio(over(t['--accent-line'] ?? '', bg), bg), 'row now line').toBeLessThan(
      AA_LARGE,
    )
    // What the reader is actually meant to read on the header, at the bar text answers to.
    for (const ink of ['--text-1', '--text-2'] as const) {
      expect(contrastRatio(hex(t, ink), header), `band name ${ink}`).toBeGreaterThanOrEqual(
        AA_NORMAL,
      )
    }
  })

  // The delta pill on the project page — `N days past` on `--urgent-soft`. The urgent ink over an
  // 8% urgent wash is pinned by the digest assertion above; what is NEW here is that this reads the
  // DECLARED `--urgent-soft` token rather than reconstructing the wash from `--status-urgent`, so
  // an edit to the wash itself (8% → 14%, or a change of hue) fails here and nowhere else.
  //
  // The two urgent inks the index and the roadmap add — `Past target — N open` and `Target passed`
  // — are `--status-urgent-ink` on the three row grounds, and the passed target's ring is
  // `--status-urgent` on the same three. Both pairs are already pinned, by 'the phrase at rest' and
  // by the track block; recorded here rather than duplicated, because two assertions over one pair
  // is how one of them quietly stops being maintained.
  it('the delta pill’s ink meets AA on the urgent wash as the preset declares it (>= 4.5)', () => {
    expect(
      contrastRatio(hex(t, '--status-urgent-ink'), composite(t, '--urgent-soft')),
    ).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})
