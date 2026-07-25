import {
  type AgentAuditEntry,
  type AuthContext,
  agentAuditEntry,
  buildMutatorToolSpecs,
  type MutatorToolSpec,
  needsApproval,
  newId,
} from '@yapm/schema'
import type { createServerMutators } from '@yapm/schema/server'
import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import type { ZeroDatabase } from '../zero/db-provider.js'

// The agent-as-actor bridge: turn the pure mutator-tool registry (packages/schema) into an
// AI-SDK `ToolSet` whose `execute` calls the SAME mutator the human UI calls, inside one Zero
// transaction, under an `AuthContext` DERIVED FROM THE INVOKING USER. The role ceiling is
// therefore automatic and is the primary injection defense: a viewer's agent gets a viewer ctx →
// every write mutator throws. Identity is taken from ctx, never from model output. Writes default
// to `needsApproval` (HITL); reads are exposed separately and auto-run. Built as foundation — the
// read-only cycle-digest flagship does not use it.

type ServerMutators = ReturnType<typeof createServerMutators>

type MutatorFn = (input: { tx: unknown; args: unknown; ctx: AuthContext }) => Promise<void>

// Flatten `{ group: { name: mutator } }` to `mutatorName -> fn` (e.g. `issue.setStatus`). The
// registry also carries a branded `~` phantom property, so only plain-object groups are walked.
function mutatorFnByName(mutators: ServerMutators): Map<string, MutatorFn> {
  const map = new Map<string, MutatorFn>()
  const groups = mutators as unknown as Record<string, unknown>
  for (const group of Object.values(groups)) {
    if (typeof group !== 'object' || group === null) continue
    for (const mutator of Object.values(group as Record<string, unknown>)) {
      const m = mutator as { mutatorName?: string; fn?: MutatorFn }
      if (m.mutatorName && m.fn) map.set(m.mutatorName, m.fn)
    }
  }
  return map
}

// Fields the wrapper always mints at the call site rather than trusting the model, per the
// client-minted-UUIDv7 rule (mutators re-run on rebase, so an id/timestamp computed inside would
// drift). Any of these present in a mutator's args is overwritten with a fresh server value.
function callSiteMintedFields(
  shape: Record<string, unknown>,
  now: number,
): Record<string, unknown> {
  const minted: Record<string, unknown> = {}
  if ('id' in shape) minted.id = newId()
  if ('createdAt' in shape) minted.createdAt = now
  if ('updatedAt' in shape) minted.updatedAt = now
  return minted
}

export interface BuildAgentToolsOptions {
  mutators: ServerMutators
  dbProvider: ZeroDatabase
  // The invoking user's context — the enforced ceiling for every tool call.
  ctx: AuthContext
  // Records each attempted agent mutation (actor = agent, on-behalf-of = user).
  onAudit?: (entry: AgentAuditEntry) => void
  now?: () => number
  specs?: readonly MutatorToolSpec[]
}

// Build the write-tool set. Each mutator becomes one `tool` whose `inputSchema` IS the mutator's
// own Zod args schema; `execute` mints call-site fields, runs the mutator under `ctx` in a Zero
// transaction, and audits the attempt. `needsApproval` is set so the loop pauses for human
// confirmation before any state change.
export function buildAgentTools(options: BuildAgentToolsOptions): ToolSet {
  const specs = options.specs ?? buildMutatorToolSpecs()
  const fnByName = mutatorFnByName(options.mutators)
  const now = options.now ?? Date.now
  const tools: ToolSet = {}

  for (const spec of specs) {
    const fn = fnByName.get(spec.name)
    if (!fn) continue
    const shape = spec.args instanceof z.ZodObject ? spec.args.shape : {}

    tools[spec.name] = tool({
      description: `Invoke the yapm "${spec.name}" mutator, subject to the invoking user's permissions.`,
      inputSchema: spec.args as z.ZodType,
      needsApproval: needsApproval(spec.kind),
      execute: async (rawArgs) => {
        options.onAudit?.(agentAuditEntry(options.ctx.userID, spec))
        const args = {
          ...(rawArgs as Record<string, unknown>),
          ...callSiteMintedFields(shape as Record<string, unknown>, now()),
        }
        await options.dbProvider.transaction((tx) => fn({ tx, args, ctx: options.ctx }))
        return { ok: true, tool: spec.name }
      },
    })
  }

  return tools
}
