import { type Kysely, sql } from 'kysely'
import { newId } from '../id.js'
import { DEFAULT_RETRO_FORMAT, type IssuePriority, type IssueStatus } from '../zero/context.js'
import { initialRanks } from '../zero/rank.js'
import { RETRO_FORMAT_COLUMNS } from '../zero/retro/phase.js'
import type { DB, Workspace, WorkspaceMember } from './types.js'

export const DEFAULT_WORKSPACE_NAME = 'yapm'

export const SEED_LOCK_ID = 4207331001
export const BOOTSTRAP_LOCK_ID = 4207331002
export const DEMO_CONTENT_LOCK_ID = 4207331003

export interface SeedWorkspaceOptions {
  id: string
  name?: string
}

export async function seedWorkspace(
  db: Kysely<DB>,
  options: SeedWorkspaceOptions,
): Promise<Workspace | undefined> {
  const name = options.name ?? DEFAULT_WORKSPACE_NAME

  return db.transaction().execute(async (trx) => {
    // `where not exists` alone is not enough: under READ COMMITTED two booting
    // replicas both see an empty table and both insert.
    await sql`select pg_advisory_xact_lock(${sql.lit(SEED_LOCK_ID)})`.execute(trx)

    const { rows } = await sql<Workspace>`
      insert into workspace (id, name)
      select ${options.id}, ${name}
      where not exists (select 1 from workspace)
      returning id, name, created_at, updated_at
    `.execute(trx)

    return rows[0]
  })
}

export interface BootstrapFirstAdminOptions {
  id: string
  userId: string
  userEmail?: string
  requiredEmail?: string
}

function normalizeEmail(email: string | undefined): string | undefined {
  const trimmed = email?.trim().toLowerCase()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

// First-authenticated-user-wins: promote the caller to `admin` only if the workspace
// has zero members yet. Advisory-locked (same pattern as `seedWorkspace`) so concurrent
// first sign-ins produce exactly one admin. Returns the created row, or `undefined` when
// a member already exists or the required-email gate rejects the caller.
export async function bootstrapFirstAdmin(
  db: Kysely<DB>,
  options: BootstrapFirstAdminOptions,
): Promise<WorkspaceMember | undefined> {
  const requiredEmail = normalizeEmail(options.requiredEmail)
  if (requiredEmail !== undefined && normalizeEmail(options.userEmail) !== requiredEmail) {
    return undefined
  }

  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(${sql.lit(BOOTSTRAP_LOCK_ID)})`.execute(trx)

    const { rows } = await sql<WorkspaceMember>`
      insert into workspace_member (id, workspace_id, user_id, role)
      select ${options.id}, w.id, ${options.userId}, 'admin'
      from workspace w
      where not exists (select 1 from workspace_member)
      limit 1
      returning id, workspace_id, user_id, role, created_at, updated_at
    `.execute(trx)

    return rows[0]
  })
}

export interface SeedDemoContentOptions {
  userId: string
  teamKey?: string
  teamName?: string
}

export interface SeedDemoContentResult {
  teamId: string
  teamKey: string
  issueCount: number
}

interface DemoIssueSpec {
  title: string
  status: IssueStatus
  priority: IssuePriority
  assigned: boolean
  labels: string[]
  description?: string
  inActiveCycle?: boolean
  // Landed in (or was canceled during) the completed cycle — the retro's Delivered panel reads these
  // as shipped/canceled.
  inCompletedCycle?: boolean
  // The rollover carried it out of the completed cycle into the active one; `carryoverCount` of 2+ is
  // what the panel reports as "carried twice or more".
  carriedFromCompleted?: boolean
  carryoverCount?: number
  // Joined its cycle after that cycle had started — the panel's "added mid-cycle" fact.
  addedMidCycle?: boolean
  needsTriage?: boolean
  project?: 0 | 1
}

const DEMO_LABELS: { name: string; color: string }[] = [
  { name: 'bug', color: '#e5484d' },
  { name: 'feature', color: '#4c6ef5' },
  { name: 'chore', color: '#f59f00' },
  { name: 'design', color: '#12b886' },
]

const DEMO_ISSUES: DemoIssueSpec[] = [
  {
    title: 'Keyboard navigation drops focus after closing the command palette',
    status: 'in_progress',
    priority: 'high',
    assigned: true,
    labels: ['bug'],
    description: 'Focus should return to the previously focused row when the palette closes.',
    inActiveCycle: true,
    carriedFromCompleted: true,
    carryoverCount: 2,
    project: 0,
  },
  {
    title: 'Add saved views for the team issue list',
    status: 'todo',
    priority: 'medium',
    assigned: true,
    labels: ['feature'],
    inActiveCycle: true,
    carriedFromCompleted: true,
    carryoverCount: 1,
    project: 0,
  },
  {
    title: 'Reality strip renders the not-linked placeholder',
    status: 'in_review',
    priority: 'medium',
    assigned: false,
    labels: ['design'],
    inActiveCycle: true,
    addedMidCycle: true,
    project: 1,
  },
  {
    title: 'Tune row density to match the Warm mockups',
    status: 'todo',
    priority: 'low',
    assigned: false,
    labels: ['design', 'chore'],
  },
  {
    title: 'Batch status changes from a multi-select in the list',
    status: 'backlog',
    priority: 'medium',
    assigned: false,
    labels: ['feature'],
  },
  {
    title: 'Comment composer loses draft on navigation',
    status: 'backlog',
    priority: 'low',
    assigned: true,
    labels: ['bug'],
  },
  {
    title: 'Ship the six status glyphs including canceled',
    status: 'done',
    priority: 'high',
    assigned: true,
    labels: ['design'],
    inCompletedCycle: true,
  },
  {
    title: 'Land the single-write fractional-index board move',
    status: 'done',
    priority: 'medium',
    assigned: true,
    labels: ['feature'],
    inCompletedCycle: true,
  },
  {
    title: 'Stamp the rollover origin cycle on carried issues',
    status: 'done',
    priority: 'medium',
    assigned: false,
    labels: ['chore'],
    inCompletedCycle: true,
    addedMidCycle: true,
  },
  {
    title: 'Drop the legacy inline filter prototype',
    status: 'canceled',
    priority: 'no_priority',
    assigned: false,
    labels: ['chore'],
    inCompletedCycle: true,
  },
  {
    title: 'Incoming: dark mode contrast looks off on the login screen',
    status: 'backlog',
    priority: 'no_priority',
    assigned: false,
    labels: ['bug'],
    needsTriage: true,
  },
  {
    title: 'Incoming: can we add CSV export for the issue list?',
    status: 'backlog',
    priority: 'no_priority',
    assigned: false,
    labels: [],
    needsTriage: true,
  },
]

interface SeedDemoRetroOptions {
  teamId: string
  userId: string
  cycleId: string
  nextCycleId: string
  at: Date
}

interface DemoRetroCardSpec {
  column: number
  body: string
  group?: number
  votes?: number
}

const DEMO_RETRO_CARDS: DemoRetroCardSpec[] = [
  {
    column: 0,
    body: 'Rollover meant nothing was silently dropped at the cycle boundary.',
    votes: 2,
  },
  { column: 0, body: 'The reality strip caught two issues whose PRs had already merged.' },
  { column: 1, body: 'Review wait stretched to two days on the board work.', group: 0, votes: 3 },
  { column: 1, body: 'A second reviewer was hard to find late in the cycle.', group: 0 },
  { column: 1, body: 'Two items carried for the second time — the plan was too full.', votes: 1 },
]

// A worked demo retro on the seeded completed cycle, so the surface has content on first run: the
// default format's columns, published cards (one group of two), their tallies, and one action item
// still waiting to become an issue. Written directly rather than through the mutators because the
// seeder is a plain Kysely pass with no Zero transaction — including `retro_card_author`, which is
// the server-only side of the anonymity boundary and is written on publish in real use.
async function seedDemoRetro(trx: Kysely<DB>, options: SeedDemoRetroOptions): Promise<void> {
  const template = RETRO_FORMAT_COLUMNS[DEFAULT_RETRO_FORMAT]
  const retroId = newId()
  const columnRanks = initialRanks(template.length)
  const columnIds = template.map(() => newId())

  await sql`
    insert into retro (id, team_id, cycle_id, next_cycle_id, title, format, phase, facilitator_id, is_anonymous, votes_per_participant, created_by, created_at, updated_at)
    values (${retroId}, ${options.teamId}, ${options.cycleId}, ${options.nextCycleId}, 'Cycle 1 retrospective', ${DEFAULT_RETRO_FORMAT}, 'discuss', ${options.userId}, false, 3, ${options.userId}, ${options.at}, ${options.at})
  `.execute(trx)

  for (const [index, column] of template.entries()) {
    await sql`
      insert into retro_column (id, retro_id, team_id, key, title, accent_token, rank, created_at, updated_at)
      values (${columnIds[index]}, ${retroId}, ${options.teamId}, ${column.key}, ${column.title}, ${column.accentToken}, ${columnRanks[index]}, ${options.at}, ${options.at})
    `.execute(trx)
  }

  const groupIds = [newId()]
  await sql`
    insert into retro_group (id, retro_id, team_id, column_id, label, rank, created_at, updated_at)
    values (${groupIds[0]}, ${retroId}, ${options.teamId}, ${columnIds[1]}, 'Review wait', ${initialRanks(1)[0]}, ${options.at}, ${options.at})
  `.execute(trx)

  const cardRanks = initialRanks(DEMO_RETRO_CARDS.length)
  for (const [index, spec] of DEMO_RETRO_CARDS.entries()) {
    const cardId = newId()
    const groupId = spec.group === undefined ? null : groupIds[spec.group]
    await sql`
      insert into retro_card (id, retro_id, team_id, column_id, group_id, body, rank, is_anonymous, author_display_id, created_at, updated_at)
      values (${cardId}, ${retroId}, ${options.teamId}, ${columnIds[spec.column]}, ${groupId}, ${spec.body}, ${cardRanks[index]}, false, ${options.userId}, ${options.at}, ${options.at})
    `.execute(trx)
    await sql`
      insert into retro_card_author (card_id, retro_id, author_id)
      values (${cardId}, ${retroId}, ${options.userId})
    `.execute(trx)

    if (spec.votes === undefined) continue
    const targetId = groupId ?? cardId
    await sql`
      insert into retro_vote_tally (target_id, retro_id, team_id, target_type, count, created_at, updated_at)
      values (${targetId}, ${retroId}, ${options.teamId}, ${groupId === null ? 'card' : 'group'}, ${spec.votes}, ${options.at}, ${options.at})
      on conflict (target_id) do update set count = retro_vote_tally.count + ${spec.votes}
    `.execute(trx)
  }

  await sql`
    insert into retro_action (id, retro_id, team_id, group_id, body, assignee_id, target_cycle_id, created_at, updated_at)
    values (${newId()}, ${retroId}, ${options.teamId}, ${groupIds[0]}, 'Agree a same-day first-review target and rotate a review buddy each cycle.', ${options.userId}, ${options.nextCycleId}, ${options.at}, ${options.at})
  `.execute(trx)
}

const demoDoc = (text: string): string =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })

// Fills a fresh instance with a demo team and a handful of realistic issues so the list has
// content on first run. Idempotent and one-shot: it does nothing once any team exists, so it
// never touches a real workspace. Advisory-locked like the other seeders. The caller (the
// first-admin bootstrap) provides the verified admin `userId`, who is added to the demo team
// so the seeded issues sync to them.
export async function seedDemoContent(
  db: Kysely<DB>,
  options: SeedDemoContentOptions,
): Promise<SeedDemoContentResult | undefined> {
  const teamKey = (options.teamKey ?? 'ENG').toUpperCase()
  const teamName = options.teamName ?? 'Engineering'

  return db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(${sql.lit(DEMO_CONTENT_LOCK_ID)})`.execute(trx)

    const workspace = await trx.selectFrom('workspace').select('id').executeTakeFirst()
    if (!workspace) return undefined

    const existingTeam = await trx.selectFrom('team').select('id').executeTakeFirst()
    if (existingTeam) return undefined

    const teamId = newId()
    await sql`insert into team (id, workspace_id, name, key) values (${teamId}, ${workspace.id}, ${teamName}, ${teamKey})`.execute(
      trx,
    )
    await sql`insert into team_membership (id, team_id, user_id) values (${newId()}, ${teamId}, ${options.userId})`.execute(
      trx,
    )

    const labelIds = new Map<string, string>()
    for (const label of DEMO_LABELS) {
      const id = newId()
      labelIds.set(label.name, id)
      await sql`insert into label (id, team_id, name, color) values (${id}, ${teamId}, ${label.name}, ${label.color})`.execute(
        trx,
      )
    }

    // Three cycles so the Cycles view (and the retro that hangs off a completed one) has content on
    // first run: a completed cycle that just ended, the active cycle a handful of unfinished issues
    // are assigned to, and an upcoming one after it. The per-team `cycle_sequence` is seeded past
    // their numbers so the next server-claimed cycle number continues the run.
    const day = 24 * 60 * 60 * 1000
    const now = Date.now()
    const completedCycleId = newId()
    const activeCycleId = newId()
    const upcomingCycleId = newId()
    await sql`
      insert into cycle (id, team_id, number, name, status, start_date, end_date)
      values
        (${completedCycleId}, ${teamId}, 1, 'Cycle 1', 'completed', ${new Date(now - 17 * day)}, ${new Date(now - 3 * day)}),
        (${activeCycleId}, ${teamId}, 2, 'Cycle 2', 'active', ${new Date(now - 3 * day)}, ${new Date(now + 4 * day)}),
        (${upcomingCycleId}, ${teamId}, 3, 'Cycle 3', 'upcoming', ${new Date(now + 4 * day)}, ${new Date(now + 11 * day)})
    `.execute(trx)
    await sql`insert into cycle_sequence (team_id, next_number) values (${teamId}, 4)`.execute(trx)

    // Two workspace-level projects so the roadmap and project views have content on first run:
    // an active project with a near-term target date and a planned one further out. Some demo
    // issues below are pointed at them via `project_id`.
    const projectIds = [newId(), newId()]
    await sql`
      insert into project (id, workspace_id, name, lead_id, status, target_date)
      values
        (${projectIds[0]}, ${workspace.id}, 'Onboarding polish', ${options.userId}, 'active', ${new Date(now + 14 * day)}),
        (${projectIds[1]}, ${workspace.id}, 'Reality strip GA', null, 'planned', ${new Date(now + 45 * day)})
    `.execute(trx)

    const completedStart = now - 17 * day
    const completedEnd = now - 3 * day

    let number = 0
    for (const spec of DEMO_ISSUES) {
      number += 1
      const issueId = newId()
      const assigneeId = spec.assigned ? options.userId : null
      const description = spec.description ? sql`${demoDoc(spec.description)}::jsonb` : sql`null`
      const cycleId = spec.inCompletedCycle
        ? completedCycleId
        : spec.inActiveCycle
          ? activeCycleId
          : null
      const rolledOverFrom = spec.carriedFromCompleted ? completedCycleId : null
      // The rollover stamps a carried issue's assignment at the moment its cycle completed; an issue
      // "added mid-cycle" is stamped part-way in; anything else is stamped at its cycle's start.
      const cycleStart = spec.inCompletedCycle ? completedStart : now - 3 * day
      const midCycleOffset = spec.inCompletedCycle ? 7 * day : day
      const cycleAssignedAt = spec.carriedFromCompleted
        ? new Date(completedEnd)
        : cycleId === null
          ? null
          : new Date(cycleStart + (spec.addedMidCycle ? midCycleOffset : 0))
      const projectId = spec.project === undefined ? null : projectIds[spec.project]
      const needsTriage = spec.needsTriage ?? false
      await sql`
        insert into issue (id, team_id, number, title, description, status, priority, assignee_id, creator_id, cycle_id, rolled_over_from_cycle_id, carryover_count, cycle_assigned_at, project_id, needs_triage)
        values (${issueId}, ${teamId}, ${number}, ${spec.title}, ${description}, ${spec.status}, ${spec.priority}, ${assigneeId}, ${options.userId}, ${cycleId}, ${rolledOverFrom}, ${spec.carryoverCount ?? 0}, ${cycleAssignedAt}, ${projectId}, ${needsTriage})
      `.execute(trx)

      for (const labelName of spec.labels) {
        const labelId = labelIds.get(labelName)
        if (labelId === undefined) continue
        await sql`insert into issue_label (issue_id, label_id, team_id) values (${issueId}, ${labelId}, ${teamId})`.execute(
          trx,
        )
      }
    }

    await sql`insert into issue_sequence (team_id, next_number) values (${teamId}, ${number + 1})`.execute(
      trx,
    )

    await sql`
      insert into comment (id, issue_id, team_id, author_id, body)
      select ${newId()}, i.id, ${teamId}, ${options.userId}, ${demoDoc('Reproduced on the latest build — looking into the focus restore path.')}::jsonb
      from issue i
      where i.team_id = ${teamId} and i.number = 1
    `.execute(trx)

    await seedDemoRetro(trx, {
      teamId,
      userId: options.userId,
      cycleId: completedCycleId,
      nextCycleId: activeCycleId,
      at: new Date(completedEnd),
    })

    return { teamId, teamKey, issueCount: DEMO_ISSUES.length }
  })
}
