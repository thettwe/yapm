import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildMutatorToolSpecs, mutatorToolNames } from '../ai-tools.js'
import { schema } from '../schema.js'

// THE ABSENCE design §D7 rests on: both AI artifact tables sync, and NEITHER has a client mutator.
// Sibling of `attachment-absence.test.ts`, for the same reason and in the same shape.
//
// "yapm computed these numbers" is only true if a client cannot write one. The write path is two
// server-only helpers over the shared Zero transaction, reachable from `server-mutators.ts` and from
// nowhere else — the `upsertCycleDigest` trick. The moment somebody adds `retroAiProposal.create`
// "so the panel can render optimistically", any client can insert a proposal citing anything, and
// the derived agent-tool registry exposes it as an AI-callable tool the day it is written.
//
// Both halves are asserted, so neither can pass vacuously: the client map must not reach the writer,
// and the server override must.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const CLIENT_MUTATORS = join(repoRoot, 'packages/schema/src/zero/mutators.ts')
const SERVER_MUTATORS = join(repoRoot, 'packages/schema/src/zero/server-mutators.ts')
const ARTIFACT_TABLES = ['retro_ai_draft', 'retro_ai_proposal'] as const

describe('the AI artifact tables sync but have no client mutator', () => {
  it('has both tables in the Zero schema, so the missing mutator is the point', () => {
    for (const table of ARTIFACT_TABLES) {
      expect(Object.keys(schema.tables)).toContain(table)
    }
  })

  it('registers no mutator over either artifact table', () => {
    const names = mutatorToolNames()
    // Non-vacuity: the registry is exhaustive, and the one mutator this change DID add is in it.
    expect(names).toContain('retro.setPhase')
    expect(names).toContain('team.setAiRetroDraft')
    expect(names.filter((name) => /^retroAi(Draft|Proposal)\./.test(name))).toEqual([])
    // Change 19's line, in the same file for the same reason: the REACTION is an ordinary client
    // mutator, and the VERDICT it feeds is not. A `retroAiProposal.*` mutator appearing here would
    // mean a client could stamp its own verdict — which is the whole authority this design keeps on
    // the server.
    expect(names).toContain('retroAiReaction.set')
    expect(names).toContain('retroAiReaction.clear')
  })

  it('exposes no artifact-writing tool to an agent', () => {
    const specs = buildMutatorToolSpecs()
    expect(specs).toHaveLength(mutatorToolNames().length)
    expect(specs.filter((spec) => /retroAiDraft|retroAiProposal/i.test(spec.name))).toEqual([])
  })

  it('never writes either table from the client mutator module', () => {
    const source = readFileSync(CLIENT_MUTATORS, 'utf8')
    // Non-vacuity: this module does write the retro surface, so a grep that finds nothing works.
    // Plain substring, not a constructed `\b` regex — boundary rule 4 reserves that shape for the
    // one member-name walker, and it is right to.
    expect(source).toContain('mutate.retro_card')
    for (const table of ARTIFACT_TABLES) {
      expect(source).not.toContain(`mutate.${table}`)
    }
    expect(source).not.toMatch(/ai-draft-writes/)
    // The verdict's writer is server-only by the same construction. Matched on the IMPORT rather
    // than on the name, because the reaction mutator names the module in a comment on purpose —
    // pointing a reader at where the counting actually happens is the opposite of hiding it.
    // Non-vacuity is the line above: the client module DOES write `retro_ai_reaction`, so finding no
    // import of the ratify module is a real absence rather than a grep that matches nothing.
    expect(source).toContain('mutate.retro_ai_reaction')
    expect(source).not.toMatch(/^import .*ratify-writes/mu)
    expect(source).not.toContain('mutate.retro_ai_proposal')
  })

  it('reaches the server-only writers from the server override, and only from there', () => {
    const source = readFileSync(SERVER_MUTATORS, 'utf8')
    expect(source).toMatch(/from '\.\/retro\/ai-draft-writes\.js'/)
    expect(source).toMatch(/\bupsertRetroAiDraft\(/)
    expect(source).toMatch(/from '\.\/retro\/ratify-writes\.js'/)
    expect(source).toMatch(/\bratifyRetroAiProposals\(/)
    expect(source).toMatch(/\bclearRetroAiVerdicts\(/)
  })
})
