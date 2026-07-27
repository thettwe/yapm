// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import {
  SNIPPET_START_DELIMITER as START,
  SNIPPET_STOP_DELIMITER as STOP,
} from '@yapm/schema/search'
import { expect, test } from 'vitest'
import { SearchResultRow } from './search-result-row'
import * as stories from './search-result-row.stories'
import { SnippetText } from './snippet-text'

test('renders alternating plain and highlighted segments', () => {
  const { container } = render(<SnippetText text={`before ${START}match${STOP} after`} />)

  const highlighted = container.querySelectorAll('mark')
  expect(highlighted).toHaveLength(1)
  expect(highlighted[0]?.textContent).toBe('match')
  expect(container.textContent).toBe('before match after')
})

// The reason this component exists. `ts_headline`'s default output IS markup, and its input here is
// user-authored comment prose; anything that reached `dangerouslySetInnerHTML` would be stored XSS.
test('renders markup-looking characters literally and interprets nothing', () => {
  const hostile = `<img src=x onerror="alert(1)"> <b>bold</b> & ${START}hit${STOP}`
  const { container } = render(<SnippetText text={hostile} />)

  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('b')).toBeNull()
  // Present only as escaped TEXT — the angle brackets never became a tag.
  expect(container.innerHTML).toContain('&lt;img src=x onerror="alert(1)"&gt;')
  expect(container.textContent).toBe(`<img src=x onerror="alert(1)"> <b>bold</b> & hit`)
})

test('an unbalanced delimiter degrades to plain text rather than highlighting the tail', () => {
  const { container } = render(<SnippetText text={`opened ${START}but never closed`} />)

  expect(container.querySelectorAll('mark')).toHaveLength(0)
  expect(container.textContent).toBe('opened but never closed')
})

test('a snippet with no delimiters renders unchanged', () => {
  const { container } = render(<SnippetText text="ordinary prose" />)

  expect(container.querySelectorAll('mark')).toHaveLength(0)
  expect(container.textContent).toBe('ordinary prose')
})

test('the result row renders its snippet through the same segmented path', () => {
  const { container } = render(
    <SearchResultRow
      kind="comment"
      issueKey="ENG-12"
      title="A title"
      snippet={`a <b>bold</b> ${START}hit${STOP}`}
    />,
  )

  expect(container.querySelector('b')).toBeNull()
  expect(container.querySelectorAll('mark')).toHaveLength(1)
  expect(screen.getByText('ENG-12')).toBeInTheDocument()
  expect(screen.getByText('A title')).toBeInTheDocument()
})

test('the row shows its state labels and its entity glyph, and marks the active row', () => {
  const { container, rerender } = render(
    <SearchResultRow
      kind="issue"
      issueKey="ENG-9"
      title="Held out of every list"
      states={['triage', 'canceled']}
    />,
  )

  expect(screen.getByText('Triage')).toBeInTheDocument()
  expect(screen.getByText('Canceled')).toBeInTheDocument()
  expect(screen.getByLabelText('Issue')).toBeInTheDocument()

  const row = container.querySelector('[data-slot="search-result-row"]')
  expect(row?.getAttribute('data-active')).toBeNull()
  expect(row?.className).not.toContain('bg-accent-soft')

  rerender(<SearchResultRow kind="issue" issueKey="ENG-9" title="Held out of every list" active />)
  const activeRow = container.querySelector('[data-slot="search-result-row"]')
  expect(activeRow?.getAttribute('data-active')).toBe('true')
  // The wash-plus-rule idiom, and body ink rather than accent ink — see `styles/contrast.test.ts`.
  expect(activeRow?.className).toContain('bg-accent-soft')
  expect(activeRow?.className).toContain('border-accent-strong')
  expect(activeRow?.className).not.toContain('text-accent-strong')
})

// The showcase requirement, asserted rather than eyeballed: every exported story mounts, and each
// one paints its variants once per preset per mode — six panels, `warm|focused|editorial` crossed
// with light and dark. A story that silently renders nothing would otherwise pass a build.
test('every showcase story renders in all three presets, light and dark', () => {
  const { default: meta, ...variants } = stories
  expect(meta.title).toBe('Search result row')
  const exported = Object.entries(variants)
  expect(exported.length).toBeGreaterThan(0)

  for (const [name, Story] of exported) {
    const { container, unmount } = render(<Story />)
    const panels = container.querySelectorAll('[data-theme]')
    expect(panels, name).toHaveLength(6)
    for (const theme of ['warm', 'focused', 'editorial']) {
      expect(
        container.querySelectorAll(`[data-theme="${theme}"]`),
        `${name} ${theme}`,
      ).toHaveLength(2)
      expect(
        container.querySelectorAll(`[data-theme="${theme}"].dark`),
        `${name} ${theme} dark`,
      ).toHaveLength(1)
    }
    unmount()
  }
})
