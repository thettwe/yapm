import { type Kysely, sql } from 'kysely'

const STATUS_CHECK = sql`status in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled')`
const PRIORITY_CHECK = sql`priority in ('no_priority', 'low', 'medium', 'high', 'urgent')`
const GROUPING_CHECK = sql`grouping in ('status', 'assignee', 'priority', 'label', 'none')`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('issue')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('number', 'integer')
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('description', 'jsonb')
    .addColumn('status', 'text', (col) => col.notNull().check(STATUS_CHECK))
    .addColumn('priority', 'text', (col) => col.notNull().check(PRIORITY_CHECK))
    .addColumn('assignee_id', 'text')
    .addColumn('creator_id', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('label')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('color', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('label_team_id_name_key', ['team_id', 'name'])
    .execute()

  await db.schema
    .createTable('issue_label')
    .addColumn('issue_id', 'uuid', (col) =>
      col.notNull().references('issue.id').onDelete('cascade'),
    )
    .addColumn('label_id', 'uuid', (col) =>
      col.notNull().references('label.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('issue_label_pkey', ['issue_id', 'label_id'])
    .execute()

  await db.schema
    .createTable('comment')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('issue_id', 'uuid', (col) =>
      col.notNull().references('issue.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('author_id', 'text', (col) => col.notNull())
    .addColumn('body', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('saved_view')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('filter', 'jsonb', (col) => col.notNull())
    .addColumn('grouping', 'text', (col) => col.notNull().check(GROUPING_CHECK))
    .addColumn('sort', 'jsonb', (col) => col.notNull())
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('issue_sequence')
    .addColumn('team_id', 'uuid', (col) =>
      col.primaryKey().references('team.id').onDelete('cascade'),
    )
    .addColumn('next_number', 'bigint', (col) => col.notNull().defaultTo(1))
    .execute()

  await db.schema.createIndex('issue_team_id_idx').on('issue').column('team_id').execute()

  await db.schema.createIndex('issue_assignee_id_idx').on('issue').column('assignee_id').execute()

  await db.schema
    .createIndex('issue_team_id_number_key')
    .unique()
    .on('issue')
    .columns(['team_id', 'number'])
    .where('number', 'is not', null)
    .execute()

  await db.schema.createIndex('label_team_id_idx').on('label').column('team_id').execute()

  await db.schema
    .createIndex('issue_label_label_id_idx')
    .on('issue_label')
    .column('label_id')
    .execute()

  await db.schema.createIndex('comment_issue_id_idx').on('comment').column('issue_id').execute()

  await db.schema.createIndex('saved_view_team_id_idx').on('saved_view').column('team_id').execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('issue_sequence').ifExists().execute()
  await db.schema.dropTable('saved_view').ifExists().execute()
  await db.schema.dropTable('comment').ifExists().execute()
  await db.schema.dropTable('issue_label').ifExists().execute()
  await db.schema.dropTable('label').ifExists().execute()
  await db.schema.dropTable('issue').ifExists().execute()
}
