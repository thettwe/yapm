import type { ReadonlyJSONValue } from '@rocicorp/zero'
import { useQuery, useZero } from '@rocicorp/zero/react'
import { Link } from '@tanstack/react-router'
import {
  buildIssueTimeline,
  type DivergenceKind,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssueMoment,
  type IssuePriority,
  type IssueStatus,
  latestMoment,
  mutators,
  newId,
  type PullRequestState,
  queries,
  type RestPhrase,
  type ReviewState,
} from '@yapm/schema'
import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import { Button } from '@yapm/ui/components/button'
import { CommentCard } from '@yapm/ui/components/comment'
import { DetailField, DetailSection, PropertyButton } from '@yapm/ui/components/detail-field'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@yapm/ui/components/menu'
import { PriorityMark } from '@yapm/ui/components/priority-mark'
import { ProvenanceMark } from '@yapm/ui/components/provenance-mark'
import { buildRailShape, RealityTrack } from '@yapm/ui/components/reality-track'
import { RestPhraseText } from '@yapm/ui/components/rest-phrase'
import {
  isRichTextEmpty,
  type MentionCandidate,
  RichTextEditor,
  RichTextRenderer,
  type RichTextValue,
} from '@yapm/ui/components/rich-text'
import { Sheet } from '@yapm/ui/components/sheet'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
import {
  CheckIcon,
  ChevronLeftIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  TagIcon,
  UserIcon,
  UserXIcon,
  XIcon,
} from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMembership } from '@/auth/use-membership'
import { useCommandSource } from '@/frame/command-registry'
import { Masthead } from '@/frame/masthead'
import { FilesSection } from '@/issues/attachments/files-section'
import { attachmentSrc, uploadAttachment } from '@/issues/attachments/upload'
import { deliveryView, type LinkedIssueRow, linkedEntitiesFor } from '@/issues/delivery'
import { useDescriptionAutosave } from '@/issues/description-autosave'
import { FollowControl } from '@/issues/follow-control'
import { buildMentionables, mentionNamesFor } from '@/issues/mentionables'
import {
  isPendingNumber,
  issueKey,
  PRIORITY_LABEL,
  PRIORITY_TO_KIND,
  STATUS_LABEL,
  STATUS_TO_KIND,
} from '@/issues/model'
import {
  type ActivityEntry,
  agoPhrase,
  buildActivity,
  buildRailView,
  linkSourceWord,
  momentsForChange,
  monoSubline,
  shortSha,
} from '@/issues/timeline-view'
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

interface CiCheckRow {
  id?: string
  name?: string | null
  conclusion: string
}

interface ReviewRow {
  id?: string
  author?: string | null
  state: ReviewState
  submittedAt: number
}

interface LinkedPrRow {
  id: string
  number: number
  title?: string | null
  state: PullRequestState
  url?: string | null
  repo: string
  headSha?: string | null
  mergeCommitSha?: string | null
  openedAt: number
  mergedAt?: number | null
  ciChecks?: readonly CiCheckRow[]
  reviews?: readonly ReviewRow[]
}

interface IssueLinkDetailRow {
  source: string
  createdAt: number
  pullRequest?: LinkedPrRow | null
}

interface DeploymentRow {
  id: string
  repo: string
  environment?: string | null
  state: string
  ref?: string | null
  sha?: string | null
  deployedAt?: number | null
  updatedAt: number
}

interface CycleRow {
  id: string
  name: string
  number?: number | null
  startDate?: number | null
  endDate?: number | null
}

const PR_STATE_LABEL: Record<PullRequestState, string> = {
  draft: 'Draft',
  open: 'Open',
  merged: 'Merged',
  closed: 'Closed',
}

// `page` draws the mock's two columns — the document beside the delivery rail. `sheet` stacks the
// same sections at the panel's measure. Every section below is ONE component: the two layouts differ
// in where they place them and in nothing else, so a capability cannot exist on one and not the
// other.
export type IssueDetailLayout = 'page' | 'sheet'

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
      <IssueDetail issueId={issueId} teamId={teamId} layout="sheet" onClose={onClose} />
    </Sheet>
  )
}

export function IssueDetail({
  issueId,
  teamId,
  layout = 'sheet',
  onClose,
}: {
  issueId: string
  teamId: string
  layout?: IssueDetailLayout
  onClose?: () => void
}) {
  const [issue, result] = useQuery(queries.issues.detail({ id: issueId }))
  const [teams] = useQuery(queries.teams.all())
  const [users] = useQuery(queries.users.all())
  const [labels] = useQuery(queries.labels.byTeam({ teamId }))
  const [cycles] = useQuery(queries.cycles.byTeam({ teamId }))
  const [deployments] = useQuery(queries.deployments.byTeam({ teamId }))
  // Already synced by `useMembership`, so reading it here costs no new subscription and no
  // network round trip — it is what tells the `@` list which non-members are workspace admins.
  const [workspaceMembers] = useQuery(queries.members.all())
  const { canWrite, userId } = useMembership()

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

  // The same `MemberOption[]` the assignee menu is built from, widened with the workspace roster.
  const mentionables = useMemo(
    () =>
      buildMentionables({
        teamMembers: members,
        workspaceMembers,
        users,
        selfId: userId,
      }),
    [members, workspaceMembers, users, userId],
  )

  // The whole roster, unlike `mentionNames`: an uploader's name is a fact about a row in the Files
  // list, not a claim that they can read the issue, so it does not carry the mention scoping.
  const userNames = useMemo(
    () => new Map(users.map((user) => [user.id, user.name ?? user.email ?? user.id])),
    [users],
  )

  // Scoped to the people who can read this issue, not to the whole roster: a mention of somebody
  // who cannot read it must render as inert text rather than as a resolved chip.
  const mentionNames = useMemo(
    () =>
      mentionNamesFor({
        teamMembers: members,
        workspaceMembers,
        users,
        selfId: userId,
      }),
    [members, workspaceMembers, users, userId],
  )

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

  const record = issue as unknown as IssueRecord
  const cycle = (cycles as readonly CycleRow[]).find((row) => row.id === record.cycleId) ?? null

  return (
    <IssueDetailBody
      key={issueId}
      issue={record}
      teamId={teamId}
      teamKey={teamKey}
      layout={layout}
      members={members}
      mentionables={mentionables}
      mentionNames={mentionNames}
      userNames={userNames}
      labelOptions={labels.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      }))}
      cycleOptions={cycles.map((row) => ({
        id: row.id,
        name: row.name,
        number: row.number ?? null,
      }))}
      cycle={cycle}
      deployments={deployments as readonly DeploymentRow[]}
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
  cycleId: string | null
  creatorId: string
  createdAt: number
  updatedAt: number
  cycleAssignedAt?: number | null
  carryoverCount?: number | null
  lastHumanStatusAt?: number | null
  assignee?: {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
  } | null
  creator?: { id: string; name?: string | null; email?: string | null } | null
  labels?: readonly LabelRow[]
  comments?: readonly CommentRow[]
  issueLinks?: readonly IssueLinkDetailRow[]
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

interface CycleOption {
  id: string
  name: string
  number: number | null
}

// The keyboard hint the mock draws inside a button. Decorative: the button's own accessible name
// carries the action, and the key it advertises is the one the browser already binds to a focused
// button — this page adds no document-level listener, because the frame owns that layer.
function KeyHint({ children, onAccent }: { children: string; onAccent?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'ml-1 rounded-[4px] border px-1 font-mono text-[10px] leading-[1.4]',
        // No opacity on the ink. On the accent fill the readable pair is `--on-accent` over
        // `--accent`, which `contrast.test.ts` pins at AA — an alpha modifier steps that one
        // guaranteed pair down below it in five of the six theme blocks, and no token assertion
        // can see an opacity class. The hint stays quiet through its size, not through its ink.
        onAccent
          ? 'border-primary-foreground/75 text-primary-foreground'
          : 'border-border-strong text-text-2',
      )}
    >
      {children}
    </span>
  )
}

function IssueDetailBody({
  issue,
  teamId,
  teamKey,
  layout,
  members,
  mentionables,
  mentionNames,
  userNames,
  labelOptions,
  cycleOptions,
  cycle,
  deployments,
  canWrite,
  onClose,
}: {
  issue: IssueRecord
  teamId: string
  teamKey: string
  layout: IssueDetailLayout
  members: readonly MemberOption[]
  mentionables: readonly MentionCandidate[]
  mentionNames: ReadonlyMap<string, string>
  userNames: ReadonlyMap<string, string>
  labelOptions: readonly LabelRow[]
  cycleOptions: readonly CycleOption[]
  cycle: CycleRow | null
  deployments: readonly DeploymentRow[]
  canWrite: boolean
  onClose?: () => void
}) {
  const zero = useZero()
  const pending = isPendingNumber(issue)
  const key = issueKey(teamKey, issue)
  const currentLabels = (issue.labels ?? []) as readonly LabelRow[]
  const currentLabelIds = new Set(currentLabels.map((label) => label.id))
  const issueLinks = (issue.issueLinks ?? []) as readonly IssueLinkDetailRow[]

  const view = deliveryView(
    issue,
    linkedEntitiesFor(issueLinks as readonly LinkedIssueRow[], deployments),
  )
  const divergence = view.divergence

  // ONE clock for the whole page. The rail and the feed read the same moment list, so a moment
  // cannot be 22h old in the right column and a day old in the left one.
  const { timeline, now } = useMemo(() => {
    const at = Date.now()
    return {
      now: at,
      timeline: buildIssueTimeline(
        {
          issue: {
            createdAt: issue.createdAt,
            creatorId: issue.creatorId,
            cycleAssignedAt: issue.cycleAssignedAt ?? null,
            cycleId: issue.cycleId,
            carryoverCount: issue.carryoverCount ?? 0,
          },
          links: issueLinks as never,
          deployments: deployments as never,
          cycle,
        },
        at,
      ),
    }
  }, [issue, issueLinks, deployments, cycle])

  // The moments belonging to the change the delivery signal describes. The plain register's phrase
  // was computed over ONE pull request; the mono register, the rail and the callout's evidence read
  // the same one, so an issue with two linked changes cannot have its two registers describing two
  // different changes as though they were one. The feed keeps the whole list.
  const changeTimeline = useMemo(
    () => momentsForChange(timeline, view.pullRequestId),
    [timeline, view.pullRequestId],
  )

  const [dismissed, setDismissed] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  // Where the keyboard lands when a control unmounts under it: the callout's two actions, the
  // masthead's Mark Done, and the palette entry that does the same thing. Each removes the element
  // holding focus, and focus dropped to `<body>` is a keyboard reader losing their place in the one
  // flow that is keyboard-only. The Delivery section is the deliberate landing: it is the thing all
  // four were talking about, and it survives every outcome.
  const deliveryRef = useRef<HTMLElement | null>(null)
  const landOnDelivery = useCallback(() => {
    deliveryRef.current?.focus()
  }, [])

  const run = useCallback(async (write: ReturnType<typeof zero.mutate>) => {
    const failure = await runMutation(write)
    setError(failure)
  }, [])

  const setStatus = useCallback(
    (status: IssueStatus) =>
      void run(
        zero.mutate(mutators.issue.setStatus({ id: issue.id, status, updatedAt: Date.now() })),
      ),
    [issue.id, run, zero],
  )
  const setPriority = (priority: IssuePriority) =>
    void run(
      zero.mutate(mutators.issue.setPriority({ id: issue.id, priority, updatedAt: Date.now() })),
    )
  const assign = (assigneeId: string | null) =>
    void run(
      zero.mutate(mutators.issue.assign({ id: issue.id, assigneeId, updatedAt: Date.now() })),
    )
  const setCycle = (cycleId: string | null) =>
    void run(zero.mutate(mutators.issue.setCycle({ id: issue.id, cycleId, updatedAt: Date.now() })))
  const currentCycleName =
    cycleOptions.find((option) => option.id === issue.cycleId)?.name ??
    (issue.cycleId ? 'Unknown' : 'No cycle')
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
  // authoritative write is debounced so a burst of keystrokes settles into one update.
  const description = (issue.description as RichTextValue | null) ?? null

  const commitDescription = useCallback(
    (doc: RichTextValue) => {
      void run(
        zero.mutate(
          mutators.issue.update({
            id: issue.id,
            description: doc as unknown as ReadonlyJSONValue,
            updatedAt: Date.now(),
          }),
        ),
      )
    },
    [issue.id, run, zero],
  )

  // The synced document is passed in, not just the callback: an armed debounce has to be cancelled
  // when that document turns out to hold something this bundle cannot represent.
  const { save: saveDescription } = useDescriptionAutosave(description, commitDescription)

  // Bound to THIS issue and THIS team, so `packages/ui` never learns either. The editor's whole
  // knowledge of uploading is a callback that answers with an opaque id or a reason.
  const uploadImage = useCallback(
    (file: File) => uploadAttachment({ file, teamId, issueId: issue.id }),
    [teamId, issue.id],
  )

  const assigneeName =
    issue.assignee?.name ?? issue.assignee?.email ?? (issue.assigneeId ? 'Unknown' : 'Unassigned')
  const creatorName = issue.creator?.name ?? issue.creator?.email ?? null

  const titleField = (
    <TitleField
      title={issue.title}
      canWrite={canWrite}
      as={layout === 'page' ? 'inline' : 'heading'}
      onSave={saveTitle}
    />
  )

  const markDone = canWrite && issue.status !== 'done' && issue.status !== 'canceled'

  // ⌘K belongs to the frame. This surface REGISTERS what it can do and binds no listener of its
  // own — the same contract every other palette-bearing surface signed in `app-frame`.
  const firstChangeUrl = issueLinks.find((link) => link.pullRequest?.url)?.pullRequest?.url ?? null
  const commandGroups = useMemo(
    () => [
      {
        id: 'issue-detail',
        heading: 'This issue',
        commands: [
          ...(markDone
            ? [
                {
                  id: 'issue-detail-mark-done',
                  label: 'Mark done',
                  onSelect: () => {
                    setStatus('done')
                    landOnDelivery()
                  },
                },
              ]
            : []),
          ...(firstChangeUrl === null
            ? []
            : [
                {
                  id: 'issue-detail-open-change',
                  label: 'Open the change',
                  onSelect: () => window.open(firstChangeUrl, '_blank', 'noreferrer'),
                },
              ]),
        ],
      },
    ],
    [markDone, firstChangeUrl, setStatus, landOnDelivery],
  )
  useCommandSource('issue-detail', { groups: commandGroups })

  const documentColumn = (
    <>
      <DetailSection title="Description">
        {canWrite ? (
          <RichTextEditor
            key={issue.id}
            ariaLabel="Issue description"
            placeholder="Add a description…"
            minHeight="7rem"
            defaultValue={description}
            mentionables={mentionables}
            mentionNames={mentionNames}
            resolveAttachmentSrc={attachmentSrc}
            onUploadImage={uploadImage}
            onChange={saveDescription}
          />
        ) : description ? (
          <RichTextRenderer
            value={description}
            mentionNames={mentionNames}
            resolveAttachmentSrc={attachmentSrc}
          />
        ) : (
          <p className="text-sm text-text-3">No description.</p>
        )}
      </DetailSection>

      <FilesSection issueId={issue.id} teamId={teamId} canWrite={canWrite} userNames={userNames} />

      <ActivitySection timeline={timeline} creatorName={creatorName} />

      <CommentThread
        issueId={issue.id}
        comments={(issue.comments ?? []) as readonly CommentRow[]}
        canWrite={canWrite}
        mentionables={mentionables}
        mentionNames={mentionNames}
        onUploadImage={uploadImage}
      />
    </>
  )

  const rail = (
    <>
      <DeliveryRail
        sectionRef={deliveryRef}
        timeline={changeTimeline}
        divergence={divergence}
        cycleName={cycle?.name ?? null}
      />

      {divergence !== null && !dismissed ? (
        <DivergenceCallout
          phrase={view.phrase}
          status={issue.status}
          divergence={divergence}
          timeline={changeTimeline}
          lastHumanStatusAt={issue.lastHumanStatusAt ?? null}
          updatedAt={issue.updatedAt}
          now={now}
          canWrite={canWrite}
          onConfirm={() => {
            setStatus('done')
            landOnDelivery()
          }}
          onDismiss={() => {
            setDismissed(true)
            landOnDelivery()
          }}
        />
      ) : null}

      <ReferencedIn links={issueLinks} />

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
              <MenuItem key={status} className="justify-between" onClick={() => setStatus(status)}>
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

        <DetailField label="Cycle">
          <MetaMenu
            disabled={!canWrite || cycleOptions.length === 0}
            ariaLabel={`Cycle: ${currentCycleName}`}
            trigger={
              <>
                <RefreshCwIcon className="size-4 text-text-3" />
                {currentCycleName}
              </>
            }
          >
            <MenuItem onClick={() => setCycle(null)}>No cycle</MenuItem>
            {cycleOptions.map((option) => (
              <MenuItem
                key={option.id}
                className="justify-between"
                onClick={() => setCycle(option.id)}
              >
                <span className="flex items-center gap-2">
                  <RefreshCwIcon className="size-3.5 text-text-3" />
                  {option.name}
                </span>
                {option.id === issue.cycleId ? (
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

        {/* The full page carries Follow in band 2, where the mock draws it; the panel has no band 2
            of its own, so the control lives here. Available to viewers either way: a viewer can be
            mentioned, so a viewer is auto-subscribed and must be able to stop. */}
        {layout === 'page' ? null : (
          <DetailField label="Updates">
            <FollowControl issueId={issue.id} />
          </DetailField>
        )}
      </DetailSection>
    </>
  )

  const subline = (
    <TwoRegisterSubline
      status={issue.status}
      phrase={view.phrase}
      cycleName={cycle?.name ?? (issue.cycleId ? currentCycleName : null)}
      labels={currentLabels}
      timeline={changeTimeline}
      divergence={divergence}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {layout === 'page' ? (
        <Masthead
          kicker={
            <>
              <Link
                to="/teams/$teamId/issues"
                params={{ teamId }}
                search={{}}
                className="inline-flex items-center gap-1 rounded-control text-[12.5px] text-text-2 hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <ChevronLeftIcon className="size-3.5" aria-hidden="true" />
                Issues
              </Link>
              <span
                className="font-mono text-[12.5px] text-text-2"
                data-pending={pending || undefined}
                data-testid="detail-key"
              >
                {key}
              </span>
              {divergence === null ? null : <DivergencePill phrase={view.phrase} />}
            </>
          }
          title={titleField}
          actions={
            <>
              <FollowControl issueId={issue.id} />
              {markDone ? (
                <Button
                  size="sm"
                  data-testid="masthead-mark-done"
                  // Marking done removes this button — the issue is done, so `markDone` is false and
                  // the action is gone. Same unmount-under-the-focus as the callout's two actions,
                  // so the same landing: `<body>` is not where a keyboard reader may be left.
                  onClick={() => {
                    setStatus('done')
                    landOnDelivery()
                  }}
                >
                  Mark Done
                  <KeyHint onAccent>⏎</KeyHint>
                </Button>
              ) : null}
            </>
          }
          meta={subline}
        />
      ) : (
        <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <StatusGlyph status={STATUS_TO_KIND[issue.status]} />
          <span
            className="font-mono text-xs text-text-2"
            data-pending={pending || undefined}
            data-testid="detail-key"
          >
            {key}
          </span>
          {divergence === null ? null : <DivergencePill phrase={view.phrase} compact />}
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
            {onClose ? (
              <Button variant="ghost" size="icon-sm" aria-label="Close issue" onClick={onClose}>
                <XIcon />
              </Button>
            ) : null}
          </span>
        </header>
      )}

      {layout === 'page' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-7 px-5 py-6 lg:px-10">
            {documentColumn}
          </div>
          <div className="flex w-full shrink-0 flex-col gap-5 border-t border-border px-5 py-6 lg:w-[26rem] lg:border-t-0 lg:border-l lg:px-9">
            {rail}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
          {titleField}
          {subline}
          {documentColumn}
          {rail}
        </div>
      )}

      {error !== undefined ? (
        <div className="border-t border-border px-4 py-2 text-xs text-status-urgent" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  )
}

// The pill is the dictionary's own string with the dictionary's own urgency — never a colour on its
// own, which is why the text is what carries it and `RestPhraseText` decides the ink.
function DivergencePill({ phrase, compact }: { phrase: RestPhrase; compact?: boolean }) {
  if (phrase.text === null) return null
  return (
    <span
      data-testid="divergence-pill"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border border-accent-line bg-urgent-soft px-2.5 py-0.5',
        compact ? 'text-[11.5px]' : 'text-[12px]',
      )}
    >
      <RestPhraseText phrase={phrase} />
    </span>
  )
}

// THE TWO REGISTERS. One sentence a PM reads, one mono line an engineer reads, both built from ONE
// delivery signal and ONE timeline — so a fact stated in one and not supported by the other is a
// bug rather than a style. `ia.html`'s word diet allows the mono register on the detail and nowhere
// else, which is why this component lives here and is not exported.
function TwoRegisterSubline({
  status,
  phrase,
  cycleName,
  labels,
  timeline,
  divergence,
}: {
  status: IssueStatus
  phrase: RestPhrase
  cycleName: string | null
  labels: readonly LabelRow[]
  timeline: readonly IssueMoment[]
  divergence: DivergenceKind | null
}) {
  const mono = monoSubline(timeline, divergence)
  return (
    <div className="flex w-full flex-col gap-[3px]" data-testid="issue-subline">
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-text-1"
        data-testid="subline-say"
      >
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <StatusGlyph status={STATUS_TO_KIND[status]} />
          {STATUS_LABEL[status]}
        </span>
        {cycleName === null ? null : (
          <>
            <Divider />
            <span className="text-text-2">{cycleName}</span>
          </>
        )}
        {labels.map((label) => (
          <span key={label.id} className="inline-flex items-center gap-1.5 text-text-2">
            <Divider />
            <span
              aria-hidden="true"
              className="size-[7px] rounded-full"
              style={{ backgroundColor: label.color }}
            />
            {label.name}
          </span>
        ))}
        {phrase.text === null ? null : (
          <>
            <Divider />
            <RestPhraseText phrase={phrase} />
          </>
        )}
      </div>
      {mono === null ? null : (
        <div
          className="flex items-center gap-1 font-mono text-[11px] text-text-2"
          data-testid="subline-git"
        >
          {mono.text}
          {mono.sourced ? <ProvenanceMark provider="github" size={12} /> : null}
        </div>
      )}
    </div>
  )
}

function Divider() {
  return (
    <span aria-hidden="true" className="text-border-strong">
      ·
    </span>
  )
}

function SectionHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline border-b border-border pb-2">
      <h2 className="font-ui text-[11px] font-semibold tracking-[0.09em] text-text-2 uppercase">
        {title}
      </h2>
      {aside === undefined ? null : <span className="ml-auto">{aside}</span>}
    </div>
  )
}

// The vertical rail, mounted from the shared vocabulary — one station per moment that happened, and
// no station for one that did not. There is no DESIGNED station: nothing in the work graph records a
// design artefact, so neither the rail nor the chain in its header may promise one.
function DeliveryRail({
  timeline,
  divergence,
  cycleName,
  sectionRef,
}: {
  timeline: readonly IssueMoment[]
  divergence: DivergenceKind | null
  cycleName: string | null
  sectionRef?: RefObject<HTMLElement | null>
}) {
  const view = useMemo(() => buildRailView(timeline, cycleName), [timeline, cycleName])
  const shape = useMemo(
    () => buildRailShape(view.stations, { divergence }),
    [view.stations, divergence],
  )
  return (
    // `tabIndex={-1}` makes this a landing place, not a tab stop: the callout's actions send focus
    // here as they unmount, and a reader tabbing through the page never has to pass through it.
    <section
      ref={sectionRef}
      aria-label="Delivery"
      tabIndex={-1}
      className="rounded-control outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
    >
      <SectionHead
        title="Delivery"
        aside={
          <span className="font-mono text-[10px] tracking-[0.02em] text-text-2">{view.chain}</span>
        }
      />
      {/* The rail's knockout paints the surface it sits on; both layouts draw it on `--bg`. */}
      <RealityTrack orientation="vertical" surface="bg" shape={shape} label={view.label} />
    </section>
  )
}

const DIVERGENCE_SLUG: Record<IssueStatus, string> = {
  backlog: 'backlog',
  todo: 'todo',
  in_progress: 'in-progress',
  in_review: 'in-review',
  done: 'done',
  canceled: 'canceled',
}

// The callout's evidence, in the register that can be checked: what the board says and when a human
// last said it, against what git did and when. `lastHumanStatusAt` is the honest left-hand side; a
// row that predates the column degrades to `updatedAt` AND SAYS SO, rather than printing a set-time
// nothing recorded.
function divergenceEvidence({
  status,
  divergence,
  timeline,
  lastHumanStatusAt,
  updatedAt,
  now,
}: {
  status: IssueStatus
  divergence: DivergenceKind
  timeline: readonly IssueMoment[]
  lastHumanStatusAt: number | null
  updatedAt: number
  now: number
}): string {
  const merged = latestMoment(timeline, 'merged')
  const opened = latestMoment(timeline, 'change_opened')
  const left =
    lastHumanStatusAt === null
      ? `${DIVERGENCE_SLUG[status]} · issue updated ${agoPhrase(now - updatedAt)}`
      : `${DIVERGENCE_SLUG[status]} set ${agoPhrase(now - lastHumanStatusAt)}`
  if (divergence === 'status_ahead_of_pr') return `${left} ≠ no open change`
  if (divergence === 'done_but_ci_failing') {
    const where = merged?.mergeCommitSha ?? opened?.headSha ?? null
    return `${left} ≠ checks failing${where === null ? '' : ` on ${shortSha(where)}`}`
  }
  if (merged === null) return left
  return `${left} ≠ merge ${shortSha(merged.mergeCommitSha) ?? 'no sha recorded'}, ${agoPhrase(merged.ageMs)}`
}

function divergenceSentence(
  status: IssueStatus,
  divergence: DivergenceKind,
  timeline: readonly IssueMoment[],
): string {
  const merged = latestMoment(timeline, 'merged')
  const label = STATUS_LABEL[status]
  if (divergence === 'status_ahead_of_pr') {
    return `Status says ${label} — no open change backs it.`
  }
  if (divergence === 'done_but_ci_failing') {
    return `Status says ${label} — the linked change has failing checks.`
  }
  if (merged === null) return `Status says ${label} — the change has already merged.`
  const checks =
    merged.checksTotal === 0
      ? ''
      : merged.checksHealth === 'passing'
        ? ' with every check green'
        : merged.checksHealth === 'failing'
          ? ' with checks failing'
          : ' with checks still reporting'
  return `Status says ${label} — the change merged ${agoPhrase(merged.ageMs)}${checks}.`
}

// Two real buttons, both in the focus order. ⏎ and esc are handled INSIDE this callout's own key
// scope — never on `document`, because ⌘K and the frame own the global layer and a second global
// listener is how that ownership was lost last time.
//
// "Keep as is" writes NOTHING. There is no acknowledged column to write to, and there should not
// be: the divergence is still true after the reader dismisses the callout, so the pill, the `//`
// break and the phrase at rest all stay exactly where they were.
function DivergenceCallout({
  phrase,
  status,
  divergence,
  timeline,
  lastHumanStatusAt,
  updatedAt,
  now,
  canWrite,
  onConfirm,
  onDismiss,
}: {
  phrase: RestPhrase
  status: IssueStatus
  divergence: DivergenceKind
  timeline: readonly IssueMoment[]
  lastHumanStatusAt: number | null
  updatedAt: number
  now: number
  canWrite: boolean
  onConfirm: () => void
  onDismiss: () => void
}) {
  // Only one divergence has an honest board-side repair: the merge already happened, so Done is
  // simply true. A red check is not fixed by a status, and an in-review issue with no change behind
  // it needs a change, not a click — those states state themselves and offer only the dismissal.
  const confirmable = canWrite && divergence === 'status_behind_merge'

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      // A focused button already turns Enter and Space into a click; handling it again here would
      // fire the mutation twice.
      if (event.target instanceof HTMLButtonElement && event.key !== 'Escape') return
      if (event.key === 'Enter' && confirmable) {
        event.preventDefault()
        onConfirm()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
      }
    },
    [confirmable, onConfirm, onDismiss],
  )

  return (
    <section
      data-testid="divergence-callout"
      aria-label={phrase.text ?? 'Reality and the board disagree'}
      onKeyDown={onKeyDown}
      className="rounded-card border border-accent-line bg-urgent-soft px-4 py-3"
    >
      <h2 className="text-[13px] font-bold text-status-urgent-ink">{phrase.text}</h2>
      <p className="mt-1.5 text-[13px] leading-[1.55] text-text-1">
        {divergenceSentence(status, divergence, timeline)}
      </p>
      <p className="mt-1.5 font-mono text-[11px] text-text-2" data-testid="divergence-evidence">
        {divergenceEvidence({ status, divergence, timeline, lastHumanStatusAt, updatedAt, now })}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirmable ? (
          <Button size="sm" data-testid="callout-confirm" onClick={onConfirm}>
            Mark Done
            <KeyHint onAccent>⏎</KeyHint>
          </Button>
        ) : null}
        <Button variant="outline" size="sm" data-testid="callout-dismiss" onClick={onDismiss}>
          Keep as is
          <KeyHint>esc</KeyHint>
        </Button>
      </div>
    </section>
  )
}

// Every entry is a durable timestamp saying what it is. There is deliberately NO status-transition
// entry: the board keeps `lastHumanStatusAt` and nothing else, so "board todo → in-progress" is a
// history yapm does not have.
function ActivitySection({
  timeline,
  creatorName,
}: {
  timeline: readonly IssueMoment[]
  creatorName: string | null
}) {
  const entries = useMemo(() => buildActivity(timeline, { creatorName }), [timeline, creatorName])
  if (entries.length === 0) return null
  return (
    <section aria-label="Activity" data-testid="issue-activity">
      <SectionHead title="Activity" />
      <ol className="flex flex-col">
        {entries.map((entry) => (
          <ActivityRow key={entry.id} entry={entry} />
        ))}
      </ol>
    </section>
  )
}

const TONE_CLASS: Record<ActivityEntry['tone'], string> = {
  plain: 'bg-border-strong',
  link: 'bg-status-in-review',
  warm: 'bg-status-in-progress',
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <li className="flex gap-3 border-t border-row-hairline py-2.5 last:border-b">
      <span
        aria-hidden="true"
        className={cn('mt-[5px] size-[7px] flex-none rounded-full', TONE_CLASS[entry.tone])}
      />
      <span className="min-w-0">
        <span className="block text-[13px] text-text-1">
          {entry.say}
          <span className="ml-2 text-[12px] text-text-2">{agoPhrase(entry.ageMs)}</span>
        </span>
        {entry.fact === null ? null : (
          <span className="mt-0.5 block font-mono text-[11px] text-text-2">{entry.fact}</span>
        )}
      </span>
    </li>
  )
}

// Only what genuinely exists: the changes linked to this issue, and how yapm knows they are linked.
// There is no issue<->issue link table, no mention edge and no path from an issue to a retro action,
// so the mock's cycle-report / decision / retro rows have nothing behind them and this block FOLDS
// AWAY ENTIRELY rather than standing over an empty state.
function ReferencedIn({ links }: { links: readonly IssueLinkDetailRow[] }) {
  const rows = links.filter((link) => link.pullRequest != null)
  if (rows.length === 0) return null
  return (
    <section aria-label="Referenced in" data-testid="referenced-in">
      <SectionHead title="Referenced in" aside={<CountMark value={rows.length} />} />
      <ul className="flex flex-col">
        {rows.map((link) => {
          const pr = link.pullRequest as LinkedPrRow
          return (
            <li
              key={pr.id}
              className="flex flex-col gap-0.5 border-t border-row-hairline py-2 first:border-t-0"
            >
              <span className="flex items-center gap-2">
                <ProvenanceMark provider="github" size={13} label={null} />
                {pr.url ? (
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-control font-mono text-[11.5px] text-accent-strong hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {pr.repo}#{pr.number}
                    <ExternalLinkIcon className="size-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="font-mono text-[11.5px] text-text-1">
                    {pr.repo}#{pr.number}
                  </span>
                )}
                <span className="ml-auto font-mono text-[10.5px] text-text-2">
                  {PR_STATE_LABEL[pr.state]}
                </span>
              </span>
              <span className="font-mono text-[10.5px] text-text-2">
                {linkSourceWord(link.source)}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function CountMark({ value }: { value: number }) {
  return <span className="font-mono text-[10.5px] text-text-2">{value}</span>
}

// `as="heading"` in the panel, which has no band 2 of its own; `as="inline"` on the full page,
// where the shared `Masthead` supplies the heading this field sits inside. A second `<h1>` nested in
// the masthead's would be one heading too many in the document outline.
function TitleField({
  title,
  canWrite,
  as,
  onSave,
}: {
  title: string
  canWrite: boolean
  as: 'heading' | 'inline'
  onSave: (title: string) => void
}) {
  const [draft, setDraft] = useState(title)

  if (!canWrite) {
    const className = 'text-lg font-semibold tracking-tight text-text-1'
    return as === 'heading' ? (
      <h1 className={className}>{title}</h1>
    ) : (
      <span className={className}>{title}</span>
    )
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
      // `w-full` alone resolves against the masthead's auto-width `<h1>`, whose own width comes
      // from this input — circular, so the browser falls back to the ~20-character default and
      // clips the title. `size` gives the intrinsic width the cycle needs to settle on.
      size={Math.max(24, draft.length + 1)}
      className="w-full rounded-control bg-transparent text-lg font-semibold tracking-tight text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
  mentionables,
  mentionNames,
  onUploadImage,
}: {
  issueId: string
  comments: readonly CommentRow[]
  canWrite: boolean
  mentionables: readonly MentionCandidate[]
  mentionNames: ReadonlyMap<string, string>
  onUploadImage: (file: File) => Promise<{ attachmentId: string } | { error: string }>
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
                    mentionables={mentionables}
                    mentionNames={mentionNames}
                    resolveAttachmentSrc={attachmentSrc}
                    onUploadImage={onUploadImage}
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
                  <RichTextRenderer
                    value={comment.body as RichTextValue}
                    mentionNames={mentionNames}
                    resolveAttachmentSrc={attachmentSrc}
                  />
                )}
              </CommentCard>
            )
          })
        )}

        {canWrite ? (
          <CommentComposer
            onPost={post}
            onError={setError}
            mentionables={mentionables}
            mentionNames={mentionNames}
            onUploadImage={onUploadImage}
          />
        ) : null}
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
  mentionables,
  mentionNames,
  onUploadImage,
}: {
  onPost: (doc: RichTextValue) => Promise<string | undefined>
  onError: (message: string | undefined) => void
  mentionables: readonly MentionCandidate[]
  mentionNames: ReadonlyMap<string, string>
  onUploadImage: (file: File) => Promise<{ attachmentId: string } | { error: string }>
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
        mentionables={mentionables}
        mentionNames={mentionNames}
        resolveAttachmentSrc={attachmentSrc}
        onUploadImage={onUploadImage}
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
        <span className="text-[11px] text-text-2">⌘↵ to send</span>
      </div>
    </div>
  )
}
