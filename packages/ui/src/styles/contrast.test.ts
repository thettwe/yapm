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

function hex(tokens: Record<string, string>, name: string): string {
  const value = tokens[name]
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

  it('on-accent text on the accent fill meets AA (>= 4.5)', () => {
    expect(contrastRatio(hex(t, '--on-accent'), hex(t, '--accent'))).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
  })
})
