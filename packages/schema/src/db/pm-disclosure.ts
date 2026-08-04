import type { Kysely } from 'kysely'
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
