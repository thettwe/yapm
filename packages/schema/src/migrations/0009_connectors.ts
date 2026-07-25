import { type Kysely, sql } from 'kysely'

const CONNECTOR_STATUS_CHECK = sql`status in ('disabled', 'pending', 'connected', 'error')`

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
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('connector_installation').ifExists().execute()
  await db.schema.dropTable('connector_secret').ifExists().execute()
  await db.schema.dropTable('connector_config').ifExists().execute()
}
