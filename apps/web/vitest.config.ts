import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig({ command: 'serve', mode: 'test' }),
  defineConfig({
    test: {
      name: 'web',
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: true,
      // Room for `test-setup.ts`'s 5s async budget to actually be reached — vitest's own 5s default
      // would kill the test first — and for the one-shot route-chunk warm-up some suites do in a
      // hook. The whole suite runs in ~5s; these are ceilings for a slow runner, not a target.
      testTimeout: 15_000,
      hookTimeout: 30_000,
    },
  }),
)
