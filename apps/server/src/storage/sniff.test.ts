import { describe, expect, it } from 'vitest'
import { contentDispositionFor, sniffMediaType } from './sniff.js'

const bytes = (...parts: (string | number[])[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...part].map((character) => character.charCodeAt(0)) : part,
    ),
  )

const PNG = bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13])
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF')
const GIF87 = bytes('GIF87a', [0x01, 0x00])
const GIF89 = bytes('GIF89a', [0x01, 0x00])
const WEBP = bytes('RIFF', [0x20, 0x00, 0x00, 0x00], 'WEBPVP8 ')
const AVIF = bytes([0x00, 0x00, 0x00, 0x1c], 'ftyp', 'avif', 'avif')

describe('sniffMediaType', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/gif', GIF87],
    ['image/gif', GIF89],
    ['image/webp', WEBP],
    ['image/avif', AVIF],
  ])('recognises %s from its magic bytes', (type, source) => {
    expect(sniffMediaType(source)).toBe(type)
  })

  // THE POINT OF THE ALLOWLIST. Each of these is a document a browser would happily execute script
  // from if it were served with a type that let it; each sniffs to `null`, so each is stored and
  // served as `application/octet-stream` + `Content-Disposition: attachment`.
  it.each([
    ['an SVG', bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['an SVG behind an XML declaration', bytes('<?xml version="1.0"?><svg><script/></svg>')],
    ['an HTML document', bytes('<!DOCTYPE html><html><body><script>alert(1)</script>')],
    ['a zip archive', bytes('PK', [0x03, 0x04, 0x14, 0x00])],
    ['a PDF', bytes('%PDF-1.7')],
    ['a RIFF container that is not WebP', bytes('RIFF', [0x20, 0x00, 0x00, 0x00], 'WAVEfmt ')],
    ['an ISO-BMFF container that is not AVIF', bytes([0, 0, 0, 0x18], 'ftyp', 'mp42', 'mp42')],
    ['random bytes', bytes([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09])],
  ])('sniffs %s to null', (_label, source) => {
    expect(sniffMediaType(source)).toBeNull()
  })

  // The claim and the extension are both attacker-controlled; only the bytes are not.
  it('ignores the claimed type and the filename entirely', () => {
    expect(sniffMediaType(PNG)).toBe('image/png')
  })

  it('does not throw on a buffer shorter than the longest signature', () => {
    expect(sniffMediaType(new Uint8Array())).toBeNull()
    expect(sniffMediaType(new Uint8Array([0x89, 0x50]))).toBeNull()
    expect(sniffMediaType(bytes('RIFF'))).toBeNull()
  })
})

describe('contentDispositionFor', () => {
  it('emits both RFC 6266 forms on one line', () => {
    expect(contentDispositionFor('diagram.png', true)).toBe(
      `inline; filename="diagram.png"; filename*=UTF-8''diagram.png`,
    )
    expect(contentDispositionFor('diagram.svg', false)).toBe(
      `attachment; filename="diagram.svg"; filename*=UTF-8''diagram.svg`,
    )
  })

  // The injection this exists to close: the value reached the header via a database column, which
  // is exactly why a CR/LF in it is easy to stop worrying about.
  it.each([
    ['a quote', 'ev"il.png'],
    ['a CRLF header split', 'ev\r\nX-Injected: yes.png'],
    ['a bare newline', 'ev\nil.png'],
    ['a null byte', 'ev\u0000il.png'],
    ['a path separator', '../../etc/passwd'],
    ['a backslash', 'C:\\Windows\\evil.png'],
  ])('strips %s and stays a single line', (_label, filename) => {
    const header = contentDispositionFor(filename, false)
    expect(header).not.toContain('"ev"')
    expect(header.split('\n')).toHaveLength(1)
    expect(header.split('\r')).toHaveLength(1)
    expect(header).not.toContain('\u0000')
    expect(header).toMatch(/^attachment; filename="[ -~]*"; filename\*=UTF-8''\S*$/)
  })

  it('keeps a non-ASCII name in filename* and degrades it in the ASCII fallback', () => {
    const header = contentDispositionFor('スクリーンショット.png', true)
    expect(header).toContain(`filename="_________.png"`)
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('スクリーンショット.png')}`)
  })

  it('names something when the filename sanitises away entirely', () => {
    expect(contentDispositionFor('///', false)).toBe(
      `attachment; filename="download"; filename*=UTF-8''download`,
    )
  })
})
