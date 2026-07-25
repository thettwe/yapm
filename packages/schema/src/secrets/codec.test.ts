import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createSecretCodec, decodeEncryptionKey, SecretCodecError } from './codec.js'

const key = () => randomBytes(32).toString('base64')

describe('secret codec', () => {
  it('round-trips a secret', () => {
    const codec = createSecretCodec(key())
    const plaintext = 'gh-webhook-secret-\u{1F510}-multi\nline'
    expect(codec.decrypt(codec.encrypt(plaintext))).toBe(plaintext)
  })

  it('produces a versioned iv.tag.ciphertext blob and a fresh IV each time', () => {
    const codec = createSecretCodec(key())
    const a = codec.encrypt('same')
    const b = codec.encrypt('same')
    expect(a.startsWith('v1.')).toBe(true)
    expect(a.split('.')).toHaveLength(4)
    expect(a).not.toBe(b)
  })

  it('never leaks the plaintext into the blob', () => {
    const codec = createSecretCodec(key())
    const blob = codec.encrypt('super-secret-token')
    expect(blob).not.toContain('super-secret-token')
  })

  it('rejects a blob decrypted under a different key', () => {
    const blob = createSecretCodec(key()).encrypt('secret')
    expect(() => createSecretCodec(key()).decrypt(blob)).toThrow(SecretCodecError)
  })

  it('rejects a tampered ciphertext (authenticated encryption)', () => {
    const codec = createSecretCodec(key())
    const [version, iv, tag, ctB64] = codec.encrypt('secret').split('.')
    const ct = Buffer.from(ctB64 ?? '', 'base64')
    ct[0] = (ct[0] ?? 0) ^ 0xff
    const tampered = [version, iv, tag, ct.toString('base64')].join('.')
    expect(() => codec.decrypt(tampered)).toThrow(SecretCodecError)
  })

  it('rejects a malformed blob', () => {
    const codec = createSecretCodec(key())
    expect(() => codec.decrypt('not-a-blob')).toThrow(SecretCodecError)
    expect(() => codec.decrypt('v2.a.b.c')).toThrow(SecretCodecError)
  })

  it('rejects a key that does not decode to 32 bytes', () => {
    expect(() => decodeEncryptionKey(randomBytes(16).toString('base64'))).toThrow(SecretCodecError)
    expect(() => createSecretCodec('too-short')).toThrow(SecretCodecError)
  })
})
