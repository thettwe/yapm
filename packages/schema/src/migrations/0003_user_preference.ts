import { type Kysely, sql } from 'kysely'

const THEME_CHECK = sql`theme in ('warm', 'focused', 'editorial')`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('user_preference')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('user_id', 'text', (col) => col.notNull())
    .addColumn('theme', 'text', (col) => col.notNull().defaultTo('warm').check(THEME_CHECK))
    .addColumn('accent', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('user_preference_user_id_key', ['user_id'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('user_preference').ifExists().execute()
}
