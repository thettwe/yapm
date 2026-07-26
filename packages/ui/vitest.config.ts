import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'ui',
    // `node` stays the default: most of this package's tests are pure functions, and one of them
    // reads `globals.css` off disk through `import.meta.url`, which jsdom rewrites to an http URL.
    // Component tests opt in with a `@vitest-environment jsdom` docblock instead.
    environment: 'node',
    // Testing Library registers its between-test DOM cleanup only when the globals are enabled.
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
