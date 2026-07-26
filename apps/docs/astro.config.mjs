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
            { label: 'Cycle digest', slug: 'features/cycle-digest' },
            { label: 'Retrospectives', slug: 'features/retrospectives' },
            { label: 'Notifications', slug: 'features/notifications' },
          ],
        },
        {
          label: 'Self-hosting',
          items: [
            { label: 'Connect GitHub', slug: 'self-hosting/github-connector' },
            { label: 'Enable AI', slug: 'self-hosting/ai-setup' },
            { label: 'Email delivery', slug: 'self-hosting/email' },
            { label: 'Sync connection & recovery', slug: 'self-hosting/sync-recovery' },
          ],
        },
      ],
    }),
  ],
})
