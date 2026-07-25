import type { Kysely } from 'kysely'

// Records, for an issue that a completing cycle rolled forward, the cycle it was carried OUT of.
// Set by the shared `cycle.complete` mutator at rollover (client + server, deterministically, no
// minted id) so a completed cycle's carried set survives the re-point: without it the cycle view
// can only see the done/canceled issues still pointing at the cycle, so every completed cycle
// reports carried=0 and an undercounted total. Nullable (only carried issues carry it), FK to the
// origin cycle with ON DELETE SET NULL so deleting the origin cycle simply clears the marker.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('issue')
    .addColumn('rolled_over_from_cycle_id', 'uuid', (col) =>
      col.references('cycle.id').onDelete('set null'),
    )
    .execute()

  await db.schema
    .createIndex('issue_rolled_over_from_cycle_id_idx')
    .on('issue')
    .column('rolled_over_from_cycle_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('issue').dropColumn('rolled_over_from_cycle_id').execute()
}
