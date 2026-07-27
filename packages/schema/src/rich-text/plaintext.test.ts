import { describe, expect, it } from 'vitest'
import {
  extractMentionIds,
  MENTION_LABEL_MAX_LENGTH,
  richTextToPlainText,
  sanitizeRichText,
} from './plaintext.js'

function text(value: string): unknown {
  return { type: 'text', text: value }
}

function mention(attrs: Record<string, unknown>): unknown {
  return { type: 'mention', attrs }
}

function paragraph(...content: unknown[]): unknown {
  return { type: 'paragraph', content }
}

function doc(...content: unknown[]): unknown {
  return { type: 'doc', content }
}

const NESTED = doc(
  paragraph(text('Ship '), mention({ id: 'u-1', label: 'Alice' }), text(' today')),
  {
    type: 'blockquote',
    content: [
      paragraph(text('Blocked on ')),
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(text('review'))] },
          {
            type: 'listItem',
            content: [
              paragraph(text('deploy ')),
              {
                type: 'bulletList',
                content: [{ type: 'listItem', content: [paragraph(text('staging'))] }],
              },
            ],
          },
        ],
      },
    ],
  },
)

describe('richTextToPlainText', () => {
  it('renders nested lists and blockquotes one block per line', () => {
    expect(richTextToPlainText(NESTED)).toBe(
      ['Ship @Alice today', 'Blocked on', 'review', 'deploy', 'staging'].join('\n'),
    )
  })

  it('renders a mention with the resolved display name, not the stored label', () => {
    const names = new Map([['u-1', 'Alice Okonkwo']])
    expect(
      richTextToPlainText(doc(paragraph(mention({ id: 'u-1', label: 'stale' }))), { names }),
    ).toBe('@Alice Okonkwo')
  })

  it('falls back to the stored label, then to nothing at all', () => {
    expect(richTextToPlainText(doc(paragraph(mention({ id: 'u-9', label: 'Bo' }))))).toBe('@Bo')
    expect(richTextToPlainText(doc(paragraph(mention({ id: 'u-9' }))))).toBe('')
  })

  it('omits mention nodes entirely in strip mode — the model-facing form', () => {
    const document = doc(
      paragraph(text('ask '), mention({ id: 'u-1', label: 'Alice' }), text(' first')),
    )
    expect(richTextToPlainText(document, { mentions: 'strip' })).toBe('ask  first')
    expect(
      richTextToPlainText(document, { mentions: 'strip', names: new Map([['u-1', 'Alice']]) }),
    ).not.toContain('Alice')
  })

  it('breaks a line on a hard break and drops empty blocks', () => {
    expect(
      richTextToPlainText(
        doc(
          paragraph(text('one'), { type: 'hardBreak' }, text('two')),
          paragraph(),
          paragraph(text('three')),
        ),
      ),
    ).toBe('one\ntwo\nthree')
  })

  // What the search indexer asks of this walk: a mention resolves to the person's CURRENT name, so
  // the index finds them by who they are now rather than by whatever label was frozen into the
  // document when they were mentioned — and a rename propagates on the next reindex.
  it('indexes a mention under the resolved name, so a rename propagates', () => {
    const document = doc(paragraph(text('Blocked on '), mention({ id: 'u-1', label: 'Lovisa' })))
    expect(
      richTextToPlainText(document, {
        mentions: 'label',
        names: new Map([['u-1', 'Lovisa Berg']]),
      }),
    ).toBe('Blocked on @Lovisa Berg')
  })

  // The other half, unchanged and load-bearing: the model-facing form still removes the person
  // entirely, so a searchable projection and a model prompt can never be built the same way.
  it('still strips a mention completely in strip mode even with names supplied', () => {
    const document = doc(paragraph(text('Blocked on '), mention({ id: 'u-1', label: 'Lovisa' })))
    const stripped = richTextToPlainText(document, {
      mentions: 'strip',
      names: new Map([['u-1', 'Lovisa Berg']]),
    })
    expect(stripped).toBe('Blocked on')
    expect(stripped).not.toContain('Lovisa')
    expect(stripped).not.toContain('@')
  })

  it('bounds the output at maxLength and stops walking once the budget is spent', () => {
    const long = doc(
      ...Array.from({ length: 500 }, (_, index) => paragraph(text(`line ${index} of prose`))),
    )
    expect(richTextToPlainText(long, { maxLength: 40 })).toHaveLength(40)
    expect(richTextToPlainText(long, { maxLength: 40 })).toBe(
      richTextToPlainText(long).slice(0, 40),
    )
  })

  it('leaves a document shorter than the budget untouched, and honours a zero budget', () => {
    const document = doc(paragraph(text('short')))
    expect(richTextToPlainText(document, { maxLength: 4096 })).toBe('short')
    expect(richTextToPlainText(document, { maxLength: 0 })).toBe('')
  })

  it('is unbounded when no budget is given', () => {
    const long = doc(...Array.from({ length: 200 }, () => paragraph(text('x'.repeat(50)))))
    expect(richTextToPlainText(long).length).toBeGreaterThan(9000)
  })

  it('returns an empty string for a malformed document rather than throwing', () => {
    for (const value of [
      undefined,
      null,
      'a string',
      42,
      [],
      { type: 'paragraph' },
      { content: 'nope' },
    ]) {
      expect(richTextToPlainText(value)).toBe('')
    }
  })
})

describe('extractMentionIds', () => {
  it('returns ids in document order, deduplicated', () => {
    const document = doc(
      paragraph(
        mention({ id: 'u-2', label: 'Bo' }),
        text(' and '),
        mention({ id: 'u-1', label: 'Alice' }),
      ),
      {
        type: 'blockquote',
        content: [paragraph(mention({ id: 'u-2', label: 'Bo again' }), mention({ id: 'u-3' }))],
      },
    )
    expect(extractMentionIds(document)).toEqual(['u-2', 'u-1', 'u-3'])
  })

  it('ignores a mention with a missing, blank or non-string id', () => {
    const document = doc(
      paragraph(mention({ label: 'nobody' }), mention({ id: '   ' }), mention({ id: 17 })),
    )
    expect(extractMentionIds(document)).toEqual([])
  })

  // This is what makes every pre-existing document retroactively silent: no backfill step, no
  // migration, just a walk that finds nothing.
  it('returns nothing for a document written before mentions existed', () => {
    expect(extractMentionIds(doc(paragraph(text('plain prose'))))).toEqual([])
    expect(extractMentionIds(doc())).toEqual([])
    expect(extractMentionIds(null)).toEqual([])
  })
})

describe('sanitizeRichText', () => {
  it('keeps only id, label and mentionSuggestionChar on a mention node', () => {
    const sanitized = sanitizeRichText(
      doc(
        paragraph(
          mention({
            id: 'u-1',
            label: 'Alice',
            mentionSuggestionChar: '@',
            href: 'javascript:alert(1)',
            role: 'admin',
          }),
        ),
      ),
    ) as { content: { content: { attrs: Record<string, unknown> }[] }[] }

    expect(sanitized.content[0]?.content[0]?.attrs).toEqual({
      id: 'u-1',
      label: 'Alice',
      mentionSuggestionChar: '@',
    })
  })

  it('keeps mentionSuggestionChar and defaults it when absent', () => {
    const sanitized = sanitizeRichText(doc(paragraph(mention({ id: 'u-1', label: 'Alice' })))) as {
      content: { content: { attrs: Record<string, unknown> }[] }[]
    }
    expect(sanitized.content[0]?.content[0]?.attrs.mentionSuggestionChar).toBe('@')
  })

  it('trims and length-caps the label', () => {
    const sanitized = sanitizeRichText(
      doc(paragraph(mention({ id: 'u-1', label: `  ${'n'.repeat(400)}  ` }))),
    ) as { content: { content: { attrs: { label: string } }[] }[] }
    expect(sanitized.content[0]?.content[0]?.attrs.label).toHaveLength(MENTION_LABEL_MAX_LENGTH)
  })

  it('degrades a mention with no usable id to plain text', () => {
    const sanitized = sanitizeRichText(doc(paragraph(mention({ id: '', label: 'Alice' })))) as {
      content: { content: unknown[] }[]
    }
    expect(sanitized.content[0]?.content[0]).toEqual({ type: 'text', text: '@Alice' })
    expect(extractMentionIds(sanitized)).toEqual([])
  })

  it('leaves every non-mention node and its attributes alone', () => {
    const document = doc({ type: 'heading', attrs: { level: 2 }, content: [text('Title')] })
    expect(sanitizeRichText(document)).toEqual(document)
  })

  it('is deterministic and idempotent, and mints nothing', () => {
    const document = doc(paragraph(mention({ id: 'u-1', label: ' Alice ', stray: true })))
    const once = sanitizeRichText(document)
    expect(sanitizeRichText(document)).toEqual(once)
    expect(sanitizeRichText(once)).toEqual(once)
    // No id is generated anywhere: the only id in the output is the one that came in.
    expect(JSON.stringify(once).match(/u-1/gu)).toHaveLength(1)
  })

  it('passes a malformed document through rather than throwing', () => {
    for (const value of [undefined, null, 'a string', 42]) {
      expect(sanitizeRichText(value)).toEqual(value)
    }
  })
})
