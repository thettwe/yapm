export type Mode = 'light' | 'dark'

export interface AccentShades {
  accent: string
  strong: string
  hover: string
  active: string
  soft: string
  line: string
  onAccent: string
}

// Two fixed on-accent candidates: a near-white and a near-black ink. The user only ever
// sets the base accent, so on-accent is always the more readable of these — never a
// low-contrast value the user picked.
const ON_ACCENT_LIGHT = '#ffffff'
const ON_ACCENT_DARK = '#111111'

function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

interface Rgb {
  r: number
  g: number
  b: number
}

function expandHex(hex: string): string {
  if (hex.length === 3 || hex.length === 4) {
    return hex
      .split('')
      .map((ch) => ch + ch)
      .join('')
  }
  return hex
}

// Parses hex (#rgb/#rgba/#rrggbb/#rrggbbaa) and rgb()/rgba() to sRGB. Returns null for
// anything else (e.g. oklch), which callers treat as "cannot compute a contrast candidate".
export function parseColor(value: string): Rgb | null {
  const v = value.trim()

  if (v.startsWith('#')) {
    const body = expandHex(v.slice(1))
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/iu.test(body)) return null
    return {
      r: Number.parseInt(body.slice(0, 2), 16),
      g: Number.parseInt(body.slice(2, 4), 16),
      b: Number.parseInt(body.slice(4, 6), 16),
    }
  }

  const rgb = v.match(/^rgba?\(([^)]+)\)$/iu)
  if (rgb?.[1]) {
    const parts = rgb[1].split(/[\s,/]+/u).filter(Boolean)
    if (parts.length < 3) return null
    const channel = (raw: string): number | null => {
      const n = raw.endsWith('%') ? (Number.parseFloat(raw) / 100) * 255 : Number.parseFloat(raw)
      return Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : null
    }
    const r = channel(parts[0] ?? '')
    const g = channel(parts[1] ?? '')
    const b = channel(parts[2] ?? '')
    if (r === null || g === null || b === null) return null
    return { r, g, b }
  }

  return null
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

// WCAG 2.x contrast ratio between two colors. Unparseable inputs contribute worst-case
// luminance so a caller never treats an unknown color as high-contrast.
export function contrastRatio(a: string, b: string): number {
  const ca = parseColor(a)
  const cb = parseColor(b)
  const la = ca ? relativeLuminance(ca) : 0
  const lb = cb ? relativeLuminance(cb) : 0
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// Auto-computes the contrast-safe text color drawn on top of the accent. Because picking
// the higher-contrast of {near-white, near-black} coincides with the WCAG-AA rule (higher
// when both pass, higher when neither passes, and the passing one when exactly one passes),
// on-accent is always the most readable available choice.
export function onAccentFor(accent: string): string {
  return contrastRatio(accent, ON_ACCENT_LIGHT) >= contrastRatio(accent, ON_ACCENT_DARK)
    ? ON_ACCENT_LIGHT
    : ON_ACCENT_DARK
}

// Derives every accent state from a single base color. Hover/active mix toward black in
// light mode and toward white in dark mode; soft/line are transparent mixes for the
// selected-row tint and selection border. Shades are CSS color-mix() strings (baseline
// support); on-accent is a resolved hex so bootstrap needs no computation.
export function deriveAccent(base: string, mode: Mode): AccentShades {
  const toward = mode === 'dark' ? 'white' : 'black'
  return {
    accent: base,
    strong: base,
    hover: `color-mix(in oklch, ${base}, ${toward} 8%)`,
    active: `color-mix(in oklch, ${base}, ${toward} 14%)`,
    soft: `color-mix(in oklch, ${base}, transparent 88%)`,
    line: `color-mix(in oklch, ${base}, transparent 66%)`,
    onAccent: onAccentFor(base),
  }
}
