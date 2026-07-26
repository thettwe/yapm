import { type Env, mailEnv } from '../config/env.js'
import type { Logger } from '../logger.js'
import type { Mailer } from './mailer.js'
import { createResendMailer } from './resend.js'
import { createSmtpMailer } from './smtp.js'

export type { SendInviteEmailOptions, SendInviteEmailResult } from './invite.js'
export { sendInviteEmail } from './invite.js'
export type { Mailer, OutboundMessage, RenderedMessage } from './mailer.js'
export { createResendMailer, type FetchLike, ResendSendError } from './resend.js'
export type { CreateSmtpTransport, SmtpTransport } from './smtp.js'
export { createSmtpMailer } from './smtp.js'

// Returns null when email is off. Null is not a degraded state: the in-app inbox is complete
// without a mailer, invite links stay copyable, and nothing is queued that could retry forever.
//
// Both transports set is a warning, never a boot failure. A host that blocks outbound SMTP is the
// reason the HTTPS sender exists, so an operator who added RESEND_API_KEY on top of an existing
// SMTP_URL has almost certainly done so because SMTP stopped working — refusing to boot on a config
// where neither value is malformed would be a footgun exactly at the moment they are fixing things.
export type MailerLogger = Pick<Logger, 'info' | 'warn'>

export function createMailer(env: Env, logger: MailerLogger): Mailer | null {
  const config = mailEnv(env)

  if (config === null) {
    logger.info(
      'Email is disabled: neither SMTP_URL nor RESEND_API_KEY is configured. The notification inbox works in full without it.',
    )
    return null
  }

  if (config.ignored !== null) {
    logger.warn(
      { transport: config.transport, ignored: config.ignored },
      `Both email transports are configured; using RESEND_API_KEY and ignoring ${config.ignored}.`,
    )
  }

  if (config.transport === 'resend') {
    return createResendMailer({ apiKey: config.apiKey, from: config.from })
  }
  return createSmtpMailer({ url: config.url, from: config.from })
}
