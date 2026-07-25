import { ApplicationError } from '@rocicorp/zero'

export const MutationErrorCode = {
  invalidName: 'invalid_name',
  invalidKey: 'invalid_key',
  invalidColor: 'invalid_color',
  invalidDate: 'invalid_date',
  duplicateKey: 'duplicate_key',
  notAuthorized: 'not_authorized',
  lastAdmin: 'last_admin',
  crossTeam: 'cross_team',
  // The retro's phase machine: a non-adjacent transition, or a write in a phase where that kind of
  // change is closed. Checked against the retro's phase AT APPLY TIME on the server, so a write
  // racing a phase advance is rejected and the optimistic write rolls back.
  invalidPhase: 'invalid_phase',
  // The per-participant dot budget, counted from the caller's own vote rows.
  voteBudget: 'vote_budget',
  // A vote target that is not votable: a card that has been grouped (vote the group instead), or a
  // card/group that does not belong to the retro.
  invalidTarget: 'invalid_target',
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
