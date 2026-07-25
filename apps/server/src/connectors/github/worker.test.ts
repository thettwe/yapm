import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type AuthContext, type NormalizedDelivery, newId } from '@yapm/schema'
import {
  createDatabase,
  type Database,
  findConnectorInstallation,
  migrateToLatest,
  setInstallationRepoTeam,
  upsertConnectorConfig,
  upsertConnectorInstallation,
} from '@yapm/schema/db'
import { type Kysely, sql } from 'kysely'
import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createZeroDatabase } from '../../zero/db-provider.js'

// The Zero server-schema check validates the whole synced schema, including better-auth's
// `user` table (created at boot by its migrations, not ours). Provision it so mutator
// transactions run, mirroring the schema-drift test.
async function provisionAuthUserTable(db: Kysely<never>): Promise<void> {
  await sql`
    create table if not exists "user" (
      "id" text not null primary key,
      "name" text not null,
      "email" text not null unique,
      "emailVerified" boolean not null,
      "image" text,
      "createdAt" timestamptz default current_timestamp not null,
      "updatedAt" timestamptz default current_timestamp not null
    )
  `.execute(db)
}

import { githubConnector } from './connector.js'
import { type GithubWorkerDeps, processGithubDelivery } from './worker.js'

const DATABASE_URL = process.env.DATABASE_URL
if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the github ingest test must not be skipped')
}

const FIXTURES = join(import.meta.dirname, '__fixtures__')
const admin: AuthContext = { userID: 'admin', role: 'admin' }
const silent = pino({ level: 'silent' })

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
}

describe.skipIf(DATABASE_URL === undefined)('github ingest worker (live db)', () => {
  let database: Database
  let deps: GithubWorkerDeps
  let workspaceId: string
  let teamId: string
  let issueId: string
  let externalInstallationId: string
  let installationId: string

  function delivery(
    eventType: string,
    payload: unknown,
    over: Partial<NormalizedDelivery> = {},
  ): NormalizedDelivery {
    return {
      installationKey: externalInstallationId,
      eventType,
      deliveryId: newId(),
      payload,
      ...over,
    }
  }

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
    await provisionAuthUserTable(database.db as unknown as Kysely<never>)
    deps = {
      db: database.db,
      dbProvider: createZeroDatabase(database.db),
      connector: githubConnector,
      logger: silent,
    }
  }, 30_000)

  afterAll(async () => {
    await database.close()
  })

  afterEach(async () => {
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
  })

  beforeEach(async () => {
    workspaceId = newId()
    teamId = newId()
    issueId = newId()
    externalInstallationId = newId()
    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'connector-ingest' })
      .execute()
    await database.db
      .insertInto('team')
      .values({ id: teamId, workspace_id: workspaceId, name: 'Engineering', key: 'ENG' })
      .execute()
    await database.db
      .insertInto('issue')
      .values({
        id: issueId,
        team_id: teamId,
        number: 1,
        title: 'Login race',
        status: 'in_progress',
        priority: 'high',
        creator_id: 'system',
      })
      .execute()
    const config = await upsertConnectorConfig(database.db, admin, {
      id: newId(),
      workspaceId,
      provider: 'github',
      enabled: true,
    })
    const installation = await upsertConnectorInstallation(database.db, {
      id: newId(),
      configId: config.id,
      externalInstallationId,
      accountLogin: 'acme',
    })
    installationId = installation.id
    await setInstallationRepoTeam(database.db, admin, {
      installationId: installation.id,
      repoFullName: 'acme/app',
      teamId,
    })
  })

  it('ingests a PR into the mapped team and links it to the referenced issue', async () => {
    await processGithubDelivery(deps, delivery('pull_request', fixture('pull_request.opened.json')))

    const pr = await database.db
      .selectFrom('pull_request')
      .selectAll()
      .where('installation_id', '=', installationId)
      .where('external_id', '=', '5001')
      .executeTakeFirstOrThrow()
    expect(pr.team_id).toBe(teamId)
    expect(pr.state).toBe('open')
    expect(pr.repo).toBe('acme/app')

    const link = await database.db
      .selectFrom('issue_link')
      .selectAll()
      .where('pull_request_id', '=', pr.id)
      .execute()
    expect(link).toHaveLength(1)
    expect(link[0]).toMatchObject({ issue_id: issueId, team_id: teamId })
  })

  it('is idempotent and advances PR state on redelivery', async () => {
    await processGithubDelivery(deps, delivery('pull_request', fixture('pull_request.opened.json')))
    await processGithubDelivery(
      deps,
      delivery('pull_request', fixture('pull_request.closed_merged.json')),
    )

    const prs = await database.db
      .selectFrom('pull_request')
      .selectAll()
      .where('installation_id', '=', installationId)
      .where('external_id', '=', '5001')
      .execute()
    expect(prs).toHaveLength(1)
    expect(prs[0]?.state).toBe('merged')
    expect(prs[0]?.merged_at).toBeInstanceOf(Date)
  })

  it('attaches checks and reviews under the ingested PR, inheriting its team', async () => {
    await processGithubDelivery(deps, delivery('pull_request', fixture('pull_request.opened.json')))
    await processGithubDelivery(deps, delivery('check_run', fixture('check_run.completed.json')))
    await processGithubDelivery(
      deps,
      delivery('pull_request_review', fixture('pull_request_review.submitted.json')),
    )

    const check = await database.db
      .selectFrom('ci_check')
      .selectAll()
      .where('external_id', '=', '7001')
      .executeTakeFirstOrThrow()
    expect(check).toMatchObject({ team_id: teamId, conclusion: 'failure' })

    const review = await database.db
      .selectFrom('review')
      .selectAll()
      .where('external_id', '=', '9001')
      .executeTakeFirstOrThrow()
    expect(review).toMatchObject({ team_id: teamId, state: 'approved', author: 'reviewer-jane' })
  })

  it('records a deployment for the mapped repo', async () => {
    await processGithubDelivery(
      deps,
      delivery('deployment_status', fixture('deployment_status.json')),
    )
    const deployment = await database.db
      .selectFrom('deployment')
      .selectAll()
      .where('external_id', '=', '8001')
      .executeTakeFirstOrThrow()
    expect(deployment).toMatchObject({
      team_id: teamId,
      state: 'success',
      environment: 'production',
    })
  })

  it('drops a webhook for an unmapped repo without writing rows', async () => {
    const payload = {
      ...(fixture('pull_request.opened.json') as Record<string, unknown>),
      repository: { full_name: 'acme/unmapped' },
    }
    await processGithubDelivery(deps, delivery('pull_request', payload))
    const count = await database.db
      .selectFrom('pull_request')
      .select(({ fn }) => fn.countAll<string>().as('n'))
      .where('installation_id', '=', installationId)
      .executeTakeFirstOrThrow()
    expect(Number(count.n)).toBe(0)
  })

  it('drops a webhook for an unknown installation', async () => {
    await processGithubDelivery(
      deps,
      delivery('pull_request', fixture('pull_request.opened.json'), {
        installationKey: 'does-not-exist',
      }),
    )
    const count = await database.db
      .selectFrom('pull_request')
      .select(({ fn }) => fn.countAll<string>().as('n'))
      .where('external_id', '=', '5001')
      .where('installation_id', '=', installationId)
      .executeTakeFirstOrThrow()
    expect(Number(count.n)).toBe(0)
  })

  it('records and removes the installation on lifecycle events', async () => {
    const lifecycleExternalId = newId()
    const created = {
      action: 'created',
      installation: { id: lifecycleExternalId, account: { login: 'newco' } },
    }
    await processGithubDelivery(
      deps,
      delivery('installation', created, { installationKey: lifecycleExternalId }),
    )
    expect(
      await findConnectorInstallation(database.db, 'github', lifecycleExternalId),
    ).not.toBeNull()

    const deleted = { action: 'deleted', installation: { id: lifecycleExternalId } }
    await processGithubDelivery(
      deps,
      delivery('installation', deleted, { installationKey: lifecycleExternalId }),
    )
    expect(await findConnectorInstallation(database.db, 'github', lifecycleExternalId)).toBeNull()
  })
})
