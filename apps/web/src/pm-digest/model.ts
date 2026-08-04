import {
  type DigestItemKind,
  type StoredPmDigestContent,
  storedPmDigestContentSchema,
} from '@yapm/schema'

// The PM reader's pure half. Everything here reads ONLY the stored row: no relationship is
// traversed, no issue, cycle, team or pull-request row is consulted, and none is available to
// consult — a reader outside the producing team can name none of them in any query. The subject
// line and every evidence label were baked into `content` server-side for exactly that reason.

export interface PmDigestRowData {
  readonly id: string
  readonly teamId: string
  readonly cycleId: string
  readonly status: string
  readonly content?: unknown
  readonly provider?: string | null
  readonly model?: string | null
  readonly generatedAt?: number | null
  readonly publishedAt?: number | null
  readonly audienceSizeAtPublish?: number | null
}

export const PM_ITEM_KIND_LABEL: Record<DigestItemKind, string> = {
  shipped: 'Shipped',
  carried: 'Carried',
  risk: 'Risk',
  highlight: 'Highlight',
}

// Parsed rather than cast: the blob crosses the sync boundary as opaque json, and a shape this
// render cannot walk must degrade to "no narrative" instead of throwing inside a reader's surface.
export function pmDigestContent(row: { readonly content?: unknown }): StoredPmDigestContent | null {
  const parsed = storedPmDigestContentSchema.safeParse(row.content)
  return parsed.success ? parsed.data : null
}

function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatRange(start: number | null, end: number | null): string | null {
  if (start !== null && end !== null) return `${formatDay(start)} – ${formatDay(end)}`
  if (start !== null) return formatDay(start)
  if (end !== null) return formatDay(end)
  return null
}

// `Platform · Cycle 12 · 1 Jul – 14 Jul`. Every part of it was written by yapm at generation time
// and stored on the row, because the names it carries live in rows this reader cannot read.
export function pmSubjectLine(content: StoredPmDigestContent): string | null {
  const subject = content.subject
  if (subject === undefined) return null
  const parts = [subject.teamName, subject.cycleName].filter((part) => part.trim().length > 0)
  const range = formatRange(subject.startDate, subject.endDate)
  if (range !== null) parts.push(range)
  return parts.length > 0 ? parts.join(' · ') : null
}

// PLAIN TEXT, NEVER A LINK. The reader can open none of these targets, so a link would dead-end —
// and making one work means widening reads on issues and pull requests, a far larger disclosure than
// the prose it was meant to make verifiable. An evidence id with no baked label renders as nothing
// rather than as a bare uuid.
export function pmEvidenceLabels(
  refs: readonly { readonly id: string }[],
  labels: Readonly<Record<string, string>> | undefined,
): string[] {
  if (labels === undefined) return []
  const out: string[] = []
  for (const ref of refs) {
    const label = labels[ref.id]
    if (label === undefined || label.length === 0) continue
    if (!out.includes(label)) out.push(label)
  }
  return out
}

// The same "AI-generated · <model>" framing the team-internal digest carries, minus its invitation
// to open a linked entity: there is nothing here this reader can open.
export function pmDigestFraming(row: {
  readonly model?: string | null
  readonly generatedAt?: number | null
}): string {
  const parts = ['AI-generated']
  if (row.model) parts.push(row.model)
  if (row.generatedAt) {
    parts.push(
      new Date(row.generatedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    )
  }
  return `${parts.join(' · ')}. Written from yapm's own record of the cycle, and released by the team that did the work. Some items may be imprecise.`
}

// A SNAPSHOT taken when the team released it, not a live count — the honest answer to "how many
// people did we disclose this to", and it does not silently change when the list is edited later.
// Never a name: there is no reader list on this surface, and there is not one anywhere.
export function sharedReadersLabel(count: number | null | undefined): string {
  if (count === null || count === undefined) return 'Shared outside this team.'
  return `Shared with ${count} ${count === 1 ? 'reader' : 'readers'} outside this team.`
}

// What the producing team is told when there is nothing to release. Each one ends the same way,
// because the only thing the team needs to know for certain is whether anything left the team.
export const PM_REVIEW_STATUS_NOTE: Record<string, string> = {
  pending: 'A product summary of this cycle is being written. Nothing has left this team.',
  failed: 'The product summary could not be written. Nothing has left this team.',
  ai_off:
    'AI is off for this workspace, so no product summary was written. Nothing has left this team.',
}

export function pmReviewStatusNote(status: string): string {
  return (
    PM_REVIEW_STATUS_NOTE[status] ??
    'No product summary for this cycle. Nothing has left this team.'
  )
}
