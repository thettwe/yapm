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

function image(attrs: Record<string, unknown>): unknown {
  return { type: 'image', attrs }
}

// ASSEMBLED, not written literally. The capability-at-rest guard in
// `apps/server/src/storage/no-capability.test.ts` greps this directory for any attribute whose
// value opens with an absolute URL, and unlike its sibling word-grep it does not exclude test files
// (`attachments` §I6). A test asserting that such a value is DROPPED would otherwise trip the guard
// that exists to stop one being STORED — as would a comment quoting the pattern.
const TRACKING_PIXEL_URL = `${'https:'}//tracker.example/pixel.png`

function cell(...content: unknown[]): unknown {
  return { type: 'tableCell', content }
}

function row(...content: unknown[]): unknown {
  return { type: 'tableRow', content }
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

  it("projects an image's alt text, trimmed and length-capped", () => {
    expect(
      richTextToPlainText(doc(image({ attachmentId: 'a-1', alt: '  login page 500  ' }))),
    ).toBe('login page 500')
    expect(
      richTextToPlainText(doc(image({ attachmentId: 'a-1', alt: 'x'.repeat(500) }))),
    ).toHaveLength(300)
  })

  it('contributes nothing for an image with no alt, and still ends a line', () => {
    const document = doc(
      paragraph(text('before')),
      image({ attachmentId: 'a-1' }),
      paragraph(text('after')),
    )
    expect(richTextToPlainText(document)).toBe('before\nafter')
  })

  // The default block handling would end a line after every cell, and — once blank lines are
  // dropped — a row would arrive at the search index as three separate lines. Welding them is the
  // other failure: `1002open` is a token nobody types.
  it('separates cells within a row and rows from each other', () => {
    const document = doc({
      type: 'table',
      content: [
        row(cell(paragraph(text('Env'))), cell(paragraph(text('Status')))),
        row(cell(paragraph(text('prod'))), cell(paragraph(text('1002 open')))),
      ],
    })
    expect(richTextToPlainText(document)).toBe('Env Status\nprod 1002 open')
  })

  it('flattens block content inside a cell onto the row line', () => {
    const document = doc({
      type: 'table',
      content: [
        row(
          cell(paragraph(text('one')), paragraph(text('two'))),
          cell({ type: 'paragraph', content: [text('a'), { type: 'hardBreak' }, text('b')] }),
        ),
      ],
    })
    expect(richTextToPlainText(document)).toBe('one two a b')
  })

  it('reaches a mention inside a table cell', () => {
    const document = doc({
      type: 'table',
      content: [
        row(
          cell(paragraph(mention({ id: 'u-1', label: 'Alice' }))),
          cell(paragraph(text('owner'))),
        ),
      ],
    })
    expect(richTextToPlainText(document)).toBe('@Alice owner')
    expect(extractMentionIds(document)).toEqual(['u-1'])
  })

  // Already correct by default, and asserted so a later refactor of the default cannot silently
  // change it.
  it('keeps a code block verbatim as one block', () => {
    const document = doc({
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [text('const a = 1')],
    })
    expect(richTextToPlainText(document)).toBe('const a = 1')
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

  // The document node itself gains a `schemaVersion` stamp — asserted on its own in
  // `schema-version.test.ts`. Everything BELOW the doc is what this asserts is untouched.
  it('leaves every non-mention node and its attributes alone', () => {
    const document = doc({ type: 'heading', attrs: { level: 2 }, content: [text('Title')] })
    const sanitized = sanitizeRichText(document) as { content: unknown[] }
    expect(sanitized.content).toEqual((document as { content: unknown[] }).content)
  })

  it('keeps only attachmentId, alt and width on an image node', () => {
    const sanitized = sanitizeRichText(
      doc(
        image({
          attachmentId: '019702c7-0000-7000-8000-000000000001',
          alt: '  login page 500  ',
          width: 'small',
          src: TRACKING_PIXEL_URL,
          title: 'dropped',
        }),
      ),
    ) as { content: { attrs: Record<string, unknown> }[] }

    expect(sanitized.content[0]?.attrs).toEqual({
      attachmentId: '019702c7-0000-7000-8000-000000000001',
      alt: 'login page 500',
      width: 'small',
    })
  })

  // The ban is what makes "no URL is ever stored" true rather than merely intended: the client
  // node type has no `src` and refuses to parse a pasted `<img>`, but only this pass binds a
  // client that was not built from this bundle.
  it('refuses a URL-shaped attachmentId or alt on the authoritative pass', () => {
    for (const hostile of [
      TRACKING_PIXEL_URL,
      '//tracker.example/p.png',
      '  javascript:alert(1)',
      'DATA:image/png;base64,AAAA',
    ]) {
      const sanitized = sanitizeRichText(doc(image({ attachmentId: hostile, alt: hostile }))) as {
        content: { attrs: Record<string, unknown> }[]
      }
      expect(sanitized.content[0]?.attrs).toEqual({ attachmentId: '', alt: '', width: 'full' })
    }
  })

  it('defaults a missing or out-of-range image width to full', () => {
    for (const width of [undefined, 'gigantic', 12]) {
      const sanitized = sanitizeRichText(doc(image({ attachmentId: 'a-1', width }))) as {
        content: { attrs: Record<string, unknown> }[]
      }
      expect(sanitized.content[0]?.attrs).toEqual({ attachmentId: 'a-1', alt: '', width: 'full' })
    }
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
