import { type Kysely, sql } from 'kysely'
import type { DB } from './types.js'

export interface ReplicationSlot {
  name: string
  plugin: string
  active: boolean
  restartLsn: string | null
  walStatus: string | null
}

export interface ReplicationStatus {
  walLevel: string
  slots: ReplicationSlot[]
}

interface SettingRow {
  wal_level: string
}

interface SlotRow {
  slot_name: string
  plugin: string
  active: boolean
  restart_lsn: string | null
  wal_status: string | null
}

export async function readReplicationStatus(db: Kysely<DB>): Promise<ReplicationStatus> {
  const setting = await sql<SettingRow>`select current_setting('wal_level') as wal_level`.execute(
    db,
  )

  const slots = await sql<SlotRow>`
    select slot_name,
           plugin,
           active,
           restart_lsn::text as restart_lsn,
           wal_status
    from pg_replication_slots
    where slot_type = 'logical' and database = current_database()
    order by slot_name
  `.execute(db)

  return {
    walLevel: setting.rows[0]?.wal_level ?? 'unknown',
    slots: slots.rows.map((row) => ({
      name: row.slot_name,
      plugin: row.plugin,
      active: row.active,
      restartLsn: row.restart_lsn,
      walStatus: row.wal_status,
    })),
  }
}

export function describeReplicationStatus(status: ReplicationStatus): string {
  if (status.slots.length === 0) {
    return `wal_level=${status.walLevel}, no logical replication slot yet`
  }
  const slots = status.slots
    .map(
      (slot) =>
        `${slot.name} (${slot.plugin}, ${slot.active ? 'active' : 'inactive'}, wal_status=${slot.walStatus ?? 'unknown'})`,
    )
    .join(', ')
  return `wal_level=${status.walLevel}, slots: ${slots}`
}

// The app boots before zero-cache, so "no slot yet" is healthy. An invalidated slot
// is not: sync is dead until zero-cache rebuilds its replica.
export function assertReplicationHealthy(status: ReplicationStatus): string {
  if (status.walLevel !== 'logical') {
    throw new Error(
      `wal_level is "${status.walLevel}", expected "logical" — zero-cache cannot replicate (start Postgres with -c wal_level=logical)`,
    )
  }

  const broken = status.slots.filter(
    (slot) => slot.walStatus === 'lost' || slot.restartLsn === null,
  )

  if (broken.length > 0) {
    const detail = broken
      .map((slot) => `${slot.name} (wal_status=${slot.walStatus ?? 'unknown'})`)
      .join(', ')
    throw new Error(
      `logical replication slot invalidated: ${detail} — zero-cache must resync its replica`,
    )
  }

  return describeReplicationStatus(status)
}
