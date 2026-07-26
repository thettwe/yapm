import type { Mailer, OutboundMessage } from './mailer.js'

const RESEND_SEND_ENDPOINT = 'https://api.resend.com/emails'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface ResendMailerOptions {
  apiKey: string
  from: string
  endpoint?: string
  // Injected so tests need no API key and make no network call.
  fetch?: FetchLike
}

export class ResendSendError extends Error {
  status: number
  body: string

  constructor(status: number, body: string) {
    super(`Resend rejected the message: ${status} ${body}`)
    this.name = 'ResendSendError'
    this.status = status
    this.body = body
  }
}

// One authenticated JSON POST. No SDK: the `resend` package pulls postal-mime and standardwebhooks
// for a request Node's built-in fetch makes in a dozen lines, and a dependency not added is a
// dependency not maintained.
//
// This exists because some hosts block outbound SMTP ports entirely, and on those SMTP cannot be
// made to work at all — an HTTPS sender is the only path out.
export function createResendMailer({
  apiKey,
  from,
  endpoint = RESEND_SEND_ENDPOINT,
  fetch: fetchImpl = globalThis.fetch,
}: ResendMailerOptions): Mailer {
  return {
    transport: 'resend',
    async send({ to, message }: OutboundMessage): Promise<void> {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [...to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      })

      if (!response.ok) {
        throw new ResendSendError(response.status, await response.text())
      }
    },
  }
}
