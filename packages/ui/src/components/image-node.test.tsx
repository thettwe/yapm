// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { JSONContent } from '@tiptap/react'
import { RichTextRenderer } from '@yapm/ui/components/rich-text'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

beforeAll(() => {
  Range.prototype.getClientRects = () =>
    Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Element.prototype.scrollIntoView = () => undefined
})

afterEach(cleanup)

const ATTACHMENT_ID = '019702c7-0000-7000-8000-000000000001'

const DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'image', attrs: { attachmentId: ATTACHMENT_ID, alt: 'the login page' } }],
}

const resolve = (id: string) => `/api/v1/files/${id}`

describe('the image node view', () => {
  it('renders an img from the resolved path', async () => {
    render(<RichTextRenderer value={DOC} resolveAttachmentSrc={resolve} />)
    const image = await screen.findByAltText('the login page')
    expect(image).toHaveAttribute('src', `/api/v1/files/${ATTACHMENT_ID}`)
  })

  // Removing a file from the Files section deletes the bytes and leaves every document that named
  // them alone, so the fetch 404s. The docs promise the image "degrades to its alt text"; without
  // this it degraded to the browser's own broken-image glyph, which carries none.
  it('falls back to the alt-text placeholder when the bytes are gone', async () => {
    render(<RichTextRenderer value={DOC} resolveAttachmentSrc={resolve} />)
    const image = await screen.findByAltText('the login page')

    fireEvent.error(image)

    expect(screen.queryByAltText('the login page')).toBeNull()
    expect(screen.getByTestId('rich-text-image')).toHaveTextContent('the login page')
  })

  it('draws the placeholder when no resolver is supplied, rather than an empty src', async () => {
    render(<RichTextRenderer value={DOC} />)
    const wrapper = await screen.findByTestId('rich-text-image')
    expect(wrapper).toHaveTextContent('the login page')
    expect(wrapper.querySelector('img')).toBeNull()
  })
})
