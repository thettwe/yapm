import { describe, expect, it } from 'vitest'
import { sendInviteEmail } from './invite.js'
import type { Mailer, OutboundMessage } from './mailer.js'

const PUBLIC_URL = 'https://yapm.example.com'
const TOKEN = 'tok en/+1'

function recordingMailer(): { mailer: Mailer; sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = []
  return {
    sent,
    mailer: {
      transport: 'resend',
      send: (message) => {
        sent.push(message)
        return Promise.resolve()
      },
    },
  }
}

const invite = {
  publicUrl: PUBLIC_URL,
  workspaceName: 'Acme',
  inviterName: 'Ada',
  recipient: 'bee@example.com',
  token: TOKEN,
}

describe('sendInviteEmail', () => {
  it('sends nothing and still reports the link when no mailer is configured', async () => {
    const result = await sendInviteEmail({ ...invite, mailer: null })

    expect(result.sent).toBe(false)
    expect(result.link).toBe(`${PUBLIC_URL}/invite?token=${encodeURIComponent(TOKEN)}`)
  })

  it('hands the rendered message to the transport when a mailer exists', async () => {
    const { mailer, sent } = recordingMailer()

    const result = await sendInviteEmail({ ...invite, mailer })

    expect(result.sent).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toEqual(['bee@example.com'])
    expect(sent[0]?.message.subject).toBe('You have been invited to Acme on yapm')
    expect(sent[0]?.message.html).toContain(result.link)
    expect(sent[0]?.message.text).toContain(result.link)
  })

  it('builds the accept link from the public URL, never a localhost origin', async () => {
    const { mailer, sent } = recordingMailer()

    await sendInviteEmail({ ...invite, mailer })

    expect(sent[0]?.message.html).not.toContain('localhost')
    expect(sent[0]?.message.html).toContain(PUBLIC_URL)
  })

  it('degrades to an anonymous inviter rather than leaking an address', async () => {
    const { mailer, sent } = recordingMailer()

    await sendInviteEmail({ ...invite, inviterName: null, mailer })

    expect(sent[0]?.message.html).toContain('Someone invited you to Acme')
    expect(sent[0]?.message.html).not.toContain('@example.com')
  })

  it('is inert with no public URL, whatever the mailer', async () => {
    const { mailer, sent } = recordingMailer()

    const result = await sendInviteEmail({ ...invite, publicUrl: null, mailer })

    expect(result).toEqual({ link: null, sent: false })
    expect(sent).toHaveLength(0)
  })
})
