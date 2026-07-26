import { describe, expect, it } from 'vitest'
import { inviteSubject, inviteUrl, renderInvite } from './invite.js'

const PUBLIC_URL = 'https://yapm.example.com'

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '')
}

describe('inviteUrl', () => {
  it('builds the accept link the /invite route expects', () => {
    expect(inviteUrl(PUBLIC_URL, 'abc123')).toBe(`${PUBLIC_URL}/invite?token=abc123`)
  })

  it('percent-encodes a token so it survives the query string', () => {
    expect(inviteUrl(PUBLIC_URL, 'a b/c&d')).toBe(`${PUBLIC_URL}/invite?token=a%20b%2Fc%26d`)
  })
})

describe('renderInvite', () => {
  it('names the workspace in the subject', () => {
    expect(inviteSubject('Acme')).toBe('You have been invited to Acme on yapm')
  })

  it('renders the inviter, the workspace and the accept link', async () => {
    const message = await renderInvite({
      publicUrl: PUBLIC_URL,
      workspaceName: 'Acme',
      inviterName: 'Ada',
      token: 'abc123',
    })

    expect(message.subject).toBe('You have been invited to Acme on yapm')
    expect(message.html).toContain('Ada invited you to Acme')
    expect(message.text).toContain('Ada invited you to Acme'.toUpperCase())
    expect(message.text).toContain(`${PUBLIC_URL}/invite?token=abc123`)
  })

  it('builds every link from the supplied public base URL', async () => {
    const message = await renderInvite({
      publicUrl: 'https://example.com/yapm',
      workspaceName: 'Acme',
      inviterName: 'Ada',
      token: 'abc123',
    })

    const links = hrefs(message.html)
    expect(links).toEqual(['https://example.com/yapm/invite?token=abc123'])
    expect(message.html).not.toContain('localhost')
  })

  it('falls back to "Someone" rather than leaking an address when the inviter is unknown', async () => {
    const message = await renderInvite({
      publicUrl: PUBLIC_URL,
      workspaceName: 'Acme',
      inviterName: null,
      token: 'abc123',
    })

    expect(message.html).toContain('Someone invited you to Acme')
  })

  it('names the same link in the plain-text part as in the HTML', async () => {
    const message = await renderInvite({
      publicUrl: PUBLIC_URL,
      workspaceName: 'Acme',
      inviterName: '  Ada  ',
      token: 'abc123',
    })

    for (const link of hrefs(message.html)) {
      expect(message.text).toContain(link)
    }
    expect(message.html).toContain('Ada invited you to Acme')
  })
})
