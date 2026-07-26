import { Button, Layout } from './layout.js'
import type { RenderedMessage } from './message.js'
import { renderMessage } from './render.js'
import { palette } from './theme.js'
import { absoluteUrl } from './url.js'

// The one extra line a mention carries, because being mentioned did something beyond telling you:
// it subscribed you to the thread. An email that leaves that unsaid is a subscription somebody
// acquired without being told, which is the mail trap this feature exists to avoid. The wording
// lives here, with the template that renders it, and the sender decides which items get it — this
// package deliberately knows no notification kinds.
//
// It is a SENTENCE, not a link: no signed unsubscribe URL and no `List-Unsubscribe` header. The
// control is the issue's own Follow button, inside the app's permission model.
export const MENTION_FOLLOW_FOOTNOTE =
  'You now follow this issue — you can stop from the issue page.'

export interface NotificationDigestItem {
  // Already worded by `notificationCopy` in @yapm/schema, so the inbox row and this email can never
  // describe the same event differently.
  readonly title: string
  readonly summary: string
  // App-relative, resolved against `publicUrl`. Never absolute — see `absoluteUrl`.
  readonly path: string
  // Per-item consequence line, rendered under the summary when present. `MENTION_FOLLOW_FOOTNOTE`
  // is the only one that ships.
  readonly footnote?: string
}

export interface NotificationDigestInput {
  readonly publicUrl: string
  readonly items: readonly NotificationDigestItem[]
}

const INBOX_PATH = '/inbox'

export function notificationDigestSubject(items: readonly NotificationDigestItem[]): string {
  const first = items[0]
  if (first === undefined) return 'yapm'
  if (items.length === 1) return first.title
  return `${first.title} and ${items.length - 1} more`
}

// A digest carries the actor-and-verb line and the issue title as it was — never a comment body.
// An email leaves the app's permission model behind, so anything beyond what is needed to decide
// "do I open this?" is content leaked for no benefit.
export function NotificationDigest({ publicUrl, items }: NotificationDigestInput) {
  const inboxUrl = absoluteUrl(publicUrl, INBOX_PATH)
  const heading =
    items.length === 1 ? 'You have a notification' : `You have ${items.length} notifications`
  return (
    <Layout
      // The footer NAMES THE CONTROL, not just the app. `/inbox` is where the link can land — it
      // is the only notification surface an email has a stable path to — but the email preference
      // lives in the Appearance popover, so a footer reading "change your email preferences here"
      // sent people to a page with no such control. Say where it actually is.
      footer={
        <>
          You are receiving this because you are involved in this work. To change what yapm emails
          you, open{' '}
          <a href={inboxUrl} style={{ color: palette.text2 }}>
            yapm
          </a>{' '}
          and use Appearance settings.
        </>
      }
      heading={heading}
      preview={notificationDigestSubject(items)}
    >
      <table cellPadding={0} cellSpacing={0} role="presentation" style={{ width: '100%' }}>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.path}-${item.title}`}>
              <td style={{ padding: '12px 0', borderBottom: `1px solid ${palette.border}` }}>
                <a
                  href={absoluteUrl(publicUrl, item.path)}
                  style={{ color: palette.text1, fontWeight: 600, textDecoration: 'none' }}
                >
                  {item.title}
                </a>
                <div style={{ color: palette.text2, fontSize: '14px', marginTop: '2px' }}>
                  {item.summary}
                </div>
                {item.footnote === undefined ? null : (
                  <div style={{ color: palette.text2, fontSize: '13px', marginTop: '2px' }}>
                    {item.footnote}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ paddingTop: '20px' }}>
        <Button href={inboxUrl} label="Open your inbox" />
      </div>
    </Layout>
  )
}

export function renderNotificationDigest(input: NotificationDigestInput): Promise<RenderedMessage> {
  return renderMessage(notificationDigestSubject(input.items), <NotificationDigest {...input} />)
}
