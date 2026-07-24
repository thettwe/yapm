import { describe, expect, it } from 'vitest'
import { contrastRatio, deriveAccent, onAccentFor, parseColor } from './color.js'

const AA = 4.5

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for identical colors', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5)
  })

  it('is order-independent', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(contrastRatio('#abcdef', '#123456'), 6)
  })
})

describe('parseColor', () => {
  it('parses shorthand and full hex and rgb()', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseColor('#1b1613')).toEqual({ r: 27, g: 22, b: 19 })
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('returns null for unparseable input', () => {
    expect(parseColor('not-a-color')).toBeNull()
    expect(parseColor('oklch(0.7 0.1 30)')).toBeNull()
  })
})

describe('onAccentFor never yields unreadable text', () => {
  it('gives light text on a dark accent', () => {
    const on = onAccentFor('#1b2a52')
    expect(on).toBe('#ffffff')
    expect(contrastRatio('#1b2a52', on)).toBeGreaterThanOrEqual(AA)
  })

  it('gives dark text on a light accent', () => {
    const on = onAccentFor('#ffd166')
    expect(on).toBe('#111111')
    expect(contrastRatio('#ffd166', on)).toBeGreaterThanOrEqual(AA)
  })

  it('picks the most readable candidate for any mid-tone', () => {
    for (const accent of ['#808080', '#c15a38', '#5b63d6', '#de341a', '#7a7a7a', '#999999']) {
      const on = onAccentFor(accent)
      const other = on === '#ffffff' ? '#111111' : '#ffffff'
      expect(contrastRatio(accent, on)).toBeGreaterThanOrEqual(contrastRatio(accent, other))
    }
  })
})

describe('deriveAccent', () => {
  it('derives every state from one base and mixes toward black in light mode', () => {
    const shades = deriveAccent('#c15a38', 'light')
    expect(shades.accent).toBe('#c15a38')
    expect(shades.strong).toBe('#c15a38')
    expect(shades.hover).toBe('color-mix(in oklch, #c15a38, black 8%)')
    expect(shades.active).toBe('color-mix(in oklch, #c15a38, black 14%)')
    expect(shades.soft).toBe('color-mix(in oklch, #c15a38, transparent 88%)')
    expect(shades.line).toBe('color-mix(in oklch, #c15a38, transparent 66%)')
    expect(shades.onAccent).toBe('#ffffff')
  })

  it('mixes toward white in dark mode', () => {
    const shades = deriveAccent('#de7a4f', 'dark')
    expect(shades.hover).toBe('color-mix(in oklch, #de7a4f, white 8%)')
    expect(shades.active).toBe('color-mix(in oklch, #de7a4f, white 14%)')
  })
})
