import { useQuery } from '@rocicorp/zero/react'
import { queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { DetailSection } from '@yapm/ui/components/detail-field'
import { PaperclipIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { attachmentSrc, deleteAttachment, uploadAttachment } from '@/issues/attachments/upload'

export interface AttachmentRow {
  id: string
  filename: string
  contentType: string
  byteSize: number
  uploaderId: string
  createdAt: number
}

/**
 * The Files section accepts ANY file, unlike the editor's image picker: a log, a har, a crash dump
 * attached to a bug are the point of it. The document only ever holds images, because only an image
 * has a node type.
 */
function pickAnyFile(onPick: (file: File) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.style.display = 'none'
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    input.remove()
    if (file) onPick(file)
  })
  document.body.append(input)
  input.click()
}

/** Decimal, not binary: a file manager says 1.2 MB for 1 200 000 bytes and so does this. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1000) return `${bytes} B`
  const units = ['kB', 'MB', 'GB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/**
 * The complete inventory of what this issue has stored, reading the `attachments.byIssue` synced
 * query that already exists — no new query, no new mutator, no ZQL outside `packages/schema`.
 *
 * FILES ARE DATABASE ROWS, NOT DOCUMENT NODES. There is no `fileAttachment` node type, so an image
 * the editor uploaded is a row here as well as a node in the description. That is deliberate: the
 * operator's GC sweep and backup story both assume this list is everything, and a file the editor
 * put somewhere the Files section cannot see would break both.
 */
export function FilesSection({
  issueId,
  teamId,
  canWrite,
  userNames,
}: {
  issueId: string
  teamId: string
  canWrite: boolean
  userNames: ReadonlyMap<string, string>
}) {
  const [attachments] = useQuery(queries.attachments.byIssue({ issueId }))
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const rows = attachments as readonly AttachmentRow[]

  async function upload(file: File): Promise<void> {
    setBusy(true)
    const result = await uploadAttachment({ file, teamId, issueId })
    setBusy(false)
    setError('error' in result ? result.error : undefined)
  }

  async function remove(row: AttachmentRow): Promise<void> {
    // A confirm, because deleting an attachment removes the bytes as well as the row and nothing
    // undoes it. The image node in a description that named it degrades to its alt text.
    if (!window.confirm(`Remove ${row.filename}? This cannot be undone.`)) return
    setError(await deleteAttachment(row.id))
  }

  return (
    <DetailSection title={`Files${rows.length > 0 ? ` · ${rows.length}` : ''}`}>
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-text-3">
          No files yet.
          {canWrite ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => pickAnyFile((file) => void upload(file))}
            >
              <PaperclipIcon aria-hidden="true" />
              Upload
            </Button>
          ) : null}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-2 py-1.5">
              <PaperclipIcon aria-hidden="true" className="size-3.5 shrink-0 text-text-3" />
              <span className="flex min-w-0 flex-1 flex-col">
                {/* The download IS the filename, and its accessible name says so — nine controls
                    all called "Download" is a list a screen reader cannot navigate. */}
                <a
                  href={attachmentSrc(row.id, 'full')}
                  download={row.filename}
                  aria-label={`Download ${row.filename}`}
                  className="truncate rounded-control font-ui text-[13px] text-accent-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {row.filename}
                </a>
                <span className="truncate font-ui text-[11px] text-text-3">
                  {formatBytes(row.byteSize)} · {userNames.get(row.uploaderId) ?? 'Someone'} ·{' '}
                  {formatWhen(row.createdAt)}
                </span>
              </span>
              {canWrite ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${row.filename}`}
                  className="text-text-2"
                  onClick={() => void remove(row)}
                >
                  <Trash2Icon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && canWrite ? (
        <div className="pt-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => pickAnyFile((file) => void upload(file))}
          >
            <PaperclipIcon aria-hidden="true" />
            Upload
          </Button>
        </div>
      ) : null}

      {error !== undefined ? (
        <p className="text-xs text-status-urgent" role="alert">
          {error}
        </p>
      ) : null}
    </DetailSection>
  )
}

function formatWhen(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
