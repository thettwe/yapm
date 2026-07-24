import {
  defineMutator,
  defineMutators,
  type ReadonlyJSONValue,
  type Transaction,
} from '@rocicorp/zero'
import * as z from 'zod'
import {
  type AuthContext,
  type CycleStatus,
  canManage,
  canWrite,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssueStatus,
  isAuthenticated,
  isMember,
  PROJECT_STATUSES,
  THEME_PRESETS,
} from './context.js'
import { type CycleOrderRow, isUnfinished, nextCycleId } from './cycles.js'
import { MutationError, MutationErrorCode } from './errors.js'
import { issueFilterSchema, issueGroupingSchema, issueSortSchema } from './filter.js'
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

// Load an existing issue for a write. The role-capability gate (`canWrite`) must run in the
// caller before this so a viewer/non-member is rejected before any existence check; here the
// row is read and a generic not-authorized is thrown for both "missing" and "wrong team" so
// a private issue's existence never leaks.
async function loadIssueForWrite(
  tx: Transaction,
  ctx: AuthContext,
  issueId: string,
): Promise<IssueRow> {
  const issue = (await tx.run(zql.issue.where('id', issueId).one())) as IssueRow | undefined
  if (!issue) throw notAuthorized(issueId)
  await assertTeamAccess(tx, ctx, issue.teamId, issueId)
  return issue
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
      updatedAt: args.updatedAt,
    })
    return
  }

  await tx.mutate.user_preference.insert({
    id: args.id,
    userId: ctx.userID,
    theme: args.theme,
    accent: args.accent,
    createdAt: args.updatedAt,
    updatedAt: args.updatedAt,
  })
})

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
    description: args.description ?? null,
    status: args.status,
    priority: args.priority,
    assigneeId: args.assigneeId ?? null,
    rank: args.rank ?? null,
    needsTriage: args.needsTriage ?? false,
    creatorId: ctx.userID,
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
    ...(args.description === undefined ? {} : { description: args.description }),
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
  await tx.mutate.issue.update({ id: args.id, status: args.status, updatedAt: args.updatedAt })
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
  }[]
  for (const issue of issues) {
    if (!isUnfinished(issue.status)) continue
    await tx.mutate.issue.update({ id: issue.id, cycleId: target, updatedAt: args.updatedAt })
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

  await tx.mutate.issue.update({
    id: args.id,
    cycleId: args.cycleId,
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
    ...(args.status === undefined ? {} : { status: args.status }),
    ...(args.assigneeId === undefined ? {} : { assigneeId: args.assigneeId }),
    ...(args.cycleId === undefined ? {} : { cycleId: args.cycleId }),
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
    body: args.body,
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
  await tx.mutate.comment.update({ id: args.id, body: args.body, updatedAt: args.updatedAt })
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

export const mutators = defineMutators({
  workspace: {
    rename: renameWorkspace,
  },
  preference: {
    set: setPreference,
  },
  member: {
    changeRole: changeMemberRole,
    remove: removeMember,
  },
  team: {
    create: createTeam,
    rename: renameTeam,
    archive: archiveTeam,
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
})

export const RENAME_WORKSPACE_MUTATOR_NAME = 'workspace.rename'
export const SET_PREFERENCE_MUTATOR_NAME = 'preference.set'
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
