import { defineMutator, defineMutators } from '@rocicorp/zero'
import * as z from 'zod'
import { type AuthContext, canWrite } from './context.js'
import { MutationError, MutationErrorCode } from './errors.js'

export const WORKSPACE_NAME_MAX_LENGTH = 200

export function normalizeWorkspaceName(name: string): string {
  return name.replace(/\s+/gu, ' ').trim()
}

export const renameWorkspaceArgs = z.object({
  id: z.string().min(1),
  name: z.string(),
  updatedAt: z.number().int().positive(),
})

export type RenameWorkspaceArgs = z.infer<typeof renameWorkspaceArgs>

export function assertRenameWorkspaceAllowed(
  args: RenameWorkspaceArgs,
  ctx: AuthContext | undefined,
): string {
  if (!canWrite(ctx)) {
    throw new MutationError(
      'Not authorized to rename this workspace',
      MutationErrorCode.notAuthorized,
      args.id,
    )
  }

  const name = normalizeWorkspaceName(args.name)

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

export const mutators = defineMutators({
  workspace: {
    rename: renameWorkspace,
  },
})

export const RENAME_WORKSPACE_MUTATOR_NAME = 'workspace.rename'
