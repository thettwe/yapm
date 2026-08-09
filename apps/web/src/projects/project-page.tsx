import { useQuery } from '@rocicorp/zero/react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  buildDeploymentIndex,
  type DeploymentIndex,
  ISSUE_STATUSES,
  type IssueStatus,
  queries,
  type TeamDeploymentRow,
} from '@yapm/schema'
import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import { Door } from '@yapm/ui/components/door'
import { How } from '@yapm/ui/components/how'
import { IssueRow } from '@yapm/ui/components/issue-row'
import {
  buildRealityShape,
  formatReviewAge,
  RealityTrack,
  realityTrackLabel,
} from '@yapm/ui/components/reality-track'
import { RestPhraseText } from '@yapm/ui/components/rest-phrase'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import { cn } from '@yapm/ui/lib/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Masthead } from '@/frame/masthead'
import {
  DIVERGENCE_LABEL,
  deliveryView,
  type LinkedIssueRow,
  linkedEntitiesFor,
} from '@/issues/delivery'
import {
  formatRelative,
  type IssueRowData,
  issueKey,
  PRIORITY_TO_KIND,
  STATUS_LABEL,
  STATUS_TO_KIND,
} from '@/issues/model'
import {
  formatTargetDay,
  issueStateSegments,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TO_KIND,
  type ProjectRowData,
  pastTargetReading,
  projectProgress,
  targetStrip,
  teamSplit,
} from '@/projects/model'
import {
  EditProjectButton,
  initials,
  ScopeChip,
  type UserOption,
} from '@/projects/project-controls'

// Each issue status's own ink, as an SVG/box fill. The state bar is the one place a status hue is
// drawn as area rather than as a glyph, so the tokens are named here rather than borrowed from a
// text class.
const STATUS_FILL: Record<IssueStatus, string> = {
  backlog: 'bg-status-backlog',
  todo: 'bg-status-todo',
  in_progress: 'bg-status-in-progress',
  in_review: 'bg-status-in-review',
  done: 'bg-status-done',
  canceled: 'bg-text-3',
}

interface PageIssue extends IssueRowData {
  readonly teamId: string
  readonly teamKey: string
}

// The synced shape of one of this project's issues: the row plus the relations `projects.get`
// carries — its team (for the key), its labels, and the linked-delivery subtree the track reads.
interface RawPageIssue extends IssueRowData {
  readonly teamId: string
  readonly team?: { readonly id: string; readonly key: string } | null
  readonly issueLinks?: readonly LinkedIssueRow[]
  readonly labels?: readonly { id: string; name: string; color: string }[]
  readonly assignee?: {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
  } | null
}

export function ProjectPage({ teamId, projectId }: { teamId: string; projectId: string }) {
  const navigate = useNavigate()
  const [row, result] = useQuery(queries.projects.get({ id: projectId }))
  const [users] = useQuery(queries.users.all())
  const [workspace] = useQuery(queries.workspace.current())
  const [deployments, setDeployments] = useState<ReadonlyMap<string, readonly TeamDeploymentRow[]>>(
    () => new Map(),
  )

  const back = useCallback(() => {
    void navigate({ to: '/teams/$teamId/projects', params: { teamId }, search: {} })
  }, [navigate, teamId])

  // Leaveable from the keyboard. A dialog owns Escape while it is open, so the page stands back.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (document.querySelector('[role="dialog"]') !== null) return
      back()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [back])

  const publish = useCallback((team: string, rows: readonly TeamDeploymentRow[]) => {
    setDeployments((prev) => {
      if (sameRows(prev.get(team), rows)) return prev
      const next = new Map(prev)
      next.set(team, rows)
      return next
    })
  }, [])

  const rawIssues = useMemo(() => (row?.issues ?? []) as unknown as readonly RawPageIssue[], [row])

  // One subscription per team that ACTUALLY contributes an issue here. Without them the deploy
  // station cannot tell "not deployed" from "not synced", and the dictionary's deploy phrase would
  // be a claim the reader has no way to check.
  const contributingTeams = useMemo(() => {
    const ids = new Set<string>()
    for (const issue of rawIssues) ids.add(issue.teamId)
    return [...ids].sort()
  }, [rawIssues])

  const deployIndex = useMemo<DeploymentIndex>(
    () => buildDeploymentIndex([...deployments.values()].flat()),
    [deployments],
  )

  const issues = useMemo<PageIssue[]>(
    () =>
      rawIssues.map((issue) => ({
        id: issue.id,
        number: issue.number ?? null,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        assigneeId: issue.assigneeId ?? null,
        cycleId: issue.cycleId ?? null,
        updatedAt: issue.updatedAt,
        createdAt: issue.createdAt,
        teamId: issue.teamId,
        teamKey: issue.team?.key ?? '',
        labels: (issue.labels ?? []).map((label) => ({
          id: label.id,
          name: label.name,
          color: label.color,
        })),
        assignee: issue.assignee ?? null,
        linked: linkedEntitiesFor(issue.issueLinks, deployIndex),
      })),
    [rawIssues, deployIndex],
  )

  if (!row) {
    return (
      <p className="p-8 text-sm text-text-2" role="status">
        {result.type === 'complete' ? 'No such project' : 'Loading…'}
      </p>
    )
  }

  const project: ProjectRowData = {
    id: row.id,
    name: row.name,
    status: row.status,
    leadId: row.leadId ?? null,
    targetDate: row.targetDate ?? null,
    createdAt: row.createdAt,
  }
  const lead = row.lead as UserOption | null | undefined
  const leadName = lead ? (lead.name ?? lead.email ?? lead.id) : null
  const leadImage = (lead as { image?: string | null } | null | undefined)?.image ?? null

  const teamKeys = new Map(issues.map((issue) => [issue.teamId, issue.teamKey] as const))
  const split = teamSplit(issues, teamKeys)
  const progress = projectProgress(issues)
  const segments = issueStateSegments(issues)
  const past = pastTargetReading(project, issues, Date.now())
  const strip = targetStrip(project, Date.now())

  return (
    // Band 2 is the shared `Masthead`, adapted — never hand-rolled. `app-frame` deleted a
    // hand-rolled header from ten routes and the rule holds here: the breadcrumb is the kicker,
    // the status pill and the scope chip are the lens, Edit is the action, LEAD/TEAMS is the meta.
    <>
      <Masthead
        kicker={
          <span className="font-mono text-[11px] text-text-2">
            <Link
              to="/teams/$teamId/projects"
              params={{ teamId }}
              search={{}}
              data-testid="project-breadcrumb"
              className="rounded-control outline-none hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Door>Projects</Door>
            </Link>
            <span aria-hidden="true"> ›</span>
          </span>
        }
        title={
          <span className="flex items-center gap-2">
            <StatusGlyph
              status={PROJECT_STATUS_TO_KIND[project.status]}
              aria-hidden="true"
              className="size-4 flex-none"
            />
            {project.name}
          </span>
        }
        lens={
          <>
            <span className="inline-flex h-[21px] items-center rounded-pill bg-bg-hover px-2.5 font-semibold text-[11.5px] text-text-2">
              {PROJECT_STATUS_LABEL[project.status]}
            </span>
            <ScopeChip workspaceName={workspace?.name ?? null} />
          </>
        }
        actions={
          <EditProjectButton
            project={project}
            users={users as readonly UserOption[]}
            onDeleted={back}
          />
        }
        meta={
          <span className="flex items-center gap-6 text-[12.5px] text-text-2">
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] tracking-[0.06em] text-text-2">LEAD</span>
              {leadName === null ? (
                <span className="size-5" aria-hidden="true" />
              ) : (
                <>
                  <Avatar size="xs" title={leadName}>
                    {leadImage ? <AvatarImage src={leadImage} alt={leadName} /> : null}
                    <AvatarFallback aria-hidden="true">{initials(leadName)}</AvatarFallback>
                  </Avatar>
                  {leadName}
                </>
              )}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] tracking-[0.06em] text-text-2">TEAMS</span>
              <span className="font-mono text-[11.5px] text-text-2">
                {split.map((entry) => `${entry.teamKey} ${entry.count}`).join(' · ')}
              </span>
            </span>
          </span>
        }
      />
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg"
        data-testid="project-page"
      >
        {contributingTeams.map((id) => (
          <TeamDeploymentFeed key={id} teamId={id} publish={publish} />
        ))}

        <div className="mt-4 flex flex-wrap gap-14 px-10 pt-5">
          <section className="min-w-0 max-w-[660px] flex-1 pt-4" aria-label="Issues">
            <div className="flex items-baseline gap-2.5">
              <span className="font-bold text-[11px] tracking-[0.09em] text-text-1">ISSUES</span>
              <span className="font-mono text-[12px] text-text-2">{progress.total}</span>
              <span className="ml-auto">
                <How label="issues" align="end" constraint="teamScoped over this project's issues">
                  Every issue pointing at this project that is in a team you belong to. Done is the
                  issue's own status; canceled work counts toward the total, never toward done.
                </How>
              </span>
            </div>
            {progress.total === 0 ? (
              <p className="mt-3 text-sm text-text-2" data-testid="project-no-issues">
                No issues yet
              </p>
            ) : (
              <>
                <div className="mt-2.5 flex items-baseline gap-2.5">
                  <span
                    data-testid="project-done-count"
                    className="font-bold text-[28px] leading-none tracking-[-0.02em] text-text-1"
                  >
                    {progress.done}
                  </span>
                  <span className="font-semibold text-[15px] text-text-2">
                    /{progress.total} done
                  </span>
                </div>
                <div
                  data-testid="project-state-bar"
                  role="img"
                  aria-label={segments
                    .map((segment) => `${segment.count} ${segment.label.toLowerCase()}`)
                    .join(', ')}
                  className="mt-3.5 flex h-2 gap-1 overflow-hidden"
                >
                  {segments.map((segment) => (
                    <span
                      key={segment.status}
                      className={cn('h-2 rounded-full', STATUS_FILL[segment.status])}
                      style={{ width: `${segment.fraction * 100}%` }}
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-5 text-[11.5px] text-text-2">
                  {segments.map((segment) => (
                    <span key={segment.status} className="inline-flex items-center gap-1.5">
                      <StatusGlyph
                        status={STATUS_TO_KIND[segment.status]}
                        aria-hidden="true"
                        className="size-3"
                      />
                      <span className="font-medium font-mono text-text-1">{segment.count}</span>
                      {segment.label.toLowerCase()}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="w-[440px] flex-none pt-4" aria-label="Target">
            <div className="flex items-baseline gap-2.5">
              <span className="font-bold text-[11px] tracking-[0.09em] text-text-1">TARGET</span>
              <span className="ml-auto">
                <How
                  label="target"
                  align="end"
                  constraint="target_date is one stored field; nothing records whether it was re-agreed."
                >
                  The one date a project stores. There is no start date, so the line below runs from
                  when the project was CREATED — not from when work began.
                </How>
              </span>
            </div>
            {project.targetDate === null ? (
              <p className="mt-3 font-mono text-[12px] text-text-2" data-testid="project-no-target">
                No target date
              </p>
            ) : (
              <>
                <div className="mt-2.5 flex items-baseline gap-2.5">
                  <span className="font-bold text-[28px] leading-none tracking-[-0.02em] text-text-1">
                    {formatTargetDay(project.targetDate)}
                  </span>
                  {past.passed ? (
                    <span className="rounded-pill bg-urgent-soft px-2 py-0.5 font-semibold text-[11px] text-status-urgent-ink">
                      {past.daysPast} {past.daysPast === 1 ? 'day' : 'days'} past
                    </span>
                  ) : null}
                </div>
                {strip === null ? null : (
                  <TargetStripDrawing
                    createdAt={project.createdAt}
                    targetDate={project.targetDate}
                    strip={strip}
                    daysPast={past.passed ? past.daysPast : 0}
                  />
                )}
              </>
            )}
          </section>
        </div>

        <ProjectIssueList issues={issues} teamId={teamId} />

        <div className="flex items-baseline gap-3.5 px-10 pt-4 pb-6 font-mono text-[10.5px] text-text-2">
          <span>workspace project · counted over the issues in your teams</span>
          <How
            label="the counting rule"
            constraint="isMember on the project · teamScoped on its issues"
          >
            A project belongs to the workspace, not to the team in the deck above. Its issues are
            only the ones in teams you belong to — issues from other teams never sync here.
          </How>
        </div>
      </div>
    </>
  )
}

// The published rows are lifted into state, so this comparison is what stands between a sync tick
// and a render loop. It is element-wise rather than a reference check on the array: a query result
// that arrives at a fresh identity on every render — which a subscription is free to do — would
// otherwise publish, re-render, publish again, forever.
function sameRows(
  a: readonly TeamDeploymentRow[] | undefined,
  b: readonly TeamDeploymentRow[],
): boolean {
  if (a === b) return true
  if (a === undefined || a.length !== b.length) return false
  return a.every((row, index) => row === b[index])
}

// One subscription, one team, no drawing: the rows are lifted so every issue's track is computed
// over the same merged index.
function TeamDeploymentFeed({
  teamId,
  publish,
}: {
  teamId: string
  publish: (teamId: string, rows: readonly TeamDeploymentRow[]) => void
}) {
  const [rows] = useQuery(queries.deployments.byTeam({ teamId }))
  useEffect(() => {
    publish(teamId, rows as readonly TeamDeploymentRow[])
  }, [rows, teamId, publish])
  return null
}

const STRIP_LEFT = 10
const STRIP_RUN = 380
// Where the `created` label starts, and one 10px mono character's advance. Both labels are
// fixed-format mono strings, so their drawn extents are arithmetic — no measurement needed.
const STRIP_TEXT_LEFT = 6
const MONO_ADVANCE = 6

function TargetStripDrawing({
  createdAt,
  targetDate,
  strip,
  daysPast,
}: {
  createdAt: number
  targetDate: number
  strip: {
    targetFraction: number
    nowFraction: number
    overrun: { from: number; to: number } | null
  }
  daysPast: number
}) {
  const x = (fraction: number) => STRIP_LEFT + fraction * STRIP_RUN
  const targetX = x(strip.targetFraction)
  const nowX = x(strip.nowFraction)
  const createdText = `${formatTargetDay(createdAt)} · created`
  const targetText = `${formatTargetDay(targetDate)} · target`
  // Placement is decided from the two labels' ACTUAL extents, never from a fraction of the run: a
  // fraction knows nothing about how wide `Jun 1 · created` is, so any threshold picked that way
  // draws the two mono strings through each other over most of the range. End-anchored left of the
  // mark while that clears `created`; start-anchored right of it while THAT clears `created`; and
  // when neither does, the target label drops to its own baseline so the two never share a line.
  const createdRight = STRIP_TEXT_LEFT + createdText.length * MONO_ADVANCE
  const targetW = targetText.length * MONO_ADVANCE
  const place =
    targetX - 4 - targetW > createdRight ? 'end' : targetX + 4 > createdRight ? 'start' : 'below'
  return (
    <svg
      data-testid="project-target-strip"
      width="400"
      height="58"
      viewBox="0 0 400 58"
      role="img"
      aria-label={`Created ${formatTargetDay(createdAt)}, target ${formatTargetDay(targetDate)}${
        daysPast > 0 ? `, ${daysPast} days past target` : ''
      }`}
      className="mt-3 block overflow-visible"
    >
      <line
        x1={STRIP_LEFT}
        y1="34"
        x2={targetX}
        y2="34"
        stroke="var(--border-strong)"
        strokeWidth="1.5"
      />
      {strip.overrun === null ? null : (
        <line
          x1={targetX}
          y1="34"
          x2={nowX}
          y2="34"
          stroke="var(--status-urgent)"
          strokeWidth="2.4"
        />
      )}
      <circle cx={STRIP_LEFT} cy="34" r="3.2" fill="var(--text-3)" />
      <line
        x1={targetX}
        y1="24"
        x2={targetX}
        y2="44"
        stroke="var(--text-2)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line
        x1={nowX}
        y1="27"
        x2={nowX}
        y2="41"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* `created`, never `started` — the label IS the disclosure that this end is not a start. */}
      <text
        x={STRIP_TEXT_LEFT}
        y="19"
        fontSize="10"
        fill="var(--text-2)"
        style={{ fontFamily: 'var(--type-mono)' }}
      >
        {createdText}
      </text>
      <text
        x={place === 'end' ? targetX - 4 : place === 'start' ? targetX + 4 : targetX}
        y={place === 'below' ? 52 : 19}
        textAnchor={place === 'end' ? 'end' : place === 'below' ? 'middle' : 'start'}
        fontSize="10"
        fill="var(--text-2)"
        style={{ fontFamily: 'var(--type-mono)' }}
      >
        {targetText}
      </text>
      <text
        x={nowX + 6}
        y="52"
        textAnchor="end"
        fontSize="10.5"
        fontWeight="600"
        fill="var(--text-1)"
      >
        today
      </text>
    </svg>
  )
}

function ProjectIssueList({ issues, teamId }: { issues: readonly PageIssue[]; teamId: string }) {
  const navigate = useNavigate()
  const [showDone, setShowDone] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // The issues on screen when the fold was pressed. The fold unmounts itself, so focus has to land
  // somewhere deliberate — on the first row that was not already there. An index cannot stand in
  // for that: a done issue's slot sits wherever its status group does, which can be ABOVE the fold.
  const revealedRef = useRef<ReadonlySet<string> | null>(null)

  const open = issues.filter((issue) => issue.status !== 'done')
  const done = issues.filter((issue) => issue.status === 'done')
  const shown = showDone ? issues : open

  useEffect(() => {
    const previous = revealedRef.current
    if (previous === null) return
    revealedRef.current = null
    const target = shown.find((issue) => !previous.has(issue.id))
    if (target === undefined) return
    listRef.current?.querySelector<HTMLElement>(`[data-issue-id="${target.id}"]`)?.focus()
  }, [shown])

  const groups = ISSUE_STATUSES.map((status) => ({
    status,
    issues: shown.filter((issue) => issue.status === status),
  })).filter((group) => group.issues.length > 0)

  const openIssue = (issue: PageIssue) => {
    void navigate({
      to: '/teams/$teamId/issues',
      params: { teamId: issue.teamId || teamId },
      search: { open: issue.id },
    })
  }

  if (issues.length === 0) return null

  return (
    <div className="mt-6" ref={listRef}>
      {groups.map((group) => (
        <section key={group.status} aria-label={STATUS_LABEL[group.status]}>
          <div className="flex h-[35px] items-center gap-2.5 border-row-hairline border-t bg-bg-hover px-10">
            <StatusGlyph status={STATUS_TO_KIND[group.status]} aria-hidden="true" />
            <span className="font-semibold text-[12.5px] text-text-1">
              {STATUS_LABEL[group.status]}
            </span>
            <span className="font-mono text-[11.5px] text-text-2">{group.issues.length}</span>
          </div>
          {group.issues.map((issue) => {
            const view = deliveryView(issue, issue.linked ?? {})
            return (
              <IssueRow
                key={issue.id}
                data-issue-id={issue.id}
                data-testid="project-issue-row"
                issueKey={issueKey(issue.teamKey, issue)}
                title={issue.title}
                status={STATUS_TO_KIND[issue.status]}
                priority={PRIORITY_TO_KIND[issue.priority]}
                labels={(issue.labels ?? []).map((label) => ({
                  name: label.name,
                  color: label.color,
                }))}
                date={formatRelative(issue.updatedAt)}
                phrase={<RestPhraseText phrase={view.phrase} />}
                realityTrack={
                  <RealityTrack
                    shape={buildRealityShape(view.strip, { divergence: view.divergence })}
                    age={
                      view.strip?.reviewAgeMs == null
                        ? null
                        : formatReviewAge(view.strip.reviewAgeMs)
                    }
                    label={realityTrackLabel(
                      view.strip,
                      view.divergence ? DIVERGENCE_LABEL[view.divergence] : null,
                    )}
                  />
                }
                {...(issue.assignee
                  ? {
                      assignee: {
                        name: issue.assignee.name ?? issue.assignee.email ?? issue.assignee.id,
                        ...(issue.assignee.image ? { src: issue.assignee.image } : {}),
                      },
                    }
                  : {})}
                onClick={() => openIssue(issue)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    openIssue(issue)
                  }
                }}
              />
            )
          })}
        </section>
      ))}
      {done.length === 0 || showDone ? null : (
        <button
          type="button"
          data-testid="project-done-fold"
          onClick={() => {
            revealedRef.current = new Set(shown.map((issue) => issue.id))
            setShowDone(true)
          }}
          className="w-full border-row-hairline border-t px-10 py-3.5 text-left font-mono text-[11.5px] text-text-2 hover:text-text-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          ↓ {done.length} done
        </button>
      )}
    </div>
  )
}
