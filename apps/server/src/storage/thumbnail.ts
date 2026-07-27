import sharp from 'sharp'

// The longest edge of a thumbnail. 512 is two of them side by side on a retina issue detail without
// being a second full-size download.
export const THUMBNAIL_MAX_EDGE = 512

// STATED, not inherited. It happens to be sharp's own default (0x3fff * 0x3fff), and writing it
// down is the point: a decompression bomb is bounded by a number this file owns rather than by
// whatever a future sharp release decides.
export const THUMBNAIL_MAX_INPUT_PIXELS = 268402689

export interface Thumbnail {
  readonly bytes: Uint8Array
  readonly contentType: 'image/webp'
}

// Runs ONCE, at upload. The read path is then a pure byte proxy for both variants — a read path
// that decodes an image is a read path where twenty concurrent thumbnail requests are a CPU DoS on
// a 2-vCPU VPS, and the whole point of `max-age=300` is that the second view costs nothing at all.
//
// Returns `null` on ANY decode failure rather than throwing: a thumbnail is an optimisation, not a
// validity condition, so a file sharp cannot read is stored with `has_thumbnail = false` and the
// upload succeeds.
//
// Metadata is stripped (sharp's default is to drop it; `withMetadata()` is what would carry it
// forward). That is deliberate rather than incidental: EXIF GPS on a pasted phone screenshot is a
// location this product has no business republishing to a whole team.
export async function createThumbnail(source: Uint8Array): Promise<Thumbnail | null> {
  try {
    const bytes = await sharp(source, { limitInputPixels: THUMBNAIL_MAX_INPUT_PIXELS })
      .rotate()
      .resize({
        width: THUMBNAIL_MAX_EDGE,
        height: THUMBNAIL_MAX_EDGE,
        fit: 'inside',
        // An image already smaller than the bound is passed through at its own size rather than
        // scaled up into a blurrier, larger file than the original.
        withoutEnlargement: true,
      })
      .webp({ quality: 78 })
      .toBuffer()
    return { bytes: new Uint8Array(bytes), contentType: 'image/webp' }
  } catch {
    return null
  }
}
