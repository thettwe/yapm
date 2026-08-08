import type { IssueStatus } from './context.js'
import { type DeliverySignal, type DivergenceKind, formatReviewAge } from './delivery.js'

// THE phrase dictionary. One classifier over the real predicates (`computeDeliverySignal` +
// `computeDivergence`), and register tables that are total over its key set. It lives beside the
// delivery seam rather than inside any surface so a second vocabulary for the same facts cannot be
// declared quietly: `phrases.test.ts` fails if a register loses a key, and a source-level test
// fails if these strings appear in a second file.

export type RestPhraseKey =
  | 'diverged_behind_merge'
  // TOTALITY PLACEHOLDER — no classifier path reaches this key with the shipped producer, and no
  // surface may promise its string. `computeDivergence` returns `status_ahead_of_pr` for an
  // in-review issue whose signal has a draft PR OR no PR at all, but `assembleLinkedEntities`
  // derives CI runs only from a linked pull request, so a non-null signal always carries one — and
  // the draft case resolves at `pr_draft`, one branch above. It stays in the key set because
  // `computeDivergence` can still produce the kind and the registers are total over what the
  // classifier can name; it becomes reachable the day CI runs are sourced independently of a PR.
  | 'diverged_ahead_of_pr'
  | 'diverged_done_ci_failing'
  | 'checks_failing'
  | 'merged_not_deployed'
  | 'deployed'
  | 'pr_approved'
  | 'pr_draft'
  | 'review_unreviewed'
  | 'review_returned'
  | 'in_review'
  | 'in_progress'
  | 'not_started'
  | 'in_backlog'

export const REST_PHRASE_KEYS: readonly RestPhraseKey[] = [
  'diverged_behind_merge',
  'diverged_ahead_of_pr',
  'diverged_done_ci_failing',
  'checks_failing',
  'merged_not_deployed',
  'deployed',
  'pr_approved',
  'pr_draft',
  'review_unreviewed',
  'review_returned',
  'in_review',
  'in_progress',
  'not_started',
  'in_backlog',
]

// `neutral` is the issue list's voice — a fact stated about the work. `personal` is the team
// home's YOURS voice, where the reader is the assignee and the phrase may say whose move it is.
export type PhraseRegister = 'neutral' | 'personal'

export interface RestPhrase {
  readonly key: RestPhraseKey
  // `null` means this register has nothing true to add on this surface: the row renders an empty
  // slot rather than filler.
  readonly text: string | null
  readonly urgent: boolean
  // The provider whose fact this phrase states, or null when yapm derived it. A property of the
  // ENTRY, so two surfaces cannot disagree about whether a phrase is sourced.
  readonly source: 'github' | null
}

export interface RestPhraseContext {
  // Milliseconds behind the review clock, for the two keys whose text names an age. Ignored by
  // every other key.
  readonly reviewAgeMs?: number | null
}

// The three keys yapm sources from a connected provider: the two check facts and the deploy fact.
// A divergence, a review age and a status position are yapm's own derivations and carry no mark.
const SOURCED: ReadonlySet<RestPhraseKey> = new Set<RestPhraseKey>([
  'checks_failing',
  'diverged_done_ci_failing',
  'merged_not_deployed',
])

const URGENT: ReadonlySet<RestPhraseKey> = new Set<RestPhraseKey>([
  'diverged_behind_merge',
  'diverged_ahead_of_pr',
  'diverged_done_ci_failing',
  'checks_failing',
])

type PhraseText = string | null
type Register = Record<RestPhraseKey, PhraseText | ((context: RestPhraseContext) => PhraseText)>

// There is no review-requested event, so `reviewAgeFrom` decides which sentence may be said: a
// pull request nobody has reviewed is WAITING, and one whose review came back was REVIEWED. Saying
// "waiting" of the second would invert the fact.
function age(context: RestPhraseContext): string | null {
  return context.reviewAgeMs == null ? null : formatReviewAge(context.reviewAgeMs)
}

const NEUTRAL: Register = {
  diverged_behind_merge: 'Done in git, not on the board',
  diverged_ahead_of_pr: 'In review — no PR',
  diverged_done_ci_failing: 'Done — checks failing',
  checks_failing: 'Checks failing',
  merged_not_deployed: 'Built — not live yet',
  deployed: null,
  pr_approved: 'Approved',
  pr_draft: 'Draft open',
  review_unreviewed: (context) => {
    const value = age(context)
    return value === null ? 'In review' : `In review — waiting ${value}`
  },
  review_returned: (context) => {
    const value = age(context)
    if (value === null) return 'In review'
    // `formatReviewAge` answers "now" under a minute, and this is the one clause in the dictionary
    // that ends in " ago" — so a review submitted seconds ago read "reviewed now ago" until this
    // existed. Under a minute the whole clause is "just now".
    return value === 'now' ? 'In review — reviewed just now' : `In review — reviewed ${value} ago`
  },
  in_review: null,
  in_progress: null,
  not_started: null,
  in_backlog: null,
}

const PERSONAL: Register = {
  diverged_behind_merge: 'Done in git — update the board',
  diverged_ahead_of_pr: 'In review',
  diverged_done_ci_failing: 'Checks failing — the fix is yours',
  checks_failing: 'Checks failing — the fix is yours',
  merged_not_deployed: 'Merged — not live yet',
  deployed: 'Live',
  pr_approved: 'Approved — merge when ready',
  pr_draft: 'Draft open — not in review yet',
  review_unreviewed: 'In review',
  review_returned: 'In review',
  in_review: 'In review',
  in_progress: 'In progress',
  not_started: 'Not started',
  in_backlog: 'In the backlog',
}

const REGISTERS: Record<PhraseRegister, Register> = { neutral: NEUTRAL, personal: PERSONAL }

// Precedence, and the reason for each step's place:
//   1. divergence first, EXCEPT `status_ahead_of_pr`, which sits below the draft branch — a draft
//      PR is the more specific fact about the same disagreement.
//   2. failing checks before the deploy axis: red checks are the reader's next move.
//   3. `merged_not_deployed` before `pr_approved`; unreachable in YOURS, where an unfinished issue
//      with a merged PR classifies as `diverged_behind_merge` first.
//   4. an open PR resolves to a review key, split by which clock `reviewAgeFrom` names.
//   5. the human status, last, because it is the fact git had no say in.
export function classifyRestPhrase(
  status: IssueStatus,
  signal: DeliverySignal | null,
  divergence: DivergenceKind | null,
): RestPhraseKey {
  if (divergence === 'status_behind_merge') return 'diverged_behind_merge'
  if (divergence === 'done_but_ci_failing') return 'diverged_done_ci_failing'
  if (signal?.ciHealth === 'failing') return 'checks_failing'
  if (signal?.pr === 'merged') {
    return signal.deployedAt == null ? 'merged_not_deployed' : 'deployed'
  }
  if (signal?.pr === 'approved') return 'pr_approved'
  if (signal?.pr === 'draft') return 'pr_draft'
  // Unreachable with the shipped producer — see the key's note above. Kept so the classifier stays
  // total over `DivergenceKind` rather than falling through to a status phrase if a future producer
  // yields a signal with no pull request.
  if (divergence === 'status_ahead_of_pr') return 'diverged_ahead_of_pr'
  if (signal?.pr === 'open') {
    return signal.reviewAgeFrom === 'review' ? 'review_returned' : 'review_unreviewed'
  }
  switch (status) {
    case 'in_review':
      return 'in_review'
    case 'in_progress':
      return 'in_progress'
    case 'todo':
      return 'not_started'
    default:
      return 'in_backlog'
  }
}

export function restPhrase(
  key: RestPhraseKey,
  register: PhraseRegister,
  context: RestPhraseContext = {},
): RestPhrase {
  const entry = REGISTERS[register][key]
  const text = typeof entry === 'function' ? entry(context) : entry
  return {
    key,
    text,
    urgent: URGENT.has(key),
    source: text === null ? null : SOURCED.has(key) ? 'github' : null,
  }
}

// The one call a surface needs: classify the row's real predicates, then say it in this surface's
// voice. A surface that reaches past this into the register tables would be re-deciding provenance
// and urgency for itself, which is what the dictionary exists to prevent.
export function sayRestPhrase(
  status: IssueStatus,
  signal: DeliverySignal | null,
  divergence: DivergenceKind | null,
  register: PhraseRegister,
): RestPhrase {
  const key = classifyRestPhrase(status, signal, divergence)
  return restPhrase(key, register, { reviewAgeMs: signal?.reviewAgeMs ?? null })
}
