import { inviteUrl, renderInvite } from '@yapm/email'
import type { Mailer } from './mailer.js'

export interface SendInviteEmailOptions {
  // Null means email is off. Then this is a no-op that still reports the link, which is the whole
  // "email is an additional convenience, never a requirement" contract in one signature.
  mailer: Mailer | null
  publicUrl: string | null
  workspaceName: string
  inviterName: string | null
  recipient: string
  token: string
}

export interface SendInviteEmailResult {
  // The accept link the email carries, or null when no public URL is configured — in which case
  // nothing was sent and the admin's own copyable link (built client-side from the browser origin)
  // is the only one there has ever been.
  readonly link: string | null
  readonly sent: boolean
}

// Rendered by the same react-email mechanism and delivered by the same provider-neutral seam as
// every other outgoing message, which is what closes the invitations spec's long-false "WHEN SMTP
// is configured … THEN the invite email is sent".
export async function sendInviteEmail(
  options: SendInviteEmailOptions,
): Promise<SendInviteEmailResult> {
  const { mailer, publicUrl, workspaceName, inviterName, recipient, token } = options
  if (publicUrl === null) return { link: null, sent: false }

  const link = inviteUrl(publicUrl, token)
  if (mailer === null) return { link, sent: false }

  const message = await renderInvite({ publicUrl, workspaceName, inviterName, token })
  await mailer.send({ to: [recipient], message })
  return { link, sent: true }
}
