import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { routeTree } from './routeTree.gen'

test('the index route renders the shared Button from @yapm/ui', async () => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: 'yapm' })).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Primary action' })).toBeInTheDocument()
})
