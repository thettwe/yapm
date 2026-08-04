import type { Kysely, SqlBool } from 'kysely'
import { sql } from 'kysely'
import {
  type AiDisclosureEvent,
  type AuthContext,
  canManage,
  SYSTEM_ACTOR_ID,
} from '../zero/context.js'
import {
  type AiConfigData,
  emptyAiConfigData,
  getAiConfig,
  type PmDisclosureTeamPolicy,
  upsertAiConfig,
} from './ai-config.js'
import { ConnectorAuthorizationError } from './connector.js'
import type { DB } from './types.js'

// THE FOUR SWITCHES COLLAPSE INTO ONE RESOLVER, and that is the whole point of this module.
//
// A ZQL predicate runs synchronously and cannot read Postgres, so the disclosure entitlement has to
// be resolved here and carried on `AuthContext`. One resolver in SQL, one predicate in ZQL, and each
// switch has exactly one meaning — a second place that decides "is this person allowed" is how the
// two answers drift.

const EMPTY_TEAM_POLICY: PmDisclosureTeamPolicy = { pmVisible: false, audience: [] }

async function workspaceOf(db: Kysely<DB>, userId: string): Promise<string | null> {
  const row = await db
    .selectFrom('workspace_member')
    .select('workspace_id')
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return row?.workspace_id ?? null
}

async function configFor(db: Kysely<DB>, workspaceId: string): Promise<AiConfigData | null> {
  const config = await getAiConfig(db, workspaceId)
  return config?.data ?? null
}

// The teams whose PM digests this user may read once a human publishes them. Every denial path
// returns the SAME empty array, so nothing downstream can distinguish "not a member" from "the kill
// switch is on" from "nobody named you".
//
// Not a workspace member ⇒ `[]`. No `ai` config row ⇒ `[]`. Workspace switch off ⇒ `[]`. Kill switch
// on ⇒ `[]`. Otherwise: the SORTED team ids where `pmVisible` is true and the audience contains this
// user. Sorted so the credential is stable across calls — an unstable array would re-mint the
// client's `AuthContext` on every refresh and tear down the Zero client for nothing.
//
// Note what is NOT here: no admin bypass. Membership of the list is the entitlement.
export async function resolvePmAudienceTeamIds(db: Kysely<DB>, userId: string): Promise<string[]> {
  const workspaceId = await workspaceOf(db, userId)
  if (workspaceId === null) return []
  const data = await configFor(db, workspaceId)
  if (data === null) return []
  const { pmDisclosure } = data
  if (!pmDisclosure.enabled || pmDisclosure.killed) return []
  return Object.entries(pmDisclosure.teams)
    .filter(([, policy]) => policy.pmVisible && policy.audience.includes(userId))
    .map(([teamId]) => teamId)
    .sort()
}

// The job's gate, read before any model call: a team whose `pmVisible` is off costs no tokens.
// Returns the all-off policy when the workspace switch is off or the kill switch is set, so a caller
// that only checks `pmVisible` still gets the right answer.
export async function pmTeamPolicy(
  db: Kysely<DB>,
  workspaceId: string,
  teamId: string,
): Promise<PmDisclosureTeamPolicy> {
  const data = await configFor(db, workspaceId)
  if (data === null) return EMPTY_TEAM_POLICY
  const { pmDisclosure } = data
  if (!pmDisclosure.enabled || pmDisclosure.killed) return EMPTY_TEAM_POLICY
  return pmDisclosure.teams[teamId] ?? EMPTY_TEAM_POLICY
}

// How many readers a team's audience holds RIGHT NOW. Stamped onto the row at publish, which makes
// the producing team's "shared with N readers outside this team" marker a snapshot of the moment
// they released it rather than a live count that changes silently when an admin edits the list.
export async function audienceSize(
  db: Kysely<DB>,
  workspaceId: string,
  teamId: string,
): Promise<number> {
  const policy = await pmTeamPolicy(db, workspaceId, teamId)
  return policy.pmVisible ? new Set(policy.audience).size : 0
}

// yapm-computed metadata ONLY. The type is the enforcement: there is no `string` field a caller
// could put a summary in, because an audit record that quotes the disclosure is a second copy of the
// disclosure sitting outside the kill switch. Widening this type is the thing to refuse in review.
export interface DisclosureAuditDetail {
  readonly audienceSize?: number
  readonly status?: string
  readonly enabled?: boolean
  readonly killed?: boolean
  readonly pmVisible?: boolean
  // Team ids whose entry this policy write touched — ids, never names, and never the audience.
  readonly teamsChanged?: readonly string[]
}

export interface DisclosureAuditEntry {
  // Client-minted UUIDv7, minted at the CALL SITE like every other id in this codebase.
  readonly id: string
  readonly workspaceId: string
  readonly teamId?: string | null
  // Null for a generation: the system principal is a reserved literal, not a `user` row.
  readonly actorId?: string | null
  readonly event: AiDisclosureEvent
  readonly pmDigestId?: string | null
  readonly detail?: DisclosureAuditDetail
}

// THE ONE WRITER of `ai_disclosure_audit`. Everything that changes the policy or moves content
// across the boundary comes through here, so "every disclosure event is recorded" is a property of
// one function rather than a convention spread over four call sites.
export async function recordDisclosureAudit(
  db: Kysely<DB>,
  entry: DisclosureAuditEntry,
): Promise<void> {
  await db
    .insertInto('ai_disclosure_audit')
    .values({
      id: entry.id,
      workspace_id: entry.workspaceId,
      team_id: entry.teamId ?? null,
      actor_id: entry.actorId === SYSTEM_ACTOR_ID ? null : (entry.actorId ?? null),
      event: entry.event,
      pm_digest_id: entry.pmDigestId ?? null,
      detail: { ...(entry.detail ?? {}) },
    })
    .execute()
}

export interface SetPmDisclosurePolicyOptions {
  // Client-minted UUIDv7 for the `ai` config row (used only if it does not exist yet).
  readonly configId: string
  // Client-minted UUIDv7 for the audit row.
  readonly auditId: string
  readonly workspaceId: string
  readonly enabled?: boolean
  readonly killed?: boolean
  // MERGED per team, not replaced: an admin editing one team's audience must not silently clear
  // every other team's. Omitted fields within a team entry keep their stored value.
  readonly teams?: Readonly<Record<string, Partial<PmDisclosureTeamPolicy>>>
}

// Admin-gated twice over: `upsertAiConfig` goes through `upsertConnectorConfig`'s `canManage` gate,
// and this asserts it itself so a direct call can never write the policy either (the belt-and-braces
// shape `getRedactedAiStatus` already uses).
//
// Writes exactly ONE `policy_changed` audit row per call, describing WHAT changed — which switches,
// which team ids — and never the audience itself. A record that listed the readers would be a
// per-person roster of who may read a team's work, sitting in a table nobody can turn off.
export async function setPmDisclosurePolicy(
  db: Kysely<DB>,
  ctx: AuthContext | undefined,
  options: SetPmDisclosurePolicyOptions,
): Promise<void> {
  if (!canManage(ctx)) throw new ConnectorAuthorizationError()

  const existing = await configFor(db, options.workspaceId)
  const current = existing ?? emptyAiConfigData()
  const teams: Record<string, PmDisclosureTeamPolicy> = { ...current.pmDisclosure.teams }
  for (const [teamId, patch] of Object.entries(options.teams ?? {})) {
    const before = teams[teamId] ?? EMPTY_TEAM_POLICY
    teams[teamId] = {
      pmVisible: patch.pmVisible ?? before.pmVisible,
      // Deduplicated and sorted so the stored list is canonical and a no-op write is a no-op.
      audience:
        patch.audience === undefined ? before.audience : [...new Set(patch.audience)].sort(),
    }
  }

  const nextConfig: AiConfigData = {
    ...current,
    pmDisclosure: {
      enabled: options.enabled ?? current.pmDisclosure.enabled,
      killed: options.killed ?? current.pmDisclosure.killed,
      teams,
    },
  }

  await upsertAiConfig(db, ctx, {
    id: options.configId,
    workspaceId: options.workspaceId,
    config: nextConfig,
  })

  await recordDisclosureAudit(db, {
    id: options.auditId,
    workspaceId: options.workspaceId,
    actorId: ctx.userID,
    event: 'policy_changed',
    detail: {
      enabled: nextConfig.pmDisclosure.enabled,
      killed: nextConfig.pmDisclosure.killed,
      teamsChanged: Object.keys(options.teams ?? {}).sort(),
    },
  })
}

// Retention. `ai_disclosure_audit` is append-only and grows with ACTIVITY — a row per policy edit,
// per generation, per publication, per retraction, forever — and nothing else in the product ever
// removes one. This is the only bound it has.
//
// It deletes audit records and NOTHING ELSE. Not `pm_digest`, not `cycle_digest`: a digest grows at
// one row per cycle per team, the rate `cycle_digest` has grown since change 9 without ever needing
// a sweep, and deleting a published one would silently shrink a reader's list — removing something
// the product told them they had, which is a worse trust outcome than storage.
//
// Idempotent by construction: a second run against the same cutoff deletes nothing.
export async function deleteDisclosureAuditOlderThan(
  db: Kysely<DB>,
  before: Date,
): Promise<number> {
  const result = await db
    .deleteFrom('ai_disclosure_audit')
    .where(sql<SqlBool>`${sql.ref('ai_disclosure_audit.created_at')} < ${before}`)
    .executeTakeFirst()
  return Number(result?.numDeletedRows ?? 0)
}

// The admin audit view's read: what was disclosed, when, by whom, and to how many readers.
//
// Three properties are structural rather than editorial, and they are what keep an audit log from
// becoming the per-person surface VISION #8 bans:
//
//  1. **The totals are grouped by TEAM.** There is no actor-keyed field on either shape for a count
//     to be added to later, so "who publishes most" is not one query away — it is a shape change a
//     reviewer would have to approve.
//  2. **No read is reportable, because none is recorded.** `AI_DISCLOSURE_EVENTS` has four values —
//     `policy_changed`, `generated`, `published`, `unpublished` — and none of them is a read. Nothing
//     in the schema records that a reader opened a digest.
//  3. **The audience is never returned.** `setPmDisclosurePolicy` records only WHICH team ids a write
//     touched, never who is on a list, and this read has no other source for one.
//
// The actor IS named, deliberately: the actor of a policy change or a release is an attribute of one
// discrete governance action in an admin-only log, not a metric. LEFT-joined, because `actor_id`
// carries no FK by design (change 20's I4) and a departed admin's record must survive them.
const DISCLOSURE_AUDIT_RECENT_LIMIT = 50

// The three events that HAPPEN TO A TEAM, and the reason `policy_changed` is not among them: a policy
// write is workspace-scoped — one record per call describing which switches moved and which team ids
// the write touched — so it has no single team to be totalled under. Counting it per team would have
// meant a "0 policy changes" on every team forever and every real edit filed under a workspace row.
// Policy changes are reported in the recent list instead, naming the teams they touched.
export interface DisclosureAuditTeamTotals {
  // Null when the team is gone: `team_id` is `on delete set null`, so a swept team's history survives
  // it rather than vanishing from the record.
  readonly teamId: string | null
  readonly teamName: string | null
  readonly generated: number
  readonly published: number
  readonly unpublished: number
}

export interface DisclosureAuditEvent {
  readonly id: string
  readonly createdAt: number
  readonly event: AiDisclosureEvent
  readonly teamId: string | null
  readonly teamName: string | null
  // The display name of whoever acted, or null for a system generation and for an account that has
  // since been deleted. The two are indistinguishable here and that costs nothing an admin needs.
  readonly actorName: string | null
  // The names of the teams a policy write touched, resolved from the ids in `detail.teamsChanged` so
  // an admin reads "Policy changed · Platform, Payments" rather than a pair of UUIDs. Empty for every
  // other event, and for an id whose team has since been deleted. NAMES, never audiences: the record
  // has no source for who is on a list, and this read adds none.
  readonly teamsChangedNames: readonly string[]
  // yapm-computed metadata only. `DisclosureAuditDetail` has no field capable of carrying content.
  readonly detail: DisclosureAuditDetail
}

export interface DisclosureAuditLog {
  readonly totals: readonly DisclosureAuditTeamTotals[]
  readonly recent: readonly DisclosureAuditEvent[]
}

export interface DisclosureAuditLogOptions {
  readonly limit?: number
}

interface DisclosureEventCounts {
  generated: number
  published: number
  unpublished: number
}

function emptyCounts(): DisclosureEventCounts {
  return { generated: 0, published: 0, unpublished: 0 }
}

const TEAM_SCOPED_EVENTS = ['generated', 'published', 'unpublished'] as const

type TeamScopedEvent = (typeof TEAM_SCOPED_EVENTS)[number]

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_SHAPE.test(value)
}

export async function disclosureAuditLogForWorkspace(
  db: Kysely<DB>,
  workspaceId: string,
  options: DisclosureAuditLogOptions = {},
): Promise<DisclosureAuditLog> {
  const counted = await db
    .selectFrom('ai_disclosure_audit')
    .leftJoin('team', 'team.id', 'ai_disclosure_audit.team_id')
    .select((eb) => [
      'ai_disclosure_audit.team_id as teamId',
      'team.name as teamName',
      'ai_disclosure_audit.event as event',
      eb.fn.countAll().as('count'),
    ])
    .where('ai_disclosure_audit.workspace_id', '=', workspaceId)
    .where('ai_disclosure_audit.event', 'in', TEAM_SCOPED_EVENTS)
    .groupBy(['ai_disclosure_audit.team_id', 'team.name', 'ai_disclosure_audit.event'])
    .execute()

  const teams = new Map<
    string,
    { teamId: string | null; name: string | null; counts: DisclosureEventCounts }
  >()
  for (const row of counted) {
    const key = row.teamId ?? ''
    const team = teams.get(key) ?? { teamId: row.teamId, name: row.teamName, counts: emptyCounts() }
    team.counts[row.event as TeamScopedEvent] += Number(row.count)
    teams.set(key, team)
  }

  const totals: DisclosureAuditTeamTotals[] = [...teams.values()]
    .map((team) => ({
      teamId: team.teamId,
      teamName: team.name,
      generated: team.counts.generated,
      published: team.counts.published,
      unpublished: team.counts.unpublished,
    }))
    // A deleted team's rows (no team) sort last, so the named teams read first.
    .sort((a, b) => (a.teamName ?? '￿').localeCompare(b.teamName ?? '￿'))

  const recent = await db
    .selectFrom('ai_disclosure_audit')
    .leftJoin('team', 'team.id', 'ai_disclosure_audit.team_id')
    .leftJoin('user as actor', 'actor.id', 'ai_disclosure_audit.actor_id')
    .select([
      'ai_disclosure_audit.id as id',
      // `created_at` is a DB-defaulted (`Generated<Timestamp>`) column whose selected type this
      // project's TS config does not unwrap to `Date`; a raw reference reads it cleanly, the same
      // shape the delete's predicate below uses.
      sql<Date>`${sql.ref('ai_disclosure_audit.created_at')}`.as('createdAt'),
      'ai_disclosure_audit.event as event',
      'ai_disclosure_audit.team_id as teamId',
      'team.name as teamName',
      'actor.name as actorName',
      'ai_disclosure_audit.detail as detail',
    ])
    .where('ai_disclosure_audit.workspace_id', '=', workspaceId)
    .orderBy('ai_disclosure_audit.created_at', 'desc')
    .limit(options.limit ?? DISCLOSURE_AUDIT_RECENT_LIMIT)
    .execute()

  // The team ids a policy write touched, resolved to names in ONE query over the caller's own
  // workspace. Scoped to it deliberately: a `teamsChanged` id from another workspace could not be
  // written by this code, and if one ever were, it would resolve to nothing here rather than
  // disclosing a name across the boundary.
  //
  // Filtered to uuid shape first. `detail` is jsonb — whatever a past or future writer put there is
  // what comes back — and `team.id` is a uuid column, so one non-uuid string in the `in` list is a
  // Postgres cast error that fails the ENTIRE workspace's audit read, permanently, for one bad row.
  // An unrecognizable id degrades to an unnamed team, which is what an id whose team was deleted
  // already does.
  const changedIds = new Set(
    recent
      .flatMap((row) => ((row.detail ?? {}) as DisclosureAuditDetail).teamsChanged ?? [])
      .filter(isUuid),
  )
  const namesById = new Map<string, string>()
  if (changedIds.size > 0) {
    const named = await db
      .selectFrom('team')
      .select(['team.id as id', 'team.name as name'])
      .where('team.workspace_id', '=', workspaceId)
      .where('team.id', 'in', [...changedIds])
      .execute()
    for (const team of named) namesById.set(team.id, team.name)
  }

  return {
    totals,
    recent: recent.map((row) => {
      const detail = (row.detail ?? {}) as DisclosureAuditDetail
      return {
        id: row.id,
        createdAt: row.createdAt.getTime(),
        event: row.event,
        teamId: row.teamId,
        teamName: row.teamName,
        actorName: row.actorName,
        teamsChangedNames: (detail.teamsChanged ?? [])
          .map((teamId) => namesById.get(teamId))
          .filter((name): name is string => name !== undefined)
          .sort((a, b) => a.localeCompare(b)),
        detail,
      }
    }),
  }
}
