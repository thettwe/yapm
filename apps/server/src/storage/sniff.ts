// AN SVG IS AN HTML DOCUMENT. `<script>` inside one executes with the origin's privileges the
// moment a browser is allowed to treat the response as a document — and yapm serves its own SPA
// from the same origin, so an inline-rendered SVG is stored XSS against every session.
//
// So the media type an attachment is served with is NEVER the client's claim and NEVER derived from
// the filename. It comes from this fixed table, and the table is an ALLOWLIST of five raster
// formats. Everything else — including anything whose bytes look like SVG, XML, HTML or a zip —
// sniffs to `null`, is stored and served as `application/octet-stream`, and is offered as a
// download. Rejecting SVG uploads outright was considered and declined: people legitimately attach
// diagrams, a refusal at upload teaches nothing, and a download-only SVG is entirely usable. What
// is not negotiable is that the origin never renders it.
//
// Pure, and imports nothing.

export type SniffedMediaType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/avif'

interface Signature {
  readonly type: SniffedMediaType
  readonly offset: number
  readonly bytes: readonly number[]
  // A second window that must also match, for the container formats whose first four bytes say
  // nothing (RIFF is also WAV and AVI; the ISO-BMFF box is also MP4 and HEIC).
  readonly also?: { readonly offset: number; readonly bytes: readonly number[] }
}

const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0))

const SIGNATURES: readonly Signature[] = [
  { type: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', offset: 0, bytes: ascii('GIF87a') },
  { type: 'image/gif', offset: 0, bytes: ascii('GIF89a') },
  {
    type: 'image/webp',
    offset: 0,
    bytes: ascii('RIFF'),
    also: { offset: 8, bytes: ascii('WEBP') },
  },
  {
    type: 'image/avif',
    offset: 4,
    bytes: ascii('ftyp'),
    also: { offset: 8, bytes: ascii('avif') },
  },
  {
    type: 'image/avif',
    offset: 4,
    bytes: ascii('ftyp'),
    also: { offset: 8, bytes: ascii('avis') },
  },
]

function matchesAt(source: Uint8Array, offset: number, bytes: readonly number[]): boolean {
  if (source.length < offset + bytes.length) return false
  for (let index = 0; index < bytes.length; index += 1) {
    if (source[offset + index] !== bytes[index]) return false
  }
  return true
}

// `null` means "not a raster image this product will render inline", which is a broader statement
// than "unknown": it is the answer for a valid SVG just as much as for random bytes.
export function sniffMediaType(source: Uint8Array): SniffedMediaType | null {
  for (const signature of SIGNATURES) {
    if (!matchesAt(source, signature.offset, signature.bytes)) continue
    if (signature.also && !matchesAt(source, signature.also.offset, signature.also.bytes)) continue
    return signature.type
  }
  return null
}

export const FALLBACK_MEDIA_TYPE = 'application/octet-stream'

// Control characters, quotes, backslashes and path separators are STRIPPED rather than escaped, by
// code point rather than by a regex literal (a literal control character in a pattern is exactly
// the kind of thing that survives a copy-paste as something else). The value round-trips through
// the database first, which is why this is easy to miss: a CR/LF in a filename is header injection,
// and the header is built from a column.
function stripUnsafe(filename: string): string {
  let out = ''
  for (const character of filename) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) continue
    if (character === '"' || character === '\\' || character === '/') continue
    out += character
  }
  return out.trim()
}

function toAscii(value: string): string {
  let out = ''
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    out += code >= 0x20 && code < 0x7f ? character : '_'
  }
  return out
}

// RFC 6266. Both forms are emitted: a sanitised ASCII `filename=` every client understands, and a
// percent-encoded `filename*` carrying the real name for the ones that do. Always ONE line.
export function contentDispositionFor(filename: string, inline: boolean): string {
  const disposition = inline ? 'inline' : 'attachment'
  const cleaned = stripUnsafe(filename)
  // A name that sanitised away entirely still needs to name something.
  const named = cleaned.length > 0 ? cleaned.slice(0, 200) : 'download'
  return `${disposition}; filename="${toAscii(named)}"; filename*=UTF-8''${encodeURIComponent(named)}`
}
