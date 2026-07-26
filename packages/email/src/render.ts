import { render, toPlainText } from '@react-email/render'
import type { ReactElement } from 'react'
import type { RenderedMessage } from './message.js'

// The plain-text part is derived from the *same* rendered HTML string, not from a second render
// pass, so the two can never describe different things. `@react-email/render`'s own
// `render(el, { plainText: true })` renders and then converts internally; doing the conversion here
// makes the shared origin visible and halves the work.
export async function renderMessage(
  subject: string,
  element: ReactElement,
): Promise<RenderedMessage> {
  const html = await render(element)
  return { subject, html, text: toPlainText(html) }
}
