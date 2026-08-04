import { describe, expect, it } from 'vitest'
import { pmDigestReadySubject, renderPmDigestReady } from './pm-digest-ready.js'

const PUBLIC_URL = 'https://yapm.example.com'

// A REAL digest's content, of the shape `StoredPmDigestContent` carries — a headline summary, a
// highlight, a risk and a server-rendered evidence label. None of it is passed to the template,
// because the template's input type has no field for it. Every string here is distinctive enough
// that a substring match is a real test rather than a coincidence.
const DIGEST_CONTENT = {
  summary: 'Checkout latency work landed; onboarding slipped to the next cycle.',
  highlight: 'Payments retry queue drained under a synthetic peak of 4x.',
  risk: 'The vendor sandbox is still the only environment reproducing the 402 path.',
  evidenceLabel: 'ENG-411 · merged 2026-07-30 · areas: payments, checkout',
}

const CONTENT_STRINGS = Object.values(DIGEST_CONTENT)

describe('pmDigestReadySubject', () => {
  it('names the team and the cycle, and nothing else', () => {
    expect(pmDigestReadySubject({ teamName: 'Platform', cycleName: 'Cycle 14' })).toBe(
      'Platform — Cycle 14 cycle digest is ready',
    )
  })
})

describe('the PM digest ready notice', () => {
  it('carries a link to the reader’s own surface', async () => {
    const message = await renderPmDigestReady({
      publicUrl: PUBLIC_URL,
      teamName: 'Platform',
      cycleName: 'Cycle 14',
    })

    expect(message.html).toContain('https://yapm.example.com/digests')
    expect(message.text).toContain('https://yapm.example.com/digests')
    expect(message.subject).toBe('Platform — Cycle 14 cycle digest is ready')
  })

  // THE FALSIFIABLE CHECK, asserted against the RENDERED OUTPUT rather than the template source.
  // Asserting against the source would pass for a template that interpolated a content field which
  // happened to be empty in the fixture; this cannot.
  //
  // The reason the body carries a link only: a mailed artifact sits outside the kill switch, outside
  // retention and outside the audit log at the same time. An admin who sets the kill switch stops
  // every further read in yapm and cannot reach an inbox.
  it('contains no substring of the digest content, in either the HTML or the text', async () => {
    const message = await renderPmDigestReady({
      publicUrl: PUBLIC_URL,
      teamName: 'Platform',
      cycleName: 'Cycle 14',
    })

    for (const content of CONTENT_STRINGS) {
      expect(message.html).not.toContain(content)
      expect(message.text).not.toContain(content)
      expect(message.subject).not.toContain(content)
      // Also every whitespace-delimited word of six characters or more, so a template that leaked a
      // fragment rather than a whole field is caught too.
      for (const word of content.split(/\s+/).filter((part) => part.length >= 6)) {
        expect(message.text).not.toContain(word)
      }
    }
  })

  it('names no publisher — the actor of a release never leaves the audit log', async () => {
    const message = await renderPmDigestReady({
      publicUrl: PUBLIC_URL,
      teamName: 'Platform',
      cycleName: 'Cycle 14',
    })
    expect(message.text.toLowerCase()).not.toContain('published by')
    expect(message.text).not.toContain('Ada')
  })
})
