import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import { createDatabase, type Database } from './client.js'
import { migrateToLatest } from './migrate.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the project delete FK test must not be skipped')
}

// Guards the migration's `issue.project_id ... on delete set null` FK (0008_projects.ts):
// deleting a project must UNASSIGN its issues, never delete them (spec: "the project is
// removed and its issues survive with project_id = null"). Without this test, flipping the
// FK to `cascade` would silently delete issues with the whole suite green.
describe.skipIf(DATABASE_URL === undefined)('project delete unassigns its issues', () => {
  let database: Database
  let workspaceId: string
  let teamId: string

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    workspaceId = newId()
    teamId = newId()
    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'project-delete-test' })
      .execute()
    await database.db
      .insertInto('team')
      .values({ id: teamId, workspace_id: workspaceId, name: 'Platform', key: newId().slice(0, 8) })
      .execute()
  }, 30_000)

  afterAll(async () => {
    // Cascades to team/issue/project rows created under it.
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
    await database.close()
  })

  it('removes the project but keeps its issues with project_id = null', async () => {
    const projectId = newId()
    const issueId = newId()
    await database.db
      .insertInto('project')
      .values({ id: projectId, workspace_id: workspaceId, name: 'Onboarding', status: 'active' })
      .execute()
    await database.db
      .insertInto('issue')
      .values({
        id: issueId,
        team_id: teamId,
        title: 'Assigned to the project',
        status: 'todo',
        priority: 'medium',
        creator_id: newId(),
        project_id: projectId,
      })
      .execute()

    await database.db.deleteFrom('project').where('id', '=', projectId).execute()

    const project = await database.db
      .selectFrom('project')
      .select('id')
      .where('id', '=', projectId)
      .executeTakeFirst()
    expect(project).toBeUndefined()

    const issue = await database.db
      .selectFrom('issue')
      .select(['id', 'project_id'])
      .where('id', '=', issueId)
      .executeTakeFirst()
    expect(issue).toMatchObject({ id: issueId, project_id: null })
  })
})
