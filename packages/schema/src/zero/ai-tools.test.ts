import { describe, expect, it } from 'vitest'
import {
  activeMutatorTools,
  agentAuditEntry,
  buildMutatorToolSpecs,
  mutatorToolNames,
  needsApproval,
} from './ai-tools.js'
import { createIssueArgs, mutators, setIssueStatusArgs } from './mutators.js'

describe('ai tool registry — generated from defineMutators', () => {
  it('emits exactly one spec per mutator in the registry', () => {
    const specs = buildMutatorToolSpecs()
    const names = specs.map((spec) => spec.name).sort()
    const registryNames = mutatorToolNames().sort()

    expect(names).toEqual(registryNames)
    expect(new Set(names).size).toBe(names.length)
    // Every group.method in `defineMutators` is present.
    for (const group of Object.values(mutators)) {
      if (typeof group !== 'object' || group === null) continue
      for (const mutator of Object.values(group as Record<string, { mutatorName?: string }>)) {
        if (mutator?.mutatorName) expect(registryNames).toContain(mutator.mutatorName)
      }
    }
  })

  it('reuses the mutator’s own exported Zod args schema as the tool inputSchema (no parallel schema)', () => {
    const specs = buildMutatorToolSpecs()
    const byName = new Map(specs.map((spec) => [spec.name, spec]))
    expect(byName.get('issue.setStatus')?.args).toBe(setIssueStatusArgs)
    expect(byName.get('issue.create')?.args).toBe(createIssueArgs)
  })

  it('classifies deletes/role-changes as destructive and never throws on coverage', () => {
    const specs = buildMutatorToolSpecs()
    const byName = new Map(specs.map((spec) => [spec.name, spec.kind]))
    expect(byName.get('project.delete')).toBe('destructive')
    expect(byName.get('member.changeRole')).toBe('destructive')
    expect(byName.get('issue.setStatus')).toBe('write')
  })
})

describe('ai tool ceiling predicates', () => {
  it('requires human approval for every mutator tool (reads auto-run, exposed separately)', () => {
    expect(needsApproval('write')).toBe(true)
    expect(needsApproval('destructive')).toBe(true)
  })

  it('selects least-privilege active tools per task', () => {
    const specs = buildMutatorToolSpecs()
    // A summarize/read-only run mounts no write tools.
    expect(activeMutatorTools(specs)).toEqual([])
    // Writes on, destructive off (least privilege even below the human's role).
    const writes = activeMutatorTools(specs, { allowWrites: true })
    expect(writes).toContain('issue.setStatus')
    expect(writes).not.toContain('project.delete')
    // Destructive only when explicitly opted in.
    const all = activeMutatorTools(specs, { allowWrites: true, allowDestructive: true })
    expect(all).toContain('project.delete')
    expect(all.length).toBe(specs.length)
  })
})

describe('agent audit shape', () => {
  it('records actor = agent, on-behalf-of = user', () => {
    const entry = agentAuditEntry('user-1', { name: 'issue.create', kind: 'write' })
    expect(entry).toEqual({
      actor: 'agent',
      onBehalfOf: 'user-1',
      tool: 'issue.create',
      kind: 'write',
    })
  })
})
