import { type Kysely, sql } from 'kysely'

const CYCLE_STATUS_CHECK = sql`status in ('upcoming', 'active', 'completed')`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('cycle')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('number', 'integer')
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().check(CYCLE_STATUS_CHECK))
    .addColumn('start_date', 'timestamptz', (col) => col.notNull())
    .addColumn('end_date', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('cycle_sequence')
    .addColumn('team_id', 'uuid', (col) =>
      col.primaryKey().references('team.id').onDelete('cascade'),
    )
    .addColumn('next_number', 'bigint', (col) => col.notNull().defaultTo(1))
    .execute()

  await db.schema
    .alterTable('issue')
    .addColumn('cycle_id', 'uuid', (col) => col.references('cycle.id').onDelete('set null'))
    .execute()

  await db.schema.createIndex('cycle_team_id_idx').on('cycle').column('team_id').execute()

  await db.schema
    .createIndex('cycle_team_id_number_key')
    .unique()
    .on('cycle')
    .columns(['team_id', 'number'])
    .where('number', 'is not', null)
    .execute()

  await db.schema.createIndex('issue_cycle_id_idx').on('issue').column('cycle_id').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('issue').dropColumn('cycle_id').execute()
  await db.schema.dropTable('cycle_sequence').ifExists().execute()
  await db.schema.dropTable('cycle').ifExists().execute()
}
