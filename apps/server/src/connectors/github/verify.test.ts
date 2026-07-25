import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConnectorHeaders } from '@yapm/schema'
import { describe, expect, it } from 'vitest'
import { verifyGithubSignature } from './verify.js'

const RAW = readFileSync(
  join(import.meta.dirname, '__fixtures__', 'pull_request.opened.json'),
  'utf8',
)

function sign(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

function headers(signature?: string): ConnectorHeaders {
  return {
    get: (name) => (name.toLowerCase() === 'x-hub-signature-256' ? (signature ?? null) : null),
  }
}

const bytes = new TextEncoder().encode(RAW)

describe('verifyGithubSignature', () => {
  it('accepts a signature computed over the exact raw body', async () => {
    expect(
      await verifyGithubSignature(bytes, headers(sign('shh', RAW)), { webhookSecret: 'shh' }),
    ).toBe(true)
  })

  it('rejects a missing signature header', async () => {
    expect(await verifyGithubSignature(bytes, headers(), { webhookSecret: 'shh' })).toBe(false)
  })

  it('rejects a signature made with the wrong secret', async () => {
    expect(
      await verifyGithubSignature(bytes, headers(sign('other', RAW)), { webhookSecret: 'shh' }),
    ).toBe(false)
  })

  it('rejects when the body was tampered after signing', async () => {
    const tampered = new TextEncoder().encode(`${RAW} `)
    expect(
      await verifyGithubSignature(tampered, headers(sign('shh', RAW)), { webhookSecret: 'shh' }),
    ).toBe(false)
  })

  it('accepts a fallback secret during rotation', async () => {
    expect(
      await verifyGithubSignature(bytes, headers(sign('old', RAW)), {
        webhookSecret: 'new',
        fallbackSecrets: ['old'],
      }),
    ).toBe(true)
  })
})
