import { describe, expect, it } from 'vitest'
import { sanitizeRichText } from './plaintext.js'
import {
  detectRichTextSkew,
  RICH_TEXT_SCHEMA_VERSION,
  RICH_TEXT_SCHEMA_VERSION_ATTR,
  stripUnknownRichText,
} from './schema-version.js'

const KNOWN = {
  knownNodeTypes: ['doc', 'paragraph', 'text', 'heading', 'mention'],
  knownMarkTypes: ['bold', 'italic', 'code'],
}

function doc(content: unknown[], attrs?: Record<string, unknown>): unknown {
  return attrs === undefined ? { type: 'doc', content } : { type: 'doc', attrs, content }
}

function paragraph(...content: unknown[]): unknown {
  return { type: 'paragraph', content }
}

function text(value: string, marks?: unknown[]): unknown {
  return marks === undefined ? { type: 'text', text: value } : { type: 'text', text: value, marks }
}

describe('detectRichTextSkew', () => {
  it('passes a document naming only known types with no stamp', () => {
    expect(detectRichTextSkew(doc([paragraph(text('hello'))]), KNOWN)).toEqual({ blocked: false })
  })

  it('reports an unknown node type', () => {
    const result = detectRichTextSkew(doc([paragraph(text('a')), { type: 'callout' }]), KNOWN)
    expect(result).toEqual({
      blocked: true,
      reason: 'unknown-types',
      unknownTypes: ['callout'],
      documentVersion: 1,
    })
  })

  it('reports an unknown node type nested arbitrarily deep', () => {
    const result = detectRichTextSkew(
      doc([{ type: 'table', content: [{ type: 'tableRow', content: [paragraph(text('x'))] }] }]),
      KNOWN,
    )
    expect(result).toMatchObject({ blocked: true, unknownTypes: ['table', 'tableRow'] })
  })

  it('reports an unknown mark type', () => {
    const result = detectRichTextSkew(doc([paragraph(text('a', [{ type: 'highlight' }]))]), KNOWN)
    expect(result).toMatchObject({ reason: 'unknown-types', unknownTypes: ['highlight'] })
  })

  it('deduplicates and keeps document order', () => {
    const result = detectRichTextSkew(
      doc([{ type: 'image' }, { type: 'table' }, { type: 'image' }]),
      KNOWN,
    )
    expect(result).toMatchObject({ unknownTypes: ['image', 'table'] })
  })

  it('reports a stamp above the constant even when every type is known', () => {
    const value = doc([paragraph(text('a'))], {
      [RICH_TEXT_SCHEMA_VERSION_ATTR]: RICH_TEXT_SCHEMA_VERSION + 1,
    })
    expect(detectRichTextSkew(value, KNOWN)).toEqual({
      blocked: true,
      reason: 'newer-version',
      unknownTypes: [],
      documentVersion: RICH_TEXT_SCHEMA_VERSION + 1,
    })
  })

  it('passes a stamp equal to or below the constant', () => {
    for (const version of [0, 1, RICH_TEXT_SCHEMA_VERSION]) {
      const value = doc([paragraph(text('a'))], { [RICH_TEXT_SCHEMA_VERSION_ATTR]: version })
      expect(detectRichTextSkew(value, KNOWN)).toEqual({ blocked: false })
    }
  })

  it('reads a garbage stamp as version 1 rather than blocking every reader', () => {
    for (const stamp of ['9', null, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      const value = doc([paragraph(text('a'))], { [RICH_TEXT_SCHEMA_VERSION_ATTR]: stamp })
      expect(detectRichTextSkew(value, KNOWN)).toEqual({ blocked: false })
    }
  })

  it('prefers the unknown-type reason when both detectors fire', () => {
    const value = doc([{ type: 'callout' }], {
      [RICH_TEXT_SCHEMA_VERSION_ATTR]: RICH_TEXT_SCHEMA_VERSION + 1,
    })
    expect(detectRichTextSkew(value, KNOWN)).toMatchObject({
      reason: 'unknown-types',
      documentVersion: RICH_TEXT_SCHEMA_VERSION + 1,
    })
  })

  it('stands down on an empty known-node set rather than blocking everything', () => {
    const value = doc([paragraph(text('a'))])
    expect(detectRichTextSkew(value, { knownNodeTypes: [], knownMarkTypes: [] })).toEqual({
      blocked: false,
    })
  })

  it('accepts a Set as well as an array', () => {
    const value = doc([{ type: 'callout' }])
    expect(
      detectRichTextSkew(value, {
        knownNodeTypes: new Set(KNOWN.knownNodeTypes),
        knownMarkTypes: new Set(KNOWN.knownMarkTypes),
      }),
    ).toMatchObject({ blocked: true, unknownTypes: ['callout'] })
  })

  it('returns clean on malformed input rather than throwing', () => {
    for (const value of [undefined, null, 'a string', 42, [], { content: 'not an array' }]) {
      expect(detectRichTextSkew(value, KNOWN)).toEqual({ blocked: false })
    }
  })

  it('ignores a node with no type and a mark that is not an object', () => {
    const value = doc([{ content: [text('a')] }, { type: 'paragraph', marks: [null, 7, 'bold'] }])
    expect(detectRichTextSkew(value, KNOWN)).toEqual({ blocked: false })
  })
})

describe('sanitizeRichText stamps the schema version', () => {
  it('stamps the document and is idempotent', () => {
    const once = sanitizeRichText(doc([paragraph(text('a'))])) as {
      attrs: Record<string, unknown>
    }
    expect(once.attrs[RICH_TEXT_SCHEMA_VERSION_ATTR]).toBe(RICH_TEXT_SCHEMA_VERSION)
    expect(sanitizeRichText(once)).toEqual(once)
  })

  it('keeps any other document attribute', () => {
    const stamped = sanitizeRichText(doc([paragraph(text('a'))], { other: 'kept' })) as {
      attrs: Record<string, unknown>
    }
    expect(stamped.attrs).toEqual({
      other: 'kept',
      [RICH_TEXT_SCHEMA_VERSION_ATTR]: RICH_TEXT_SCHEMA_VERSION,
    })
  })

  it('overwrites a stamp claiming to be newer, because the write is happening on THIS bundle', () => {
    const stamped = sanitizeRichText(
      doc([paragraph(text('a'))], { [RICH_TEXT_SCHEMA_VERSION_ATTR]: 99 }),
    ) as { attrs: Record<string, unknown> }
    expect(stamped.attrs[RICH_TEXT_SCHEMA_VERSION_ATTR]).toBe(RICH_TEXT_SCHEMA_VERSION)
  })

  it('stamps nothing that is not a doc node', () => {
    expect(sanitizeRichText(paragraph(text('a')))).toEqual(paragraph(text('a')))
    for (const value of [undefined, null, 'a string', 42]) {
      expect(sanitizeRichText(value)).toEqual(value)
    }
  })

  it('a sanitized document is never blocked by the detector it stamps for', () => {
    const stamped = sanitizeRichText(doc([paragraph(text('a'))]))
    expect(detectRichTextSkew(stamped, KNOWN)).toEqual({ blocked: false })
  })
})

describe('stripUnknownRichText', () => {
  it('drops an unknown node and keeps its known siblings', () => {
    const stripped = stripUnknownRichText(
      doc([paragraph(text('keep me')), { type: 'callout', content: [paragraph(text('gone'))] }]),
      KNOWN,
    )
    expect(stripped).toEqual(doc([paragraph(text('keep me'))]))
  })

  it('drops an unknown mark and keeps the text it was on', () => {
    const stripped = stripUnknownRichText(
      doc([paragraph(text('inked', [{ type: 'bold' }, { type: 'highlight' }]))]),
      KNOWN,
    )
    expect(stripped).toEqual(doc([paragraph(text('inked', [{ type: 'bold' }]))]))
  })

  it('drops an unknown node nested inside a known one', () => {
    const stripped = stripUnknownRichText(
      doc([{ type: 'paragraph', content: [text('a'), { type: 'emoji' }, text('b')] }]),
      KNOWN,
    )
    expect(stripped).toEqual(doc([paragraph(text('a'), text('b'))]))
  })

  // `doc` is `block+`: a document whose every child was unrepresentable is legal JSON and an
  // illegal ProseMirror document, and handing that to a renderer throws exactly the way the
  // unstripped document would have.
  it('leaves one empty paragraph when nothing survives', () => {
    expect(stripUnknownRichText(doc([{ type: 'callout' }]), KNOWN)).toEqual(
      doc([{ type: 'paragraph' }]),
    )
  })

  it('preserves attributes, including the version stamp, on the nodes it keeps', () => {
    const stamped = doc([paragraph(text('a'))], { [RICH_TEXT_SCHEMA_VERSION_ATTR]: 99 })
    expect(stripUnknownRichText(stamped, KNOWN)).toEqual(stamped)
  })

  it('returns the document untouched when the caller could not build a schema', () => {
    const value = doc([{ type: 'callout' }])
    expect(stripUnknownRichText(value, { knownNodeTypes: [], knownMarkTypes: [] })).toEqual(value)
  })

  it('is total on malformed input', () => {
    for (const value of ['a string', 42, null, undefined, []]) {
      expect(stripUnknownRichText(value, KNOWN)).toEqual({
        type: 'doc',
        content: [{ type: 'paragraph' }],
      })
    }
  })
})
