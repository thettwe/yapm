import { uuidv7 } from 'uuidv7'

export const newId = (): string => uuidv7()

// A UUIDv7's leading characters are a 48-bit millisecond clock, not entropy: `newId().slice(0, 8)`
// is that clock's top 32 bits and repeats for every id minted inside the same ~65 seconds. A short
// value whose purpose is uniqueness is minted from randomness here rather than sliced off an id.
export const newKey = (length = 8): string => {
  const bytes = new Uint8Array(Math.ceil(length / 2))
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}
