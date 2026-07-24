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
          items: [{ label: 'Board', slug: 'features/board' }],
        },
        {
          label: 'Self-hosting',
          items: [{ label: 'Connect GitHub', slug: 'self-hosting/github-connector' }],
        },
      ],
    }),
  ],
})
