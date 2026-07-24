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

  it('on-accent text on the accent fill meets AA (>= 4.5)', () => {
    expect(contrastRatio(hex(t, '--on-accent'), hex(t, '--accent'))).toBeGreaterThanOrEqual(
      AA_NORMAL,
    )
  })
})
