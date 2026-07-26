import { createTransport as nodemailerCreateTransport } from 'nodemailer'
import type { Mailer, OutboundMessage } from './mailer.js'

export interface SmtpTransport {
  sendMail: (options: {
    from: string
    to: string[]
    subject: string
    html: string
    text: string
  }) => Promise<unknown>
}

export type CreateSmtpTransport = (url: string) => SmtpTransport

export interface SmtpMailerOptions {
  url: string
  from: string
  // Injected so tests need no SMTP server and no credentials — CI has neither, and never will.
  createTransport?: CreateSmtpTransport
}

const defaultCreateTransport: CreateSmtpTransport = (url) => nodemailerCreateTransport(url)

// One relay URL reaches Mailgun, Resend, Mailjet, Postmark, SendGrid and SES — every one of them
// issues SMTP credentials — which is why this is the default transport and covers most self-hosters
// with a single line of config.
export function createSmtpMailer({
  url,
  from,
  createTransport = defaultCreateTransport,
}: SmtpMailerOptions): Mailer {
  const transport = createTransport(url)
  return {
    transport: 'smtp',
    async send({ to, message }: OutboundMessage): Promise<void> {
      await transport.sendMail({
        from,
        to: [...to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      })
    },
  }
}
