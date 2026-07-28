import type { ImageUploadResult } from '@yapm/ui/lib/image-upload'

// Declared here rather than imported from `apps/server`: an app never imports another app, and the
// path is part of this client's contract with the REST surface exactly as `/api/v1/search` is.
// `apps/server` exports the same string as `FILES_API_BASE`; the pair is asserted by the e2e run,
// which drives the real route.
const FILES_API_BASE = '/api/v1/files'

/**
 * The path a browser fetches an attachment from, computed rather than stored.
 *
 * THE ID IS A NAME, NOT A CAPABILITY. Nothing signed and nothing bearer-shaped goes into a document
 * — a document syncs, so a URL in a node would sit in every team member's IndexedDB for as long as
 * the document lives. The route checks the session and the team on every request; this function
 * knows nothing and grants nothing.
 */
export function attachmentSrc(attachmentId: string, variant: 'thumb' | 'full'): string {
  const id = encodeURIComponent(attachmentId)
  return variant === 'thumb' ? `${FILES_API_BASE}/${id}/thumb` : `${FILES_API_BASE}/${id}`
}

// The route's refusals, in human copy.
//
// 404 is the STANDARD BYTE-IDENTICAL REFUSAL: an id that matches no row, a row in a team the caller
// is not in, and a team that does not exist all serialise to the same bytes on purpose, so the
// shape of the answer leaks nothing. The copy has to be equally non-committal — telling the user
// which of those it was is precisely what the route declines to.
function refusalCopy(status: number, maxBytes: number | undefined): string {
  if (status === 413) {
    const limit =
      maxBytes === undefined ? '' : ` The limit is ${Math.floor(maxBytes / 1_000_000)} MB.`
    return `That file is too large to upload.${limit}`
  }
  if (status === 401) return 'Your session has expired. Reload the page and sign in again.'
  if (status === 400) return "That file couldn't be read. Try uploading it again."
  if (status === 404) return "Couldn't upload — you may not have access to this issue."
  return "Couldn't upload that file. Try again."
}

export interface UploadAttachmentInput {
  file: File
  teamId: string
  issueId: string
}

/**
 * One file per request, multipart, with the session cookie. The attachment id is SERVER-minted and
 * comes back in the response — there is no attachment mutator anywhere, so CLAUDE.md #4's
 * client-minted-id rule has nothing to bind to here and nothing rebases.
 */
export async function uploadAttachment({
  file,
  teamId,
  issueId,
}: UploadAttachmentInput): Promise<ImageUploadResult> {
  const body = new FormData()
  body.append('file', file)
  body.append('teamId', teamId)
  body.append('issueId', issueId)

  let response: Response
  try {
    response = await fetch(FILES_API_BASE, { method: 'POST', body, credentials: 'include' })
  } catch {
    return { error: 'Upload failed. Check your connection and try again.' }
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { maxBytes?: unknown }
    const maxBytes = typeof payload.maxBytes === 'number' ? payload.maxBytes : undefined
    return { error: refusalCopy(response.status, maxBytes) }
  }

  const payload = (await response.json().catch(() => ({}))) as { id?: unknown }
  if (typeof payload.id !== 'string' || payload.id === '') {
    return { error: "Couldn't upload that file. Try again." }
  }
  return { attachmentId: payload.id }
}

/** Object, thumbnail and row together, and idempotent: a second call is the standard refusal. */
export async function deleteAttachment(attachmentId: string): Promise<string | undefined> {
  let response: Response
  try {
    response = await fetch(`${FILES_API_BASE}/${encodeURIComponent(attachmentId)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  } catch {
    return 'Delete failed. Check your connection and try again.'
  }
  if (response.ok) return undefined
  return response.status === 404
    ? "Couldn't remove that file — it may already be gone."
    : "Couldn't remove that file. Try again."
}
