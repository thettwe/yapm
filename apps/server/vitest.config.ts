import { defineConfig } from 'vitest/config'
import { SERVER_TEST_DATABASE, withDatabase } from './src/testing/database-url.js'

const DATABASE_URL = process.env.DATABASE_URL

export default defineConfig({
  test: {
    name: 'server',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/testing/global-setup.ts'],
    env:
      DATABASE_URL === undefined
        ? {}
        : { DATABASE_URL: withDatabase(DATABASE_URL, SERVER_TEST_DATABASE) },
  },
})
