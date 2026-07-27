import { type SnippetSegment, splitSnippet } from '@yapm/schema/search'
import { cn } from '@yapm/ui/lib/utils'

// `ts_headline` returns MARKUP by default and this component's input is user-authored comment
// prose, so the wire format uses two control characters as delimiters instead and NOTHING here
// ever touches `dangerouslySetInnerHTML`. That is the whole reason this component exists rather
// than a one-line `<span>{snippet}</span>` with the highlight thrown away.
//
// The splitter is IMPORTED from `@yapm/schema/search` rather than reimplemented: the format has two
// ends that must agree — Postgres writes it, this reads it — and a second copy of the parser is how
// they drift. `@yapm/schema/search` is a pure, import-free module (see its index header), so this
// costs the design system no runtime dependency on Zero, Kysely or Zod.
//
// The highlight is WEIGHT and an underline, not a background wash. A wash would have to be legible
// against both the plain row and the active row, and the active row is already painted
// `--accent-soft`; a second wash on top of it either disappears or needs a colour nobody has
// contrast-tested. `text-1` over `text-2` is asserted AA on every surface in every preset already,
// and the underline carries the emphasis without relying on hue (WCAG 1.4.1).
export interface SnippetTextProps {
  /** Raw `ts_headline` output carrying the U+0001 / U+0002 delimiters. */
  text: string
  className?: string
}

const HIGHLIGHT =
  'bg-transparent font-semibold text-text-1 underline decoration-accent-strong decoration-2 underline-offset-2'

function segmentKey(segment: SnippetSegment, index: number): string {
  return `${index}:${segment.highlighted ? 'h' : 'p'}`
}

export function SnippetText({ text, className }: SnippetTextProps) {
  return (
    <span
      data-slot="snippet-text"
      className={cn('block truncate font-ui text-[12px] text-text-2', className)}
    >
      {splitSnippet(text).map((segment, index) =>
        segment.highlighted ? (
          <mark key={segmentKey(segment, index)} className={HIGHLIGHT}>
            {segment.text}
          </mark>
        ) : (
          <span key={segmentKey(segment, index)}>{segment.text}</span>
        ),
      )}
    </span>
  )
}
