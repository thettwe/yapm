import { defineMutator, defineMutators, type Transaction } from '@rocicorp/zero'
import * as z from 'zod'
import { type AuthContext, canManage, isMember } from './context.js'
import { MutationError, MutationErrorCode } from './errors.js'
import { zql } from './schema.js'

export const WORKSPACE_NAME_MAX_LENGTH = 200
export const TEAM_NAME_MAX_LENGTH = 200
export const TEAM_KEY_MAX_LENGTH = 16

const TEAM_KEY_PATTERN = /^[A-Z][A-Z0-9]*$/u

const roleSchema = z.enum(['admin', 'member', 'viewer'])
const timestamp = z.number().int().positive()

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

export const mutators = defineMutators({
  workspace: {
    rename: renameWorkspace,
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
})

export const RENAME_WORKSPACE_MUTATOR_NAME = 'workspace.rename'
