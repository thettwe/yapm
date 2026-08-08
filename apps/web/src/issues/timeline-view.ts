import {
  type DivergenceKind,
  formatReviewAge,
  type IssueMergedMoment,
  type IssueMoment,
  type IssueReviewedMoment,
  latestMoment,
} from '@yapm/schema'
import type { TrackNodeKind, TrackStation } from '@yapm/ui/components/reality-track'

// THE PHRASING LAYER, and only that. `buildIssueTimeline` decides what is true; this decides how
// this one surface says it. Every function here reads the SAME ordered moment list, so the rail's
// station and the feed's entry describing one moment cannot date it two ways or contradict each
// other — which is the whole reason the derivation lives in `packages/schema` and the words do not.
//
// Nothing here reads a row: if a sentence cannot be built from a moment, the moment did not happen
// and the sentence is not said.

export function shortSha(sha: string | null): string | null {
  return sha === null ? null : sha.slice(0, 7)
}

// "3d", "22h", "now" — the same formatter the track's age column and the phrase dictionary use, so
// one moment is never 22h in one line and a day in another.
export function ago(ageMs: number): string {
  return formatReviewAge(ageMs)
}

const REVIEW_WORD: Record<string, string> = {
  approved: 'approved',
  changes_requested: 'changes requested',
  commented: 'commented',
  dismissed: 'dismissed',
}

function reviewWord(state: string): string {
  return REVIEW_WORD[state] ?? 'reviewed'
}

// The whole shape of a review exchange in one clause. A single round says what it was; several
// rounds say how they ended, because "2 rounds · approved" hides the fact that the change came
// back once — which is exactly the fact a reader is looking for.
export function reviewSequence(reviews: readonly IssueReviewedMoment[]): string | null {
  const latest = reviews.at(-1)
  if (latest === undefined) return null
  const rounds = reviews.length
  const returned = reviews.slice(0, -1).some((review) => review.state === 'changes_requested')
  const ending = reviewWord(latest.state)
  if (rounds === 1) return ending
  return returned && latest.state === 'approved' ? 'changes requested, then approved' : ending
}

// `14/14 checks passed` and nothing that implies a duration: `ci_check` stores only `updatedAt`,
// so how long the checks took is not a fact yapm holds (design D2).
export function checksFact(merged: IssueMergedMoment): string | null {
  if (merged.checksTotal === 0) return null
  const checks = merged.checksTotal === 1 ? 'check' : 'checks'
  if (merged.checksHealth === 'passing') {
    return `${merged.checksPassed}/${merged.checksTotal} ${checks} passed`
  }
  if (merged.checksHealth === 'failing') {
    return `${merged.checksTotal - merged.checksPassed} of ${merged.checksTotal} ${checks} failing`
  }
  return `${merged.checksPassed}/${merged.checksTotal} ${checks} reported`
}

function joinFacts(parts: readonly (string | null)[]): string | null {
  const kept = parts.filter((part): part is string => part !== null && part !== '')
  return kept.length === 0 ? null : kept.join(' · ')
}

export interface RailView {
  readonly stations: readonly TrackStation[]
  // The stages the rail actually draws, in order — `idea → built → live`. Derived from the drawn
  // stations rather than written down, because a header promising a station that folded away is
  // the same lie as a disabled menu row.
  readonly chain: string
  // Names the stations drawn, in order, and nothing else.
  readonly label: string
}

// One station per moment that happened, in the mock's order. There is NO designed station: no
// entity backs one, so neither the rail nor its header may mention design.
export function buildRailView(moments: readonly IssueMoment[], cycleName: string | null): RailView {
  const stations: TrackStation[] = []

  const created = latestMoment(moments, 'created')
  const planned = latestMoment(moments, 'planned')
  const opened = latestMoment(moments, 'change_opened')
  const linked = latestMoment(moments, 'linked')
  const reviews = moments.filter(
    (moment): moment is IssueReviewedMoment => moment.kind === 'reviewed',
  )
  const merged = latestMoment(moments, 'merged')
  const deployed = latestMoment(moments, 'deployed')

  if (created !== null) {
    const cycle = planned === null ? null : (planned.cycleName ?? cycleName)
    stations.push({
      id: 'idea',
      node: 'done',
      label: cycle === null ? 'Idea' : `Idea — planned into ${cycle}`,
      fact:
        joinFacts([
          `created ${ago(created.ageMs)} ago`,
          planned === null ? null : `added at planning ${ago(planned.ageMs)} ago`,
        ]) ?? undefined,
    })
  }

  if (opened !== null) {
    stations.push({
      id: 'change-opened',
      node: 'done',
      label: 'Change opened',
      // No branch and no base ref: `pull_request` stores neither (design DI-1). How the link was
      // MADE — "matched by branch" — is a fact about the link, and the feed states it there.
      fact:
        joinFacts([
          opened.number === null ? opened.repo : `PR #${opened.number}`,
          `opened ${ago(opened.ageMs)} ago`,
        ]) ?? undefined,
    })
  } else if (linked !== null) {
    stations.push({
      id: 'change-linked',
      node: 'open',
      label: 'Change linked',
      fact: `linked ${ago(linked.ageMs)} ago`,
    })
  }

  const latestReview = reviews.at(-1)
  if (latestReview !== undefined) {
    // There is no review-requested event, so a reviewed station is drawn only where a review was
    // actually submitted; "waiting on a reviewer since X" is a sentence yapm cannot support.
    const node: TrackNodeKind = latestReview.state === 'approved' ? 'done' : 'rev-wait'
    stations.push({
      id: 'reviewed',
      node,
      label: `Reviewed — ${reviewWord(latestReview.state)}`,
      fact:
        joinFacts([
          `${latestReview.rounds} round${latestReview.rounds === 1 ? '' : 's'}`,
          reviewSequence(reviews),
          `${ago(latestReview.ageMs)} ago`,
        ]) ?? undefined,
    })
  }

  if (merged !== null) {
    stations.push({
      id: 'merged',
      node: 'done',
      label: 'Merged',
      fact:
        joinFacts([
          shortSha(merged.mergeCommitSha),
          checksFact(merged),
          `${ago(merged.ageMs)} ago`,
        ]) ?? undefined,
    })
  }

  if (deployed !== null) {
    stations.push({
      id: 'live',
      node: 'done',
      label: 'Live',
      fact:
        joinFacts([
          deployed.environment === null ? 'deployed' : `deployed to ${deployed.environment}`,
          `${ago(deployed.ageMs)} ago`,
        ]) ?? undefined,
    })
  } else if (merged !== null) {
    stations.push({
      id: 'not-live',
      node: 'empty',
      label: 'Not live yet',
      fact: 'no production release carries it',
    })
  }

  const chain = [
    stations.length > 0 ? 'idea' : null,
    opened !== null || linked !== null ? 'built' : null,
    merged !== null || deployed !== null ? 'live' : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' → ')

  const label = `Delivery: ${stations.map((station) => station.label).join(', ')}`

  return { stations, chain, label }
}

export interface ActivityEntry {
  readonly id: string
  readonly say: string
  readonly fact: string | null
  readonly at: number
  readonly ageMs: number
  readonly tone: 'plain' | 'link' | 'warm'
}

const LINK_SOURCE_WORD: Record<string, string> = {
  branch: 'matched by branch',
  body: 'referenced in the change body',
}

export function linkSourceWord(source: string): string {
  return LINK_SOURCE_WORD[source] ?? `matched by ${source}`
}

// The feed over the same moments. There is NO status-transition entry, in either register: the
// board stores `lastHumanStatusAt` — one scalar saying when a human last set a status — and no
// history at all, so "Work started · board todo → in-progress" is two claims nothing supports.
export function buildActivity(
  moments: readonly IssueMoment[],
  options: { readonly creatorName?: string | null; readonly cycleName?: string | null } = {},
): readonly ActivityEntry[] {
  const entries: ActivityEntry[] = []
  moments.forEach((moment, index) => {
    const id = `${moment.kind}-${index}`
    const base = { id, at: moment.at, ageMs: moment.ageMs } as const
    switch (moment.kind) {
      case 'created':
        entries.push({
          ...base,
          tone: 'plain',
          say: 'Created',
          fact: options.creatorName ? `by ${options.creatorName}` : null,
        })
        break
      case 'planned': {
        const cycle = moment.cycleName ?? options.cycleName ?? null
        entries.push({
          ...base,
          tone: 'plain',
          say: cycle === null ? 'Planned into a cycle' : `Planned into ${cycle}`,
          fact: joinFacts([
            'added at planning',
            moment.carryoverCount > 0 ? `carried over ${moment.carryoverCount}×` : null,
          ]),
        })
        break
      }
      case 'linked':
        entries.push({
          ...base,
          tone: 'link',
          say: 'Linked to a change',
          fact: joinFacts([
            moment.number === null ? moment.repo : `PR #${moment.number}`,
            linkSourceWord(moment.source),
          ]),
        })
        break
      case 'change_opened':
        entries.push({
          ...base,
          tone: 'plain',
          say: 'Change opened',
          fact: joinFacts([
            moment.repo,
            moment.number === null ? null : `#${moment.number}`,
            moment.title,
          ]),
        })
        break
      case 'reviewed':
        entries.push({
          ...base,
          tone: 'warm',
          say: `Review ${reviewWord(moment.state)}`,
          fact: joinFacts([
            `round ${moment.round} of ${moment.rounds}`,
            moment.author === null ? null : `by ${moment.author}`,
          ]),
        })
        break
      case 'merged':
        entries.push({
          ...base,
          tone: 'plain',
          say: 'Merged',
          fact: joinFacts([shortSha(moment.mergeCommitSha), checksFact(moment)]),
        })
        break
      case 'deployed':
        entries.push({
          ...base,
          tone: 'plain',
          say: moment.environment === null ? 'Deployed' : `Deployed to ${moment.environment}`,
          fact: shortSha(moment.sha),
        })
        break
    }
  })
  return entries
}

// The mono half of the two-register subline: the same facts the plain line states, in the register
// an engineer reads. Null when the issue has no git facts at all — an empty mono line under a
// plain one would be a register with nothing to say in it.
export function monoSubline(
  moments: readonly IssueMoment[],
  divergence: DivergenceKind | null,
): { readonly text: string; readonly sourced: boolean } | null {
  const opened = latestMoment(moments, 'change_opened')
  const merged = latestMoment(moments, 'merged')
  const deployed = latestMoment(moments, 'deployed')
  const number = merged?.number ?? opened?.number ?? null

  const text = joinFacts([
    merged === null
      ? opened === null
        ? null
        : `PR open ${ago(opened.ageMs)}`
      : `git merged ${shortSha(merged.mergeCommitSha) ?? 'no sha recorded'}`,
    number === null ? null : `PR #${number}`,
    deployed === null ? null : `live ${ago(deployed.ageMs)} ago`,
    // Drift is measured from the merge, because that is the moment the board stopped being true.
    divergence === 'status_behind_merge' && merged !== null ? `drifted ${ago(merged.ageMs)}` : null,
  ])
  if (text === null) return null
  return { text, sourced: opened !== null || merged !== null || deployed !== null }
}
