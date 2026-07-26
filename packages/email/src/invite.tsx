import { Button, Layout } from './layout.js'
import type { RenderedMessage } from './message.js'
import { renderMessage } from './render.js'
import { palette } from './theme.js'
import { absoluteUrl } from './url.js'

export interface InviteInput {
  readonly publicUrl: string
  readonly workspaceName: string
  // Null when the inviter's name is unknown — never an email address, which would leak an admin's
  // address to someone who is not yet a member.
  readonly inviterName: string | null
  readonly token: string
}

const UNKNOWN_INVITER = 'Someone'

export function inviteSubject(workspaceName: string): string {
  return `You have been invited to ${workspaceName} on yapm`
}

export function inviteUrl(publicUrl: string, token: string): string {
  return absoluteUrl(publicUrl, `/invite?token=${encodeURIComponent(token)}`)
}

export function Invite({ publicUrl, workspaceName, inviterName, token }: InviteInput) {
  const inviter = inviterName?.trim() ? inviterName.trim() : UNKNOWN_INVITER
  const acceptUrl = inviteUrl(publicUrl, token)
  return (
    <Layout
      footer="If you were not expecting this invitation you can safely ignore this email."
      heading={`${inviter} invited you to ${workspaceName}`}
      preview={inviteSubject(workspaceName)}
    >
      <p style={{ margin: '0 0 20px', color: palette.text2 }}>
        Accept the invitation to join the workspace and start working with your team.
      </p>
      <Button href={acceptUrl} label="Accept invitation" />
      <p style={{ margin: '20px 0 0', color: palette.text3, fontSize: '12px' }}>
        Or paste this link into your browser: {acceptUrl}
      </p>
    </Layout>
  )
}

export function renderInvite(input: InviteInput): Promise<RenderedMessage> {
  return renderMessage(inviteSubject(input.workspaceName), <Invite {...input} />)
}
