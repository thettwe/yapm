import { type Kysely, sql } from 'kysely'

// One table, and the whole storage surface of attachments. Four decisions are baked into its shape
// rather than into a caller's discipline:
//
//   1. `team_id` IS THE PERMISSION ANCHOR, not `issue_id`. An image pasted into a not-yet-created
//      issue has no issue for a while, so a model anchored on `issue_id` would have a window where
//      the row is unanchored. `team_id` is known at upload time — it is a required field of the
//      request — and it is what `teamScoped` joins on.
//   2. `ON DELETE SET NULL` ON BOTH ISSUE/COMMENT EDGES, NEVER CASCADE. A deleted comment ORPHANS its files; the
//      GC sweep decides when the bytes die. A cascade would delete the row inside somebody's
//      transaction and leave the bytes on disk — the worst outcome, because the orphan is then
//      invisible. Set-null makes deletion a sweep with a grace window instead.
//   3. `content_type` STORES THE SNIFFED TYPE, never the client's claim. A multipart part's
//      Content-Type is an attacker-controlled string, and storing it to serve it later is the SVG
//      hole with extra steps.
//   4. THERE IS NO `storage_key` COLUMN. The key is `<team_id>/<id>`, derivable from two columns
//      already here. A stored key is a second source of truth that can disagree with the row — and,
//      the reason that matters here, a stored key is one refactor away from being RENDERED.
//
// `bigint` is the one column type in this table that is not already on zero-cache's replication
// path for some other table; it is checked live against the write-worker rather than assumed.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('attachment')
    // Server-minted UUIDv7, returned in the upload response. The CLAUDE.md #4 client-minted rule is
    // about mutator call sites; there is no mutator here at all (design §D5) and the row is only
    // ever created by the REST upload, which owns the bytes in the same request.
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('issue_id', 'uuid', (col) => col.references('issue.id').onDelete('set null'))
    .addColumn('comment_id', 'uuid', (col) => col.references('comment.id').onDelete('set null'))
    // NO FK, and `text` rather than `uuid`: `user` is better-auth's table, created by ITS migrator
    // at boot AFTER the Kysely migrator has run, so a reference to it fails on a fresh instance
    // before better-auth has ever executed. Every other user-shaped column in this repo does the
    // same (`issue.creator_id`, `notification.recipient_id`, `retro.facilitator_id`). The
    // consequence is deliberate rather than merely tolerated: permission is anchored on `team_id`,
    // so a deleted account's files stay readable by the team that owns them instead of vanishing.
    .addColumn('uploader_id', 'text', (col) => col.notNull())
    // As supplied by the client, used for download naming only — never to decide a media type and
    // never interpolated into a header unsanitised.
    .addColumn('filename', 'text', (col) => col.notNull())
    .addColumn('content_type', 'text', (col) => col.notNull())
    .addColumn('byte_size', 'bigint', (col) => col.notNull())
    .addColumn('has_thumbnail', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // The synced read and the `teamScoped` join.
  await db.schema.createIndex('attachment_team_id_idx').on('attachment').column('team_id').execute()

  // The Files list for one issue. Partial, because the column is null for every unattached row and
  // those are the majority during an editing session.
  await sql`create index attachment_issue_id_idx on attachment (issue_id) where issue_id is not null`.execute(
    db,
  )

  // THE SWEEP'S INDEX. `issue_id is null and comment_id is null` is the orphan predicate, and
  // ordering by `created_at` inside it is how the pass is bounded without a sequential scan of every
  // attachment in the instance.
  await sql`
    create index attachment_orphan_idx on attachment (created_at)
    where issue_id is null and comment_id is null
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('attachment').ifExists().execute()
}
