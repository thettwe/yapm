import type { ReadonlyJSONValue } from '@rocicorp/zero'
import { useQuery, useZero } from '@rocicorp/zero/react'
import { Link } from '@tanstack/react-router'
import {
  computeDeliverySignal,
  computeDivergence,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssuePriority,
  type IssueStatus,
  mutators,
  newId,
  queries,
} from '@yapm/schema'
import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import { Button } from '@yapm/ui/components/button'
import { CommentCard } from '@yapm/ui/components/comment'
import { DetailField, DetailSection, PropertyButton } from '@yapm/ui/components/detail-field'
import { DivergenceFlag, RealityStripPlaceholder } from '@yapm/ui/components/issue-row'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@yapm/ui/components/menu'
import { PriorityMark } from '@yapm/ui/components/priority-mark'
import {
  isRichTextEmpty,
  RichTextEditor,
  RichTextRenderer,
  type RichTextValue,
} from '@yapm/ui/components/rich-text'
import { Sheet } from '@yapm/ui/components/sheet'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import { CheckIcon, ExternalLinkIcon, TagIcon, UserIcon, UserXIcon, XIcon } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import {
  isPendingNumber,
  issueKey,
  PRIORITY_LABEL,
  PRIORITY_TO_KIND,
  STATUS_LABEL,
  STATUS_TO_KIND,
} from '@/issues/model'
import { runMutation } from '@/lib/mutation'

function formatWhen(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface MemberOption {
  id: string
  name: string
  image?: string | null
}

interface LabelRow {
  id: string
  name: string
  color: string
}

interface CommentRow {
  id: string
  authorId: string
  body: unknown
  createdAt: number
  updatedAt: number
  author?: { id: string; name?: string | null; email?: string | null; image?: string | null } | null
}

export function IssueDetailPanel({
  issueId,
  teamId,
  onClose,
}: {
  issueId: string
  teamId: string
  onClose: () => void
}) {
  return (
    <Sheet
      open
      label="Issue detail"
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <IssueDetail issueId={issueId} teamId={teamId} onClose={onClose} />
    </Sheet>
  )
}

export function IssueDetail({
  issueId,
  teamId,
  onClose,
}: {
  issueId: string
  teamId: string
  onClose?: () => void
}) {
  const [issue, result] = useQuery(queries.issues.detail({ id: issueId }))
  const [teams] = useQuery(queries.teams.all())
  const [users] = useQuery(queries.users.all())
  const [labels] = useQuery(queries.labels.byTeam({ teamId }))
  const { canWrite } = useMembership()

  const team = teams.find((candidate) => candidate.id === teamId)
  const teamKey = team?.key ?? ''

  const members = useMemo<MemberOption[]>(() => {
    const memberships = (team?.members ?? []) as readonly { userId: string }[]
    return memberships.map((membership) => {
      const user = users.find((candidate) => candidate.id === membership.userId)
      return {
        id: membership.userId,
        name: user?.name ?? user?.email ?? membership.userId,
        image: user?.image ?? null,
      }
    })
  }, [team, users])

  if (!issue) {
    const complete = result.type === 'complete'
    return (
      <div className="flex h-full flex-col">
        <DetailToolbar onClose={onClose} title={complete ? 'Issue not found' : 'Loading…'} />
        <p className="p-8 text-center text-sm text-text-3" role="status">
          {complete ? 'This issue does not exist or is not visible to you.' : 'Loading issue…'}
        </p>
      </div>
    )
  }

  return (
    <IssueDetailBody
      key={issueId}
      issue={issue as never}
      teamId={teamId}
      teamKey={teamKey}
      members={members}
      labelOptions={labels.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      }))}
      canWrite={canWrite}
      onClose={onClose}
    />
  )
}

interface IssueRecord {
  id: string
  number: number | null
  title: string
  description: unknown
  status: IssueStatus
  priority: IssuePriority
  assigneeId: string | null
  createdAt: number
  updatedAt: number
  assignee?: {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
  } | null
  creator?: { id: string; name?: string | null; email?: string | null } | null
  labels?: readonly LabelRow[]
  comments?: readonly CommentRow[]
}

function DetailToolbar({ onClose, title }: { onClose?: () => void; title: string }) {
  return (
    <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
      <span className="font-mono text-xs text-text-2">{title}</span>
      {onClose ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close issue"
          className="ml-auto"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      ) : null}
    </header>
  )
}

function IssueDetailBody({
  issue,
  teamId,
  teamKey,
  members,
  labelOptions,
  canWrite,
  onClose,
}: {
  issue: IssueRecord
  teamId: string
  teamKey: string
  members: readonly MemberOption[]
  labelOptions: readonly LabelRow[]
  canWrite: boolean
  onClose?: () => void
}) {
  const zero = useZero()
  const pending = isPendingNumber(issue)
  const key = issueKey(teamKey, issue)
  const currentLabels = (issue.labels ?? []) as readonly LabelRow[]
  const currentLabelIds = new Set(currentLabels.map((label) => label.id))
  const signal = computeDeliverySignal(issue, {})
  const divergence = computeDivergence(issue.status, signal)

  const [error, setError] = useState<string | undefined>(undefined)

  const run = useCallback(async (write: ReturnType<typeof zero.mutate>) => {
    const failure = await runMutation(write)
    setError(failure)
  }, [])

  const setStatus = (status: IssueStatus) =>
    void run(zero.mutate(mutators.issue.setStatus({ id: issue.id, status, updatedAt: Date.now() })))
  const setPriority = (priority: IssuePriority) =>
    void run(
      zero.mutate(mutators.issue.setPriority({ id: issue.id, priority, updatedAt: Date.now() })),
    )
  const assign = (assigneeId: string | null) =>
    void run(
      zero.mutate(mutators.issue.assign({ id: issue.id, assigneeId, updatedAt: Date.now() })),
    )
  const toggleLabel = (labelId: string) => {
    if (currentLabelIds.has(labelId)) {
      void run(zero.mutate(mutators.issue.removeLabel({ issueId: issue.id, labelId })))
    } else {
      void run(
        zero.mutate(mutators.issue.addLabel({ issueId: issue.id, labelId, createdAt: Date.now() })),
      )
    }
  }

  const saveTitle = (title: string) => {
    if (title.trim().length === 0 || title === issue.title) return
    void run(zero.mutate(mutators.issue.update({ id: issue.id, title, updatedAt: Date.now() })))
  }

  // Description edits stay local-first: the optimistic mutator applies instantly, but the
  // authoritative write is debounced so a burst of keystrokes settles into one update. The
  // pending edit is flushed on unmount (closing the panel) so nothing is lost.
  const pendingDoc = useRef<RichTextValue | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushDescription = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const doc = pendingDoc.current
    if (doc === null) return
    pendingDoc.current = null
    void run(
      zero.mutate(
        mutators.issue.update({
          id: issue.id,
          description: doc as unknown as ReadonlyJSONValue,
          updatedAt: Date.now(),
        }),
      ),
    )
  }, [issue.id, run, zero])

  const saveDescription = useCallback(
    (doc: RichTextValue) => {
      pendingDoc.current = doc
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(flushDescription, 500)
    },
    [flushDescription],
  )

  useEffect(() => () => flushDescription(), [flushDescription])

  const assigneeName =
    issue.assignee?.name ?? issue.assignee?.email ?? (issue.assigneeId ? 'Unknown' : 'Unassigned')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <StatusGlyph status={STATUS_TO_KIND[issue.status]} />
        <span
          className="font-mono text-xs text-text-2"
          data-pending={pending || undefined}
          data-testid="detail-key"
        >
          {key}
        </span>
        {divergence ? <DivergenceFlag /> : null}
        {onClose ? (
          <span className="ml-auto flex items-center gap-1">
            {pending ? null : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open full view"
                render={
                  <Link
                    to="/teams/$teamId/issues/$issueKey"
                    params={{ teamId, issueKey: String(issue.number) }}
                  >
                    <ExternalLinkIcon />
                  </Link>
                }
              />
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Close issue" onClick={onClose}>
              <XIcon />
            </Button>
          </span>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5 md:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <TitleField title={issue.title} canWrite={canWrite} onSave={saveTitle} />

          <DetailSection title="Description">
            {canWrite ? (
              <RichTextEditor
                key={issue.id}
                ariaLabel="Issue description"
                placeholder="Add a description…"
                minHeight="7rem"
                defaultValue={(issue.description as RichTextValue | null) ?? null}
                onChange={saveDescription}
              />
            ) : issue.description ? (
              <RichTextRenderer value={issue.description as RichTextValue} />
            ) : (
              <p className="text-sm text-text-3">No description.</p>
            )}
          </DetailSection>

          <CommentThread
            issueId={issue.id}
            comments={(issue.comments ?? []) as readonly CommentRow[]}
            canWrite={canWrite}
          />
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-1 md:w-64 md:border-l md:border-border md:pl-5">
          <DetailSection title="Properties">
            <DetailField label="Status">
              <MetaMenu
                disabled={!canWrite}
                ariaLabel={`Status: ${STATUS_LABEL[issue.status]}`}
                trigger={
                  <>
                    <StatusGlyph status={STATUS_TO_KIND[issue.status]} />
                    {STATUS_LABEL[issue.status]}
                  </>
                }
              >
                {ISSUE_STATUSES.map((status) => (
                  <MenuItem
                    key={status}
                    className="justify-between"
                    onClick={() => setStatus(status)}
                  >
                    <span className="flex items-center gap-2">
                      <StatusGlyph status={STATUS_TO_KIND[status]} />
                      {STATUS_LABEL[status]}
                    </span>
                    {status === issue.status ? (
                      <CheckIcon className="size-3.5 text-accent-strong" />
                    ) : null}
                  </MenuItem>
                ))}
              </MetaMenu>
            </DetailField>

            <DetailField label="Priority">
              <MetaMenu
                disabled={!canWrite}
                ariaLabel={`Priority: ${PRIORITY_LABEL[issue.priority]}`}
                trigger={
                  <>
                    <PriorityMark priority={PRIORITY_TO_KIND[issue.priority]} />
                    {PRIORITY_LABEL[issue.priority]}
                  </>
                }
              >
                {ISSUE_PRIORITIES.map((priority) => (
                  <MenuItem
                    key={priority}
                    className="justify-between"
                    onClick={() => setPriority(priority)}
                  >
                    <span className="flex items-center gap-2">
                      <PriorityMark priority={PRIORITY_TO_KIND[priority]} />
                      {PRIORITY_LABEL[priority]}
                    </span>
                    {priority === issue.priority ? (
                      <CheckIcon className="size-3.5 text-accent-strong" />
                    ) : null}
                  </MenuItem>
                ))}
              </MetaMenu>
            </DetailField>

            <DetailField label="Assignee">
              <MetaMenu
                disabled={!canWrite}
                ariaLabel={`Assignee: ${assigneeName}`}
                trigger={
                  <>
                    {issue.assignee ? (
                      <Avatar size="xs">
                        {issue.assignee.image ? (
                          <AvatarImage src={issue.assignee.image} alt={assigneeName} />
                        ) : null}
                        <AvatarFallback aria-label={assigneeName}>
                          {assigneeName.slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <UserIcon className="size-4 text-text-3" />
                    )}
                    {assigneeName}
                  </>
                }
              >
                <MenuItem onClick={() => assign(null)}>
                  <UserXIcon className="size-4" />
                  Unassigned
                </MenuItem>
                {members.map((member) => (
                  <MenuItem
                    key={member.id}
                    className="justify-between"
                    onClick={() => assign(member.id)}
                  >
                    <span className="flex items-center gap-2">
                      <Avatar size="xs">
                        {member.image ? <AvatarImage src={member.image} alt={member.name} /> : null}
                        <AvatarFallback aria-label={member.name}>
                          {member.name.slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {member.name}
                    </span>
                    {member.id === issue.assigneeId ? (
                      <CheckIcon className="size-3.5 text-accent-strong" />
                    ) : null}
                  </MenuItem>
                ))}
              </MetaMenu>
            </DetailField>

            <DetailField label="Labels">
              {currentLabels.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center gap-1.5 rounded-pill bg-bg-hover px-2 py-0.5 text-[12px] text-text-1"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: label.color }}
                    aria-hidden="true"
                  />
                  {label.name}
                </span>
              ))}
              {canWrite && labelOptions.length > 0 ? (
                <MetaMenu
                  ariaLabel="Add label"
                  closeOnSelect={false}
                  trigger={
                    <>
                      <TagIcon className="size-3.5" />
                      Add
                    </>
                  }
                >
                  {labelOptions.map((label) => (
                    <MenuItem
                      key={label.id}
                      closeOnClick={false}
                      className="justify-between"
                      onClick={() => toggleLabel(label.id)}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: label.color }}
                          aria-hidden="true"
                        />
                        {label.name}
                      </span>
                      {currentLabelIds.has(label.id) ? (
                        <CheckIcon className="size-3.5 text-accent-strong" />
                      ) : null}
                    </MenuItem>
                  ))}
                </MetaMenu>
              ) : currentLabels.length === 0 ? (
                <span className="text-[13px] text-text-3">None</span>
              ) : null}
            </DetailField>

            <DetailField label="Delivery">
              <span className="flex items-center gap-2 text-[13px] text-text-3">
                <RealityStripPlaceholder />
                Not linked
              </span>
            </DetailField>
          </DetailSection>
        </aside>
      </div>

      {error !== undefined ? (
        <div className="border-t border-border px-4 py-2 text-xs text-status-urgent" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  )
}

function TitleField({
  title,
  canWrite,
  onSave,
}: {
  title: string
  canWrite: boolean
  onSave: (title: string) => void
}) {
  const [draft, setDraft] = useState(title)

  if (!canWrite) {
    return <h1 className="text-lg font-semibold tracking-tight text-text-1">{title}</h1>
  }

  return (
    <input
      aria-label="Issue title"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onSave(draft.trim())}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          setDraft(title)
          event.currentTarget.blur()
        }
      }}
      className="w-full bg-transparent text-lg font-semibold tracking-tight text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-control"
    />
  )
}

function MetaMenu({
  trigger,
  ariaLabel,
  disabled = false,
  children,
}: {
  trigger: ReactNode
  ariaLabel: string
  disabled?: boolean
  closeOnSelect?: boolean
  children: ReactNode
}) {
  if (disabled) {
    return (
      <PropertyButton disabled aria-label={ariaLabel}>
        {trigger}
      </PropertyButton>
    )
  }
  return (
    <Menu>
      <MenuTrigger render={<PropertyButton aria-label={ariaLabel}>{trigger}</PropertyButton>} />
      <MenuContent className="max-h-72 overflow-y-auto">{children}</MenuContent>
    </Menu>
  )
}

function CommentThread({
  issueId,
  comments,
  canWrite,
}: {
  issueId: string
  comments: readonly CommentRow[]
  canWrite: boolean
}) {
  const zero = useZero()
  const { userId, canManage } = useMembership()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)

  const run = useCallback(async (write: ReturnType<typeof zero.mutate>) => {
    const failure = await runMutation(write)
    setError(failure)
  }, [])

  const post = useCallback(
    (doc: RichTextValue) => {
      const now = Date.now()
      return runMutation(
        zero.mutate(
          mutators.comment.create({
            id: newId(),
            issueId,
            body: doc as unknown as ReadonlyJSONValue,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      )
    },
    [issueId, zero],
  )

  return (
    <DetailSection title={`Comments${comments.length > 0 ? ` · ${comments.length}` : ''}`}>
      <div className="flex flex-col gap-4">
        {comments.length === 0 ? (
          <p className="text-sm text-text-3">No comments yet.</p>
        ) : (
          comments.map((comment) => {
            const authorName = comment.author?.name ?? comment.author?.email ?? comment.authorId
            const mine = comment.authorId === userId
            const editing = editingId === comment.id
            return (
              <CommentCard
                key={comment.id}
                authorName={authorName}
                authorImage={comment.author?.image ?? null}
                timestamp={formatWhen(comment.createdAt)}
                edited={comment.updatedAt > comment.createdAt}
                actions={
                  (mine || canManage) && !editing ? (
                    <>
                      <Button variant="ghost" size="xs" onClick={() => setEditingId(comment.id)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          void run(zero.mutate(mutators.comment.delete({ id: comment.id })))
                        }
                      >
                        Delete
                      </Button>
                    </>
                  ) : null
                }
              >
                {editing ? (
                  <RichTextEditor
                    key={`${comment.id}-edit`}
                    ariaLabel="Edit comment"
                    autoFocus
                    minHeight="3rem"
                    defaultValue={comment.body as RichTextValue}
                    onSubmit={(doc) => {
                      void run(
                        zero.mutate(
                          mutators.comment.edit({
                            id: comment.id,
                            body: doc as unknown as ReadonlyJSONValue,
                            updatedAt: Date.now(),
                          }),
                        ),
                      )
                      setEditingId(null)
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <RichTextRenderer value={comment.body as RichTextValue} />
                )}
              </CommentCard>
            )
          })
        )}

        {canWrite ? <CommentComposer onPost={post} onError={setError} /> : null}
        {error !== undefined ? (
          <p className="text-xs text-status-urgent" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </DetailSection>
  )
}

function CommentComposer({
  onPost,
  onError,
}: {
  onPost: (doc: RichTextValue) => Promise<string | undefined>
  onError: (message: string | undefined) => void
}) {
  const [draft, setDraft] = useState<RichTextValue | null>(null)
  const [seq, setSeq] = useState(0)
  const empty = isRichTextEmpty(draft)

  async function submit(doc: RichTextValue) {
    if (isRichTextEmpty(doc)) return
    const failure = await onPost(doc)
    onError(failure)
    if (failure === undefined) {
      setDraft(null)
      setSeq((value) => value + 1)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <RichTextEditor
        key={seq}
        ariaLabel="Add a comment"
        placeholder="Leave a comment…"
        minHeight="3rem"
        onChange={setDraft}
        onSubmit={submit}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={empty}
          onClick={() => {
            if (draft) void submit(draft)
          }}
        >
          Comment
        </Button>
        <span className="text-[11px] text-text-3">⌘↵ to send</span>
      </div>
    </div>
  )
}
