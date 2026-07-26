import type { RenderedMessage } from '@yapm/email'

export type { RenderedMessage }

// Deliberately shaped around "send this rendered message to these recipients" and nothing else.
// There is no Transporter, no envelope, no MIME part, no header bag — nothing SMTP-shaped that an
// HTTPS sender would have to emulate. That is what makes the two implementations peers rather than
// one being an adapter bolted onto the other's vocabulary, and it is what keeps the test doubles
// trivial: a double asserts the OutboundMessage it was handed, not that a mail arrived.
export interface OutboundMessage {
  readonly to: readonly string[]
  readonly message: RenderedMessage
}

export interface Mailer {
  readonly transport: 'smtp' | 'resend'
  // Rejects on a transport failure. Callers decide what a failure means: the notification sweep
  // catches it and leaves rows unstamped so the next pass retries; invite creation catches it and
  // still returns the link.
  send: (message: OutboundMessage) => Promise<void>
}
