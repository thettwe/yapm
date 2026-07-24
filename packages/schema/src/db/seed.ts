import { type Kysely, sql } from 'kysely'
import { newId } from '../id.js'
import type { IssuePriority, IssueStatus } from '../zero/context.js'
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
  },
  {
    title: 'Add saved views for the team issue list',
    status: 'todo',
    priority: 'medium',
    assigned: true,
    labels: ['feature'],
  },
  {
    title: 'Reality strip renders the not-linked placeholder',
    status: 'in_review',
    priority: 'medium',
    assigned: false,
    labels: ['design'],
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
  },
  {
    title: 'Drop the legacy inline filter prototype',
    status: 'canceled',
    priority: 'no_priority',
    assigned: false,
    labels: ['chore'],
  },
]

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

    let number = 0
    for (const spec of DEMO_ISSUES) {
      number += 1
      const issueId = newId()
      const assigneeId = spec.assigned ? options.userId : null
      const description = spec.description ? sql`${demoDoc(spec.description)}::jsonb` : sql`null`
      await sql`
        insert into issue (id, team_id, number, title, description, status, priority, assignee_id, creator_id)
        values (${issueId}, ${teamId}, ${number}, ${spec.title}, ${description}, ${spec.status}, ${spec.priority}, ${assigneeId}, ${options.userId})
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

    return { teamId, teamKey, issueCount: DEMO_ISSUES.length }
  })
}
