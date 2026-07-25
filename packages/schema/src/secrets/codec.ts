import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32
const SEPARATOR = '.'

export class SecretCodecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretCodecError'
  }
}

export interface SecretCodec {
  encrypt(plaintext: string): string
  decrypt(blob: string): string
}

export function decodeEncryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new SecretCodecError(
      `SECRETS_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`,
    )
  }
  return key
}

export function createSecretCodec(base64Key: string): SecretCodec {
  const key = decodeEncryptionKey(base64Key)
  return {
    encrypt: (plaintext) => encryptWith(key, plaintext),
    decrypt: (blob) => decryptWith(key, blob),
  }
}

function encryptWith(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(SEPARATOR)
}

function decryptWith(key: Buffer, blob: string): string {
  const [version, ivB64, tagB64, ctB64] = blob.split(SEPARATOR)
  if (version !== VERSION || ivB64 === undefined || tagB64 === undefined || ctB64 === undefined) {
    throw new SecretCodecError('malformed secret blob')
  }
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(ctB64, 'base64')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new SecretCodecError('secret decryption failed: wrong key or tampered ciphertext')
  }
}
