import {
  RETRO_PHASES,
  type RetroColumnAccent,
  type RetroFormat,
  type RetroPhase,
} from '../context.js'

// The retro's authority, expressed as two pure predicates over the ordered phase list. Both run
// inside the SERVER mutators (a client-only gate is a suggestion, because optimistic local writes
// let a crafted mutation try anything) and the same functions drive the UI's affordances, so the
// UI and the authority can never disagree.

export function retroPhaseIndex(phase: RetroPhase): number {
  return RETRO_PHASES.indexOf(phase)
}

// Exactly one step forward or exactly one step back. Rejects same-phase, skips ("brainstorm ->
// actions"), and long rewinds ("closed -> brainstorm") alike.
export function isAdjacentPhase(from: RetroPhase, to: RetroPhase): boolean {
  return Math.abs(retroPhaseIndex(to) - retroPhaseIndex(from)) === 1
}

// Every retro write belongs to exactly one operation class. The phase matrix below is the single
// place a phase decides what is editable.
export const RETRO_WRITE_OPS = [
  // create/edit/delete one's own private draft
  'draft',
  // format, anonymity, vote budget, title
  'configure',
  // move a card, create/label/dissolve a group
  'group',
  // facilitator/author card deletion
  'moderate',
  // cast/retract a dot
  'vote',
  // create/edit/delete an action item
  'action',
  // convert an action into a tracked issue
  'convert',
  // start/stop the shared timer
  'timer',
  // claim / hand off facilitation
  'facilitate',
  // the throttled presence heartbeat
  'presence',
  // agree/disagree with one AI proposal, or clear that reaction
  'react',
] as const

export type RetroWriteOp = (typeof RETRO_WRITE_OPS)[number]

// The write matrix. `closed` is content-read-only: only converting an already-created action and
// the two non-content operations (facilitation, presence) survive it. Presence is deliberately
// allowed in every phase — a heartbeat is liveness, not retro content, and "who is here" has to
// stay accurate while a closed retro is being read.
const ALLOWED_PHASES: Record<RetroWriteOp, readonly RetroPhase[]> = {
  draft: ['brainstorm'],
  configure: ['brainstorm'],
  group: ['group'],
  moderate: ['group', 'vote'],
  vote: ['vote'],
  action: ['discuss', 'actions'],
  convert: ['discuss', 'actions', 'closed'],
  timer: ['brainstorm', 'group', 'vote', 'discuss', 'actions'],
  facilitate: RETRO_PHASES,
  presence: RETRO_PHASES,
  // `group` because the AI section appears at that advance and that is when people read it; `vote`
  // because the window has to stay open until the moment it closes. NOT `discuss`: the verdict is
  // stamped on entry to it, and a reaction accepted after the count would be silently uncounted,
  // which is worse than being told the window is shut.
  react: ['group', 'vote'],
}

export function isRetroWriteAllowed(phase: RetroPhase, op: RetroWriteOp): boolean {
  return ALLOWED_PHASES[op].includes(phase)
}

export interface RetroColumnTemplate {
  readonly key: string
  readonly title: string
  readonly accentToken: RetroColumnAccent
}

// Format -> column template. A client passes ids and ranks for these columns (minted at the call
// site); `retro.openForCycle` validates the keys, titles and accents against this map, so a known
// format name can never carry injected columns.
export const RETRO_FORMAT_COLUMNS: Record<RetroFormat, readonly RetroColumnTemplate[]> = {
  wentwell_didnt_action: [
    { key: 'went_well', title: 'Went well', accentToken: 'positive' },
    { key: 'didnt_go_well', title: "Didn't go well", accentToken: 'negative' },
    { key: 'action_items', title: 'Action items', accentToken: 'action' },
  ],
  start_stop_continue: [
    { key: 'start', title: 'Start', accentToken: 'positive' },
    { key: 'stop', title: 'Stop', accentToken: 'negative' },
    { key: 'continue', title: 'Continue', accentToken: 'neutral' },
  ],
  mad_sad_glad: [
    { key: 'mad', title: 'Mad', accentToken: 'negative' },
    { key: 'sad', title: 'Sad', accentToken: 'caution' },
    { key: 'glad', title: 'Glad', accentToken: 'positive' },
  ],
  '4ls': [
    { key: 'liked', title: 'Liked', accentToken: 'positive' },
    { key: 'learned', title: 'Learned', accentToken: 'neutral' },
    { key: 'lacked', title: 'Lacked', accentToken: 'caution' },
    { key: 'longed_for', title: 'Longed for', accentToken: 'action' },
  ],
}

export function retroColumnTemplate(format: RetroFormat): readonly RetroColumnTemplate[] {
  return RETRO_FORMAT_COLUMNS[format]
}
