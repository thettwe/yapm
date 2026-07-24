import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('issue')
    .addColumn('needs_triage', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute()

  await db.schema
    .createIndex('issue_team_id_needs_triage_idx')
    .on('issue')
    .columns(['team_id', 'needs_triage'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('issue').dropColumn('needs_triage').execute()
}
