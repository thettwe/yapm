import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { sniffMediaType } from './sniff.js'
import { createThumbnail, THUMBNAIL_MAX_EDGE } from './thumbnail.js'

async function png(width: number, height: number): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } },
  })
    .png()
    .toBuffer()
  return new Uint8Array(buffer)
}

describe('createThumbnail', () => {
  it('produces a WebP bounded by the longest edge', async () => {
    const result = await createThumbnail(await png(1600, 900))

    expect(result?.contentType).toBe('image/webp')
    expect(sniffMediaType(result?.bytes as Uint8Array)).toBe('image/webp')

    const meta = await sharp(result?.bytes as Uint8Array).metadata()
    expect(meta.format).toBe('webp')
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(THUMBNAIL_MAX_EDGE)
    // Aspect ratio preserved: `fit: 'inside'` rather than a crop.
    expect(meta.height).toBe(Math.round((900 / 1600) * THUMBNAIL_MAX_EDGE))
  })

  it('does not enlarge an image already smaller than the bound', async () => {
    const result = await createThumbnail(await png(64, 48))
    const meta = await sharp(result?.bytes as Uint8Array).metadata()

    expect(meta.width).toBe(64)
    expect(meta.height).toBe(48)
  })

  // A thumbnail is an optimisation, not a validity condition: the upload must succeed with
  // `has_thumbnail = false` rather than fail because sharp could not read the file.
  it.each([
    ['a non-image buffer', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])],
    ['an empty buffer', new Uint8Array()],
    ['a truncated PNG header', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ])('returns null for %s rather than throwing', async (_label, source) => {
    await expect(createThumbnail(source)).resolves.toBeNull()
  })

  // EXIF GPS on a pasted phone screenshot is a location this product has no business republishing
  // to a whole team, and sharp carries metadata forward the moment somebody adds `withMetadata()`.
  it('strips metadata from the output', async () => {
    const withExif = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .withExif({ IFD0: { Copyright: 'yapm', Software: 'test' } })
      .jpeg()
      .toBuffer()

    expect((await sharp(withExif).metadata()).exif).toBeDefined()

    const result = await createThumbnail(new Uint8Array(withExif))
    const meta = await sharp(result?.bytes as Uint8Array).metadata()
    expect(meta.exif).toBeUndefined()
  })
})
