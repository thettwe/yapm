import {
  defineMutator,
  defineMutators,
  type ReadonlyJSONValue,
  type Transaction,
} from '@rocicorp/zero'
import * as z from 'zod'
import { sanitizeRichText } from '../rich-text/plaintext.js'
import {
  type AuthContext,
  type CycleStatus,
  canManage,
  canWrite,
  DEFAULT_EMAIL_NOTIFICATION_MODE,
  DEFAULT_VOTES_PER_PARTICIPANT,
  EMAIL_NOTIFICATION_MODES,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssueStatus,
  isAuthenticated,
  isMember,
  MAX_VOTES_PER_PARTICIPANT,
  MIN_VOTES_PER_PARTICIPANT,
  NOTIFICATION_KINDS,
  NOTIFICATION_SYNC_LIMIT,
  type NotificationKind,
  PROJECT_STATUSES,
  RETRO_COLUMN_ACCENTS,
  RETRO_FORMATS,
  RETRO_PHASES,
  RETRO_VOTE_TARGETS,
  type RetroColumnAccent,
  type RetroFormat,
  type RetroPhase,
  type RetroVoteTarget,
  type SubscriptionState,
  SYSTEM_ACTOR_ID,
  THEME_PRESETS,
} from './context.js'
import { type CycleOrderRow, isUnfinished, nextCycleId } from './cycles.js'
import { MutationError, MutationErrorCode } from './errors.js'
import { issueFilterSchema, issueGroupingSchema, issueSortSchema } from './filter.js'
import {
  isAdjacentPhase,
  isRetroWriteAllowed,
  type RetroWriteOp,
  retroColumnTemplate,
} from './retro/phase.js'
import { retroSeedRefSchema } from './retro/seed.js'
import { zql } from './schema.js'

export const WORKSPACE_NAME_MAX_LENGTH = 200
export const TEAM_NAME_MAX_LENGTH = 200
export const TEAM_KEY_MAX_LENGTH = 16
export const ISSUE_TITLE_MAX_LENGTH = 300
export const CYCLE_NAME_MAX_LENGTH = 200
export const PROJECT_NAME_MAX_LENGTH = 200
export const LABEL_NAME_MAX_LENGTH = 60
export const SAVED_VIEW_NAME_MAX_LENGTH = 100

const TEAM_KEY_PATTERN = /^[A-Z][A-Z0-9]*$/u

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu
const RGB_COLOR = /^rgba?\([^)]+\)$/iu
const OKLCH_COLOR = /^oklch\([^)]+\)$/iu

// A shared, presentation-free color validator (the schema layer stores and validates the
// string; the sRGB/contrast math lives in packages/ui). Accepts hex, rgb()/rgba(), oklch().
export function isParseableColor(value: string): boolean {
  const v = value.trim()
  return HEX_COLOR.test(v) || RGB_COLOR.test(v) || OKLCH_COLOR.test(v)
}

const roleSchema = z.enum(['admin', 'member', 'viewer'])
const timestamp = z.number().int().positive()
const issueStatusSchema = z.enum(ISSUE_STATUSES)
const issuePrioritySchema = z.enum(ISSUE_PRIORITIES)
const projectStatusSchema = z.enum(PROJECT_STATUSES)

// Runtime-validated by the real filter/sort schemas, but typed as JSON so the mutator arg
// validators satisfy Zero's `ReadonlyJSONValue` input/output constraint (a structured filter
// is JSON, TS just can't prove the index signature).
function jsonArg<T>(schema: z.ZodType<T>) {
  return z.custom<ReadonlyJSONValue>((value) => schema.safeParse(value).success, {
    message: 'invalid structured value',
  })
}
const filterArg = jsonArg(issueFilterSchema)
const sortArg = jsonArg(issueSortSchema)

// A TipTap document, validated structurally without stripping its nodes (z.custom passes the
// value through untouched, unlike z.object which would drop unknown content keys).
const richTextSchema = z.custom<ReadonlyJSONValue>(
  (value) =>
    typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'doc',
  { message: 'must be a TipTap document' },
)

export function normalizeName(name: string): string {
  return name.replace(/\s+/gu, ' ').trim()
}

export function normalizeWorkspaceName(name: string): string {
  return normalizeName(name)
}

export function normalizeTeamKey(key: string): string {
  return key.replace(/\s+/gu, '').trim().toUpperCase()
}

function notAuthorized(id: string): MutationError {
  return new MutationError(
    'Not authorized to perform this action',
    MutationErrorCode.notAuthorized,
    id,
  )
}

function assertValidName(name: string, id: string, maxLength: number): string {
  const normalized = normalizeName(name)

  if (normalized.length === 0) {
    throw new MutationError('Name cannot be empty', MutationErrorCode.invalidName, id)
  }

  if (normalized.length > maxLength) {
    throw new MutationError(
      `Name cannot be longer than ${maxLength} characters`,
      MutationErrorCode.invalidName,
      id,
    )
  }

  return normalized
}

async function assertNotLastAdmin(tx: Transaction, id: string): Promise<void> {
  const admins = await tx.run(zql.workspace_member.where('role', 'admin'))
  if (admins.length <= 1) {
    throw new MutationError(
      'The last remaining admin cannot be removed or demoted',
      MutationErrorCode.lastAdmin,
      id,
    )
  }
}

// Team-scoped write gate. A workspace admin may write to any team; otherwise the caller
// must be a member of the target team. The caller's own membership is read, never the
// target row, so this leaks nothing about the target's existence.
async function assertTeamAccess(
  tx: Transaction,
  ctx: AuthContext,
  teamId: string,
  id: string,
): Promise<void> {
  if (ctx.role === 'admin') return
  const membership = await tx.run(
    zql.team_membership.where('teamId', teamId).where('userId', ctx.userID).one(),
  )
  if (!membership) throw notAuthorized(id)
}

async function assertTeamMember(
  tx: Transaction,
  teamId: string,
  userId: string,
  id: string,
): Promise<void> {
  const membership = await tx.run(
    zql.team_membership.where('teamId', teamId).where('userId', userId).one(),
  )
  if (!membership) {
    throw new MutationError('User is not a member of the team', MutationErrorCode.crossTeam, id)
  }
}

interface IssueRow {
  id: string
  teamId: string
}

// Load an existing issue and assert the caller's TEAM ACCESS — the admin bypass included. This is
// the READ predicate: it decides who can see the issue, and therefore also who can be mentioned on
// it and who can follow it. The row is read and a generic not-authorized is thrown for both
// "missing" and "wrong team", so a private issue's existence never leaks.
async function loadIssueForTeamAccess(
  tx: Transaction,
  ctx: AuthContext,
  issueId: string,
): Promise<IssueRow> {
  const issue = (await tx.run(zql.issue.where('id', issueId).one())) as IssueRow | undefined
  if (!issue) throw notAuthorized(issueId)
  await assertTeamAccess(tx, ctx, issue.teamId, issueId)
  return issue
}

// The same two steps for a WRITE. The role-capability gate (`canWrite`) must run in the caller
// before this so a viewer/non-member is rejected before any existence check.
async function loadIssueForWrite(
  tx: Transaction,
  ctx: AuthContext,
  issueId: string,
): Promise<IssueRow> {
  return await loadIssueForTeamAccess(tx, ctx, issueId)
}

function assertParseableColor(color: string, id: string): string {
  const value = color.trim()
  if (!isParseableColor(value)) {
    throw new MutationError('Color must be a parseable color', MutationErrorCode.invalidColor, id)
  }
  return value
}

export const renameWorkspaceArgs = z.object({
  id: z.string().min(1),
  name: z.string(),
  updatedAt: timestamp,
})

export type RenameWorkspaceArgs = z.infer<typeof renameWorkspaceArgs>

export function assertRenameWorkspaceAllowed(
  args: RenameWorkspaceArgs,
  ctx: AuthContext | undefined,
): string {
  if (!canManage(ctx)) {
    throw new MutationError(
      'Not authorized to rename this workspace',
      MutationErrorCode.notAuthorized,
      args.id,
    )
  }

  const name = normalizeName(args.name)

  if (name.length === 0) {
    throw new MutationError(
      'Workspace name cannot be empty',
      MutationErrorCode.invalidName,
      args.id,
    )
  }

  if (name.length > WORKSPACE_NAME_MAX_LENGTH) {
    throw new MutationError(
      `Workspace name cannot be longer than ${WORKSPACE_NAME_MAX_LENGTH} characters`,
      MutationErrorCode.invalidName,
      args.id,
    )
  }

  return name
}

export const renameWorkspace = defineMutator(renameWorkspaceArgs, async ({ tx, args, ctx }) => {
  const name = assertRenameWorkspaceAllowed(args, ctx)

  await tx.mutate.workspace.update({
    id: args.id,
    name,
    updatedAt: args.updatedAt,
  })
})

export const changeMemberRoleArgs = z.object({
  id: z.string().min(1),
  role: roleSchema,
  updatedAt: timestamp,
})

export const changeMemberRole = defineMutator(changeMemberRoleArgs, async ({ tx, args, ctx }) => {
  if (!canManage(ctx)) throw notAuthorized(args.id)

  const target = await tx.run(zql.workspace_member.where('id', args.id).one())
  if (!target) throw notAuthorized(args.id)

  if (target.role === 'admin' && args.role !== 'admin') {
    await assertNotLastAdmin(tx, args.id)
  }

  await tx.mutate.workspace_member.update({
    id: args.id,
    role: args.role,
    updatedAt: args.updatedAt,
  })
})

export const removeMemberArgs = z.object({
  id: z.string().min(1),
})

export const removeMember = defineMutator(removeMemberArgs, async ({ tx, args, ctx }) => {
  if (!isMember(ctx)) throw notAuthorized(args.id)

  const target = await tx.run(zql.workspace_member.where('id', args.id).one())
  if (!target) throw notAuthorized(args.id)

  if (target.userId !== ctx.userID && !canManage(ctx)) throw notAuthorized(args.id)

  if (target.role === 'admin') {
    await assertNotLastAdmin(tx, args.id)
  }

  await tx.mutate.workspace_member.delete({ id: args.id })
})

export const createTeamArgs = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string(),
  key: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export function assertValidTeamKey(key: string, id: string): string {
  const normalized = normalizeTeamKey(key)

  if (normalized.length === 0 || normalized.length > TEAM_KEY_MAX_LENGTH) {
    throw new MutationError(
      `Team key must be 1 to ${TEAM_KEY_MAX_LENGTH} characters`,
      MutationErrorCode.invalidKey,
      id,
    )
  }

  if (!TEAM_KEY_PATTERN.test(normalized)) {
    throw new MutationError(
      'Team key must start with a letter and contain only letters and digits',
      MutationErrorCode.invalidKey,
      id,
    )
  }

  return normalized
}

export const createTeam = defineMutator(createTeamArgs, async ({ tx, args, ctx }) => {
  if (!canManage(ctx)) throw notAuthorized(args.id)

  const name = assertValidName(args.name, args.id, TEAM_NAME_MAX_LENGTH)
  const key = assertValidTeamKey(args.key, args.id)

  const existing = await tx.run(zql.team.where('key', key).one())
  if (existing) {
    throw new MutationError(
      `A team with key ${key} already exists`,
      MutationErrorCode.duplicateKey,
      args.id,
    )
  }

  await tx.mutate.team.insert({
    id: args.id,
    workspaceId: args.workspaceId,
    name,
    key,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  })
})

export const renameTeamArgs = z.object({
  id: z.string().min(1),
  name: z.string(),
  updatedAt: timestamp,
})

export const renameTeam = defineMutator(renameTeamArgs, async ({ tx, args, ctx }) => {
  if (!canManage(ctx)) throw notAuthorized(args.id)

  const name = assertValidName(args.name, args.id, TEAM_NAME_MAX_LENGTH)

  const target = await tx.run(zql.team.where('id', args.id).one())
  if (!target) throw notAuthorized(args.id)

  await tx.mutate.team.update({ id: args.id, name, updatedAt: args.updatedAt })
})

export const archiveTeamArgs = z.object({
  id: z.string().min(1),
  archivedAt: timestamp,
  updatedAt: timestamp,
})

export const archiveTeam = defineMutator(archiveTeamArgs, async ({ tx, args, ctx }) => {
  if (!canManage(ctx)) throw notAuthorized(args.id)

  const target = await tx.run(zql.team.where('id', args.id).one())
  if (!target) throw notAuthorized(args.id)

  await tx.mutate.team.update({
    id: args.id,
    archivedAt: args.archivedAt,
    updatedAt: args.updatedAt,
  })
})

export const setTeamAutoStatusArgs = z.object({
  id: z.string().min(1),
  // The switch: null is off, any instant is "on, from the moment of this write" — which is what
  // makes enabling safe on an instance whose connector is about to backfill years of merged pull
  // requests. Only null-ness is read; the epoch actually stored is `updatedAt`.
  since: timestamp.nullable(),
  updatedAt: timestamp,
})

export type SetTeamAutoStatusArgs = z.infer<typeof setTeamAutoStatusArgs>

// Opting a team into status automation. `canManage` runs BEFORE the team is loaded, so a
// non-admin learns nothing about whether the id exists. The epoch is minted at the CALL SITE and
// carried in args — a `Date.now()` here would differ between the optimistic and authoritative
// passes and silently move the team's cut-off on every rebase.
//
// "A fresh instant" is a property of THIS mutator, not of one UI call site: enabling stores
// `updatedAt` — the instant of the write itself — and never `since`, whose only job is to say on or
// off. A one-sided clamp would still let a caller pick a FUTURE epoch and leave the team reading
// "On" while no pull-request event can ever satisfy the guard, which is the same replay hazard
// pointed the other way. This matters because the mutator is mounted as an AI tool, where `since`
// is model-supplied while `updatedAt` is minted server-side by `callSiteMintedFields`. It is
// args-derived and therefore identical on every rebase, and a no-op for the web caller, which
// passes one instant as both.
export const setTeamAutoStatus = defineMutator(setTeamAutoStatusArgs, async ({ tx, args, ctx }) => {
  if (!canManage(ctx)) throw notAuthorized(args.id)

  const target = await tx.run(zql.team.where('id', args.id).one())
  if (!target) throw notAuthorized(args.id)

  await tx.mutate.team.update({
    id: args.id,
    autoStatusSince: args.since === null ? null : args.updatedAt,
    updatedAt: args.updatedAt,
  })
})

export const addTeamMemberArgs = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  userId: z.string().min(1),
  createdAt: timestamp,
})

export const addTeamMember = defineMutator(addTeamMemberArgs, async ({ tx, args, ctx }) => {
  if (!isMember(ctx)) throw notAuthorized(args.id)

  if (args.userId !== ctx.userID && !canManage(ctx)) throw notAuthorized(args.id)

  const team = await tx.run(zql.team.where('id', args.teamId).one())
  if (!team || team.archivedAt != null) throw notAuthorized(args.teamId)

  await tx.mutate.team_membership.insert({
    id: args.id,
    teamId: args.teamId,
    userId: args.userId,
    createdAt: args.createdAt,
  })
})

export const removeTeamMemberArgs = z.object({
  id: z.string().min(1),
})

export const removeTeamMember = defineMutator(removeTeamMemberArgs, async ({ tx, args, ctx }) => {
  if (!isMember(ctx)) throw notAuthorized(args.id)

  const membership = await tx.run(zql.team_membership.where('id', args.id).one())
  if (!membership) throw notAuthorized(args.id)

  if (membership.userId !== ctx.userID && !canManage(ctx)) throw notAuthorized(args.id)

  await tx.mutate.team_membership.delete({ id: args.id })
})

export const createInviteArgs = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  token: z.string().min(1),
  role: roleSchema,
  email: z.string().email().optional(),
  teamId: z.string().min(1).optional(),
  expiresAt: timestamp,
  createdAt: timestamp,
})

export const createInvite = defineMutator(createInviteArgs, async ({ tx, args, ctx }) => {
  if (!canManage(ctx)) throw notAuthorized(args.id)

  await tx.mutate.invite.insert({
    id: args.id,
    workspaceId: args.workspaceId,
    token: args.token,
    role: args.role,
    email: args.email,
    teamId: args.teamId,
    createdBy: ctx.userID,
    expiresAt: args.expiresAt,
    createdAt: args.createdAt,
  })
})

export const revokeInviteArgs = z.object({
  id: z.string().min(1),
  revokedAt: timestamp,
})

export const revokeInvite = defineMutator(revokeInviteArgs, async ({ tx, args, ctx }) => {
  if (!canManage(ctx)) throw notAuthorized(args.id)

  const invite = await tx.run(zql.invite.where('id', args.id).one())
  if (!invite) throw notAuthorized(args.id)

  await tx.mutate.invite.update({ id: args.id, revokedAt: args.revokedAt })
})

export const setPreferenceArgs = z.object({
  id: z.string().min(1),
  theme: z.enum(THEME_PRESETS),
  accent: z.string().nullable(),
  // Optional so every existing caller (the theme control) keeps working unchanged; omitting it
  // preserves whatever mode the row already carries rather than resetting it.
  emailNotifications: z.enum(EMAIL_NOTIFICATION_MODES).optional(),
  updatedAt: timestamp,
})

export type SetPreferenceArgs = z.infer<typeof setPreferenceArgs>

// Owner-only, gated on authentication (not membership). `user_id` is always taken from the
// verified ctx, never args; the accent string is validated (unparseable colors rejected on
// both client and server); the single per-user row is upserted with a call-site-minted id.
export const setPreference = defineMutator(setPreferenceArgs, async ({ tx, args, ctx }) => {
  if (!isAuthenticated(ctx)) throw notAuthorized(args.id)

  if (args.accent !== null && !isParseableColor(args.accent)) {
    throw new MutationError(
      'Accent must be a parseable color',
      MutationErrorCode.invalidColor,
      args.id,
    )
  }

  const existing = await tx.run(zql.user_preference.where('userId', ctx.userID).one())

  if (existing) {
    await tx.mutate.user_preference.update({
      id: existing.id,
      theme: args.theme,
      accent: args.accent,
      emailNotifications:
        args.emailNotifications ?? existing.emailNotifications ?? DEFAULT_EMAIL_NOTIFICATION_MODE,
      updatedAt: args.updatedAt,
    })
    return
  }

  await tx.mutate.user_preference.insert({
    id: args.id,
    userId: ctx.userID,
    theme: args.theme,
    accent: args.accent,
    emailNotifications: args.emailNotifications ?? DEFAULT_EMAIL_NOTIFICATION_MODE,
    createdAt: args.updatedAt,
    updatedAt: args.updatedAt,
  })
})

export const markNotificationReadArgs = z.object({
  kind: z.enum(NOTIFICATION_KINDS),
  subjectId: z.string().min(1),
  eventKey: z.string().min(1),
  readAt: timestamp.nullable(),
})

export type MarkNotificationReadArgs = z.infer<typeof markNotificationReadArgs>

// The row is addressed by its four primary-key columns, and the RECIPIENT COMPONENT COMES FROM THE
// VERIFIED ctx, never from args. That is what makes this structurally self-scoped: there is no
// `where` clause to forget, because a caller has no way to name a row that is not their own. With a
// surrogate id it would have been an authorization check somebody could drop in review.
//
// Gated on authentication rather than membership: a demoted user's rows are deleted anyway (design
// D11), and someone dismissing their own leftovers is never the thing to refuse.
export const markNotificationRead = defineMutator(
  markNotificationReadArgs,
  async ({ tx, args, ctx }) => {
    if (!isAuthenticated(ctx)) throw notAuthorized(args.subjectId)

    await tx.mutate.notification.update({
      recipientId: ctx.userID,
      kind: args.kind,
      subjectId: args.subjectId,
      eventKey: args.eventKey,
      readAt: args.readAt,
    })
  },
)

export const markAllNotificationsReadArgs = z.object({
  readAt: timestamp,
})

export type MarkAllNotificationsReadArgs = z.infer<typeof markAllNotificationsReadArgs>

// The shared half of "mark everything read": a bounded loop over the caller's own unread rows,
// which is what makes the action optimistic and instant. On the client that loop only ever sees the
// rows `notifications.mine` synced, so the server override adds one raw statement for the rest
// (design D15) — the authorization lives here, once.
export const markAllNotificationsRead = defineMutator(
  markAllNotificationsReadArgs,
  async ({ tx, args, ctx }) => {
    if (!isAuthenticated(ctx)) throw notAuthorized(MARK_ALL_NOTIFICATIONS_READ_MUTATOR_NAME)

    const unread = (await tx.run(
      zql.notification
        .where('recipientId', ctx.userID)
        .where('readAt', 'IS', null)
        .orderBy('createdAt', 'desc')
        .limit(NOTIFICATION_SYNC_LIMIT),
    )) as UnreadNotificationRow[]

    for (const row of unread) {
      await tx.mutate.notification.update({
        recipientId: ctx.userID,
        kind: row.kind,
        subjectId: row.subjectId,
        eventKey: row.eventKey,
        readAt: args.readAt,
      })
    }
  },
)

interface UnreadNotificationRow {
  kind: NotificationKind
  subjectId: string
  eventKey: string
}

export const followIssueArgs = z.object({
  issueId: z.string().min(1),
  updatedAt: timestamp,
})

export type FollowIssueArgs = z.infer<typeof followIssueArgs>

export const unfollowIssueArgs = followIssueArgs

export type UnfollowIssueArgs = z.infer<typeof unfollowIssueArgs>

interface IssueSubscriptionRow {
  createdAt: number
}

// GATED ON READ, NOT WRITE, and that is the whole reason this helper exists rather than a call to
// `loadIssueForWrite`. `canWrite` excludes viewers, while mention eligibility is a READ predicate —
// so a viewer on the team can be mentioned and is therefore auto-subscribed. Gating the follow
// mutators on write, the reflex for anything named "mutator", would hand that viewer a subscription
// and no way to end it: the exact mail trap this change exists to avoid, aimed at the one role that
// cannot escape it.
//
// Nothing is minted. The natural key `(issueId, ctx.userID)` is fully known at the call site, and
// the user half comes from the VERIFIED CONTEXT and never from args — which is what makes a caller
// structurally unable to touch somebody else's subscription. `createdAt` is carried over from the
// existing row rather than restamped, because it orders the subscriber fan-out.
async function setIssueSubscriptionState(
  tx: Transaction,
  ctx: AuthContext | undefined,
  args: FollowIssueArgs,
  state: SubscriptionState,
): Promise<void> {
  if (!isMember(ctx)) throw notAuthorized(args.issueId)
  const issue = await loadIssueForTeamAccess(tx, ctx, args.issueId)

  const existing = (await tx.run(
    zql.issue_subscription.where('issueId', args.issueId).where('userId', ctx.userID).one(),
  )) as IssueSubscriptionRow | undefined

  await tx.mutate.issue_subscription.upsert({
    issueId: args.issueId,
    userId: ctx.userID,
    teamId: issue.teamId,
    state,
    createdAt: existing?.createdAt ?? args.updatedAt,
    updatedAt: args.updatedAt,
  })
}

export const followIssue = defineMutator(followIssueArgs, async ({ tx, args, ctx }) => {
  await setIssueSubscriptionState(tx, ctx, args, 'subscribed')
})

// An explicit unfollow STICKS: it writes a state, it does not delete the row, so the next `@`
// cannot resurrect it (`autoSubscribeMentioned` is an `on conflict do nothing`). Re-following
// afterwards is an ordinary upsert — the user asking is different from the system assuming.
export const unfollowIssue = defineMutator(unfollowIssueArgs, async ({ tx, args, ctx }) => {
  await setIssueSubscriptionState(tx, ctx, args, 'unsubscribed')
})

// The human-intent stamp folded into every row write that sets `issue.status`. `updated_at` cannot
// carry this: it moves for a title edit, a label, an assignee. The absence of the stamp on a
// machine write is the audit record — it is how `decideAutoStatus` tells "a person decided this"
// from "the instance advanced it", and therefore what stops automation overriding a human.
//
// Returned as a PATCH spread into the caller's single update rather than written separately, and a
// pure function of `ctx` and `updatedAt` — no `Date.now()`, no read — so the optimistic and
// authoritative passes produce the identical row and rebase is stable.
function humanStatusStamp(
  ctx: AuthContext,
  updatedAt: number,
): { readonly lastHumanStatusAt?: number } {
  return ctx.userID === SYSTEM_ACTOR_ID ? {} : { lastHumanStatusAt: updatedAt }
}

export const createIssueArgs = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  title: z.string(),
  status: issueStatusSchema,
  priority: issuePrioritySchema,
  assigneeId: z.string().min(1).nullable().optional(),
  description: richTextSchema.nullable().optional(),
  rank: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[0-9A-Za-z]+$/u)
    .nullable()
    .optional(),
  needsTriage: z.boolean().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export type CreateIssueArgs = z.infer<typeof createIssueArgs>

// Shared client + server create. Leaves `number` unset (Postgres default NULL); the
// per-team number is claimed only in the server-authoritative override (server-mutators.ts).
// `creator` is taken from the verified ctx, never args; both the UUIDv7 id and the fractional
// `rank` are minted at the call site, never here (mutators re-run during rebase, so an id or
// rank computed inside would change between the optimistic and authoritative runs). `rank`
// densely ranks the destination column from creation so a board move always lands
// position-faithfully; null is tolerated only as a transient pre-sync value.
//
// `sanitizeRichText` runs HERE, in the shared body, and likewise in `issue.update`,
// `comment.create` and `comment.edit` — the four paths that store a rich-text document. In a server
// override the optimistic document and the authoritative one would differ and rebase would visibly
// rewrite the user's text. Safe inside a mutator body because it is a pure function of `args` and
// mints nothing.
export const createIssue = defineMutator(createIssueArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await assertTeamAccess(tx, ctx, args.teamId, args.id)

  const title = assertValidName(args.title, args.id, ISSUE_TITLE_MAX_LENGTH)
  if (args.assigneeId != null) {
    await assertTeamMember(tx, args.teamId, args.assigneeId, args.id)
  }

  await tx.mutate.issue.insert({
    id: args.id,
    teamId: args.teamId,
    title,
    description: sanitizeRichText(args.description ?? null),
    status: args.status,
    priority: args.priority,
    assigneeId: args.assigneeId ?? null,
    rank: args.rank ?? null,
    needsTriage: args.needsTriage ?? false,
    creatorId: ctx.userID,
    // A new issue starts with no cycle, so there is no assignment moment to stamp yet;
    // `issue.setCycle` / `issue.routeIssue` / the rollover stamp it when a cycle is set.
    carryoverCount: 0,
    cycleAssignedAt: null,
    ...humanStatusStamp(ctx, args.updatedAt),
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  })
})

export const updateIssueArgs = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  description: richTextSchema.nullable().optional(),
  updatedAt: timestamp,
})

export const updateIssue = defineMutator(updateIssueArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await loadIssueForWrite(tx, ctx, args.id)

  const title =
    args.title === undefined
      ? undefined
      : assertValidName(args.title, args.id, ISSUE_TITLE_MAX_LENGTH)

  await tx.mutate.issue.update({
    id: args.id,
    ...(title === undefined ? {} : { title }),
    ...(args.description === undefined ? {} : { description: sanitizeRichText(args.description) }),
    updatedAt: args.updatedAt,
  })
})

export const setIssueStatusArgs = z.object({
  id: z.string().min(1),
  status: issueStatusSchema,
  updatedAt: timestamp,
})

export const setIssueStatus = defineMutator(setIssueStatusArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await loadIssueForWrite(tx, ctx, args.id)
  await tx.mutate.issue.update({
    id: args.id,
    status: args.status,
    ...humanStatusStamp(ctx, args.updatedAt),
    updatedAt: args.updatedAt,
  })
})

export const setIssuePriorityArgs = z.object({
  id: z.string().min(1),
  priority: issuePrioritySchema,
  updatedAt: timestamp,
})

export const setIssuePriority = defineMutator(setIssuePriorityArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await loadIssueForWrite(tx, ctx, args.id)
  await tx.mutate.issue.update({ id: args.id, priority: args.priority, updatedAt: args.updatedAt })
})

export const assignIssueArgs = z.object({
  id: z.string().min(1),
  assigneeId: z.string().min(1).nullable(),
  updatedAt: timestamp,
})

export const assignIssue = defineMutator(assignIssueArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const issue = await loadIssueForWrite(tx, ctx, args.id)

  if (args.assigneeId !== null) {
    await assertTeamMember(tx, issue.teamId, args.assigneeId, args.id)
  }

  await tx.mutate.issue.update({
    id: args.id,
    assigneeId: args.assigneeId,
    updatedAt: args.updatedAt,
  })
})

export const moveIssueArgs = z.object({
  id: z.string().min(1),
  status: issueStatusSchema,
  rank: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[0-9A-Za-z]+$/u),
  updatedAt: timestamp,
})

// The board's single-write move: set the card's fractional `rank` (and `status` when it
// changed columns) in one row update, never renumbering siblings. The `rank` is computed at
// the call site (the client mints the fractional index between the destination neighbours and
// passes it in) — never here, because a mutator re-runs during rebase and recomputing from
// shifted neighbours would jump the card, mirroring the client-minted-UUID rule.
export const moveIssue = defineMutator(moveIssueArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await loadIssueForWrite(tx, ctx, args.id)
  await tx.mutate.issue.update({
    id: args.id,
    status: args.status,
    rank: args.rank,
    ...humanStatusStamp(ctx, args.updatedAt),
    updatedAt: args.updatedAt,
  })
})

interface CycleRow {
  id: string
  teamId: string
  status: CycleStatus
  number: number | null
  startDate: number
  endDate: number
}

// Load an existing cycle for a write. `canWrite` runs in the caller first (viewer/non-member
// rejected before any existence check); here the row is read and a generic not-authorized is
// thrown for both "missing" and "wrong team" so a cycle's existence never leaks.
async function loadCycleForWrite(
  tx: Transaction,
  ctx: AuthContext,
  cycleId: string,
): Promise<CycleRow> {
  const cycle = (await tx.run(zql.cycle.where('id', cycleId).one())) as CycleRow | undefined
  if (!cycle) throw notAuthorized(cycleId)
  await assertTeamAccess(tx, ctx, cycle.teamId, cycleId)
  return cycle
}

function assertValidCycleDates(startDate: number, endDate: number, id: string): void {
  if (endDate <= startDate) {
    throw new MutationError(
      'Cycle end date must be after its start date',
      MutationErrorCode.invalidDate,
      id,
    )
  }
}

export const createCycleArgs = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  name: z.string(),
  startDate: timestamp,
  endDate: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
})

export type CreateCycleArgs = z.infer<typeof createCycleArgs>

// Shared client + server create. Leaves `number` unset (claimed only in the server override,
// like the issue number); the id is minted at the call site. A new cycle always starts
// `upcoming`; the scheduler or a deliberate action promotes it to active/completed.
export const createCycle = defineMutator(createCycleArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await assertTeamAccess(tx, ctx, args.teamId, args.id)

  const name = assertValidName(args.name, args.id, CYCLE_NAME_MAX_LENGTH)
  assertValidCycleDates(args.startDate, args.endDate, args.id)

  await tx.mutate.cycle.insert({
    id: args.id,
    teamId: args.teamId,
    name,
    status: 'upcoming',
    startDate: args.startDate,
    endDate: args.endDate,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  })
})

export const updateCycleArgs = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  startDate: timestamp.optional(),
  endDate: timestamp.optional(),
  updatedAt: timestamp,
})

export const updateCycle = defineMutator(updateCycleArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const cycle = await loadCycleForWrite(tx, ctx, args.id)

  const name =
    args.name === undefined ? undefined : assertValidName(args.name, args.id, CYCLE_NAME_MAX_LENGTH)

  if (args.startDate !== undefined || args.endDate !== undefined) {
    const startDate = args.startDate ?? cycle.startDate
    const endDate = args.endDate ?? cycle.endDate
    assertValidCycleDates(startDate, endDate, args.id)
  }

  await tx.mutate.cycle.update({
    id: args.id,
    ...(name === undefined ? {} : { name }),
    ...(args.startDate === undefined ? {} : { startDate: args.startDate }),
    ...(args.endDate === undefined ? {} : { endDate: args.endDate }),
    updatedAt: args.updatedAt,
  })
})

export const activateCycleArgs = z.object({
  id: z.string().min(1),
  updatedAt: timestamp,
})

export const activateCycle = defineMutator(activateCycleArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const cycle = await loadCycleForWrite(tx, ctx, args.id)
  if (cycle.status !== 'upcoming') return
  await tx.mutate.cycle.update({ id: args.id, status: 'active', updatedAt: args.updatedAt })
})

export const completeCycleArgs = z.object({
  id: z.string().min(1),
  updatedAt: timestamp,
})

// The signature behavior: completing a cycle rolls its unfinished issues (every status except
// done/canceled) into the next open cycle, so nothing is silently dropped. Team-scoped,
// permission-gated (canWrite + loadCycleForWrite), and IDEMPOTENT — the status guard makes a
// re-run (a retried mutation, or the scheduler racing the deliberate action) a no-op. The
// destination is chosen deterministically from the synced cycles (identical client/server),
// and issues are re-pointed by cycleId only, so no id is minted inside the mutator.
export const completeCycle = defineMutator(completeCycleArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const cycle = await loadCycleForWrite(tx, ctx, args.id)
  if (cycle.status === 'completed') return

  const cycleRows = (await tx.run(zql.cycle.where('teamId', cycle.teamId))) as CycleOrderRow[]
  const target = nextCycleId(cycleRows, {
    id: cycle.id,
    status: cycle.status,
    number: cycle.number,
    startDate: cycle.startDate,
  })

  await tx.mutate.cycle.update({ id: args.id, status: 'completed', updatedAt: args.updatedAt })

  const issues = (await tx.run(zql.issue.where('cycleId', args.id))) as {
    id: string
    status: IssueStatus
    carryoverCount: number
  }[]
  for (const issue of issues) {
    if (!isUnfinished(issue.status)) continue
    // Stamp the origin cycle as we re-point the issue so a completed cycle's carried set survives
    // the rollover: the cycle view reconstructs it from `rolledOverFromCycleId`, since the issue no
    // longer points at this cycle. Deterministic (args-derived) — no id minted in the mutator.
    // The carryover count and the assignment stamp record what the cycle history cannot otherwise
    // reconstruct ("carried twice or more", "added mid-cycle"); the status guard above is what keeps
    // a re-run of the completion from incrementing twice.
    await tx.mutate.issue.update({
      id: issue.id,
      cycleId: target,
      rolledOverFromCycleId: args.id,
      carryoverCount: (issue.carryoverCount ?? 0) + 1,
      cycleAssignedAt: args.updatedAt,
      updatedAt: args.updatedAt,
    })
  }
})

export const setIssueCycleArgs = z.object({
  id: z.string().min(1),
  cycleId: z.string().min(1).nullable(),
  updatedAt: timestamp,
})

export const setIssueCycle = defineMutator(setIssueCycleArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const issue = await loadIssueForWrite(tx, ctx, args.id)

  if (args.cycleId !== null) {
    const cycle = (await tx.run(zql.cycle.where('id', args.cycleId).one())) as
      | { id: string; teamId: string }
      | undefined
    if (!cycle || cycle.teamId !== issue.teamId) {
      throw new MutationError(
        'Cycle and issue must belong to the same team',
        MutationErrorCode.crossTeam,
        args.id,
      )
    }
  }

  // The assignment moment is what makes "added mid-cycle" a fact rather than a `created_at`
  // approximation; clearing the cycle clears it. Args-derived, so a rebase recomputes the same value.
  await tx.mutate.issue.update({
    id: args.id,
    cycleId: args.cycleId,
    cycleAssignedAt: args.cycleId === null ? null : args.updatedAt,
    updatedAt: args.updatedAt,
  })
})

async function assertWorkspaceMember(tx: Transaction, userId: string, id: string): Promise<void> {
  const member = await tx.run(zql.workspace_member.where('userId', userId).one())
  if (!member) {
    throw new MutationError(
      'Project lead must be a workspace member',
      MutationErrorCode.crossTeam,
      id,
    )
  }
}

interface ProjectRow {
  id: string
  workspaceId: string
}

// Load an existing project for a write. Projects are workspace-level: `canWrite` (member,
// non-viewer) is the whole gate — any writer may edit any project, mirroring the roadmap being
// a cross-team overview. `canWrite` runs in the caller before this; a generic not-authorized is
// thrown for a missing row so a project's existence never leaks to a viewer/non-member.
async function loadProjectForWrite(tx: Transaction, id: string): Promise<ProjectRow> {
  const project = (await tx.run(zql.project.where('id', id).one())) as ProjectRow | undefined
  if (!project) throw notAuthorized(id)
  return project
}

export const createProjectArgs = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string(),
  leadId: z.string().min(1).nullable().optional(),
  status: projectStatusSchema.optional(),
  targetDate: timestamp.nullable().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export type CreateProjectArgs = z.infer<typeof createProjectArgs>

// Workspace-level create, gated by `canWrite` (viewers rejected). The id is minted at the call
// site. A project defaults to `planned`; an optional lead is validated to be a workspace member
// (the lead is a workspace user, and a project can span teams so no team check applies).
export const createProject = defineMutator(createProjectArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)

  const name = assertValidName(args.name, args.id, PROJECT_NAME_MAX_LENGTH)
  if (args.leadId != null) {
    await assertWorkspaceMember(tx, args.leadId, args.id)
  }

  await tx.mutate.project.insert({
    id: args.id,
    workspaceId: args.workspaceId,
    name,
    leadId: args.leadId ?? null,
    status: args.status ?? 'planned',
    targetDate: args.targetDate ?? null,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  })
})

export const updateProjectArgs = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  leadId: z.string().min(1).nullable().optional(),
  status: projectStatusSchema.optional(),
  targetDate: timestamp.nullable().optional(),
  updatedAt: timestamp,
})

export const updateProject = defineMutator(updateProjectArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await loadProjectForWrite(tx, args.id)

  const name =
    args.name === undefined
      ? undefined
      : assertValidName(args.name, args.id, PROJECT_NAME_MAX_LENGTH)

  if (args.leadId != null) {
    await assertWorkspaceMember(tx, args.leadId, args.id)
  }

  await tx.mutate.project.update({
    id: args.id,
    ...(name === undefined ? {} : { name }),
    ...(args.leadId === undefined ? {} : { leadId: args.leadId }),
    ...(args.status === undefined ? {} : { status: args.status }),
    ...(args.targetDate === undefined ? {} : { targetDate: args.targetDate }),
    updatedAt: args.updatedAt,
  })
})

export const deleteProjectArgs = z.object({ id: z.string().min(1) })

// Deleting a project unassigns its issues via the `ON DELETE SET NULL` FK — no issue is lost.
export const deleteProject = defineMutator(deleteProjectArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await loadProjectForWrite(tx, args.id)
  await tx.mutate.project.delete({ id: args.id })
})

export const setIssueProjectArgs = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  updatedAt: timestamp,
})

// Assigning an issue to a (workspace-level) project respects the ISSUE's team-scoped write
// permission: `loadIssueForWrite` runs the same auth-before-existence, team-scoped gate as every
// other issue write. The project only needs to exist in the workspace — a project spans teams,
// so any team's issue may join any project (no cross-team rejection here).
export const setIssueProject = defineMutator(setIssueProjectArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await loadIssueForWrite(tx, ctx, args.id)

  if (args.projectId !== null) {
    const project = (await tx.run(zql.project.where('id', args.projectId).one())) as
      | ProjectRow
      | undefined
    if (!project) {
      throw new MutationError('Project not found', MutationErrorCode.crossTeam, args.id)
    }
  }

  await tx.mutate.issue.update({
    id: args.id,
    projectId: args.projectId,
    updatedAt: args.updatedAt,
  })
})

// Triage is an orthogonal boolean on an issue (`needs_triage`), never a seventh status. An
// issue enters the inbox here (flag set) and leaves it via accept/decline/route (flag cleared).
export const flagTriageArgs = z.object({
  id: z.string().min(1),
  updatedAt: timestamp,
})

export const flagTriage = defineMutator(flagTriageArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await loadIssueForWrite(tx, ctx, args.id)
  await tx.mutate.issue.update({ id: args.id, needsTriage: true, updatedAt: args.updatedAt })
})

export const acceptTriageArgs = z.object({
  id: z.string().min(1),
  updatedAt: timestamp,
})

// Accept clears the flag and leaves the status untouched: the issue becomes a normal issue at
// its current status and reappears in the list/board.
export const acceptTriage = defineMutator(acceptTriageArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await loadIssueForWrite(tx, ctx, args.id)
  await tx.mutate.issue.update({ id: args.id, needsTriage: false, updatedAt: args.updatedAt })
})

export const declineTriageArgs = z.object({
  id: z.string().min(1),
  updatedAt: timestamp,
})

// Decline clears the flag and cancels the issue, so a rejected incoming issue leaves the inbox
// as a canceled record rather than being deleted.
export const declineTriage = defineMutator(declineTriageArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await loadIssueForWrite(tx, ctx, args.id)
  await tx.mutate.issue.update({
    id: args.id,
    needsTriage: false,
    status: 'canceled',
    ...humanStatusStamp(ctx, args.updatedAt),
    updatedAt: args.updatedAt,
  })
})

export const routeIssueArgs = z.object({
  id: z.string().min(1),
  status: issueStatusSchema.optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  cycleId: z.string().min(1).nullable().optional(),
  addLabelIds: z.array(z.string().min(1)).optional(),
  updatedAt: timestamp,
})

// Route is accept-with-routing: clear the flag and, in one atomic write, apply a status, an
// assignee, a cycle, and/or labels — each validated to the issue's team (cross-team rejected).
// Team reassignment is deliberately not routable (it collides with the per-team number and the
// team-scoped sync scope); that is reserved for the connectors work.
export const routeIssue = defineMutator(routeIssueArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const issue = await loadIssueForWrite(tx, ctx, args.id)

  if (args.assigneeId != null) {
    await assertTeamMember(tx, issue.teamId, args.assigneeId, args.id)
  }

  if (args.cycleId != null) {
    const cycle = (await tx.run(zql.cycle.where('id', args.cycleId).one())) as
      | { id: string; teamId: string }
      | undefined
    if (!cycle || cycle.teamId !== issue.teamId) {
      throw new MutationError(
        'Cycle and issue must belong to the same team',
        MutationErrorCode.crossTeam,
        args.id,
      )
    }
  }

  for (const labelId of args.addLabelIds ?? []) {
    const label = (await tx.run(zql.label.where('id', labelId).one())) as
      | { id: string; teamId: string }
      | undefined
    if (!label || label.teamId !== issue.teamId) {
      throw new MutationError(
        'Label and issue must belong to the same team',
        MutationErrorCode.crossTeam,
        args.id,
      )
    }
  }

  await tx.mutate.issue.update({
    id: args.id,
    needsTriage: false,
    ...(args.status === undefined
      ? {}
      : { status: args.status, ...humanStatusStamp(ctx, args.updatedAt) }),
    ...(args.assigneeId === undefined ? {} : { assigneeId: args.assigneeId }),
    ...(args.cycleId === undefined
      ? {}
      : { cycleId: args.cycleId, cycleAssignedAt: args.cycleId === null ? null : args.updatedAt }),
    updatedAt: args.updatedAt,
  })

  for (const labelId of args.addLabelIds ?? []) {
    await tx.mutate.issue_label.upsert({
      issueId: args.id,
      labelId,
      teamId: issue.teamId,
      createdAt: args.updatedAt,
    })
  }
})

export const addIssueLabelArgs = z.object({
  issueId: z.string().min(1),
  labelId: z.string().min(1),
  createdAt: timestamp,
})

export const addIssueLabel = defineMutator(addIssueLabelArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.issueId)
  const issue = await loadIssueForWrite(tx, ctx, args.issueId)

  const label = (await tx.run(zql.label.where('id', args.labelId).one())) as
    | { id: string; teamId: string }
    | undefined
  if (!label || label.teamId !== issue.teamId) {
    throw new MutationError(
      'Label and issue must belong to the same team',
      MutationErrorCode.crossTeam,
      args.issueId,
    )
  }

  await tx.mutate.issue_label.upsert({
    issueId: args.issueId,
    labelId: args.labelId,
    teamId: issue.teamId,
    createdAt: args.createdAt,
  })
})

export const removeIssueLabelArgs = z.object({
  issueId: z.string().min(1),
  labelId: z.string().min(1),
})

export const removeIssueLabel = defineMutator(removeIssueLabelArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.issueId)
  await loadIssueForWrite(tx, ctx, args.issueId)
  await tx.mutate.issue_label.delete({ issueId: args.issueId, labelId: args.labelId })
})

export const createLabelArgs = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  name: z.string(),
  color: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export const createLabel = defineMutator(createLabelArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await assertTeamAccess(tx, ctx, args.teamId, args.id)

  const name = assertValidName(args.name, args.id, LABEL_NAME_MAX_LENGTH)
  const color = assertParseableColor(args.color, args.id)

  await tx.mutate.label.insert({
    id: args.id,
    teamId: args.teamId,
    name,
    color,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  })
})

export const renameLabelArgs = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  color: z.string().optional(),
  updatedAt: timestamp,
})

export const renameLabel = defineMutator(renameLabelArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const label = (await tx.run(zql.label.where('id', args.id).one())) as
    | { id: string; teamId: string }
    | undefined
  if (!label) throw notAuthorized(args.id)
  await assertTeamAccess(tx, ctx, label.teamId, args.id)

  const name =
    args.name === undefined ? undefined : assertValidName(args.name, args.id, LABEL_NAME_MAX_LENGTH)
  const color = args.color === undefined ? undefined : assertParseableColor(args.color, args.id)

  await tx.mutate.label.update({
    id: args.id,
    ...(name === undefined ? {} : { name }),
    ...(color === undefined ? {} : { color }),
    updatedAt: args.updatedAt,
  })
})

export const deleteLabelArgs = z.object({ id: z.string().min(1) })

export const deleteLabel = defineMutator(deleteLabelArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const label = (await tx.run(zql.label.where('id', args.id).one())) as
    | { id: string; teamId: string }
    | undefined
  if (!label) throw notAuthorized(args.id)
  await assertTeamAccess(tx, ctx, label.teamId, args.id)
  await tx.mutate.label.delete({ id: args.id })
})

export const createCommentArgs = z.object({
  id: z.string().min(1),
  issueId: z.string().min(1),
  body: richTextSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
})

// `author` from ctx, never args; team-scoped canWrite (viewers rejected). The comment's
// `team_id` is copied off its issue so it inherits the same two-hop sync scope.
export const createComment = defineMutator(createCommentArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const issue = await loadIssueForWrite(tx, ctx, args.issueId)

  await tx.mutate.comment.insert({
    id: args.id,
    issueId: args.issueId,
    teamId: issue.teamId,
    authorId: ctx.userID,
    body: sanitizeRichText(args.body),
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  })
})

interface CommentRow {
  id: string
  authorId: string
}

async function loadCommentForAuthor(
  tx: Transaction,
  ctx: AuthContext,
  id: string,
): Promise<CommentRow> {
  const comment = (await tx.run(zql.comment.where('id', id).one())) as CommentRow | undefined
  if (!comment) throw notAuthorized(id)
  if (comment.authorId !== ctx.userID && ctx.role !== 'admin') throw notAuthorized(id)
  return comment
}

export const editCommentArgs = z.object({
  id: z.string().min(1),
  body: richTextSchema,
  updatedAt: timestamp,
})

export const editComment = defineMutator(editCommentArgs, async ({ tx, args, ctx }) => {
  if (!isMember(ctx)) throw notAuthorized(args.id)
  await loadCommentForAuthor(tx, ctx, args.id)
  await tx.mutate.comment.update({
    id: args.id,
    body: sanitizeRichText(args.body),
    updatedAt: args.updatedAt,
  })
})

export const deleteCommentArgs = z.object({ id: z.string().min(1) })

export const deleteComment = defineMutator(deleteCommentArgs, async ({ tx, args, ctx }) => {
  if (!isMember(ctx)) throw notAuthorized(args.id)
  await loadCommentForAuthor(tx, ctx, args.id)
  await tx.mutate.comment.delete({ id: args.id })
})

export const createSavedViewArgs = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  name: z.string(),
  filter: filterArg,
  grouping: issueGroupingSchema,
  sort: sortArg,
  createdAt: timestamp,
  updatedAt: timestamp,
})

export const createSavedView = defineMutator(createSavedViewArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await assertTeamAccess(tx, ctx, args.teamId, args.id)

  const name = assertValidName(args.name, args.id, SAVED_VIEW_NAME_MAX_LENGTH)

  await tx.mutate.saved_view.insert({
    id: args.id,
    teamId: args.teamId,
    name,
    filter: args.filter,
    grouping: args.grouping,
    sort: args.sort,
    createdBy: ctx.userID,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  })
})

interface SavedViewRow {
  id: string
  teamId: string
  createdBy: string
}

export const updateSavedViewArgs = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  filter: filterArg.optional(),
  grouping: issueGroupingSchema.optional(),
  sort: sortArg.optional(),
  updatedAt: timestamp,
})

export const updateSavedView = defineMutator(updateSavedViewArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const view = (await tx.run(zql.saved_view.where('id', args.id).one())) as SavedViewRow | undefined
  if (!view) throw notAuthorized(args.id)
  await assertTeamAccess(tx, ctx, view.teamId, args.id)

  const name =
    args.name === undefined
      ? undefined
      : assertValidName(args.name, args.id, SAVED_VIEW_NAME_MAX_LENGTH)

  await tx.mutate.saved_view.update({
    id: args.id,
    ...(name === undefined ? {} : { name }),
    ...(args.filter === undefined ? {} : { filter: args.filter }),
    ...(args.grouping === undefined ? {} : { grouping: args.grouping }),
    ...(args.sort === undefined ? {} : { sort: args.sort }),
    updatedAt: args.updatedAt,
  })
})

export const deleteSavedViewArgs = z.object({ id: z.string().min(1) })

export const deleteSavedView = defineMutator(deleteSavedViewArgs, async ({ tx, args, ctx }) => {
  if (!isMember(ctx)) throw notAuthorized(args.id)
  const view = (await tx.run(zql.saved_view.where('id', args.id).one())) as SavedViewRow | undefined
  if (!view) throw notAuthorized(args.id)
  if (view.createdBy !== ctx.userID && ctx.role !== 'admin') throw notAuthorized(args.id)
  await tx.mutate.saved_view.delete({ id: args.id })
})

// ---------------------------------------------------------------------------------------------
// Retrospective
//
// Two guarantees live here rather than in the UI, because optimistic local writes make a
// client-only gate a suggestion:
//   1. The phase machine. Every write re-reads the retro's phase and consults the one shared
//      `isRetroWriteAllowed` predicate before applying, and `retro.setPhase` accepts only an
//      adjacent target from the facilitator or an admin. A crafted mutation cannot skip or rewind.
//   2. Anonymity. Nothing here ever writes an author onto a synced row for an anonymous retro. The
//      card -> author binding is written by the SERVER publish pass into `retro_card_author`, a
//      table absent from the Zero schema — see `server-mutators.ts`.
// ---------------------------------------------------------------------------------------------

export const RETRO_TITLE_MAX_LENGTH = 200
export const RETRO_COLUMN_TITLE_MAX_LENGTH = 60
export const RETRO_CARD_BODY_MAX_LENGTH = 1000
export const RETRO_ACTION_BODY_MAX_LENGTH = 1000
export const RETRO_GROUP_LABEL_MAX_LENGTH = 120
export const RETRO_TIMER_MAX_DURATION_S = 4 * 60 * 60

const retroPhaseSchema = z.enum(RETRO_PHASES)
const retroFormatSchema = z.enum(RETRO_FORMATS)
const retroVoteTargetSchema = z.enum(RETRO_VOTE_TARGETS)
const retroAccentSchema = z.enum(RETRO_COLUMN_ACCENTS)
const rankSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[0-9A-Za-z]+$/u)
const seedRefArg = jsonArg(retroSeedRefSchema)
const votesPerParticipantSchema = z
  .number()
  .int()
  .min(MIN_VOTES_PER_PARTICIPANT)
  .max(MAX_VOTES_PER_PARTICIPANT)

// Card/action bodies are plain text and may be multi-line, so they are trimmed but never collapsed
// the way `normalizeName` collapses a name.
function assertRetroText(value: string, id: string, maxLength: number, subject: string): string {
  const text = value.trim()
  if (text.length === 0) {
    throw new MutationError(`${subject} cannot be empty`, MutationErrorCode.invalidName, id)
  }
  if (text.length > maxLength) {
    throw new MutationError(
      `${subject} cannot be longer than ${maxLength} characters`,
      MutationErrorCode.invalidName,
      id,
    )
  }
  return text
}

interface RetroRow {
  id: string
  teamId: string
  title: string
  cycleId: string | null
  nextCycleId: string | null
  format: RetroFormat
  phase: RetroPhase
  facilitatorId: string | null
  isAnonymous: boolean
  votesPerParticipant: number
}

function invalidPhase(phase: RetroPhase, id: string): MutationError {
  return new MutationError(
    `This retro is in the ${phase} phase, where that change is closed`,
    MutationErrorCode.invalidPhase,
    id,
  )
}

// The retro's authority: `canWrite` runs in the caller first (so a viewer/non-member is rejected
// before any existence check), then the row is read, team access is verified, and the phase is
// consulted through the ONE shared predicate that also drives the UI's affordances. A generic
// not-authorized covers both "missing" and "wrong team" so a retro's existence never leaks.
async function loadRetroForWrite(
  tx: Transaction,
  ctx: AuthContext,
  retroId: string,
  op: RetroWriteOp | null,
  errorId: string = retroId,
): Promise<RetroRow> {
  const retro = (await tx.run(zql.retro.where('id', retroId).one())) as RetroRow | undefined
  if (!retro) throw notAuthorized(errorId)
  await assertTeamAccess(tx, ctx, retro.teamId, errorId)
  if (op !== null && !isRetroWriteAllowed(retro.phase, op)) throw invalidPhase(retro.phase, errorId)
  return retro
}

// Phase, timer and facilitation are facilitator-or-admin. `facilitator_id` is null on an
// auto-opened retro (the scheduler is not a person) — until someone claims it, only an admin can
// run the retro, which is why `retro.claimFacilitator` is open to any non-viewer member.
export function isRetroFacilitator(
  retro: { facilitatorId: string | null },
  ctx: AuthContext,
): boolean {
  return (
    ctx.role === 'admin' || (retro.facilitatorId !== null && retro.facilitatorId === ctx.userID)
  )
}

function assertRetroFacilitator(
  retro: { facilitatorId: string | null },
  ctx: AuthContext,
  id: string,
): void {
  if (!isRetroFacilitator(retro, ctx)) throw notAuthorized(id)
}

interface RetroColumnRow {
  id: string
  retroId: string
}

async function loadRetroColumn(
  tx: Transaction,
  retroId: string,
  columnId: string,
  id: string,
): Promise<RetroColumnRow> {
  const column = (await tx.run(zql.retro_column.where('id', columnId).one())) as
    | RetroColumnRow
    | undefined
  if (!column || column.retroId !== retroId) {
    throw new MutationError(
      'Column and retro must belong to each other',
      MutationErrorCode.crossTeam,
      id,
    )
  }
  return column
}

interface RetroColumnArg {
  id: string
  key: string
  title: string
  accentToken: RetroColumnAccent
  rank: string
}

// A client passes the ids and ranks it minted, but the SHAPE is the format's: keys, titles and
// accents must match the template exactly and in order, so a known format name can never carry
// injected columns.
function assertColumnsMatchFormat(
  format: RetroFormat,
  columns: readonly RetroColumnArg[],
  id: string,
): void {
  const template = retroColumnTemplate(format)
  const mismatch =
    columns.length !== template.length ||
    template.some((expected, index) => {
      const column = columns[index]
      return (
        column === undefined ||
        column.key !== expected.key ||
        column.title !== expected.title ||
        column.accentToken !== expected.accentToken
      )
    })
  if (mismatch) {
    throw new MutationError(
      `Columns do not match the ${format} format`,
      MutationErrorCode.invalidKey,
      id,
    )
  }
}

async function assertSameTeamCycle(
  tx: Transaction,
  teamId: string,
  cycleId: string,
  id: string,
): Promise<void> {
  const cycle = (await tx.run(zql.cycle.where('id', cycleId).one())) as
    | { id: string; teamId: string }
    | undefined
  if (!cycle || cycle.teamId !== teamId) {
    throw new MutationError(
      'Cycle and retro must belong to the same team',
      MutationErrorCode.crossTeam,
      id,
    )
  }
}

const retroColumnArgs = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  title: z.string().min(1).max(RETRO_COLUMN_TITLE_MAX_LENGTH),
  accentToken: retroAccentSchema,
  rank: rankSchema,
})

export const openRetroForCycleArgs = z.object({
  id: z.string().min(1),
  cycleId: z.string().min(1),
  nextCycleId: z.string().min(1).nullable().optional(),
  title: z.string().optional(),
  format: retroFormatSchema,
  isAnonymous: z.boolean().optional(),
  votesPerParticipant: votesPerParticipantSchema.optional(),
  columns: z.array(retroColumnArgs).min(1).max(8),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export type OpenRetroForCycleArgs = z.infer<typeof openRetroForCycleArgs>

// Called by BOTH completion triggers — the Cycles view's Complete-cycle action and the maintenance
// pass — each of which mints the retro and column ids at its own call site, because a mutator must
// never mint an id. A cycle that already has a retro is left untouched, so the deliberate action
// racing the scheduler still yields exactly one retro (the unique index on `cycle_id` is the
// backstop). The retro opens in `brainstorm` with NO facilitator: the scheduler is not a person.
export const openRetroForCycle = defineMutator(openRetroForCycleArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)

  const cycle = (await tx.run(zql.cycle.where('id', args.cycleId).one())) as
    | { id: string; teamId: string; name: string }
    | undefined
  if (!cycle) throw notAuthorized(args.id)
  await assertTeamAccess(tx, ctx, cycle.teamId, args.id)

  const existing = await tx.run(zql.retro.where('cycleId', args.cycleId).one())
  if (existing) return

  const title = assertValidName(
    args.title ?? `${cycle.name} retrospective`,
    args.id,
    RETRO_TITLE_MAX_LENGTH,
  )
  assertColumnsMatchFormat(args.format, args.columns, args.id)
  if (args.nextCycleId != null) {
    await assertSameTeamCycle(tx, cycle.teamId, args.nextCycleId, args.id)
  }

  await tx.mutate.retro.insert({
    id: args.id,
    teamId: cycle.teamId,
    cycleId: args.cycleId,
    nextCycleId: args.nextCycleId ?? null,
    title,
    format: args.format,
    phase: 'brainstorm',
    facilitatorId: null,
    isAnonymous: args.isAnonymous ?? false,
    votesPerParticipant: args.votesPerParticipant ?? DEFAULT_VOTES_PER_PARTICIPANT,
    timerEndsAt: null,
    timerDurationS: null,
    createdBy: ctx.userID,
    closedAt: null,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  })

  for (const column of args.columns) {
    await tx.mutate.retro_column.insert({
      id: column.id,
      retroId: args.id,
      teamId: cycle.teamId,
      key: column.key,
      title: column.title,
      accentToken: column.accentToken,
      rank: column.rank,
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    })
  }
})

export const configureRetroArgs = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  isAnonymous: z.boolean().optional(),
  votesPerParticipant: votesPerParticipantSchema.optional(),
  format: retroFormatSchema.optional(),
  columns: z.array(retroColumnArgs).min(1).max(8).optional(),
  updatedAt: timestamp,
})

// `brainstorm` only, facilitator/admin only. Anonymity is fixed BEFORE any card exists, which is
// what makes the guarantee crisp: a retro's anonymity cannot be flipped once there is something to
// attribute. Changing the format replaces the columns, so it is refused once any draft or card
// exists (a client that cannot see other people's drafts will have its optimistic swap rejected by
// the server, which is authoritative here).
export const configureRetro = defineMutator(configureRetroArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const retro = await loadRetroForWrite(tx, ctx, args.id, 'configure')
  assertRetroFacilitator(retro, ctx, args.id)

  const title =
    args.title === undefined
      ? undefined
      : assertValidName(args.title, args.id, RETRO_TITLE_MAX_LENGTH)

  if (args.format !== undefined && args.format !== retro.format) {
    if (args.columns === undefined) {
      throw new MutationError(
        'Changing the format requires its columns',
        MutationErrorCode.invalidKey,
        args.id,
      )
    }
    assertColumnsMatchFormat(args.format, args.columns, args.id)

    const drafts = await tx.run(zql.retro_draft.where('retroId', args.id))
    const cards = await tx.run(zql.retro_card.where('retroId', args.id))
    if (drafts.length > 0 || cards.length > 0) {
      throw new MutationError(
        'The format cannot change once the retro has cards',
        MutationErrorCode.invalidPhase,
        args.id,
      )
    }

    const columns = (await tx.run(zql.retro_column.where('retroId', args.id))) as { id: string }[]
    for (const column of columns) {
      await tx.mutate.retro_column.delete({ id: column.id })
    }
    for (const column of args.columns) {
      await tx.mutate.retro_column.insert({
        id: column.id,
        retroId: args.id,
        teamId: retro.teamId,
        key: column.key,
        title: column.title,
        accentToken: column.accentToken,
        rank: column.rank,
        createdAt: args.updatedAt,
        updatedAt: args.updatedAt,
      })
    }
  }

  // `configure` is brainstorm-only, but a facilitator may step BACK into brainstorm after cards
  // have been published and synced. The phase gate alone therefore does not fix anonymity before
  // there is something to attribute — the card check does.
  if (args.isAnonymous !== undefined && args.isAnonymous !== retro.isAnonymous) {
    const cards = await tx.run(zql.retro_card.where('retroId', args.id))
    if (cards.length > 0) {
      throw new MutationError(
        'Anonymity cannot change once the retro has cards',
        MutationErrorCode.invalidPhase,
        args.id,
      )
    }
  }

  await tx.mutate.retro.update({
    id: args.id,
    ...(title === undefined ? {} : { title }),
    ...(args.format === undefined ? {} : { format: args.format }),
    ...(args.isAnonymous === undefined ? {} : { isAnonymous: args.isAnonymous }),
    ...(args.votesPerParticipant === undefined
      ? {}
      : { votesPerParticipant: args.votesPerParticipant }),
    updatedAt: args.updatedAt,
  })
})

export const deleteRetroArgs = z.object({ id: z.string().min(1) })

// Facilitator/admin. Every child row cascades in Postgres, including the server-only author table.
export const deleteRetro = defineMutator(deleteRetroArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const retro = await loadRetroForWrite(tx, ctx, args.id, null)
  assertRetroFacilitator(retro, ctx, args.id)
  await tx.mutate.retro.delete({ id: args.id })
})

export const claimRetroFacilitatorArgs = z.object({
  id: z.string().min(1),
  updatedAt: timestamp,
})

// Open to any non-viewer team member WHILE the seat is empty (an auto-opened retro has no
// facilitator), and a no-op when the caller already holds it.
export const claimRetroFacilitator = defineMutator(
  claimRetroFacilitatorArgs,
  async ({ tx, args, ctx }) => {
    if (!canWrite(ctx)) throw notAuthorized(args.id)
    const retro = await loadRetroForWrite(tx, ctx, args.id, 'facilitate')
    if (retro.facilitatorId === ctx.userID) return
    if (retro.facilitatorId !== null) throw notAuthorized(args.id)
    await tx.mutate.retro.update({
      id: args.id,
      facilitatorId: ctx.userID,
      updatedAt: args.updatedAt,
    })
  },
)

export const setRetroFacilitatorArgs = z.object({
  id: z.string().min(1),
  facilitatorId: z.string().min(1).nullable(),
  updatedAt: timestamp,
})

export const setRetroFacilitator = defineMutator(
  setRetroFacilitatorArgs,
  async ({ tx, args, ctx }) => {
    if (!canWrite(ctx)) throw notAuthorized(args.id)
    const retro = await loadRetroForWrite(tx, ctx, args.id, 'facilitate')
    assertRetroFacilitator(retro, ctx, args.id)
    if (args.facilitatorId !== null) {
      await assertTeamMember(tx, retro.teamId, args.facilitatorId, args.id)
    }
    await tx.mutate.retro.update({
      id: args.id,
      facilitatorId: args.facilitatorId,
      updatedAt: args.updatedAt,
    })
  },
)

export const setRetroPhaseArgs = z.object({
  id: z.string().min(1),
  to: retroPhaseSchema,
  updatedAt: timestamp,
})

export type SetRetroPhaseArgs = z.infer<typeof setRetroPhaseArgs>

// Exactly one step forward or one step back, facilitator/admin only. A skip ("brainstorm ->
// actions"), a long rewind ("closed -> brainstorm") and a same-phase write are all rejected.
// Entering `closed` stamps `closed_at`; the one legal step back out of it clears it. Advancing
// forward out of `brainstorm` also PUBLISHES every unpublished draft — that half runs only in the
// server override, because a client sees only its own drafts and would publish a partial board.
export const setRetroPhase = defineMutator(setRetroPhaseArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const retro = await loadRetroForWrite(tx, ctx, args.id, null)
  assertRetroFacilitator(retro, ctx, args.id)
  if (!isAdjacentPhase(retro.phase, args.to)) {
    throw new MutationError(
      `A retro moves one phase at a time, not ${retro.phase} to ${args.to}`,
      MutationErrorCode.invalidPhase,
      args.id,
    )
  }

  await tx.mutate.retro.update({
    id: args.id,
    phase: args.to,
    closedAt: args.to === 'closed' ? args.updatedAt : null,
    updatedAt: args.updatedAt,
  })
})

export const startRetroTimerArgs = z.object({
  id: z.string().min(1),
  durationS: z.number().int().min(1).max(RETRO_TIMER_MAX_DURATION_S),
  endsAt: timestamp,
  updatedAt: timestamp,
})

export type StartRetroTimerArgs = z.infer<typeof startRetroTimerArgs>

// The timer is durable state, never a tick: each client renders `endsAt - now` locally. The end is
// taken from the call-site clock here so the optimistic render is instant, and RECOMPUTED from the
// server clock in the override, which is authoritative and kills client skew.
export const startRetroTimer = defineMutator(startRetroTimerArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const retro = await loadRetroForWrite(tx, ctx, args.id, 'timer')
  assertRetroFacilitator(retro, ctx, args.id)
  await tx.mutate.retro.update({
    id: args.id,
    timerEndsAt: args.endsAt,
    timerDurationS: args.durationS,
    updatedAt: args.updatedAt,
  })
})

export const stopRetroTimerArgs = z.object({
  id: z.string().min(1),
  updatedAt: timestamp,
})

export const stopRetroTimer = defineMutator(stopRetroTimerArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const retro = await loadRetroForWrite(tx, ctx, args.id, 'timer')
  assertRetroFacilitator(retro, ctx, args.id)
  await tx.mutate.retro.update({ id: args.id, timerEndsAt: null, updatedAt: args.updatedAt })
})

export const createRetroDraftArgs = z.object({
  id: z.string().min(1),
  retroId: z.string().min(1),
  columnId: z.string().min(1),
  body: z.string(),
  rank: rankSchema,
  seedRef: seedRefArg.nullable().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

// A draft is the PRIVATE brainstorm row: it carries its author and syncs only to them, which is what
// lets "you cannot see other people's cards while writing your own" be a storage fact rather than a
// UI courtesy. Its id and rank are minted at the call site and reused by the published card.
export const createRetroDraft = defineMutator(createRetroDraftArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const retro = await loadRetroForWrite(tx, ctx, args.retroId, 'draft', args.id)
  await loadRetroColumn(tx, args.retroId, args.columnId, args.id)
  const body = assertRetroText(args.body, args.id, RETRO_CARD_BODY_MAX_LENGTH, 'A card')

  await tx.mutate.retro_draft.insert({
    id: args.id,
    retroId: args.retroId,
    teamId: retro.teamId,
    columnId: args.columnId,
    authorId: ctx.userID,
    body,
    rank: args.rank,
    seedRef: args.seedRef ?? null,
    publishedAt: null,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  })
})

interface RetroDraftRow {
  id: string
  retroId: string
  authorId: string
  publishedAt: number | null
}

// Author-only, with NO admin bypass: an admin reading or rewriting someone's private draft would
// break the same promise the self-scoped query keeps.
async function loadOwnRetroDraft(
  tx: Transaction,
  ctx: AuthContext,
  draftId: string,
): Promise<RetroDraftRow> {
  const draft = (await tx.run(zql.retro_draft.where('id', draftId).one())) as
    | RetroDraftRow
    | undefined
  if (!draft) throw notAuthorized(draftId)
  if (draft.authorId !== ctx.userID) throw notAuthorized(draftId)
  if (draft.publishedAt !== null) {
    throw new MutationError(
      'A published card cannot be edited',
      MutationErrorCode.invalidPhase,
      draftId,
    )
  }
  return draft
}

export const updateRetroDraftArgs = z.object({
  id: z.string().min(1),
  body: z.string().optional(),
  columnId: z.string().min(1).optional(),
  rank: rankSchema.optional(),
  updatedAt: timestamp,
})

export const updateRetroDraft = defineMutator(updateRetroDraftArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const draft = await loadOwnRetroDraft(tx, ctx, args.id)
  await loadRetroForWrite(tx, ctx, draft.retroId, 'draft', args.id)
  if (args.columnId !== undefined) {
    await loadRetroColumn(tx, draft.retroId, args.columnId, args.id)
  }
  const body =
    args.body === undefined
      ? undefined
      : assertRetroText(args.body, args.id, RETRO_CARD_BODY_MAX_LENGTH, 'A card')

  await tx.mutate.retro_draft.update({
    id: args.id,
    ...(body === undefined ? {} : { body }),
    ...(args.columnId === undefined ? {} : { columnId: args.columnId }),
    ...(args.rank === undefined ? {} : { rank: args.rank }),
    updatedAt: args.updatedAt,
  })
})

export const deleteRetroDraftArgs = z.object({ id: z.string().min(1) })

export const deleteRetroDraft = defineMutator(deleteRetroDraftArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const draft = await loadOwnRetroDraft(tx, ctx, args.id)
  await loadRetroForWrite(tx, ctx, draft.retroId, 'draft', args.id)
  await tx.mutate.retro_draft.delete({ id: args.id })
})

interface RetroCardRow {
  id: string
  retroId: string
  columnId: string
  groupId: string | null
}

interface RetroGroupRow {
  id: string
  retroId: string
  columnId: string
}

// A vote's `target_id` is polymorphic, so it carries no FK and Postgres cannot cascade it: when a
// target stops being votable — deleted, dissolved, or absorbed into a group — the mutator that did it
// also removes the dots spent on it, or those dots would sit against the voters' budgets forever. On
// the client this clears the caller's own votes (the only ones it can see); the authoritative pass
// sees and clears them all.
async function clearRetroVotesForTarget(tx: Transaction, targetId: string): Promise<void> {
  const votes = (await tx.run(zql.retro_vote.where('targetId', targetId))) as { id: string }[]
  for (const vote of votes) {
    await tx.mutate.retro_vote.delete({ id: vote.id })
  }
  await tx.mutate.retro_vote_tally.delete({ targetId })
}

// A group exists to hold cards; the mutator that empties one dissolves it in the same write pass.
async function dissolveEmptyGroup(tx: Transaction, groupId: string | null): Promise<void> {
  if (groupId === null) return
  const remaining = await tx.run(zql.retro_card.where('groupId', groupId))
  if (remaining.length > 0) return
  await clearRetroVotesForTarget(tx, groupId)
  await tx.mutate.retro_group.delete({ id: groupId })
}

// A grouped card is voted on through its group, so joining one retires the card as a vote target.
// Reachable whenever the facilitator steps back from `vote` to `group` to regroup: without this the
// card keeps a tally row nothing can vote on and its dots stay charged against their voters.
async function retireGroupedCardVotes(
  tx: Transaction,
  card: { id: string; groupId: string | null },
  groupId: string | null,
): Promise<void> {
  if (groupId === null || card.groupId !== null) return
  await clearRetroVotesForTarget(tx, card.id)
}

export const moveRetroCardArgs = z.object({
  id: z.string().min(1),
  columnId: z.string().min(1).optional(),
  groupId: z.string().min(1).nullable(),
  rank: rankSchema,
  updatedAt: timestamp,
})

// The board's single-write move, reused verbatim: ONE row update carrying the fractional `rank` (and
// the group/column reference when they changed), never renumbering siblings. The rank is minted at
// the CALL SITE from the destination neighbours — recomputing it here would jump the card on rebase.
export const moveRetroCard = defineMutator(moveRetroCardArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const card = (await tx.run(zql.retro_card.where('id', args.id).one())) as RetroCardRow | undefined
  if (!card) throw notAuthorized(args.id)
  await loadRetroForWrite(tx, ctx, card.retroId, 'group', args.id)

  const columnId = args.columnId ?? card.columnId
  if (args.columnId !== undefined) {
    await loadRetroColumn(tx, card.retroId, args.columnId, args.id)
  }
  if (args.groupId !== null) {
    const group = (await tx.run(zql.retro_group.where('id', args.groupId).one())) as
      | RetroGroupRow
      | undefined
    if (!group || group.retroId !== card.retroId || group.columnId !== columnId) {
      throw new MutationError(
        'A card can only join a group in its own column',
        MutationErrorCode.invalidTarget,
        args.id,
      )
    }
  }

  await tx.mutate.retro_card.update({
    id: args.id,
    ...(args.columnId === undefined ? {} : { columnId: args.columnId }),
    groupId: args.groupId,
    rank: args.rank,
    updatedAt: args.updatedAt,
  })

  await retireGroupedCardVotes(tx, card, args.groupId)

  if (card.groupId !== null && card.groupId !== args.groupId) {
    await dissolveEmptyGroup(tx, card.groupId)
  }
})

export const createRetroGroupArgs = z.object({
  id: z.string().min(1),
  retroId: z.string().min(1),
  columnId: z.string().min(1),
  label: z.string().nullable().optional(),
  rank: rankSchema,
  cardIds: z.array(z.string().min(1)).max(50).optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

// Dragging a card onto another forms a group: one client-minted group id, and each card's group
// reference updated. Groups the cards left behind are dissolved if they are now empty.
export const createRetroGroup = defineMutator(createRetroGroupArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const retro = await loadRetroForWrite(tx, ctx, args.retroId, 'group', args.id)
  await loadRetroColumn(tx, args.retroId, args.columnId, args.id)
  const label =
    args.label == null
      ? null
      : assertRetroText(args.label, args.id, RETRO_GROUP_LABEL_MAX_LENGTH, 'A group label')

  await tx.mutate.retro_group.insert({
    id: args.id,
    retroId: args.retroId,
    teamId: retro.teamId,
    columnId: args.columnId,
    label,
    rank: args.rank,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  })

  const vacated: (string | null)[] = []
  for (const cardId of args.cardIds ?? []) {
    const card = (await tx.run(zql.retro_card.where('id', cardId).one())) as
      | RetroCardRow
      | undefined
    if (!card || card.retroId !== args.retroId || card.columnId !== args.columnId) {
      throw new MutationError(
        'A card can only join a group in its own column',
        MutationErrorCode.invalidTarget,
        args.id,
      )
    }
    vacated.push(card.groupId)
    await tx.mutate.retro_card.update({
      id: cardId,
      groupId: args.id,
      updatedAt: args.updatedAt,
    })
    await retireGroupedCardVotes(tx, card, args.id)
  }

  for (const groupId of new Set(vacated)) {
    if (groupId === null || groupId === args.id) continue
    await dissolveEmptyGroup(tx, groupId)
  }
})

export const labelRetroGroupArgs = z.object({
  id: z.string().min(1),
  label: z.string().nullable(),
  updatedAt: timestamp,
})

export const labelRetroGroup = defineMutator(labelRetroGroupArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const group = (await tx.run(zql.retro_group.where('id', args.id).one())) as
    | RetroGroupRow
    | undefined
  if (!group) throw notAuthorized(args.id)
  await loadRetroForWrite(tx, ctx, group.retroId, 'group', args.id)
  const label =
    args.label === null
      ? null
      : assertRetroText(args.label, args.id, RETRO_GROUP_LABEL_MAX_LENGTH, 'A group label')
  await tx.mutate.retro_group.update({ id: args.id, label, updatedAt: args.updatedAt })
})

export const dissolveRetroGroupArgs = z.object({
  id: z.string().min(1),
  updatedAt: timestamp,
})

export const dissolveRetroGroup = defineMutator(
  dissolveRetroGroupArgs,
  async ({ tx, args, ctx }) => {
    if (!canWrite(ctx)) throw notAuthorized(args.id)
    const group = (await tx.run(zql.retro_group.where('id', args.id).one())) as
      | RetroGroupRow
      | undefined
    if (!group) throw notAuthorized(args.id)
    await loadRetroForWrite(tx, ctx, group.retroId, 'group', args.id)

    const cards = (await tx.run(zql.retro_card.where('groupId', args.id))) as { id: string }[]
    for (const card of cards) {
      await tx.mutate.retro_card.update({ id: card.id, groupId: null, updatedAt: args.updatedAt })
    }
    await clearRetroVotesForTarget(tx, args.id)
    await tx.mutate.retro_group.delete({ id: args.id })
  },
)

export const deleteRetroCardArgs = z.object({ id: z.string().min(1) })

// A published card's body is editable by nobody — that is the price of anonymity being real — so
// deletion is the only card write after publish. Allowed for the facilitator/admin (moderation) and
// for the card's own author, proven WITHOUT any client learning an author: the caller's retained
// draft row (self-synced, `author_id` written from ctx) is the client-checkable proof, and the server
// override re-verifies the same claim against the server-only `retro_card_author` table.
export const deleteRetroCard = defineMutator(deleteRetroCardArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const card = (await tx.run(zql.retro_card.where('id', args.id).one())) as RetroCardRow | undefined
  if (!card) throw notAuthorized(args.id)
  const retro = await loadRetroForWrite(tx, ctx, card.retroId, 'moderate', args.id)

  if (!isRetroFacilitator(retro, ctx)) {
    const ownDraft = await tx.run(
      zql.retro_draft.where('id', args.id).where('authorId', ctx.userID).one(),
    )
    if (!ownDraft) throw notAuthorized(args.id)
  }

  await clearRetroVotesForTarget(tx, args.id)
  await tx.mutate.retro_card.delete({ id: args.id })
  await dissolveEmptyGroup(tx, card.groupId)
})

export const castRetroVoteArgs = z.object({
  id: z.string().min(1),
  retroId: z.string().min(1),
  targetType: retroVoteTargetSchema,
  targetId: z.string().min(1),
  createdAt: timestamp,
})

export type CastRetroVoteArgs = z.infer<typeof castRetroVoteArgs>

// One row is one dot; stacking dots on one target is allowed, bounded only by the total. The budget
// is counted from the caller's OWN rows — a count the client has in full, so the UI self-limits and
// the server is authoritative on a race. A vote targets the GROUP once the card is grouped, which
// avoids auto-creating singleton groups (that would mint ids inside a mutator).
//
// The tally is written here only on the client, as the optimistic dot. The server override replaces
// it with an ATOMIC SQL increment, because a read-then-write count loses updates when a whole team
// votes at once.
export const castRetroVote = defineMutator(castRetroVoteArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const retro = await loadRetroForWrite(tx, ctx, args.retroId, 'vote', args.id)

  if (args.targetType === 'card') {
    const card = (await tx.run(zql.retro_card.where('id', args.targetId).one())) as
      | RetroCardRow
      | undefined
    if (!card || card.retroId !== args.retroId) {
      throw new MutationError(
        'That card is not in this retro',
        MutationErrorCode.invalidTarget,
        args.id,
      )
    }
    if (card.groupId !== null) {
      throw new MutationError(
        'A grouped card is voted on through its group',
        MutationErrorCode.invalidTarget,
        args.id,
      )
    }
  } else {
    const group = (await tx.run(zql.retro_group.where('id', args.targetId).one())) as
      | RetroGroupRow
      | undefined
    if (!group || group.retroId !== args.retroId) {
      throw new MutationError(
        'That group is not in this retro',
        MutationErrorCode.invalidTarget,
        args.id,
      )
    }
  }

  const mine = await tx.run(
    zql.retro_vote.where('retroId', args.retroId).where('voterId', ctx.userID),
  )
  if (mine.length >= retro.votesPerParticipant) {
    throw new MutationError(
      `You have used all ${retro.votesPerParticipant} of your dots`,
      MutationErrorCode.voteBudget,
      args.id,
    )
  }

  await tx.mutate.retro_vote.insert({
    id: args.id,
    retroId: args.retroId,
    teamId: retro.teamId,
    targetType: args.targetType,
    targetId: args.targetId,
    voterId: ctx.userID,
    createdAt: args.createdAt,
  })

  if (tx.location === 'server') return
  await bumpRetroVoteTally(tx, retro.teamId, args, 1)
})

interface VoteTallyTarget {
  retroId: string
  targetType: RetroVoteTarget
  targetId: string
  createdAt: number
}

// The optimistic tally write, keyed by the TARGET's own id so nothing is minted here.
async function bumpRetroVoteTally(
  tx: Transaction,
  teamId: string,
  target: VoteTallyTarget,
  delta: 1 | -1,
): Promise<void> {
  const tally = (await tx.run(zql.retro_vote_tally.where('targetId', target.targetId).one())) as
    | { targetId: string; count: number }
    | undefined
  const count = Math.max((tally?.count ?? 0) + delta, 0)
  await tx.mutate.retro_vote_tally.upsert({
    targetId: target.targetId,
    retroId: target.retroId,
    teamId,
    targetType: target.targetType,
    count,
    createdAt: target.createdAt,
    updatedAt: target.createdAt,
  })
}

export const retractRetroVoteArgs = z.object({
  id: z.string().min(1),
  updatedAt: timestamp,
})

export type RetractRetroVoteArgs = z.infer<typeof retractRetroVoteArgs>

interface RetroVoteRow {
  id: string
  retroId: string
  targetType: RetroVoteTarget
  targetId: string
  voterId: string
}

// Voter-only, with NO admin bypass: who voted for what never leaves the server for anyone but the
// voter, so nobody else can retract on their behalf either.
export const retractRetroVote = defineMutator(retractRetroVoteArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const vote = (await tx.run(zql.retro_vote.where('id', args.id).one())) as RetroVoteRow | undefined
  if (!vote) throw notAuthorized(args.id)
  if (vote.voterId !== ctx.userID) throw notAuthorized(args.id)
  const retro = await loadRetroForWrite(tx, ctx, vote.retroId, 'vote', args.id)

  await tx.mutate.retro_vote.delete({ id: args.id })

  if (tx.location === 'server') return
  await bumpRetroVoteTally(
    tx,
    retro.teamId,
    {
      retroId: vote.retroId,
      targetType: vote.targetType,
      targetId: vote.targetId,
      createdAt: args.updatedAt,
    },
    -1,
  )
})

export const createRetroActionArgs = z.object({
  id: z.string().min(1),
  retroId: z.string().min(1),
  body: z.string(),
  assigneeId: z.string().min(1).nullable().optional(),
  targetCycleId: z.string().min(1).nullable().optional(),
  cardId: z.string().min(1).nullable().optional(),
  groupId: z.string().min(1).nullable().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export const createRetroAction = defineMutator(createRetroActionArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const retro = await loadRetroForWrite(tx, ctx, args.retroId, 'action', args.id)
  const body = assertRetroText(args.body, args.id, RETRO_ACTION_BODY_MAX_LENGTH, 'An action')

  if (args.assigneeId != null) {
    await assertTeamMember(tx, retro.teamId, args.assigneeId, args.id)
  }
  if (args.targetCycleId != null) {
    await assertSameTeamCycle(tx, retro.teamId, args.targetCycleId, args.id)
  }
  if (args.cardId != null) {
    const card = (await tx.run(zql.retro_card.where('id', args.cardId).one())) as
      | RetroCardRow
      | undefined
    if (!card || card.retroId !== args.retroId) {
      throw new MutationError(
        'That card is not in this retro',
        MutationErrorCode.invalidTarget,
        args.id,
      )
    }
  }
  if (args.groupId != null) {
    const group = (await tx.run(zql.retro_group.where('id', args.groupId).one())) as
      | RetroGroupRow
      | undefined
    if (!group || group.retroId !== args.retroId) {
      throw new MutationError(
        'That group is not in this retro',
        MutationErrorCode.invalidTarget,
        args.id,
      )
    }
  }

  await tx.mutate.retro_action.insert({
    id: args.id,
    retroId: args.retroId,
    teamId: retro.teamId,
    groupId: args.groupId ?? null,
    cardId: args.cardId ?? null,
    body,
    assigneeId: args.assigneeId ?? null,
    targetCycleId: args.targetCycleId ?? retro.nextCycleId,
    issueId: null,
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  })
})

interface RetroActionRow {
  id: string
  retroId: string
  body: string
  assigneeId: string | null
  targetCycleId: string | null
  issueId: string | null
}

async function loadRetroActionForWrite(
  tx: Transaction,
  ctx: AuthContext,
  actionId: string,
  op: RetroWriteOp,
): Promise<{ action: RetroActionRow; retro: RetroRow }> {
  const action = (await tx.run(zql.retro_action.where('id', actionId).one())) as
    | RetroActionRow
    | undefined
  if (!action) throw notAuthorized(actionId)
  const retro = await loadRetroForWrite(tx, ctx, action.retroId, op, actionId)
  return { action, retro }
}

export const updateRetroActionArgs = z.object({
  id: z.string().min(1),
  body: z.string().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  targetCycleId: z.string().min(1).nullable().optional(),
  updatedAt: timestamp,
})

export const updateRetroAction = defineMutator(updateRetroActionArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  const { retro } = await loadRetroActionForWrite(tx, ctx, args.id, 'action')

  const body =
    args.body === undefined
      ? undefined
      : assertRetroText(args.body, args.id, RETRO_ACTION_BODY_MAX_LENGTH, 'An action')
  if (args.assigneeId != null) {
    await assertTeamMember(tx, retro.teamId, args.assigneeId, args.id)
  }
  if (args.targetCycleId != null) {
    await assertSameTeamCycle(tx, retro.teamId, args.targetCycleId, args.id)
  }

  await tx.mutate.retro_action.update({
    id: args.id,
    ...(body === undefined ? {} : { body }),
    ...(args.assigneeId === undefined ? {} : { assigneeId: args.assigneeId }),
    ...(args.targetCycleId === undefined ? {} : { targetCycleId: args.targetCycleId }),
    updatedAt: args.updatedAt,
  })
})

export const deleteRetroActionArgs = z.object({ id: z.string().min(1) })

export const deleteRetroAction = defineMutator(deleteRetroActionArgs, async ({ tx, args, ctx }) => {
  if (!canWrite(ctx)) throw notAuthorized(args.id)
  await loadRetroActionForWrite(tx, ctx, args.id, 'action')
  await tx.mutate.retro_action.delete({ id: args.id })
})

export const convertRetroActionToIssueArgs = z.object({
  actionId: z.string().min(1),
  issueId: z.string().min(1),
  rank: rankSchema.nullable().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export type ConvertRetroActionToIssueArgs = z.infer<typeof convertRetroActionToIssueArgs>

function retroActionDescription(retroTitle: string, body: string): ReadonlyJSONValue {
  const paragraphs = [`From the ${retroTitle} retrospective.`, body]
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  }
}

// The loop that makes a retro part of the work graph instead of a forgotten doc: an action becomes a
// REAL issue through the shared `issue.create` mutator function — same authorization, same
// ctx-derived creator, same triage defaults, and (in the override) the same server-authoritative
// per-team number — then through the shared `issue.setCycle` so it lands in the next cycle with its
// assignment stamped. The new issue's id is minted at the CALL SITE. Idempotent: an already-converted
// action is a no-op rather than a second issue.
export const convertRetroActionToIssue = defineMutator(
  convertRetroActionToIssueArgs,
  async ({ tx, args, ctx }) => {
    if (!canWrite(ctx)) throw notAuthorized(args.actionId)
    const { action, retro } = await loadRetroActionForWrite(tx, ctx, args.actionId, 'convert')
    if (action.issueId !== null) return

    const firstLine = action.body.split('\n')[0] ?? action.body
    const title = firstLine.trim().slice(0, ISSUE_TITLE_MAX_LENGTH)
    const cycleId = action.targetCycleId ?? retro.nextCycleId

    await createIssue.fn({
      tx,
      args: {
        id: args.issueId,
        teamId: retro.teamId,
        title,
        status: 'todo',
        priority: 'no_priority',
        assigneeId: action.assigneeId,
        description: retroActionDescription(retro.title, action.body),
        rank: args.rank ?? null,
        needsTriage: false,
        createdAt: args.createdAt,
        updatedAt: args.updatedAt,
      },
      ctx,
    })

    if (cycleId !== null) {
      await setIssueCycle.fn({
        tx,
        args: { id: args.issueId, cycleId, updatedAt: args.updatedAt },
        ctx,
      })
    }

    await tx.mutate.retro_action.update({
      id: args.actionId,
      issueId: args.issueId,
      updatedAt: args.updatedAt,
    })
  },
)

export const retroPresenceHeartbeatArgs = z.object({
  retroId: z.string().min(1),
  focusTarget: z.string().min(1).nullable().optional(),
  lastSeenAt: timestamp,
})

// Coarse, throttled, self-written from the verified ctx (never args) and pruned by the existing
// maintenance pass — so "who's here" costs no sidecar service and no new job type.
export const retroPresenceHeartbeat = defineMutator(
  retroPresenceHeartbeatArgs,
  async ({ tx, args, ctx }) => {
    if (!canWrite(ctx)) throw notAuthorized(args.retroId)
    const retro = await loadRetroForWrite(tx, ctx, args.retroId, 'presence')
    await tx.mutate.retro_presence.upsert({
      retroId: args.retroId,
      userId: ctx.userID,
      teamId: retro.teamId,
      focusTarget: args.focusTarget ?? null,
      lastSeenAt: args.lastSeenAt,
    })
  },
)

export const mutators = defineMutators({
  workspace: {
    rename: renameWorkspace,
  },
  preference: {
    set: setPreference,
  },
  notification: {
    markRead: markNotificationRead,
    markAllRead: markAllNotificationsRead,
  },
  issueSubscription: {
    follow: followIssue,
    unfollow: unfollowIssue,
  },
  member: {
    changeRole: changeMemberRole,
    remove: removeMember,
  },
  team: {
    create: createTeam,
    rename: renameTeam,
    archive: archiveTeam,
    setAutoStatus: setTeamAutoStatus,
    addMember: addTeamMember,
    removeMember: removeTeamMember,
  },
  invite: {
    create: createInvite,
    revoke: revokeInvite,
  },
  issue: {
    create: createIssue,
    update: updateIssue,
    setStatus: setIssueStatus,
    setPriority: setIssuePriority,
    assign: assignIssue,
    move: moveIssue,
    setCycle: setIssueCycle,
    setProject: setIssueProject,
    addLabel: addIssueLabel,
    removeLabel: removeIssueLabel,
    flagTriage,
    acceptTriage,
    declineTriage,
    routeIssue,
  },
  cycle: {
    create: createCycle,
    update: updateCycle,
    activate: activateCycle,
    complete: completeCycle,
  },
  project: {
    create: createProject,
    update: updateProject,
    delete: deleteProject,
  },
  label: {
    create: createLabel,
    rename: renameLabel,
    delete: deleteLabel,
  },
  comment: {
    create: createComment,
    edit: editComment,
    delete: deleteComment,
  },
  savedView: {
    create: createSavedView,
    update: updateSavedView,
    delete: deleteSavedView,
  },
  retro: {
    openForCycle: openRetroForCycle,
    configure: configureRetro,
    delete: deleteRetro,
    claimFacilitator: claimRetroFacilitator,
    setFacilitator: setRetroFacilitator,
    setPhase: setRetroPhase,
    startTimer: startRetroTimer,
    stopTimer: stopRetroTimer,
    convertActionToIssue: convertRetroActionToIssue,
  },
  retroDraft: {
    create: createRetroDraft,
    update: updateRetroDraft,
    delete: deleteRetroDraft,
  },
  retroCard: {
    move: moveRetroCard,
    delete: deleteRetroCard,
  },
  retroGroup: {
    create: createRetroGroup,
    label: labelRetroGroup,
    dissolve: dissolveRetroGroup,
  },
  retroVote: {
    cast: castRetroVote,
    retract: retractRetroVote,
  },
  retroAction: {
    create: createRetroAction,
    update: updateRetroAction,
    delete: deleteRetroAction,
  },
  retroPresence: {
    heartbeat: retroPresenceHeartbeat,
  },
})

export const RENAME_WORKSPACE_MUTATOR_NAME = 'workspace.rename'
export const SET_PREFERENCE_MUTATOR_NAME = 'preference.set'
export const MARK_NOTIFICATION_READ_MUTATOR_NAME = 'notification.markRead'
export const MARK_ALL_NOTIFICATIONS_READ_MUTATOR_NAME = 'notification.markAllRead'
export const FOLLOW_ISSUE_MUTATOR_NAME = 'issueSubscription.follow'
export const UNFOLLOW_ISSUE_MUTATOR_NAME = 'issueSubscription.unfollow'
export const CREATE_ISSUE_MUTATOR_NAME = 'issue.create'
export const UPDATE_ISSUE_MUTATOR_NAME = 'issue.update'
export const SET_ISSUE_STATUS_MUTATOR_NAME = 'issue.setStatus'
export const SET_ISSUE_PRIORITY_MUTATOR_NAME = 'issue.setPriority'
export const ASSIGN_ISSUE_MUTATOR_NAME = 'issue.assign'
export const MOVE_ISSUE_MUTATOR_NAME = 'issue.move'
export const SET_ISSUE_CYCLE_MUTATOR_NAME = 'issue.setCycle'
export const SET_ISSUE_PROJECT_MUTATOR_NAME = 'issue.setProject'
export const CREATE_PROJECT_MUTATOR_NAME = 'project.create'
export const UPDATE_PROJECT_MUTATOR_NAME = 'project.update'
export const DELETE_PROJECT_MUTATOR_NAME = 'project.delete'
export const FLAG_TRIAGE_MUTATOR_NAME = 'issue.flagTriage'
export const ACCEPT_TRIAGE_MUTATOR_NAME = 'issue.acceptTriage'
export const DECLINE_TRIAGE_MUTATOR_NAME = 'issue.declineTriage'
export const ROUTE_ISSUE_MUTATOR_NAME = 'issue.routeIssue'
export const CREATE_CYCLE_MUTATOR_NAME = 'cycle.create'
export const UPDATE_CYCLE_MUTATOR_NAME = 'cycle.update'
export const ACTIVATE_CYCLE_MUTATOR_NAME = 'cycle.activate'
export const COMPLETE_CYCLE_MUTATOR_NAME = 'cycle.complete'
export const ADD_ISSUE_LABEL_MUTATOR_NAME = 'issue.addLabel'
export const REMOVE_ISSUE_LABEL_MUTATOR_NAME = 'issue.removeLabel'
export const CREATE_LABEL_MUTATOR_NAME = 'label.create'
export const CREATE_COMMENT_MUTATOR_NAME = 'comment.create'
export const CREATE_SAVED_VIEW_MUTATOR_NAME = 'savedView.create'
export const OPEN_RETRO_FOR_CYCLE_MUTATOR_NAME = 'retro.openForCycle'
export const CONFIGURE_RETRO_MUTATOR_NAME = 'retro.configure'
export const DELETE_RETRO_MUTATOR_NAME = 'retro.delete'
export const CLAIM_RETRO_FACILITATOR_MUTATOR_NAME = 'retro.claimFacilitator'
export const SET_RETRO_FACILITATOR_MUTATOR_NAME = 'retro.setFacilitator'
export const SET_RETRO_PHASE_MUTATOR_NAME = 'retro.setPhase'
export const START_RETRO_TIMER_MUTATOR_NAME = 'retro.startTimer'
export const STOP_RETRO_TIMER_MUTATOR_NAME = 'retro.stopTimer'
export const CONVERT_RETRO_ACTION_MUTATOR_NAME = 'retro.convertActionToIssue'
export const CREATE_RETRO_DRAFT_MUTATOR_NAME = 'retroDraft.create'
export const UPDATE_RETRO_DRAFT_MUTATOR_NAME = 'retroDraft.update'
export const DELETE_RETRO_DRAFT_MUTATOR_NAME = 'retroDraft.delete'
export const MOVE_RETRO_CARD_MUTATOR_NAME = 'retroCard.move'
export const DELETE_RETRO_CARD_MUTATOR_NAME = 'retroCard.delete'
export const CREATE_RETRO_GROUP_MUTATOR_NAME = 'retroGroup.create'
export const LABEL_RETRO_GROUP_MUTATOR_NAME = 'retroGroup.label'
export const DISSOLVE_RETRO_GROUP_MUTATOR_NAME = 'retroGroup.dissolve'
export const CAST_RETRO_VOTE_MUTATOR_NAME = 'retroVote.cast'
export const RETRACT_RETRO_VOTE_MUTATOR_NAME = 'retroVote.retract'
export const CREATE_RETRO_ACTION_MUTATOR_NAME = 'retroAction.create'
export const UPDATE_RETRO_ACTION_MUTATOR_NAME = 'retroAction.update'
export const DELETE_RETRO_ACTION_MUTATOR_NAME = 'retroAction.delete'
export const RETRO_PRESENCE_HEARTBEAT_MUTATOR_NAME = 'retroPresence.heartbeat'
