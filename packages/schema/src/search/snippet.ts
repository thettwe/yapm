// The snippet wire format, owned in one place because it has two ends that must agree: Postgres
// writes it (`ts_headline`'s StartSel/StopSel in `db/search.ts`) and a React component reads it.
//
// `ts_headline` returns MARKUP by default. Rendering that with `dangerouslySetInnerHTML` would be a
// stored-XSS vector fed straight from user-authored comment bodies, so the delimiters are two
// CONTROL CHARACTERS instead: they cannot occur in prose, they carry no meaning to any renderer,
// and the worst case if one somehow appears in a document is a mis-highlight rather than injected
// HTML. Nothing downstream ever interpolates a snippet as HTML.
//
// Both are one UTF-16 code unit, which `splitSnippet` relies on.

export const SNIPPET_START_DELIMITER = '\u0001'
export const SNIPPET_STOP_DELIMITER = '\u0002'

export interface SnippetSegment {
  readonly text: string
  readonly highlighted: boolean
}

// Split a delimited snippet into alternating plain/highlighted segments.
//
// Total on malformed input. An unbalanced or stray delimiter degrades to plain text rather than
// throwing or swallowing characters: the input is derived from user-authored prose, and a snippet
// that cannot be highlighted must still be readable. Empty segments are dropped so a highlight at
// the very start or end of a fragment does not render an empty span.
export function splitSnippet(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = []
  let index = 0
  let highlighted = false

  while (index < snippet.length) {
    const delimiter = highlighted ? SNIPPET_STOP_DELIMITER : SNIPPET_START_DELIMITER
    const next = snippet.indexOf(delimiter, index)
    if (next === -1) break
    if (next > index) segments.push({ text: snippet.slice(index, next), highlighted })
    index = next + delimiter.length
    highlighted = !highlighted
  }

  // Whatever is left after the last delimiter — and, when a StopSel never arrived, the unterminated
  // tail. It is emitted UNhighlighted: an unbalanced marker must not silently highlight the rest of
  // the snippet.
  if (index < snippet.length) {
    segments.push({ text: snippet.slice(index), highlighted: false })
  }

  return segments
}
