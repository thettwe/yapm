// @vitest-environment jsdom
//
// The functions under test are pure over JSON, but the PARSE path is not environment-neutral:
// `MarkdownManager.parseHTMLToken` keeps raw HTML as literal text when `window.DOMParser` is
// missing and runs it through `generateJSON` when it is there. Under `node` — this package's
// default environment — the raw-HTML rows below would pass without any of the code that makes them
// pass in a browser, which is the only place this module actually runs.

import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { getSchema, type JSONContent } from '@tiptap/react'
import { createRichTextExtensions, EMPTY_DOC } from '@yapm/ui/components/rich-text'
import { markdownToRichText, richTextToMarkdown } from '@yapm/ui/lib/markdown'
import { expect, test } from 'vitest'

const schema = getSchema(createRichTextExtensions())

/**
 * Round-trip equality is asserted after BOTH sides pass through the editor's own schema. Raw JSON
 * equality would fail on schema defaults rather than on losses: a parsed link mark carries
 * `title: null` the source omitted, and an empty paragraph comes back as `content: []` rather than
 * with no `content` key. Asserting raw equality pushes the implementation toward "fixing" defaults.
 */
function normalize(doc: JSONContent): JSONContent {
  return ProseMirrorNode.fromJSON(schema, doc).toJSON() as JSONContent
}

function doc(...content: JSONContent[]): JSONContent {
  return { type: 'doc', content }
}

function paragraph(text: string): JSONContent {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function roundTrip(source: JSONContent): JSONContent {
  return normalize(markdownToRichText(richTextToMarkdown(source)))
}

// ── 3.1 The falsifiable check ───────────────────────────────────────────────────────────────────
//
// This is the test the change exists for, and it fails two ways against the stock library:
// `a < b & c` serialises to `a &lt; b &amp; c` (HTML entities, correct CommonMark, literal garbage
// in Slack or a terminal), and `# not a heading` serialises unescaped and re-parses as a heading.
// They are ONE defect, not two — see the `>` case in the escape table below.

test('the two serialiser defects: no entities, and a paragraph stays a paragraph', () => {
  const source = doc(paragraph('a < b & c'), paragraph('# not a heading'))

  expect(richTextToMarkdown(source)).toBe('a < b & c\n\n\\# not a heading')
  expect(roundTrip(source)).toEqual(normalize(source))
})

// ── 3.2 The escape table, row by row (design.md §D5) ────────────────────────────────────────────

const ESCAPE_TABLE: readonly (readonly [label: string, text: string, emitted: string])[] = [
  ['a heading marker', '# h', '\\# h'],
  ['the deepest heading marker', '###### h', '\\###### h'],
  ['a dash bullet', '- bullet', '\\- bullet'],
  ['a plus bullet', '+ bullet', '\\+ bullet'],
  // The inline escape set already covers `*`, and it escapes it wherever it appears.
  ['a star bullet', '* bullet', '\\* bullet'],
  ['a blockquote marker', '> not a quote', '\\> not a quote'],
  // Pre-emptive: the `editor-rich-content` change adds tables, and a paragraph opening with `|`
  // must not become a table row the day it lands.
  ['a table row', '| a | b |', '\\| a | b |'],
  // The DELIMITER, never the digit: `\1.` does not escape in CommonMark, `1\.` does.
  ['an ordered list marker', '1. one', '1\\. one'],
  ['a parenthesised ordered marker', '1) one', '1\\) one'],
  ['a thematic break', '---', '\\---'],
  ['a setext underline', '===', '\\==='],
  ['a fence', '```js', '\\`\\`\\`js'],
]

for (const [label, text, emitted] of ESCAPE_TABLE) {
  test(`a paragraph opening with ${label} is escaped and re-parses as a paragraph`, () => {
    const source = doc(paragraph(text))

    expect(richTextToMarkdown(source)).toBe(emitted)
    expect(roundTrip(source)).toEqual(normalize(source))
  })
}

// CommonMark permits up to THREE spaces before every marker in the table above, so a paragraph the
// author indented by one, two or three is still read as structure. The backslash also has to land
// AFTER the indentation — `\  - two` escapes a space, which is not a thing markdown does.
for (const indent of [' ', '  ', '   ']) {
  for (const [label, text, emitted] of ESCAPE_TABLE) {
    test(`${label} indented by ${indent.length} space(s) is still escaped`, () => {
      const source = doc(paragraph(indent + text))

      expect(richTextToMarkdown(source)).toBe(indent + emitted)
      expect(roundTrip(source)).toEqual(normalize(source))
    })
  }
}

test('four leading spaces are dropped rather than encoded, and the text survives', () => {
  // Markdown has no backslash escape for whitespace. The alternatives are an HTML entity — the
  // exact garbage this module exists to remove — or emitting an indented code block the author
  // never wrote, so the indentation is what goes.
  expect(richTextToMarkdown(doc(paragraph('    indented')))).toBe('indented')
  expect(richTextToMarkdown(doc(paragraph('\tindented')))).toBe('indented')
  expect(roundTrip(doc(paragraph('    indented')))).toEqual(normalize(doc(paragraph('indented'))))

  // Under four spaces is not an indented code block and is not touched.
  expect(richTextToMarkdown(doc(paragraph('  two')))).toBe('  two')
})

test('a blockquote marker and raw punctuation survive TOGETHER', () => {
  // The two that only fail together. `> not a quote` round-trips against the stock library ONLY
  // because entity encoding turns `>` into `&gt;`. Anyone who removes the entity encoding without
  // adding the block-leading escapes breaks this; anyone who "fixes" `>` by re-introducing entity
  // encoding breaks the same test on the other line.
  const source = doc(paragraph('> not a quote'), paragraph('a < b & c'))

  const markdown = richTextToMarkdown(source)
  expect(markdown).toBe('\\> not a quote\n\na < b & c')
  expect(markdown).not.toContain('&gt;')
  expect(markdown).not.toContain('&lt;')
  expect(markdown).not.toContain('&amp;')
  expect(roundTrip(source)).toEqual(normalize(source))
})

test('block-leading escapes apply after a hard break, which also opens a line', () => {
  const source = doc({
    type: 'paragraph',
    content: [
      { type: 'text', text: 'line' },
      { type: 'hardBreak' },
      { type: 'text', text: '# after break' },
    ],
  })

  expect(richTextToMarkdown(source)).toBe('line  \n\\# after break')
  expect(roundTrip(source)).toEqual(normalize(source))
})

test('a heading ending in a hash run keeps it', () => {
  // CommonMark reads a trailing run of `#` preceded by a space as an optional CLOSING sequence and
  // throws it away, so an unescaped `## Plan #` comes back as `Plan`.
  const source = doc({
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text: 'Plan #' }],
  })

  expect(richTextToMarkdown(source)).toBe('## Plan \\#')
  expect(roundTrip(source)).toEqual(normalize(source))

  const many = doc({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: 'Sprint ###' }],
  })

  expect(richTextToMarkdown(many)).toBe('### Sprint \\###')
  expect(roundTrip(many)).toEqual(normalize(many))

  // The run can BE the whole node, and then there is no whitespace in front of it to anchor on:
  // `## #` is an ATX heading whose entire content is a closing sequence, so it re-parses EMPTY and
  // the text is gone. An escape keyed on a preceding space misses exactly this one.
  const alone = doc({
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text: '#' }],
  })

  expect(richTextToMarkdown(alone)).toBe('## \\#')
  expect(roundTrip(alone)).toEqual(normalize(alone))
})

test('a hash mid-heading, and a heading with no trailing hash, are left alone', () => {
  const source = doc({
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text: 'Item # 4 plan' }],
  })

  expect(richTextToMarkdown(source)).toBe('## Item # 4 plan')
  expect(roundTrip(source)).toEqual(normalize(source))
})

test('a block-leading character mid-paragraph is left alone', () => {
  const source = doc(paragraph('sprint 1. and item # 4 and a > b'))

  expect(richTextToMarkdown(source)).toBe('sprint 1. and item # 4 and a > b')
  expect(roundTrip(source)).toEqual(normalize(source))
})

// ── 3.3 Code is verbatim ────────────────────────────────────────────────────────────────────────

const CODE = 'if (a < b && c) {}'

test('a code block emits its code byte-identically', () => {
  const source = doc({
    type: 'codeBlock',
    attrs: { language: null },
    content: [{ type: 'text', text: CODE }],
  })

  const markdown = richTextToMarkdown(source)
  expect(markdown).toBe(`\`\`\`\n${CODE}\n\`\`\``)
  expect(markdown).not.toContain('\\')
  expect(markdown).not.toContain('&lt;')
  expect(markdown).not.toContain('&amp;')
  expect(roundTrip(source)).toEqual(normalize(source))
})

test('a code block containing a fence opens with a longer one', () => {
  // CommonMark closes a fenced block at the first fence AT LEAST as long as the opener, so a
  // three-backtick fence around code that itself contains ``` closes early: the tail of the code
  // becomes prose and the block does not come back.
  const fenced = 'before\n```js\ninner()\n```\nafter'
  const source = doc({
    type: 'codeBlock',
    attrs: { language: null },
    content: [{ type: 'text', text: fenced }],
  })

  expect(richTextToMarkdown(source)).toBe(`\`\`\`\`\n${fenced}\n\`\`\`\``)
  expect(roundTrip(source)).toEqual(normalize(source))
})

test('the fence grows with the longest run inside, and only that far', () => {
  const source = doc({
    type: 'codeBlock',
    attrs: { language: 'md' },
    content: [{ type: 'text', text: '`````\nfive\n`````' }],
  })

  expect(richTextToMarkdown(source)).toBe('``````md\n`````\nfive\n`````\n``````')
  expect(roundTrip(source)).toEqual(normalize(source))
})

test('an inline code span emits its code byte-identically', () => {
  const source = doc({
    type: 'paragraph',
    content: [{ type: 'text', text: CODE, marks: [{ type: 'code' }] }],
  })

  const markdown = richTextToMarkdown(source)
  expect(markdown).toBe(`\`${CODE}\``)
  expect(markdown).not.toContain('\\')
  expect(markdown).not.toContain('&lt;')
  expect(markdown).not.toContain('&amp;')
  expect(roundTrip(source)).toEqual(normalize(source))
})

test('an inline code span holding a backtick is emitted verbatim and does NOT round-trip', () => {
  // A characterisation test for a defect this change knowingly does not fix, so a future fix trips
  // it and its author reads this instead of rediscovering the reason.
  //
  // CommonMark delimits a code span with a run of backticks LONGER than any run inside it, so
  // `` a `b` c `` needs a double-backtick fence. 3.28.0 always emits a single one. Unlike the two
  // defects this module does correct, this one is out of reach: `getMarkOpening` renders the mark
  // against a PLACEHOLDER string, never the real text (verified in the compiled source), so the
  // delimiter cannot depend on the content. Fixing it means overriding
  // `renderNodesWithMarkBoundaries` — ~150 lines of private surface, against the one private method
  // name design.md §D4 budgets.
  //
  // The text still leaves yapm intact, which is what the portability promise is about; only the
  // code-span boundary moves. Documented in the feature page's "what markdown cannot carry".
  const source = doc({
    type: 'paragraph',
    content: [{ type: 'text', text: 'a `b` c', marks: [{ type: 'code' }] }],
  })

  const markdown = richTextToMarkdown(source)
  expect(markdown).toBe('`a `b` c`')
  expect(markdown).toContain('a `b` c')
  expect(roundTrip(source)).not.toEqual(normalize(source))
})

// ── 3.4 The whole supported node set ────────────────────────────────────────────────────────────

test('every node and mark the editor supports round-trips through markdown', () => {
  const source = doc(
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'struck', marks: [{ type: 'strike' }] },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'code()', marks: [{ type: 'code' }] },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'both', marks: [{ type: 'bold' }, { type: 'italic' }] },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'yapm',
          marks: [{ type: 'link', attrs: { href: 'https://yapm.dev' } }],
        },
      ],
    },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Detail' }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [paragraph('one')] },
        {
          type: 'listItem',
          content: [
            paragraph('two'),
            { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('nested')] }] },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [
        { type: 'listItem', content: [paragraph('first')] },
        { type: 'listItem', content: [paragraph('second')] },
      ],
    },
    { type: 'blockquote', content: [paragraph('quoted')] },
    {
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const a: number = 1' }],
    },
    { type: 'horizontalRule' },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'before' },
        { type: 'hardBreak' },
        { type: 'text', text: 'after' },
      ],
    },
  )

  expect(roundTrip(source)).toEqual(normalize(source))
})

test('a code block keeps its language through the round trip', () => {
  const source = doc({
    type: 'codeBlock',
    attrs: { language: 'ts' },
    content: [{ type: 'text', text: 'const a = 1' }],
  })

  expect(richTextToMarkdown(source)).toBe('```ts\nconst a = 1\n```')
})

// ── 3.5 Mentions ────────────────────────────────────────────────────────────────────────────────

function mention(id: string, label: string | null): JSONContent {
  return { type: 'mention', attrs: { id, label } }
}

const NAMES = new Map([['ada', 'Ada Lovelace']])

test('a mention leaves as a readable name with no machine syntax', () => {
  const source = doc({
    type: 'paragraph',
    content: [
      { type: 'text', text: 'ping ' },
      mention('ada', 'Stale Name'),
      { type: 'text', text: ' now' },
    ],
  })

  const markdown = richTextToMarkdown(source, { resolveMentionName: (id) => NAMES.get(id) })

  // The live name wins over the stored label — the label is a hint, never the truth.
  expect(markdown).toBe('ping @Ada Lovelace now')
  // 3.28.0's default is `[@ id="ada" label="Stale Name"]`: lossless through itself, unreadable
  // everywhere markdown actually goes. Asserted explicitly because it is what the library emits
  // the moment the pre-walk stops running.
  expect(markdown).not.toContain('id=')
  expect(markdown).not.toContain('label=')
  expect(markdown).not.toContain('[@')
})

test('an unresolved mention falls back to its stored label', () => {
  const source = doc({ type: 'paragraph', content: [mention('gone', 'Bo Nguyen')] })

  expect(richTextToMarkdown(source, { resolveMentionName: () => undefined })).toBe('@Bo Nguyen')
  expect(richTextToMarkdown(source)).toBe('@Bo Nguyen')
})

test('a mention that resolves to nothing contributes nothing, not a bare @', () => {
  const source = doc({
    type: 'paragraph',
    content: [
      { type: 'text', text: 'hi ' },
      mention('gone', null),
      { type: 'text', text: ' there' },
    ],
  })

  expect(richTextToMarkdown(source)).toBe('hi  there')
})

test('parsing never produces a mention node, and nobody is matched by name', () => {
  const parsed = markdownToRichText('ping @Ada Lovelace now')

  expect(JSON.stringify(parsed)).not.toContain('mention')
  expect(parsed).toEqual(doc(paragraph('ping @Ada Lovelace now')))
})

test('a pasted mention SPAN does not become a mention either', () => {
  // The one that matters, and the one `@Ada Lovelace` above cannot catch: markdown is a superset of
  // HTML, so a raw-HTML token is handed to `generateJSON` against THIS editor's full extension set —
  // Mention included. Text somebody pasted would have minted a real mention node, subscription and
  // all, from a `data-type="mention"` attribute they never saw.
  const span = '<span data-type="mention" data-id="ada" data-label="Ada Lovelace">x</span> hi'
  const parsed = markdownToRichText(span)

  expect(JSON.stringify(parsed)).not.toContain('mention"')
  expect(parsed).toEqual(doc(paragraph(span)))
})

// ── 3.5b Raw HTML is text, not markup ───────────────────────────────────────────────────────────

const HTML_SHAPED: readonly (readonly [label: string, text: string])[] = [
  // Not markup at all — ordinary prose from a terminal that `marked` reads as an inline tag. The
  // characters were DELETED and the paragraph split in three.
  ['prose that looks like a tag', 'compare a<b and c>d'],
  ['a block element', '<div>hello</div>'],
  ['a self-closing element', 'line one<br/>line two'],
  ['an unknown element', '<yapm-thing a="1">x</yapm-thing>'],
  ['a script tag', '<script>alert(1)</script>'],
  // The two the reopen exception is easiest to widen too far for. An `<em>` carrying ANY attribute
  // is not something this serialiser can emit, and a closing tag with no opener in front of it is
  // prose — both used to lose their characters and gain an empty paragraph.
  ['an em tag with an attribute', '<em class="x">y</em>'],
  ['an unmatched closing reopen tag', 'compare a</em>b'],
  ['an unmatched opening reopen tag', 'a <strong>b'],
]

for (const [label, text] of HTML_SHAPED) {
  test(`${label} pasted as plain text stays literal`, () => {
    expect(markdownToRichText(text)).toEqual(doc(paragraph(text)))
  })
}

test('the tags this serialiser emits itself still parse', () => {
  // `@tiptap/extension-italic` and `@tiptap/extension-bold` BOTH declare `markdownOptions.
  // htmlReopen` — `<em>`/`</em>` and `<strong>`/`</strong>` — and the serialiser falls back to
  // whichever pair an overlap needs when `*` alone cannot express it. Refusing ALL HTML would make
  // yapm's own output stop round-tripping, so a BALANCED bare pair from that derived set is the
  // exception; see the overlapping-marks tests below for the output that depends on it.
  expect(markdownToRichText('a <em>x</em> b')).toEqual(
    doc({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'a ' },
        { type: 'text', text: 'x', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' b' },
      ],
    }),
  )
  expect(markdownToRichText('a <strong>x</strong> b')).toEqual(
    doc({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'a ' },
        { type: 'text', text: 'x', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' b' },
      ],
    }),
  )
})

// ── 3.5c Overlapping marks, which is the ONLY thing that emits a reopen tag ─────────────────────
//
// BOTH orders, because they take different branches: whichever mark opens first is written with
// `*`, and the one left dangling past the overlap is reopened as HTML. Exercising only the italic
// tail hid the bold tail entirely — `<strong>` was missing from the allowlist, so `**A*B***<strong>
// C</strong>` came back with the bold mark gone and the tag characters sitting in the document.

const OVERLAPS: readonly (readonly [
  label: string,
  marks: readonly [string, string],
  out: string,
])[] = [
  ['bold opens first', ['bold', 'italic'], '**A*B***<em>C</em>'],
  ['italic opens first', ['italic', 'bold'], '*A**B***<strong>C</strong>'],
]

for (const [label, [first, second], emitted] of OVERLAPS) {
  test(`overlapping marks round-trip when ${label}`, () => {
    const source = doc({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'A', marks: [{ type: first }] },
        { type: 'text', text: 'B', marks: [{ type: first }, { type: second }] },
        { type: 'text', text: 'C', marks: [{ type: second }] },
      ],
    })

    expect(richTextToMarkdown(source)).toBe(emitted)
    expect(roundTrip(source)).toEqual(normalize(source))
  })
}

// ── 3.6 The inbound clamp, empty input, and what markdown cannot carry ──────────────────────────

test('heading levels are clamped to the two this editor defines', () => {
  const levels = ['#', '##', '###', '####', '#####', '######'].map((hashes) => {
    const parsed = markdownToRichText(`${hashes} Title`)
    const first = (parsed.content ?? [])[0] as JSONContent
    return first.attrs?.level
  })

  expect(levels).toEqual([2, 2, 3, 3, 3, 3])
})

test('a clamped heading is a heading node, not dropped text', () => {
  const parsed = markdownToRichText('#### Four')

  expect(parsed).toEqual(
    doc({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Four' }] }),
  )
  // The schema has no level 4, so an unclamped parse loses the node AND its text on setContent.
  expect(() => normalize(parsed)).not.toThrow()
})

test('empty input produces a valid empty document, not a document with no content', () => {
  expect(markdownToRichText('')).toEqual(EMPTY_DOC)
  expect(markdownToRichText('   \n  ')).toEqual(EMPTY_DOC)
  expect(() => normalize(markdownToRichText(''))).not.toThrow()
})

test('an empty or absent document serialises to an empty string', () => {
  expect(richTextToMarkdown(null)).toBe('')
  expect(richTextToMarkdown(undefined)).toBe('')
  expect(richTextToMarkdown({ type: 'doc', content: [] })).toBe('')
})

test('underline is dropped and its text survives, with no ++ delimiters', () => {
  const source = doc({
    type: 'paragraph',
    content: [
      { type: 'text', text: 'keep ' },
      { type: 'text', text: 'these words', marks: [{ type: 'underline' }] },
    ],
  })

  const markdown = richTextToMarkdown(source)
  expect(markdown).toBe('keep these words')
  expect(markdown).not.toContain('++')
})

test('underline under a mark markdown CAN carry keeps the portable half', () => {
  const source = doc({
    type: 'paragraph',
    content: [{ type: 'text', text: 'emphatic', marks: [{ type: 'underline' }, { type: 'bold' }] }],
  })

  expect(richTextToMarkdown(source)).toBe('**emphatic**')
})

test('no trailing newline survives serialisation', () => {
  expect(richTextToMarkdown(doc(paragraph('one'), paragraph('two')))).toBe('one\n\ntwo')
})

// ── The node types `editor-rich-content` adds ───────────────────────────────────────────────────

const RESOLVE_SRC = (id: string) => `/api/v1/files/${id}`

function cell(text: string, type: 'tableCell' | 'tableHeader' = 'tableCell'): JSONContent {
  return { type, content: [paragraph(text)] }
}

function row(...cells: JSONContent[]): JSONContent {
  return { type: 'tableRow', content: cells }
}

test('a table emits a GFM pipe table and comes back a table', () => {
  const source = doc(
    {
      type: 'table',
      content: [
        row(cell('Env', 'tableHeader'), cell('Status', 'tableHeader')),
        row(cell('prod'), cell('1002 open')),
      ],
    },
    paragraph('after'),
  )

  const markdown = richTextToMarkdown(source)
  expect(markdown).toContain('| Env')
  expect(markdown).toContain('| ---')
  expect(markdown).toContain('| prod')
  expect(roundTrip(source)).toEqual(normalize(source))
})

// 3.28.0's `renderTableToMarkdown` escapes pipes only inside backtick code spans, so a pipe typed as
// prose in a cell silently becomes a column boundary and the table comes back a column wider.
test('a pipe inside a cell is escaped and does not split the cell', () => {
  const source = doc({
    type: 'table',
    content: [
      row(cell('A', 'tableHeader'), cell('B', 'tableHeader')),
      row(cell('a | b'), cell('c')),
    ],
  })

  expect(richTextToMarkdown(source)).toContain('a \\| b')
  expect(roundTrip(source)).toEqual(normalize(source))
})

// The library's default cell separator is U+001F, which `collapseWhitespace` does not match — it
// reaches the clipboard as a literal control character.
const UNIT_SEPARATOR = String.fromCharCode(31)

test('two paragraphs in one cell flatten to a space-joined line, with no control character', () => {
  const markdown = richTextToMarkdown(
    doc({
      type: 'table',
      content: [
        row(cell('H', 'tableHeader')),
        row({ type: 'tableCell', content: [paragraph('one'), paragraph('two')] }),
      ],
    }),
  )

  expect(markdown).toContain('one two')
  expect(markdown).not.toContain(UNIT_SEPARATOR)
})

test('an image emits a path, and only when a resolver names one', () => {
  const source = doc({ type: 'image', attrs: { attachmentId: 'att-1', alt: 'login 500' } })

  expect(richTextToMarkdown(source, { resolveAttachmentSrc: RESOLVE_SRC })).toBe(
    '![login 500](/api/v1/files/att-1)',
  )
  expect(
    richTextToMarkdown(doc({ type: 'image', attrs: { attachmentId: 'att-1', alt: '' } }), {
      resolveAttachmentSrc: RESOLVE_SRC,
    }),
  ).toBe('![](/api/v1/files/att-1)')
  // No resolver, no path this bundle can name: the alt text is what is left, and `![alt]()` would
  // re-parse as an image with an empty target.
  expect(richTextToMarkdown(source)).toBe('login 500')
})

// An image node names an `attachment` row that must exist and be team-scoped; a pasted URL names
// nothing this instance owns. Same principle as "a paste never mints a mention".
test('an inbound image degrades to a link labelled with its alt', () => {
  const parsed = markdownToRichText('![login 500](https://example.test/a.png)')
  expect(parsed.content?.[0]).toEqual({
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: 'login 500',
        marks: [{ type: 'link', attrs: { href: 'https://example.test/a.png' } }],
      },
    ],
  })
  expect(JSON.stringify(parsed)).not.toContain('"image"')
})

test('an inbound image with no alt keeps its URL as the label', () => {
  const parsed = markdownToRichText('![](https://example.test/a.png)')
  expect(JSON.stringify(parsed)).toContain('https://example.test/a.png')
  expect(JSON.stringify(parsed)).not.toContain('"image"')
})

test('a code fence keeps a registered language and coerces an unregistered one', () => {
  const registered = markdownToRichText('```ts\nconst a = 1\n```')
  expect(registered.content?.[0]?.attrs?.language).toBe('ts')

  const unregistered = markdownToRichText('```elixir\nIO.puts 1\n```')
  expect(unregistered.content?.[0]?.attrs?.language).toBe('plaintext')
  expect(unregistered.content?.[0]?.content?.[0]?.text).toBe('IO.puts 1')

  const bare = markdownToRichText('```\nplain\n```')
  expect(bare.content?.[0]?.attrs?.language).toBeNull()
})

test('a plaintext code block emits a bare fence rather than a labelled one', () => {
  const source = doc({
    type: 'codeBlock',
    attrs: { language: 'plaintext' },
    content: [{ type: 'text', text: 'just words' }],
  })
  expect(richTextToMarkdown(source)).toBe('```\njust words\n```')
})
