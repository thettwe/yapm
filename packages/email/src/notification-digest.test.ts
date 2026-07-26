import { describe, expect, it } from 'vitest'
import { notificationDigestSubject, renderNotificationDigest } from './notification-digest.js'

const PUBLIC_URL = 'https://yapm.example.com'

const assigned = {
  title: 'Ada assigned you ENG-12',
  summary: 'Reconnect loop freezes the board',
  path: '/teams/team-1/issues?open=issue-1',
}

const commented = {
  title: 'Grace commented on ENG-13',
  summary: 'Digest job double-sends on rebase',
  path: '/teams/team-1/issues?open=issue-2',
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '')
}

describe('notificationDigestSubject', () => {
  it('is the single item title when there is one', () => {
    expect(notificationDigestSubject([assigned])).toBe('Ada assigned you ENG-12')
  })

  it('counts the remainder when there are several', () => {
    expect(notificationDigestSubject([assigned, commented])).toBe(
      'Ada assigned you ENG-12 and 1 more',
    )
  })
})

describe('renderNotificationDigest', () => {
  it('renders the subject, the titles and the summaries in the HTML', async () => {
    const message = await renderNotificationDigest({ publicUrl: PUBLIC_URL, items: [assigned] })

    expect(message.subject).toBe('Ada assigned you ENG-12')
    expect(message.html).toContain('Ada assigned you ENG-12')
    expect(message.html).toContain('Reconnect loop freezes the board')
  })

  it('names the same subjects in the plain-text part as in the HTML', async () => {
    const message = await renderNotificationDigest({
      publicUrl: PUBLIC_URL,
      items: [assigned, commented],
    })

    for (const item of [assigned, commented]) {
      expect(message.html).toContain(item.title)
      expect(message.text).toContain(item.title)
      expect(message.html).toContain(item.summary)
      expect(message.text).toContain(item.summary)
    }
  })

  it('builds every link from the supplied public base URL', async () => {
    const message = await renderNotificationDigest({
      publicUrl: PUBLIC_URL,
      items: [assigned, commented],
    })

    const links = hrefs(message.html)
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link.startsWith(`${PUBLIC_URL}/`)).toBe(true)
    }
    expect(links).toContain(`${PUBLIC_URL}/teams/team-1/issues?open=issue-1`)
    expect(links).toContain(`${PUBLIC_URL}/inbox`)
  })

  it('honours a base URL carrying a sub-path', async () => {
    const message = await renderNotificationDigest({
      publicUrl: 'https://example.com/yapm',
      items: [assigned],
    })

    for (const link of hrefs(message.html)) {
      expect(link.startsWith('https://example.com/yapm/')).toBe(true)
    }
    expect(message.html).not.toContain('localhost')
  })

  // Pinned exactly rather than by `toContain`, because the thing being guarded is what is ABSENT:
  // a comment-body excerpt added to the template later would leave this equality unchanged under
  // any looser assertion. The only per-event strings here are the ones the caller worded.
  it('renders exactly the frame plus the caller-supplied strings — no body excerpt can slip in', async () => {
    const message = await renderNotificationDigest({
      publicUrl: PUBLIC_URL,
      items: [commented],
    })

    expect(message.text).toBe(
      [
        'Grace commented on ENG-13',
        '',
        '',
        'YOU HAVE A NOTIFICATION',
        '',
        `Grace commented on ENG-13 ${PUBLIC_URL}/teams/team-1/issues?open=issue-2`,
        'Digest job double-sends on rebase',
        '',
        `Open your inbox ${PUBLIC_URL}/inbox`,
        `You are receiving this because you are involved in this work. Change your email preferences in yapm ${PUBLIC_URL}/inbox.`,
      ].join('\n'),
    )
  })

  it('titles the digest with the count when several notifications are batched', async () => {
    const message = await renderNotificationDigest({
      publicUrl: PUBLIC_URL,
      items: [assigned, commented],
    })

    expect(message.html).toContain('You have 2 notifications')
    expect(message.text).toContain('YOU HAVE 2 NOTIFICATIONS')
  })
})
