import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

export default defineConfig({
  integrations: [
    starlight({
      title: 'yapm',
      description:
        'Open-source project management where issues and delivery truth live in one work graph.',
      sidebar: [
        {
          label: 'Features',
          items: [
            { label: 'Board', slug: 'features/board' },
            { label: 'Cycles', slug: 'features/cycles' },
            { label: 'Triage', slug: 'features/triage' },
            { label: 'Projects & roadmap', slug: 'features/projects' },
            { label: 'Delivery signals', slug: 'features/delivery-signals' },
            { label: 'Status automation', slug: 'features/auto-status' },
            { label: 'Cycle digest', slug: 'features/cycle-digest' },
            { label: 'Product digest', slug: 'features/pm-digest' },
            { label: 'Retrospectives', slug: 'features/retrospectives' },
            { label: 'Delivery view', slug: 'features/delivery' },
            { label: 'Retro AI draft', slug: 'features/retro-ai-draft' },
            { label: 'Notifications', slug: 'features/notifications' },
            { label: 'Mentions', slug: 'features/mentions' },
            { label: 'Images, tables & code', slug: 'features/rich-text' },
            { label: 'Markdown', slug: 'features/markdown' },
            { label: 'Search', slug: 'features/search' },
          ],
        },
        {
          label: 'Self-hosting',
          items: [
            { label: 'Deploy & harden', slug: 'self-hosting/deploy' },
            { label: 'Configuration reference', slug: 'self-hosting/configuration' },
            { label: 'Upgrade & rollback', slug: 'self-hosting/upgrade' },
            { label: 'Single sign-on (OIDC)', slug: 'self-hosting/sso' },
            { label: 'Connect GitHub', slug: 'self-hosting/github-connector' },
            { label: 'Enable AI', slug: 'self-hosting/ai-setup' },
            { label: 'The disclosure model', slug: 'self-hosting/ai-disclosure' },
            { label: 'Email delivery', slug: 'self-hosting/email' },
            { label: 'Sync connection & recovery', slug: 'self-hosting/sync-recovery' },
            { label: 'Search index', slug: 'self-hosting/search-index' },
            { label: 'Attachments', slug: 'self-hosting/attachments' },
            { label: 'Backup & restore', slug: 'self-hosting/backup-restore' },
          ],
        },
      ],
    }),
  ],
})
