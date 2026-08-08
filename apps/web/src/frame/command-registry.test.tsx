import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { CommandRegistryProvider, useCommandSource } from '@/frame/command-registry'

// ONE ⌘K owner. Before this change four surfaces each bound their own `window` listener, so the
// binding the deck advertises on every page did nothing on ten routes. What these cases hold is the
// registration contract: the frame's own group always answers, a surface with its own palette takes
// over while it is mounted, and it hands the binding back when it leaves.

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  // jsdom ships neither; `cmdk` observes its list and Base UI measures its popup.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

function Surface({ id, onOpen }: { id: string; onOpen: () => void }) {
  useCommandSource(id, { open: onOpen })
  return null
}

function Frame({ onSelect }: { onSelect: () => void }) {
  useCommandSource('frame', {
    groups: [
      {
        id: 'frame',
        heading: 'Go to',
        commands: [{ id: 'frame:issues', label: 'Issues', shortcut: 'g i', onSelect }],
      },
    ],
  })
  return null
}

function press() {
  act(() => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
  })
}

test('with no surface palette registered, the shortcut opens the frame’s own', async () => {
  const onSelect = vi.fn()
  render(
    <CommandRegistryProvider>
      <Frame onSelect={onSelect} />
    </CommandRegistryProvider>,
  )

  press()

  expect(await screen.findByPlaceholderText('Type a command or search…')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Issues'))
  expect(onSelect).toHaveBeenCalledTimes(1)
})

test('a surface with its own palette answers the shortcut while it is mounted, and only then', async () => {
  const surfaceOpen = vi.fn()
  const view = render(
    <CommandRegistryProvider>
      <Frame onSelect={vi.fn()} />
      <Surface id="issues" onOpen={surfaceOpen} />
    </CommandRegistryProvider>,
  )

  press()
  expect(surfaceOpen).toHaveBeenCalledTimes(1)
  expect(screen.queryByPlaceholderText('Type a command or search…')).toBeNull()

  view.rerender(
    <CommandRegistryProvider>
      <Frame onSelect={vi.fn()} />
    </CommandRegistryProvider>,
  )

  press()
  expect(surfaceOpen).toHaveBeenCalledTimes(1)
  expect(await screen.findByPlaceholderText('Type a command or search…')).toBeInTheDocument()
})

// One listener, not one per surface: two surfaces mounted at once must not both answer.
test('the innermost surface answers, and the shortcut fires exactly one opener', () => {
  const outer = vi.fn()
  const inner = vi.fn()
  render(
    <CommandRegistryProvider>
      <Surface id="outer" onOpen={outer} />
      <Surface id="inner" onOpen={inner} />
    </CommandRegistryProvider>,
  )

  press()

  expect(inner).toHaveBeenCalledTimes(1)
  expect(outer).not.toHaveBeenCalled()
})

// Registration is inert without a provider: a surface rendered in isolation must not throw for
// wanting to offer commands.
test('a surface outside the provider registers nothing and does not throw', () => {
  expect(() => render(<Surface id="orphan" onOpen={vi.fn()} />)).not.toThrow()
})
