// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import type { MentionCandidate } from '../lib/mention-match.js'
import {
  MentionList,
  mentionAnnouncement,
  mentionOptionId,
  nextMentionIndex,
} from './mention-list.js'

const LISTBOX_ID = 'mentions'

const PEOPLE: MentionCandidate[] = [
  { id: 'ada', name: 'Ada Lovelace', email: 'ada@example.com', eligible: true },
  { id: 'bo', name: 'Bo Nguyen', email: 'bo@example.com', eligible: true },
  { id: 'cas', name: 'Casey Stone', eligible: false, reason: 'Not on this team' },
]

/**
 * Stands in for the editor: it owns the active index, points `aria-activedescendant` at the active
 * option, and owns the PERSISTENT live region — all three exactly as `RichTextEditor` does. The
 * list itself never takes focus, so this is the only shape in which its keyboard contract can be
 * exercised, and the region belongs out here because a polite region mounted with the popup, text
 * already in it, is not reliably announced.
 */
function Harness({
  items = PEOPLE,
  query = '',
  open = true,
  onInsert = vi.fn(),
}: {
  items?: MentionCandidate[]
  query?: string
  open?: boolean
  onInsert?: (candidate: MentionCandidate) => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [rejectedCount, setRejectedCount] = useState(0)

  function accept(index: number) {
    const candidate = items[index]
    if (candidate === undefined) return
    if (!candidate.eligible) {
      setRejectedCount((count) => count + 1)
      return
    }
    onInsert(candidate)
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: this stands in for ProseMirror's contenteditable, which is a div with role=textbox
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: a rich-text editor with an attached typeahead keeps role=textbox and adds the expanded/controls/activedescendant triple, exactly as the real editor does
    <div
      role="textbox"
      tabIndex={0}
      aria-label="Comment"
      aria-multiline="true"
      aria-expanded="true"
      aria-controls={LISTBOX_ID}
      aria-activedescendant={
        items.length === 0 ? undefined : mentionOptionId(LISTBOX_ID, activeIndex)
      }
      onKeyDown={(event) => {
        const moved = nextMentionIndex(event.key, activeIndex, items.length)
        if (moved !== null) {
          event.preventDefault()
          setActiveIndex(moved)
          setRejectedCount(0)
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          accept(activeIndex)
        }
      }}
    >
      {open ? (
        <MentionList
          id={LISTBOX_ID}
          items={items}
          query={query}
          activeIndex={activeIndex}
          onSelect={accept}
          onActiveChange={setActiveIndex}
        />
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">
        {open ? mentionAnnouncement({ items, query, activeIndex, rejectedCount }) : ''}
      </span>
    </div>
  )
}

function editor(): HTMLElement {
  return screen.getByRole('textbox')
}

function activeOption(): HTMLElement {
  const id = editor().getAttribute('aria-activedescendant')
  expect(id).not.toBeNull()
  const element = document.getElementById(id as string)
  expect(element).not.toBeNull()
  return element as HTMLElement
}

test('every option is announced with a resolvable id inside the same subtree', () => {
  render(<Harness />)

  const options = screen.getAllByRole('option')
  expect(options).toHaveLength(3)
  for (const [index, option] of options.entries()) {
    expect(option).toHaveAttribute('id', mentionOptionId(LISTBOX_ID, index))
  }
  expect(editor().contains(activeOption())).toBe(true)
})

test('arrow keys move the active option and wrap', () => {
  render(<Harness />)

  expect(activeOption()).toHaveTextContent('Ada Lovelace')

  fireEvent.keyDown(editor(), { key: 'ArrowDown' })
  expect(activeOption()).toHaveTextContent('Bo Nguyen')
  expect(activeOption()).toHaveAttribute('aria-selected', 'true')

  fireEvent.keyDown(editor(), { key: 'ArrowDown' })
  fireEvent.keyDown(editor(), { key: 'ArrowDown' })
  expect(activeOption()).toHaveTextContent('Ada Lovelace')

  fireEvent.keyDown(editor(), { key: 'ArrowUp' })
  expect(activeOption()).toHaveTextContent('Casey Stone')
})

test('Home and End jump to the first and last option', () => {
  render(<Harness />)

  fireEvent.keyDown(editor(), { key: 'End' })
  expect(activeOption()).toHaveTextContent('Casey Stone')

  fireEvent.keyDown(editor(), { key: 'Home' })
  expect(activeOption()).toHaveTextContent('Ada Lovelace')
})

test('a disabled option is reachable, states its reason, and inserts nothing', () => {
  const onInsert = vi.fn()
  render(<Harness onInsert={onInsert} />)

  fireEvent.keyDown(editor(), { key: 'End' })

  const disabled = activeOption()
  expect(disabled).toHaveAttribute('aria-disabled', 'true')
  expect(disabled).toHaveTextContent('Not on this team')

  fireEvent.keyDown(editor(), { key: 'Enter' })
  expect(onInsert).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent(
    'Casey Stone cannot be mentioned: Not on this team. Nothing was inserted.',
  )
  expect(screen.getAllByRole('option')).toHaveLength(3)
})

test('an eligible option inserts on Enter', () => {
  const onInsert = vi.fn()
  render(<Harness onInsert={onInsert} />)

  fireEvent.keyDown(editor(), { key: 'ArrowDown' })
  fireEvent.keyDown(editor(), { key: 'Enter' })

  expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'bo' }))
})

test('the live region announces the match count', () => {
  render(<Harness query="a" />)
  expect(screen.getByRole('status')).toHaveTextContent('3 matches. Ada Lovelace.')
})

// A polite region is announced when its CONTENT CHANGES. Inserted into the document with its text
// already present — which is what a region living inside the popup does every time the popup opens
// — there is no change to observe, and the announcement that matters most is the one that is lost.
test('the live region exists before the popup opens and is the same node once it does', () => {
  const { rerender } = render(<Harness open={false} query="a" />)

  const region = screen.getByRole('status')
  expect(region.textContent).toBe('')
  expect(screen.queryByRole('listbox')).toBeNull()

  rerender(<Harness open query="a" />)

  expect(screen.getByRole('status')).toBe(region)
  expect(region).toHaveTextContent('3 matches. Ada Lovelace.')
})

test('an empty result names the query rather than going blank', () => {
  render(<Harness items={[]} query="dana" />)

  expect(screen.queryAllByRole('option')).toHaveLength(0)
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  expect(screen.getByText('No teammates match “dana”')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('No teammates match “dana”.')
  expect(editor()).not.toHaveAttribute('aria-activedescendant')
})
