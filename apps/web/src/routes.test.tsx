import { Zero } from '@rocicorp/zero'
import { ZeroProvider } from '@rocicorp/zero/react'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { type AuthContext, mutators, schema } from '@yapm/schema'
import { afterEach, expect, test } from 'vitest'
import { routeTree } from './routeTree.gen'

const TEST_CONTEXT: AuthContext = { userID: 'test-user', role: 'admin' }

const opened: { close: () => Promise<void> }[] = []

function offlineZero() {
  const zero = new Zero({
    schema,
    mutators,
    context: TEST_CONTEXT,
    userID: TEST_CONTEXT.userID,
    cacheURL: null,
    kvStore: 'mem',
  })
  opened.push(zero)
  return zero
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((zero) => zero.close()))
})

test('the index route renders the workspace panel and the connection state', async () => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(
    <ZeroProvider zero={offlineZero()}>
      <RouterProvider router={router} />
    </ZeroProvider>,
  )

  expect(await screen.findByTestId('workspace-placeholder')).toBeInTheDocument()
  expect(await screen.findByTestId('connection-status')).toBeInTheDocument()
})
