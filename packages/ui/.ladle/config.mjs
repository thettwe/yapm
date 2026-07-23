import { fileURLToPath } from 'node:url'

export default {
  stories: 'src/**/*.stories.{js,jsx,ts,tsx}',
  viteConfig: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
  port: 61000,
  outDir: 'ladle-dist',
  addons: {
    a11y: { enabled: true },
    theme: { enabled: true, defaultState: 'light' },
    msw: { enabled: false },
  },
}
