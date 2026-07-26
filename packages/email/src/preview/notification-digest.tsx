import { NotificationDigest } from '../notification-digest.js'

// `pnpm --filter @yapm/email preview` renders this in react-email's browser preview. Sample data
// only — the real inputs are worded by `notificationCopy` in @yapm/schema.
export default function NotificationDigestPreview() {
  return (
    <NotificationDigest
      items={[
        {
          title: 'Ada assigned you ENG-12',
          summary: 'Sync reconnect loop freezes the board',
          path: '/teams/team-1/issues?open=issue-1',
        },
        {
          title: 'Grace commented on ENG-13',
          summary: 'Digest job double-sends on rebase',
          path: '/teams/team-1/issues?open=issue-2',
        },
      ]}
      publicUrl="https://yapm.example.com"
    />
  )
}
