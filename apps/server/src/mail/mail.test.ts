import { renderNotificationDigest } from '@yapm/email'
import { describe, expect, it, vi } from 'vitest'
import { loadEnv } from '../config/env.js'
import { createMailer } from './index.js'
import type { Mailer, OutboundMessage, RenderedMessage } from './mailer.js'
import { createResendMailer, ResendSendError } from './resend.js'
import { createSmtpMailer, type SmtpTransport } from './smtp.js'

const VALID = {
  DATABASE_URL: 'postgres://yapm:yapm@localhost:5432/yapm',
  EMAIL_FROM: 'yapm <notifications@example.com>',
  PUBLIC_URL: 'https://yapm.example.com',
}

const FROM = VALID.EMAIL_FROM
const TO = ['ada@example.com', 'grace@example.com']

const MESSAGE: RenderedMessage = {
  subject: 'Ada assigned you ENG-12',
  html: '<p>Ada assigned you ENG-12</p>',
  text: 'Ada assigned you ENG-12',
}

const OUTBOUND: OutboundMessage = { to: TO, message: MESSAGE }

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function recordingSmtpTransport() {
  const sent: unknown[] = []
  const transport: SmtpTransport = {
    sendMail: async (options) => {
      sent.push(options)
      return { messageId: 'test' }
    },
  }
  return { sent, transport }
}

function recordingFetch(status = 200, body = '{"id":"test"}') {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    return new Response(body, { status })
  }
  return { calls, fetchImpl }
}

describe('createSmtpMailer', () => {
  it('hands the rendered message to the transport unchanged', async () => {
    const { sent, transport } = recordingSmtpTransport()
    const mailer = createSmtpMailer({
      url: 'smtp://user:pass@relay.example.com:587',
      from: FROM,
      createTransport: () => transport,
    })

    await mailer.send(OUTBOUND)

    expect(mailer.transport).toBe('smtp')
    expect(sent).toEqual([
      {
        from: FROM,
        to: TO,
        subject: MESSAGE.subject,
        html: MESSAGE.html,
        text: MESSAGE.text,
      },
    ])
  })

  it('builds the transport from the configured URL', () => {
    const createTransport = vi.fn(() => recordingSmtpTransport().transport)
    createSmtpMailer({ url: 'smtp://relay.example.com:2525', from: FROM, createTransport })

    expect(createTransport).toHaveBeenCalledWith('smtp://relay.example.com:2525')
  })

  it('rejects when the transport fails, so the caller can leave rows unstamped', async () => {
    const mailer = createSmtpMailer({
      url: 'smtp://relay.example.com',
      from: FROM,
      createTransport: () => ({
        sendMail: () => Promise.reject(new Error('ECONNREFUSED')),
      }),
    })

    await expect(mailer.send(OUTBOUND)).rejects.toThrow('ECONNREFUSED')
  })
})

describe('createResendMailer', () => {
  it('sends one authenticated JSON POST carrying the rendered message', async () => {
    const { calls, fetchImpl } = recordingFetch()
    const mailer = createResendMailer({ apiKey: 're_test', from: FROM, fetch: fetchImpl })

    await mailer.send(OUTBOUND)

    expect(mailer.transport).toBe('resend')
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.url).toBe('https://api.resend.com/emails')
    expect(call?.init.method).toBe('POST')
    expect(call?.init.headers).toEqual({
      authorization: 'Bearer re_test',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(call?.init.body))).toEqual({
      from: FROM,
      to: TO,
      subject: MESSAGE.subject,
      html: MESSAGE.html,
      text: MESSAGE.text,
    })
  })

  it('throws with the status and the response body on a non-2xx', async () => {
    const { fetchImpl } = recordingFetch(422, '{"message":"Invalid `from` field"}')
    const mailer = createResendMailer({ apiKey: 're_test', from: FROM, fetch: fetchImpl })

    const failure = mailer.send(OUTBOUND).catch((error: unknown) => error)

    await expect(failure).resolves.toBeInstanceOf(ResendSendError)
    const error = (await failure) as ResendSendError
    expect(error.status).toBe(422)
    expect(error.body).toContain('Invalid `from` field')
    expect(error.message).toContain('422')
  })
})

describe('the transports are peers', () => {
  it('receives the identical RenderedMessage through both, from one render call', async () => {
    const rendered = await renderNotificationDigest({
      publicUrl: 'https://yapm.example.com',
      items: [
        {
          title: 'Ada assigned you ENG-12',
          summary: 'Reconnect loop freezes the board',
          path: '/teams/team-1/issues?open=issue-1',
        },
      ],
    })

    const { sent, transport } = recordingSmtpTransport()
    const { calls, fetchImpl } = recordingFetch()
    const mailers: Mailer[] = [
      createSmtpMailer({
        url: 'smtp://relay.example.com',
        from: FROM,
        createTransport: () => transport,
      }),
      createResendMailer({ apiKey: 're_test', from: FROM, fetch: fetchImpl }),
    ]

    for (const mailer of mailers) {
      await mailer.send({ to: TO, message: rendered })
    }

    const viaSmtp = sent[0] as Record<string, unknown>
    const viaResend = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(viaSmtp).toEqual(viaResend)
    expect(viaResend.subject).toBe(rendered.subject)
    expect(viaResend.html).toBe(rendered.html)
    expect(viaResend.text).toBe(rendered.text)
  })
})

describe('createMailer', () => {
  it('returns null and logs once when neither transport is configured', () => {
    const logger = silentLogger()

    const mailer = createMailer(loadEnv({ DATABASE_URL: VALID.DATABASE_URL }), logger)

    expect(mailer).toBeNull()
    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
    expect(String(logger.info.mock.calls[0]?.[0])).toContain('RESEND_API_KEY')
  })

  it('selects the SMTP transport when only SMTP_URL is set', () => {
    const logger = silentLogger()
    const env = loadEnv({ ...VALID, SMTP_URL: 'smtp://user:pass@relay.example.com:587' })

    expect(createMailer(env, logger)?.transport).toBe('smtp')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('selects the Resend transport when only RESEND_API_KEY is set', () => {
    const logger = silentLogger()
    const env = loadEnv({ ...VALID, RESEND_API_KEY: 're_test' })

    expect(createMailer(env, logger)?.transport).toBe('resend')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('prefers Resend and warns naming SMTP_URL when both are set — never a boot failure', () => {
    const logger = silentLogger()
    const env = loadEnv({
      ...VALID,
      RESEND_API_KEY: 're_test',
      SMTP_URL: 'smtp://user:pass@relay.example.com:587',
    })

    const mailer = createMailer(env, logger)

    expect(mailer?.transport).toBe('resend')
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(String(logger.warn.mock.calls[0]?.[1])).toContain('SMTP_URL')
  })
})
