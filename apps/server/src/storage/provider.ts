// THE SEAM, AND THE ONE INVARIANT IT EXISTS TO HOLD.
//
// NO MEMBER OF `StorageProvider` MAY RETURN A URL. Not a signed one, not a presigned one, not a
// relative path, not a `Location` header, not `null`-on-local-and-a-string-on-S3. Three reasons,
// stated as facts rather than as a preference, because "we would notice in review" is exactly what
// the scope predicted would fail:
//
//   1. AN `<img src>` LIVES IN A DOCUMENT THAT SYNCS. Whatever string sits in a rich-text node
//      replicates to every team member's IndexedDB and persists as long as the document does. A
//      signed URL there is a bearer capability at rest on every client, it breaks permanently the
//      moment it expires, and re-signing it means rewriting `issue.description` on a timer — LWW
//      churn, a mention diff and a search reindex per rewrite, and an `updated_at` that lies.
//   2. THE TWO PROVIDERS WOULD STOP BEING PEERS. If the seam can mint a capability, the local
//      provider must invent a signing scheme, a secret and an expiry policy for a filesystem — or
//      the permission model becomes provider-dependent, at which point the falsifiable check passes
//      under `local` and fails under `s3`, and CI only ever runs `local`.
//   3. THE REFUSAL SHAPE WOULD LEAK. A 302 to S3 lets S3's own 403 through on a mis-signed request,
//      beside the app's 404 for a miss. That is the oracle the whole read path is built to deny.
//
// The app proxies bytes for BOTH providers instead, so the permission check and the refusal are
// literally the same code. `apps/server/src/storage/no-capability.test.ts` asserts the member list
// below is exactly five, parsed out of this file's source — so ADDING a member fails, whatever it
// is called, rather than only the handful of names somebody thought to forbid.

export interface StoredObject {
  // Streamed, never buffered: the read route pipes this straight to the response, so a 25 MiB file
  // costs one chunk of memory rather than 25 MiB of it.
  readonly body: ReadableStream<Uint8Array>
  readonly size: number
}

export interface StorageProvider {
  readonly kind: 'local' | 's3'
  put: (
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    contentType: string,
  ) => Promise<void>
  // `null` for a missing object rather than a throw, because "the row exists and the bytes do not"
  // must reach the route as a VALUE it folds into the single refusal — not as an exception whose
  // message could differ per provider.
  get: (key: string) => Promise<StoredObject | null>
  // IDEMPOTENT. Deleting an absent key resolves. The GC sweep must be safely re-runnable and a
  // partial failure must not need a reconciliation table.
  delete: (key: string) => Promise<void>
  // Resolves or rejects; the readiness check turns that into ready/not-ready, exactly as the
  // existing database and replication checks do.
  health: () => Promise<void>
}

// `<teamUuid>/<attachmentUuid>` optionally `.thumb`. Team-sharded so a local directory has bounded
// fan-out per team and an operator can `du -sh` per team, and UUID-component-only so the traversal
// defence is an ALLOWLIST rather than a blocklist — `..`, a leading `/`, a backslash, a null byte
// and a third segment are all rejected by not matching, not by being enumerated.
export const STORAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.thumb)?$/

export class InvalidStorageKeyError extends Error {
  constructor(key: string) {
    // The key is UUID components only, so echoing it leaks nothing — and a rejected key is a
    // programming error worth naming rather than a caller-visible refusal.
    super(`Invalid storage key: ${JSON.stringify(key)}`)
    this.name = 'InvalidStorageKeyError'
  }
}

// Called by EACH PROVIDER, first, before any filesystem call or any request is built — never by the
// caller. On the `Mailer` precedent: a validation the caller owns is a validation the NEXT caller
// forgets. The sweep, the upload route, the serve route and any future export path all construct
// keys; one of them will eventually do it from a value that came out of the database, and the
// provider is the only place that sees all four.
export function validateKey(key: string): void {
  if (!STORAGE_KEY_PATTERN.test(key)) throw new InvalidStorageKeyError(key)
}

// Derived, never stored. There is no `storage_key` column, because a stored key is a second source
// of truth that can disagree with the row — and one refactor away from being rendered.
export function objectKeyFor(teamId: string, attachmentId: string): string {
  return `${teamId}/${attachmentId}`
}

export function thumbnailKeyFor(teamId: string, attachmentId: string): string {
  return `${objectKeyFor(teamId, attachmentId)}.thumb`
}
