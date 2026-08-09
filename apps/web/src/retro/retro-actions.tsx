import type { IssueStatus } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { Select } from '@yapm/ui/components/select'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import { ArrowUpRightIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { STATUS_LABEL, STATUS_TO_KIND } from '@/issues/model'
import type { RetroApi } from '@/retro/api'
import { type RetroActionData, type RetroRowData, retroCan } from '@/retro/model'

export interface RetroActionsProps {
  retro: RetroRowData
  actions: readonly RetroActionData[]
  members: readonly { id: string; name: string }[]
  cycles: readonly { id: string; name: string }[]
  teamKey: string
  canWrite: boolean
  composerOpen: boolean
  onFocusAction: (actionId: string | null) => void
  onOpenComposer: () => void
  onCloseComposer: () => void
  api: RetroApi
  onOpenIssue: (issueId: string) => void
}

// The loop that stops a retro being a forgotten doc: an action becomes a REAL issue in the next
// cycle through the shared create path, and then reports that issue's live status right here.
export function RetroActions({
  retro,
  actions,
  members,
  cycles,
  teamKey,
  canWrite,
  composerOpen,
  onFocusAction,
  onOpenComposer,
  onCloseComposer,
  api,
  onOpenIssue,
}: RetroActionsProps) {
  const canEdit = retroCan(retro.phase, 'action', { canWrite })
  const canConvert = retroCan(retro.phase, 'convert', { canWrite })

  return (
    <section
      className="flex flex-col gap-2 border-b border-border px-5 py-3"
      aria-label="Action items"
      // The palette's "Convert this action to an issue" acts on whatever the keyboard last held,
      // recorded here because opening the dialog moves focus off it — the same rule the board uses
      // for the focused card.
      onFocusCapture={(event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-retro-action]')
        onFocusAction(row?.dataset.retroAction ?? null)
      }}
    >
      <header className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold tracking-[-0.006em] text-text-1">Actions</h2>
        <span className="font-mono text-[11px] text-text-2">{actions.length}</span>
        {/* A retro stepped back out of `discuss` still holds what it recorded. The list stays and
            says when the write reopens rather than folding rows the phase merely cannot edit. */}
        {canEdit ? null : (
          <span className="text-[11.5px] text-text-2">read-only · actions reopen at Discuss</span>
        )}
        {canEdit ? (
          <Button
            size="icon-xs"
            variant="ghost"
            className="ml-auto"
            aria-label="New action"
            aria-keyshortcuts="a"
            data-testid="retro-new-action"
            onClick={onOpenComposer}
          >
            <PlusIcon />
          </Button>
        ) : null}
      </header>

      {composerOpen && canEdit ? (
        <ActionComposer
          onSubmit={(body) => void api.createAction(body)}
          onClose={onCloseComposer}
        />
      ) : null}

      {actions.length === 0 && !composerOpen ? (
        <p className="text-xs text-text-2">What is the team changing next cycle?</p>
      ) : null}

      {/* Full-bleed rows at 1440 would be one sentence stretched across a screen; the band lays them
          out as a wrapping run of columns instead. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-2">
        {actions.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            members={members}
            cycles={cycles}
            teamKey={teamKey}
            canEdit={canEdit}
            canConvert={canConvert}
            api={api}
            onOpenIssue={onOpenIssue}
          />
        ))}
      </div>

      {/* The loop that stops a retro being a forgotten doc, stated once. An action created from an
          AI proposal arrives with NO assignee and nothing on that path suggests, defaults or infers
          one — the model has no identity dimension to invent an owner from. */}
      <p className="font-mono text-[10.5px] text-text-2">an action becomes a real numbered issue</p>
    </section>
  )
}

function ActionComposer({
  onSubmit,
  onClose,
}: {
  onSubmit: (body: string) => void
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <textarea
      ref={ref}
      rows={2}
      data-testid="retro-action-composer"
      aria-label="New action"
      placeholder="What will the team change? Enter to add, Esc to close…"
      value={body}
      onChange={(event) => setBody(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          const trimmed = body.trim()
          if (trimmed.length === 0) return
          onSubmit(trimmed)
          setBody('')
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
      className="w-full resize-none rounded-card border border-accent-line bg-bg-elevated px-3 py-2 text-[13px] leading-snug text-text-1 outline-none placeholder:text-text-3 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
    />
  )
}

function ActionRow({
  action,
  members,
  cycles,
  teamKey,
  canEdit,
  canConvert,
  api,
  onOpenIssue,
}: {
  action: RetroActionData
  members: readonly { id: string; name: string }[]
  cycles: readonly { id: string; name: string }[]
  teamKey: string
  canEdit: boolean
  canConvert: boolean
  api: RetroApi
  onOpenIssue: (issueId: string) => void
}) {
  const [body, setBody] = useState(action.body)
  const [editing, setEditing] = useState(false)
  const converted = action.issueId !== null

  return (
    // The convert shortcut lives on the container so it fires from anywhere inside the action —
    // the body button, a select, or the convert button. The container itself is not a tab stop:
    // its focusable children are, which keeps the tab order honest.
    <article
      data-retro-action={action.id}
      data-testid="retro-action"
      aria-label={`Action: ${action.body}`}
      className="flex flex-col gap-2 rounded-card border border-border bg-bg-elevated px-3 py-2.5"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canConvert && !converted) {
          event.preventDefault()
          void api.convertAction(action.id)
        }
      }}
    >
      {editing ? (
        <textarea
          // biome-ignore lint/a11y/noAutofocus: the editor replaces the focused action in place
          autoFocus
          rows={2}
          aria-label="Edit action"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              const trimmed = body.trim()
              if (trimmed.length > 0) void api.updateAction(action.id, { body: trimmed })
              setEditing(false)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setBody(action.body)
              setEditing(false)
            }
          }}
          className="w-full resize-none rounded-control border border-accent-line bg-bg-elevated px-2 py-1.5 text-[13px] leading-snug text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      ) : canEdit ? (
        <button
          type="button"
          aria-label={`Edit action: ${action.body}`}
          aria-keyshortcuts={canConvert && !converted ? 'Meta+Enter Control+Enter' : undefined}
          onClick={() => setEditing(true)}
          className="whitespace-pre-wrap rounded-control text-left text-[13px] leading-snug text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {action.body}
        </button>
      ) : (
        <p className="whitespace-pre-wrap text-[13px] leading-snug text-text-1">{action.body}</p>
      )}

      {canEdit ? (
        <div className="flex items-center gap-2">
          <Select
            aria-label="Assignee"
            className="h-7 text-xs"
            value={action.assigneeId ?? ''}
            onChange={(event) =>
              void api.updateAction(action.id, {
                assigneeId: event.target.value === '' ? null : event.target.value,
              })
            }
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Target cycle"
            className="h-7 text-xs"
            value={action.targetCycleId ?? ''}
            onChange={(event) =>
              void api.updateAction(action.id, {
                targetCycleId: event.target.value === '' ? null : event.target.value,
              })
            }
          >
            <option value="">No cycle</option>
            {cycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>
                {cycle.name}
              </option>
            ))}
          </Select>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Delete action"
            onClick={() => void api.deleteAction(action.id)}
          >
            <Trash2Icon />
          </Button>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        {converted && action.issue ? (
          <button
            type="button"
            data-testid="retro-action-issue"
            className="flex items-center gap-1.5 rounded-control px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => onOpenIssue(action.issue?.id ?? '')}
          >
            <StatusGlyph status={STATUS_TO_KIND[action.issue.status as IssueStatus]} />
            <span className="font-mono text-[11px] text-text-3">
              {action.issue.number === null ? '…' : `${teamKey}-${action.issue.number}`}
            </span>
            <span className="text-[11.5px] text-text-2">
              {STATUS_LABEL[action.issue.status as IssueStatus]}
            </span>
          </button>
        ) : null}
        {converted && !action.issue ? (
          <span className="text-[11.5px] text-text-3">Tracked as an issue.</span>
        ) : null}
        {!converted && canConvert ? (
          <Button
            size="xs"
            variant="outline"
            className="ml-auto"
            data-testid="retro-convert-action"
            onClick={() => void api.convertAction(action.id)}
          >
            <ArrowUpRightIcon />
            Convert to issue
          </Button>
        ) : null}
      </div>
    </article>
  )
}
