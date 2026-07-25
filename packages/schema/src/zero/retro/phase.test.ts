import { describe, expect, it } from 'vitest'
import { RETRO_FORMATS, RETRO_PHASES, type RetroPhase } from '../context.js'
import {
  isAdjacentPhase,
  isRetroWriteAllowed,
  RETRO_FORMAT_COLUMNS,
  RETRO_WRITE_OPS,
  retroColumnTemplate,
  retroPhaseIndex,
} from './phase.js'

describe('the retro phase order', () => {
  it('runs brainstorm -> group -> vote -> discuss -> actions -> closed', () => {
    expect([...RETRO_PHASES]).toEqual([
      'brainstorm',
      'group',
      'vote',
      'discuss',
      'actions',
      'closed',
    ])
  })

  it('accepts exactly one step forward and one step back, and nothing else', () => {
    for (const from of RETRO_PHASES) {
      for (const to of RETRO_PHASES) {
        const distance = Math.abs(retroPhaseIndex(to) - retroPhaseIndex(from))
        expect(isAdjacentPhase(from, to), `${from} -> ${to}`).toBe(distance === 1)
      }
    }
  })

  it('rejects the crafted transitions a client would try', () => {
    // A skip, a long rewind, and a no-op re-set of the current phase.
    expect(isAdjacentPhase('brainstorm', 'actions')).toBe(false)
    expect(isAdjacentPhase('brainstorm', 'closed')).toBe(false)
    expect(isAdjacentPhase('closed', 'brainstorm')).toBe(false)
    expect(isAdjacentPhase('vote', 'vote')).toBe(false)
  })
})

// The whole matrix, spelled out, so a change to the predicate has to change this table too.
const EXPECTED_ALLOWED: Record<string, readonly RetroPhase[]> = {
  draft: ['brainstorm'],
  configure: ['brainstorm'],
  group: ['group'],
  moderate: ['group', 'vote'],
  vote: ['vote'],
  action: ['discuss', 'actions'],
  convert: ['discuss', 'actions', 'closed'],
  timer: ['brainstorm', 'group', 'vote', 'discuss', 'actions'],
  facilitate: [...RETRO_PHASES],
  presence: [...RETRO_PHASES],
}

describe('isRetroWriteAllowed over the whole phase x operation matrix', () => {
  it('covers every operation exactly once', () => {
    expect(Object.keys(EXPECTED_ALLOWED).sort()).toEqual([...RETRO_WRITE_OPS].sort())
  })

  it.each(RETRO_WRITE_OPS)('%s is allowed only in its phases', (op) => {
    for (const phase of RETRO_PHASES) {
      expect(isRetroWriteAllowed(phase, op), `${op} in ${phase}`).toBe(
        (EXPECTED_ALLOWED[op] ?? []).includes(phase),
      )
    }
  })

  it('leaves a closed retro read-only except for converting an already-created action', () => {
    const allowedWhenClosed = RETRO_WRITE_OPS.filter((op) => isRetroWriteAllowed('closed', op))
    // Facilitation and presence are not retro CONTENT: one is control, the other is liveness.
    expect([...allowedWhenClosed].sort()).toEqual(['convert', 'facilitate', 'presence'])
  })

  it('hides cards, groups, votes and actions while people are still writing drafts', () => {
    for (const op of ['group', 'vote', 'action', 'moderate'] as const) {
      expect(isRetroWriteAllowed('brainstorm', op)).toBe(false)
    }
    expect(isRetroWriteAllowed('brainstorm', 'draft')).toBe(true)
  })

  it('closes drafting and configuration the moment the board is published', () => {
    for (const phase of ['group', 'vote', 'discuss', 'actions', 'closed'] as const) {
      expect(isRetroWriteAllowed(phase, 'draft')).toBe(false)
      expect(isRetroWriteAllowed(phase, 'configure')).toBe(false)
    }
  })
})

describe('format templates', () => {
  it('offers the four starter formats', () => {
    expect(Object.keys(RETRO_FORMAT_COLUMNS).sort()).toEqual([...RETRO_FORMATS].sort())
  })

  it.each(RETRO_FORMATS)('%s has unique column keys and a tokenized accent', (format) => {
    const columns = retroColumnTemplate(format)
    expect(columns.length).toBeGreaterThanOrEqual(3)
    expect(new Set(columns.map((column) => column.key)).size).toBe(columns.length)
    for (const column of columns) {
      expect(column.title.length).toBeGreaterThan(0)
      // A token key, never a color literal — the guarantee the retro surface is styled from tokens.
      expect(column.accentToken).not.toMatch(/^#|rgb|oklch/iu)
    }
  })

  it('defaults to the zero-learning-curve went-well / didn’t / actions set', () => {
    expect(retroColumnTemplate('wentwell_didnt_action').map((column) => column.key)).toEqual([
      'went_well',
      'didnt_go_well',
      'action_items',
    ])
  })
})
