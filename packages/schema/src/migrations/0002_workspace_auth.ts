import { type Kysely, sql } from 'kysely'

const ROLE_CHECK = sql`role in ('admin', 'member', 'viewer')`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('workspace_member')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspace.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'text', (col) => col.notNull())
    .addColumn('role', 'text', (col) => col.notNull().check(ROLE_CHECK))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('workspace_member_user_id_key', ['user_id'])
    .execute()

  await db.schema
    .createTable('team')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspace.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('key', 'text', (col) => col.notNull())
    .addColumn('archived_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('team_key_key', ['key'])
    .execute()

  await db.schema
    .createTable('team_membership')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('user_id', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('team_membership_team_id_user_id_key', ['team_id', 'user_id'])
    .execute()

  await db.schema
    .createTable('invite')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspace.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (col) => col.references('team.id').onDelete('set null'))
    .addColumn('email', 'text')
    .addColumn('role', 'text', (col) => col.notNull().check(ROLE_CHECK))
    .addColumn('token', 'text', (col) => col.notNull())
    .addColumn('created_by', 'text', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('invite_token_key', ['token'])
    .execute()

  await db.schema
    .createIndex('workspace_member_workspace_id_idx')
    .on('workspace_member')
    .column('workspace_id')
    .execute()

  await db.schema.createIndex('team_workspace_id_idx').on('team').column('workspace_id').execute()

  await db.schema
    .createIndex('team_membership_user_id_idx')
    .on('team_membership')
    .column('user_id')
    .execute()

  await db.schema
    .createIndex('invite_workspace_id_idx')
    .on('invite')
    .column('workspace_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('invite').ifExists().execute()
  await db.schema.dropTable('team_membership').ifExists().execute()
  await db.schema.dropTable('team').ifExists().execute()
  await db.schema.dropTable('workspace_member').ifExists().execute()
}
