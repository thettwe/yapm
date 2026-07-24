import { ApplicationError } from '@rocicorp/zero'

export const MutationErrorCode = {
  invalidName: 'invalid_name',
  invalidKey: 'invalid_key',
  invalidColor: 'invalid_color',
  duplicateKey: 'duplicate_key',
  notAuthorized: 'not_authorized',
  lastAdmin: 'last_admin',
  crossTeam: 'cross_team',
} as const

export type MutationErrorCode = (typeof MutationErrorCode)[keyof typeof MutationErrorCode]

export type MutationErrorDetails = {
  readonly code: MutationErrorCode
  readonly id: string
}

export class MutationError extends ApplicationError<MutationErrorDetails> {
  constructor(message: string, code: MutationErrorCode, id: string) {
    super(message, { details: { code, id } })
    this.name = 'MutationError'
  }
}

const CODES: readonly string[] = Object.values(MutationErrorCode)

export function isMutationErrorDetails(details: unknown): details is MutationErrorDetails {
  if (typeof details !== 'object' || details === null) return false
  const code = (details as { code?: unknown }).code
  return typeof code === 'string' && CODES.includes(code)
}

export function mutationErrorCode(error: unknown): MutationErrorCode | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const details = (error as { details?: unknown }).details
  return isMutationErrorDetails(details) ? details.code : undefined
}
