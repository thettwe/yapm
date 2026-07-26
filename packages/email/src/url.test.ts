import { describe, expect, it } from 'vitest'
import { absoluteUrl } from './url.js'

describe('absoluteUrl', () => {
  it('joins a root-relative path onto a bare origin', () => {
    expect(absoluteUrl('https://yapm.example.com', '/inbox')).toBe('https://yapm.example.com/inbox')
  })

  it('keeps a sub-path carried by the base URL', () => {
    expect(absoluteUrl('https://example.com/yapm', '/inbox')).toBe('https://example.com/yapm/inbox')
  })

  it('tolerates a trailing slash on the base and a missing slash on the path', () => {
    expect(absoluteUrl('https://example.com/yapm/', 'inbox')).toBe('https://example.com/yapm/inbox')
  })

  it('preserves a query string', () => {
    expect(absoluteUrl('https://example.com', '/teams/t1/issues?open=i1')).toBe(
      'https://example.com/teams/t1/issues?open=i1',
    )
  })

  it('trims surrounding whitespace on the base', () => {
    expect(absoluteUrl('  https://example.com  ', '/inbox')).toBe('https://example.com/inbox')
  })
})
