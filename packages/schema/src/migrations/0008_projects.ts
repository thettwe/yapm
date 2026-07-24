import { type Kysely, sql } from 'kysely'

const PROJECT_STATUS_CHECK = sql`status in ('planned', 'active', 'completed', 'cancelled')`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('project')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspace.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('lead_id', 'text')
    .addColumn('status', 'text', (col) => col.notNull().check(PROJECT_STATUS_CHECK))
    .addColumn('target_date', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .alterTable('issue')
    .addColumn('project_id', 'uuid', (col) => col.references('project.id').onDelete('set null'))
    .execute()

  await db.schema
    .createIndex('project_workspace_id_idx')
    .on('project')
    .column('workspace_id')
    .execute()

  await db.schema.createIndex('issue_project_id_idx').on('issue').column('project_id').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('issue').dropColumn('project_id').execute()
  await db.schema.dropTable('project').ifExists().execute()
}
