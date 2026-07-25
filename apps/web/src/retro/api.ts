import { useZero } from '@rocicorp/zero/react'
import {
  mutators,
  newId,
  type RetroFormat,
  type RetroPhase,
  type RetroSeedRef,
  type RetroVoteTarget,
} from '@yapm/schema'
import { useCallback, useMemo, useState } from 'react'
import { runMutation } from '@/lib/mutation'
import { appendRank, retroColumnArgsFor } from '@/retro/model'

export interface RetroApi {
  createDraft: (
    columnId: string,
    body: string,
    siblings: readonly { rank: string }[],
    seedRef?: RetroSeedRef | null,
  ) => Promise<void>
  updateDraft: (id: string, body: string) => Promise<void>
  deleteDraft: (id: string) => Promise<void>
  moveCard: (
    id: string,
    move: { columnId?: string; groupId: string | null; rank: string },
  ) => Promise<void>
  groupCards: (
    columnId: string,
    cardIds: readonly string[],
    rank: string,
    label?: string | null,
  ) => Promise<void>
  labelGroup: (id: string, label: string | null) => Promise<void>
  dissolveGroup: (id: string) => Promise<void>
  deleteCard: (id: string) => Promise<void>
  castVote: (targetType: RetroVoteTarget, targetId: string) => Promise<void>
  retractVote: (voteId: string) => Promise<void>
  setPhase: (to: RetroPhase) => Promise<void>
  setAnonymous: (isAnonymous: boolean) => Promise<void>
  setFormat: (format: RetroFormat) => Promise<void>
  setVoteBudget: (votesPerParticipant: number) => Promise<void>
  claimFacilitator: () => Promise<void>
  setFacilitator: (userId: string | null) => Promise<void>
  startTimer: (durationS: number) => Promise<void>
  stopTimer: () => Promise<void>
  heartbeat: (columnId: string | null) => Promise<void>
  createAction: (
    body: string,
    provenance?: { cardId?: string | null; groupId?: string | null },
  ) => Promise<void>
  updateAction: (
    id: string,
    patch: { body?: string; assigneeId?: string | null; targetCycleId?: string | null },
  ) => Promise<void>
  deleteAction: (id: string) => Promise<void>
  convertAction: (id: string) => Promise<void>
}

export interface RetroApiHandle {
  api: RetroApi
  error: string | undefined
  clearError: () => void
}

// Every retro write in one place. Ids and ranks are minted HERE — at the call site — and passed
// in, never computed inside a mutator body: a mutator re-runs during rebase, and an id or rank
// minted inside one changes between runs and corrupts the optimistic result.
export function useRetroApi(retroId: string): RetroApiHandle {
  const zero = useZero()
  const [error, setError] = useState<string | undefined>(undefined)

  const clearError = useCallback(() => setError(undefined), [])

  const run = useCallback(
    async (write: ReturnType<typeof zero.mutate>): Promise<void> => {
      const failure = await runMutation(write)
      setError(failure)
    },
    [zero],
  )

  // The api object is memoised WITHOUT the error state, so a failed write does not change its
  // identity — otherwise every rejection would restart the presence heartbeat interval.
  const api = useMemo<RetroApi>(
    () => ({
      createDraft: (columnId, body, siblings, seedRef) => {
        const now = Date.now()
        return run(
          zero.mutate(
            mutators.retroDraft.create({
              id: newId(),
              retroId,
              columnId,
              body,
              rank: appendRank(siblings),
              seedRef: seedRef ?? null,
              createdAt: now,
              updatedAt: now,
            }),
          ),
        )
      },
      updateDraft: (id, body) =>
        run(zero.mutate(mutators.retroDraft.update({ id, body, updatedAt: Date.now() }))),
      deleteDraft: (id) => run(zero.mutate(mutators.retroDraft.delete({ id }))),
      moveCard: (id, move) =>
        run(zero.mutate(mutators.retroCard.move({ id, ...move, updatedAt: Date.now() }))),
      groupCards: (columnId, cardIds, rank, label) => {
        const now = Date.now()
        return run(
          zero.mutate(
            mutators.retroGroup.create({
              id: newId(),
              retroId,
              columnId,
              cardIds: [...cardIds],
              label: label ?? null,
              rank,
              createdAt: now,
              updatedAt: now,
            }),
          ),
        )
      },
      labelGroup: (id, label) =>
        run(zero.mutate(mutators.retroGroup.label({ id, label, updatedAt: Date.now() }))),
      dissolveGroup: (id) =>
        run(zero.mutate(mutators.retroGroup.dissolve({ id, updatedAt: Date.now() }))),
      deleteCard: (id) => run(zero.mutate(mutators.retroCard.delete({ id }))),
      castVote: (targetType, targetId) =>
        run(
          zero.mutate(
            mutators.retroVote.cast({
              id: newId(),
              retroId,
              targetType,
              targetId,
              createdAt: Date.now(),
            }),
          ),
        ),
      retractVote: (voteId) =>
        run(zero.mutate(mutators.retroVote.retract({ id: voteId, updatedAt: Date.now() }))),
      setPhase: (to) =>
        run(zero.mutate(mutators.retro.setPhase({ id: retroId, to, updatedAt: Date.now() }))),
      setAnonymous: (isAnonymous) =>
        run(
          zero.mutate(
            mutators.retro.configure({ id: retroId, isAnonymous, updatedAt: Date.now() }),
          ),
        ),
      // A format change replaces the columns, so the new set is minted HERE and re-validated
      // against the named template server-side; the mutator refuses outright once any draft or
      // card exists, including drafts this client cannot see.
      setFormat: (format) =>
        run(
          zero.mutate(
            mutators.retro.configure({
              id: retroId,
              format,
              columns: retroColumnArgsFor(format),
              updatedAt: Date.now(),
            }),
          ),
        ),
      setVoteBudget: (votesPerParticipant) =>
        run(
          zero.mutate(
            mutators.retro.configure({ id: retroId, votesPerParticipant, updatedAt: Date.now() }),
          ),
        ),
      claimFacilitator: () =>
        run(zero.mutate(mutators.retro.claimFacilitator({ id: retroId, updatedAt: Date.now() }))),
      setFacilitator: (userId) =>
        run(
          zero.mutate(
            mutators.retro.setFacilitator({
              id: retroId,
              facilitatorId: userId,
              updatedAt: Date.now(),
            }),
          ),
        ),
      startTimer: (durationS) => {
        const now = Date.now()
        return run(
          zero.mutate(
            mutators.retro.startTimer({
              id: retroId,
              durationS,
              endsAt: now + durationS * 1000,
              updatedAt: now,
            }),
          ),
        )
      },
      stopTimer: () =>
        run(zero.mutate(mutators.retro.stopTimer({ id: retroId, updatedAt: Date.now() }))),
      // `focusTarget` is deliberately narrowed to a column id: presence syncs to the whole team,
      // so pointing it at a card or draft id would let a client disclose more than "which column
      // I am in" — and after publish a card id is exactly the thing an anonymous retro hides.
      heartbeat: (columnId) =>
        run(
          zero.mutate(
            mutators.retroPresence.heartbeat({
              retroId,
              focusTarget: columnId,
              lastSeenAt: Date.now(),
            }),
          ),
        ),
      createAction: (body, provenance) => {
        const now = Date.now()
        return run(
          zero.mutate(
            mutators.retroAction.create({
              id: newId(),
              retroId,
              body,
              cardId: provenance?.cardId ?? null,
              groupId: provenance?.groupId ?? null,
              createdAt: now,
              updatedAt: now,
            }),
          ),
        )
      },
      updateAction: (id, patch) =>
        run(zero.mutate(mutators.retroAction.update({ id, ...patch, updatedAt: Date.now() }))),
      deleteAction: (id) => run(zero.mutate(mutators.retroAction.delete({ id }))),
      convertAction: (id) => {
        const now = Date.now()
        return run(
          zero.mutate(
            mutators.retro.convertActionToIssue({
              actionId: id,
              issueId: newId(),
              createdAt: now,
              updatedAt: now,
            }),
          ),
        )
      },
    }),
    [retroId, run, zero],
  )

  return { api, error, clearError }
}
