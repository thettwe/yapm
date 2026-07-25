import { type Kysely, sql } from 'kysely'

const CONNECTOR_STATUS_CHECK = sql`status in ('disabled', 'pending', 'connected', 'error')`

const PR_STATE_CHECK = sql`state in ('draft', 'open', 'merged', 'closed')`

const CI_CONCLUSION_CHECK = sql`conclusion in ('success', 'failure', 'pending', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required')`

const REVIEW_STATE_CHECK = sql`state in ('approved', 'changes_requested', 'commented', 'dismissed')`

const DEPLOYMENT_STATE_CHECK = sql`state in ('queued', 'in_progress', 'success', 'failure', 'error', 'inactive', 'pending')`

const LINK_SOURCE_CHECK = sql`source in ('branch', 'body')`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('connector_config')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspace.id').onDelete('cascade'),
    )
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('config', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('status', 'text', (col) =>
      col.notNull().defaultTo('disabled').check(CONNECTOR_STATUS_CHECK),
    )
    .addColumn('last_synced_at', 'timestamptz')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('connector_config_workspace_provider_key', ['workspace_id', 'provider'])
    .execute()

  await db.schema
    .createTable('connector_secret')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('connector_config_id', 'uuid', (col) =>
      col.notNull().references('connector_config.id').onDelete('cascade'),
    )
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('ciphertext', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('connector_secret_config_key_key', ['connector_config_id', 'key'])
    .execute()

  await db.schema
    .createTable('connector_installation')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('connector_config_id', 'uuid', (col) =>
      col.notNull().references('connector_config.id').onDelete('cascade'),
    )
    .addColumn('external_installation_id', 'text', (col) => col.notNull())
    .addColumn('account_login', 'text')
    .addColumn('repo_mapping', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('etags', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('connector_installation_config_external_key', [
      'connector_config_id',
      'external_installation_id',
    ])
    .execute()

  // Part B: the team-scoped, Zero-synced work-graph entities. Every row carries `team_id`
  // (the two-hop `teamScoped` sync predicate) so linked delivery data inherits the issue's
  // visibility. `installation_id` ties a row back to its `connector_installation` so an
  // uninstall cascades the work graph away; it is a plain synced column (no Zero relationship
  // to the server-only installation table). All provider-neutral — no GitHub specifics.
  await db.schema
    .createTable('pull_request')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('installation_id', 'uuid', (col) =>
      col.notNull().references('connector_installation.id').onDelete('cascade'),
    )
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('repo', 'text', (col) => col.notNull())
    .addColumn('number', 'integer', (col) => col.notNull())
    .addColumn('external_id', 'text', (col) => col.notNull())
    .addColumn('title', 'text')
    .addColumn('state', 'text', (col) => col.notNull().check(PR_STATE_CHECK))
    .addColumn('url', 'text')
    .addColumn('head_sha', 'text')
    .addColumn('opened_at', 'timestamptz', (col) => col.notNull())
    .addColumn('merged_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('pull_request_installation_external_key', [
      'installation_id',
      'external_id',
    ])
    .execute()

  await db.schema
    .createTable('ci_check')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('pull_request_id', 'uuid', (col) =>
      col.notNull().references('pull_request.id').onDelete('cascade'),
    )
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('external_id', 'text', (col) => col.notNull())
    .addColumn('name', 'text')
    .addColumn('conclusion', 'text', (col) => col.notNull().check(CI_CONCLUSION_CHECK))
    .addColumn('head_sha', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('ci_check_pull_request_external_key', ['pull_request_id', 'external_id'])
    .execute()

  await db.schema
    .createTable('review')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('pull_request_id', 'uuid', (col) =>
      col.notNull().references('pull_request.id').onDelete('cascade'),
    )
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('external_id', 'text', (col) => col.notNull())
    .addColumn('author', 'text')
    .addColumn('state', 'text', (col) => col.notNull().check(REVIEW_STATE_CHECK))
    .addColumn('submitted_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('review_pull_request_external_key', ['pull_request_id', 'external_id'])
    .execute()

  await db.schema
    .createTable('deployment')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('installation_id', 'uuid', (col) =>
      col.notNull().references('connector_installation.id').onDelete('cascade'),
    )
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('repo', 'text', (col) => col.notNull())
    .addColumn('external_id', 'text', (col) => col.notNull())
    .addColumn('ref', 'text')
    .addColumn('environment', 'text')
    .addColumn('state', 'text', (col) => col.notNull().check(DEPLOYMENT_STATE_CHECK))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('deployment_installation_external_key', ['installation_id', 'external_id'])
    .execute()

  await db.schema
    .createTable('issue_link')
    .addColumn('issue_id', 'uuid', (col) =>
      col.notNull().references('issue.id').onDelete('cascade'),
    )
    .addColumn('pull_request_id', 'uuid', (col) =>
      col.notNull().references('pull_request.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('source', 'text', (col) => col.notNull().check(LINK_SOURCE_CHECK))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('issue_link_pkey', ['issue_id', 'pull_request_id'])
    .execute()

  await db.schema
    .createIndex('pull_request_team_id_idx')
    .on('pull_request')
    .column('team_id')
    .execute()
  await db.schema
    .createIndex('ci_check_pull_request_id_idx')
    .on('ci_check')
    .column('pull_request_id')
    .execute()
  await db.schema.createIndex('ci_check_team_id_idx').on('ci_check').column('team_id').execute()
  await db.schema
    .createIndex('review_pull_request_id_idx')
    .on('review')
    .column('pull_request_id')
    .execute()
  await db.schema.createIndex('review_team_id_idx').on('review').column('team_id').execute()
  await db.schema.createIndex('deployment_team_id_idx').on('deployment').column('team_id').execute()
  await db.schema
    .createIndex('issue_link_pull_request_id_idx')
    .on('issue_link')
    .column('pull_request_id')
    .execute()
  await db.schema.createIndex('issue_link_team_id_idx').on('issue_link').column('team_id').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('issue_link').ifExists().execute()
  await db.schema.dropTable('deployment').ifExists().execute()
  await db.schema.dropTable('review').ifExists().execute()
  await db.schema.dropTable('ci_check').ifExists().execute()
  await db.schema.dropTable('pull_request').ifExists().execute()
  await db.schema.dropTable('connector_installation').ifExists().execute()
  await db.schema.dropTable('connector_secret').ifExists().execute()
  await db.schema.dropTable('connector_config').ifExists().execute()
}
