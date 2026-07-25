import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type AuthContext, newId } from '@yapm/schema'
import {
  createDatabase,
  type Database,
  migrateToLatest,
  setInstallationRepoTeam,
  upsertConnectorConfig,
  upsertConnectorInstallation,
} from '@yapm/schema/db'
import { type Kysely, sql } from 'kysely'
import { fromKysely, PgBoss } from 'pg-boss'
import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { GithubAppEnv } from '../../config/env.js'
import { createZeroDatabase } from '../../zero/db-provider.js'
import type { GithubApp } from './app.js'
import { createGithubConnector, GITHUB_WEBHOOK_DLQ, GITHUB_WEBHOOK_QUEUE } from './service.js'

const DATABASE_URL = process.env.DATABASE_URL
if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the github service test must not be skipped')
}

const FIXTURES = join(import.meta.dirname, '__fixtures__')
const APP_ENV: GithubAppEnv = { appId: '1', privateKey: 'PEM', webhookSecret: 'shh' }
const admin: AuthContext = { userID: 'admin', role: 'admin' }
const silent = pino({ level: 'silent' })
const stubApp: GithubApp = {
  installationClient: () => Promise.reject(new Error('no network in test')),
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
}

interface RecordedQueue {
  name: string
  options?: { policy?: string; deadLetter?: string }
}
interface RecordedSend {
  name: string
  options?: { singletonKey?: string }
}

// A no-op pg-boss double: records the queue topology and send options so the serialization
// configuration (key_strict_fifo, per-installation singletonKey, dead-letter) is asserted
// without a database or real polling.
function fakeBoss() {
  const queues: RecordedQueue[] = []
  const sends: RecordedSend[] = []
  const boss = {
    on: () => boss,
    start: () => Promise.resolve(),
    createQueue: (name: string, options?: RecordedQueue['options']) => {
      queues.push({ name, options })
      return Promise.resolve()
    },
    work: () => Promise.resolve('worker-id'),
    schedule: () => Promise.resolve(),
    send: (name: string, _data: unknown, options?: RecordedSend['options']) => {
      sends.push({ name, options })
      return Promise.resolve('job-id')
    },
    stop: () => Promise.resolve(),
  }
  return { boss: boss as unknown as PgBoss, queues, sends }
}

describe('createGithubConnector — disabled', () => {
  it('is inert without App env: no queues, 404 route surface', () => {
    const connector = createGithubConnector({
      appEnv: null,
      db: {} as never,
      dbProvider: {} as never,
      logger: silent,
      reconcileCron: '* * * * *',
    })
    expect(connector.enabled).toBe(false)
    expect(connector.secrets).toBeNull()
  })
})

describe('createGithubConnector — queue topology', () => {
  it('serializes per installation with key_strict_fifo and a dead-letter queue', async () => {
    const { boss, queues, sends } = fakeBoss()
    const connector = createGithubConnector({
      appEnv: APP_ENV,
      db: {} as never,
      dbProvider: {} as never,
      logger: silent,
      reconcileCron: '* * * * *',
      boss,
      app: stubApp,
    })
    await connector.start()

    const webhookQueue = queues.find((q) => q.name === GITHUB_WEBHOOK_QUEUE)
    expect(webhookQueue?.options?.policy).toBe('key_strict_fifo')
    expect(webhookQueue?.options?.deadLetter).toBe(GITHUB_WEBHOOK_DLQ)
    expect(queues.some((q) => q.name === GITHUB_WEBHOOK_DLQ)).toBe(true)

    await connector.enqueue({
      installationKey: '42',
      eventType: 'pull_request',
      deliveryId: 'd1',
      payload: {},
    })
    expect(sends[0]).toMatchObject({
      name: GITHUB_WEBHOOK_QUEUE,
      options: { singletonKey: 'installation-42' },
    })
  })
})

describe.skipIf(DATABASE_URL === undefined)('createGithubConnector — live queue (db)', () => {
  let database: Database
  let boss: PgBoss

  beforeAll(async () => {
    database = createDatabase({ connectionString: DATABASE_URL ?? '' })
    await migrateToLatest(database.db)
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
    `.execute(database.db as unknown as Kysely<never>)
    boss = new PgBoss({ db: fromKysely(database.db), schema: 'pgboss' })
    await boss.start()
  }, 30_000)

  afterAll(async () => {
    await boss?.stop({ graceful: false })
    await database.close()
  })

  it('drains enqueued deliveries in FIFO order per installation', async () => {
    const workspaceId = newId()
    const teamId = newId()
    const externalInstallationId = newId()
    await database.db.insertInto('workspace').values({ id: workspaceId, name: 'svc' }).execute()
    const teamKey = `SVC${Date.now().toString(36).toUpperCase()}`
    await database.db
      .insertInto('team')
      .values({ id: teamId, workspace_id: workspaceId, name: 'Eng', key: teamKey })
      .execute()
    await database.db
      .insertInto('issue')
      .values({
        id: newId(),
        team_id: teamId,
        number: 1,
        title: 'x',
        status: 'todo',
        priority: 'medium',
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
    })
    await setInstallationRepoTeam(database.db, admin, {
      installationId: installation.id,
      repoFullName: 'acme/app',
      teamId,
    })

    const connector = createGithubConnector({
      appEnv: APP_ENV,
      db: database.db,
      dbProvider: createZeroDatabase(database.db),
      logger: silent,
      reconcileCron: '0 0 1 1 *',
      boss,
      app: stubApp,
    })
    await connector.start()

    await connector.enqueue({
      installationKey: externalInstallationId,
      eventType: 'pull_request',
      deliveryId: newId(),
      payload: fixture('pull_request.opened.json'),
    })
    await connector.enqueue({
      installationKey: externalInstallationId,
      eventType: 'pull_request',
      deliveryId: newId(),
      payload: fixture('pull_request.closed_merged.json'),
    })

    let state: string | undefined
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const row = await database.db
        .selectFrom('pull_request')
        .select('state')
        .where('installation_id', '=', installation.id)
        .where('external_id', '=', '5001')
        .executeTakeFirst()
      if (row?.state === 'merged') {
        state = row.state
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    await connector.stop()
    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()

    // FIFO: the merge enqueued after the open must win — a reorder would leave state 'open'.
    expect(state).toBe('merged')
  }, 30_000)

  it('reconciles a mapped repo through the mutators and stores its ETag', async () => {
    const workspaceId = newId()
    const teamId = newId()
    const externalInstallationId = newId()
    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'svc-recon' })
      .execute()
    await database.db
      .insertInto('team')
      .values({
        id: teamId,
        workspace_id: workspaceId,
        name: 'Eng',
        key: `RC${Date.now().toString(36).toUpperCase()}`,
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
    })
    await setInstallationRepoTeam(database.db, admin, {
      installationId: installation.id,
      repoFullName: 'acme/app',
      teamId,
    })

    const listForRef = () => Promise.resolve({ status: 200, headers: {}, data: { check_runs: [] } })
    const emptyClient = {
      rest: {
        pulls: {
          list: () => Promise.resolve({ status: 200, headers: {}, data: [] }),
          listReviews: () => Promise.resolve({ status: 200, headers: {}, data: [] }),
        },
        checks: { listForRef },
      },
    }
    const mockClient = {
      rest: {
        pulls: {
          list: () =>
            Promise.resolve({
              status: 200,
              headers: { etag: 'W/"recon-1"' },
              data: [
                {
                  id: 6001,
                  number: 8,
                  title: 'Reconciled PR',
                  state: 'open',
                  draft: false,
                  html_url: 'https://x/8',
                  body: null,
                  created_at: '2026-07-20T10:00:00Z',
                  head: { sha: 'reconsha', ref: 'feature' },
                },
              ],
            }),
          listReviews: () => Promise.resolve({ status: 200, headers: {}, data: [] }),
        },
        checks: { listForRef },
      },
    }
    // Scope the mock to this test's installation so the global reconcile sweep returns empty
    // for any other config present in the shared DB (deterministic under parallel test files).
    const mockApp: GithubApp = {
      installationClient: (externalId) =>
        Promise.resolve(
          (externalId === externalInstallationId ? mockClient : emptyClient) as never,
        ),
    }

    const connector = createGithubConnector({
      appEnv: APP_ENV,
      db: database.db,
      dbProvider: createZeroDatabase(database.db),
      logger: silent,
      reconcileCron: '0 0 1 1 *',
      boss,
      app: mockApp,
    })

    await connector.reconcileOnce()

    const pr = await database.db
      .selectFrom('pull_request')
      .selectAll()
      .where('installation_id', '=', installation.id)
      .where('external_id', '=', '6001')
      .executeTakeFirstOrThrow()
    expect(pr.team_id).toBe(teamId)
    expect(pr.state).toBe('open')

    const etag = await database.db
      .selectFrom('connector_installation')
      .select(sql<string | null>`etags ->> 'pulls:acme/app'`.as('etag'))
      .where('id', '=', installation.id)
      .executeTakeFirstOrThrow()
    expect(etag.etag).toBe('W/"recon-1"')

    await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
  }, 30_000)
})
