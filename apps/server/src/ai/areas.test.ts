import {
  type AreaRule,
  type AuthContext,
  buildCycleFacts,
  type CycleFacts,
  type DigestContent,
} from '@yapm/schema'
import type { DB } from '@yapm/schema/db'
import type { Kysely } from 'kysely'
import { pino } from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ChangedFilesReader,
  listChangedFiles,
  MAX_PR_FILE_CALLS,
} from '../connectors/github/files.js'
import type { GithubRestClient } from '../connectors/github/reconcile.js'
import type { Logger } from '../logger.js'
import type { ZeroDatabase } from '../zero/db-provider.js'

// The enrichment step's control flow, isolated from Postgres: what needs a deterministic harness is
// the call cap, the rate-limit floor, and the failure path, none of which can be provoked by writing
// rows. The SQL behind `pullRequestSourcesForCycleFacts` is proved in
// `packages/schema/src/db/cycle-facts.pg.test.ts`, and the config round-trip in `ai-config.pg.test.ts`.
const reads = vi.hoisted(() => ({
  aiConfig: vi.fn(),
  prSources: vi.fn(),
  spend: vi.fn(),
}))

vi.mock('@yapm/schema/db', () => ({
  getAiConfig: reads.aiConfig,
  pullRequestSourcesForCycleFacts: reads.prSources,
  getWorkspaceAiSpendUsd: reads.spend,
  getAiProviderKey: vi.fn(),
}))

import { enrichCycleFactsWithAreas } from './areas.js'
import { buildDigestInput, runCycleDigest } from './digest.js'
import type { AiGateway, GenerateStructuredOptions } from './gateway.js'

// The patch body GitHub returns for a one-line change to the refund window — the research's own
// headline example, and exactly the text that must never reach a model.
const PATCH_TEXT =
  '@@ -1,4 +1,4 @@\n-const REFUND_WINDOW_DAYS = 30\n+const REFUND_WINDOW_DAYS = 14\n'

const BILLING_PATH = 'apps/server/src/billing/refund.ts'

// Every string that must not appear in the model's context, in the enriched facts, or in a stored
// row. `.ts` is in the list on purpose: a bare extension is a disclosure shape of its own.
const FORBIDDEN = [
  PATCH_TEXT,
  'REFUND_WINDOW_DAYS',
  '@@ -1,4 +1,4 @@',
  BILLING_PATH,
  'refund.ts',
  'apps/server/src/billing',
  'apps/server',
  '.ts',
]

const RULES: AreaRule[] = [
  { prefix: 'apps/server/src/billing/', area: 'Billing', sensitive: true },
  { prefix: 'apps/web/', area: 'Web' },
]

interface RestFileEntry {
  filename: string
  status: string
  changes: number
  additions: number
  deletions: number
  sha: string
  patch: string
  blob_url: string
  raw_url: string
  contents_url: string
}

function fileEntry(filename: string, changes = 8): RestFileEntry {
  return {
    filename,
    status: 'modified',
    changes,
    additions: changes - 3,
    deletions: 3,
    sha: 'abc123def456',
    // Returned WHETHER OR NOT IT IS ASKED FOR. A mock that omitted it would prove nothing.
    patch: PATCH_TEXT,
    blob_url: `https://github.com/acme/shop/blob/abc123/${filename}`,
    raw_url: `https://github.com/acme/shop/raw/abc123/${filename}`,
    contents_url: `https://api.github.com/repos/acme/shop/contents/${filename}`,
  }
}

// The reader the digest job actually gets, composed from the REAL seam (`listChangedFiles`) over a
// mocked octokit-shaped client. Nothing about the projection is stubbed here.
function readerOver(
  files: RestFileEntry[],
  remaining: (call: number) => string | undefined = () => '5000',
): { reader: ChangedFilesReader; calls: number[] } {
  const calls: number[] = []
  const client = {
    rest: {
      pulls: {
        listFiles: (params: { pull_number: number }) => {
          calls.push(params.pull_number)
          const header = remaining(calls.length)
          return Promise.resolve({
            status: 200,
            headers: header === undefined ? {} : { 'x-ratelimit-remaining': header },
            data: files,
          })
        },
      },
    },
  } as unknown as GithubRestClient
  return {
    reader: (request) => listChangedFiles(client, 'acme', 'shop', request.number),
    calls,
  }
}

// The only direct database use left in the pipeline once the reads above are stubbed is
// `loadRoster`; an empty roster is correct here (the name validator has its own unit suite).
function fakeDb(): Kysely<DB> {
  const chain: Record<string, unknown> = {}
  for (const method of ['selectFrom', 'innerJoin', 'select', 'where']) {
    chain[method] = () => chain
  }
  chain.execute = () => Promise.resolve([])
  return chain as unknown as Kysely<DB>
}

function fakeDbProvider(): { dbProvider: ZeroDatabase; writes: unknown[] } {
  const writes: unknown[] = []
  const record = (row: unknown) => {
    writes.push(row)
    return Promise.resolve()
  }
  const tx = {
    run: () => Promise.resolve(undefined),
    mutate: { cycle_digest: { insert: record, update: record } },
  }
  const dbProvider = {
    transaction: (fn: (tx: unknown) => Promise<void>) => fn(tx),
  } as unknown as ZeroDatabase
  return { dbProvider, writes }
}

// A real pino logger (the deps type is pino's `Logger`) writing into an array, so what the
// enrichment step logs is asserted rather than assumed.
function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = []
  const logger = pino({ level: 'warn' }, { write: (line: string) => void lines.push(line) })
  return { logger, lines }
}

interface CapturedCall {
  system: string
  input: string
}

function capturingGateway(
  object: DigestContent,
  onCall?: () => void,
): { gateway: AiGateway; captured: CapturedCall[] } {
  const captured: CapturedCall[] = []
  const gateway: AiGateway = {
    resolveModel: () => Promise.resolve(null),
    runAgent: () => Promise.resolve(null),
    generateStructured: <T>(
      _workspaceId: string,
      _ctx: AuthContext,
      options: GenerateStructuredOptions<T>,
    ) => {
      captured.push({ system: options.system, input: String(options.input) })
      onCall?.()
      return Promise.resolve({
        object: options.schema.parse(object),
        provider: 'anthropic' as const,
        modelId: 'mock-model',
        usage: {
          inputTokens: 100,
          inputTokenDetails: {
            noCacheTokens: 100,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
          outputTokens: 50,
          outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
          totalTokens: 150,
        },
        estimatedCostUsd: 0.001,
      })
    },
  }
  return { gateway, captured }
}

function factsFor(prIds: readonly string[]): CycleFacts {
  return buildCycleFacts({
    cycle: { id: 'cycle-1', teamId: 'team-1', name: 'Cycle 8' },
    teamKey: 'ENG',
    issues: prIds.map((prId, index) => ({
      id: `issue-${index}`,
      number: index + 1,
      title: 'Shorten the refund window',
      status: 'done',
      pullRequests: [
        { id: prId, number: 480 + index, title: 'Cut the refund window', state: 'merged' },
      ],
    })),
  })
}

function sourcesFor(prIds: readonly string[]) {
  return prIds.map((id, index) => ({
    id,
    repo: 'acme/shop',
    number: 480 + index,
    installationId: 'inst-1',
    externalInstallationId: '42',
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  reads.spend.mockResolvedValue(0)
  reads.aiConfig.mockResolvedValue({ enabled: true, data: { models: {}, areas: RULES } })
})

describe('the falsifiable check — a patch field enters the seam and reaches nothing', () => {
  it('turns a billing path into an area label and keeps every leak shape out of the whole pipeline', async () => {
    reads.prSources.mockResolvedValue(sourcesFor(['pr-1']))
    const { reader, calls } = readerOver([fileEntry(BILLING_PATH)])
    const facts = factsFor(['pr-1'])

    const enriched = await enrichCycleFactsWithAreas(
      { db: fakeDb(), changedFilesReader: reader },
      { workspaceId: 'ws-1', facts },
    )
    expect(calls).toEqual([480])

    // 1. The path became an area label, and the label is the sensitive one the operator marked.
    expect(enriched.areas).toEqual([
      { area: 'Billing', issueCount: 1, prCount: 1, sensitive: true },
    ])
    expect(enriched.touchedSensitiveAreas).toEqual(['Billing'])
    expect(enriched.issues[0]?.areas).toEqual(['Billing'])
    expect(enriched.issues[0]?.sizeBand).toBe('xs')

    // 2. Nothing the seam dropped, and no raw path, survives into the facts.
    const factsJson = JSON.stringify(enriched)
    for (const forbidden of FORBIDDEN) expect(factsJson, forbidden).not.toContain(forbidden)

    // 3. The model's context: `Billing` is in it; the path, the extension and the patch are not.
    const { gateway, captured } = capturingGateway({
      headline: 'Billing tightened its refund window.',
      sections: [
        {
          title: 'What shipped',
          items: [
            {
              kind: 'shipped',
              summary: 'Billing shortened the refund window.',
              evidenceRefs: [{ kind: 'issue', id: 'issue-0' }],
              confidence: 'high',
            },
            {
              // An echoed/hallucinated disclosure the runtime validator must drop.
              kind: 'risk',
              summary: 'Also hardened `src/auth/session.ts`.',
              evidenceRefs: [{ kind: 'issue', id: 'issue-0' }],
              confidence: 'low',
            },
          ],
        },
      ],
    })
    const { dbProvider, writes } = fakeDbProvider()
    const result = await runCycleDigest(
      { gateway, db: fakeDb(), dbProvider },
      { workspaceId: 'ws-1', facts: enriched },
    )

    expect(result.status).toBe('ready')
    expect(captured).toHaveLength(1)
    const context = `${captured[0]?.system}\n${captured[0]?.input}`
    expect(context).toContain('Billing')
    expect(context).toContain('Sensitive areas this cycle touched: Billing')
    for (const forbidden of FORBIDDEN) expect(context, forbidden).not.toContain(forbidden)

    // 4. The stored digest carries no item mentioning the echoed path, and no row anywhere records
    //    a filename, an extension, or patch text.
    const stored = writes[0] as { content: DigestContent | null }
    expect(stored.content?.sections[0]?.items).toHaveLength(1)
    expect(stored.content?.sections[0]?.items[0]?.summary).toBe(
      'Billing shortened the refund window.',
    )
    const writesJson = JSON.stringify(writes)
    for (const forbidden of [...FORBIDDEN, 'src/auth/session.ts', 'session.ts', '`']) {
      expect(writesJson, forbidden).not.toContain(forbidden)
    }
  })

  it('states the area layer OUTSIDE the untrusted fence', () => {
    const facts = factsFor(['pr-1'])
    const enriched = {
      ...facts,
      areas: [{ area: 'Billing', issueCount: 1, prCount: 1, sensitive: true }],
      touchedSensitiveAreas: ['Billing'],
      internalImprovements: 2,
    }
    const input = buildDigestInput(enriched)
    const fenceAt = input.indexOf('<<<UNTRUSTED WORK-GRAPH DATA')
    expect(fenceAt).toBeGreaterThan(0)
    expect(input.indexOf('Product areas computed by yapm')).toBeLessThan(fenceAt)
    expect(input.indexOf('Sensitive areas this cycle touched')).toBeLessThan(fenceAt)
    expect(input.indexOf('Internal improvements computed by yapm: 2')).toBeLessThan(fenceAt)
    expect(input).toContain('2 internal improvements')
  })

  it('omits the area paragraph entirely for un-enriched facts', () => {
    const input = buildDigestInput(factsFor(['pr-1']))
    expect(input).not.toContain('Product areas computed by yapm')
    expect(input).not.toContain('sizeBand')
  })
})

describe('enrichCycleFactsWithAreas — what it refuses to spend', () => {
  it('makes ZERO provider calls when the area map is empty', async () => {
    reads.aiConfig.mockResolvedValue({ enabled: true, data: { models: {}, areas: [] } })
    reads.prSources.mockResolvedValue(sourcesFor(['pr-1']))
    const { reader, calls } = readerOver([fileEntry(BILLING_PATH)])
    const facts = factsFor(['pr-1'])

    const result = await enrichCycleFactsWithAreas(
      { db: fakeDb(), changedFilesReader: reader },
      { workspaceId: 'ws-1', facts },
    )
    expect(calls).toEqual([])
    expect(reads.prSources).not.toHaveBeenCalled()
    expect(result).toBe(facts)
  })

  it('makes ZERO provider calls when AI was never configured for the workspace', async () => {
    reads.aiConfig.mockResolvedValue(null)
    const { reader, calls } = readerOver([fileEntry(BILLING_PATH)])
    const facts = factsFor(['pr-1'])
    expect(
      await enrichCycleFactsWithAreas(
        { db: fakeDb(), changedFilesReader: reader },
        { workspaceId: 'ws-1', facts },
      ),
    ).toBe(facts)
    expect(calls).toEqual([])
  })

  // A workspace with AI switched off gets an `ai_off` digest whatever this step gathers, so every
  // call it would have made is someone else's rate budget spent on nothing.
  it('makes ZERO provider calls when AI is configured but switched OFF', async () => {
    reads.aiConfig.mockResolvedValue({ enabled: false, data: { models: {}, areas: RULES } })
    reads.prSources.mockResolvedValue(sourcesFor(['pr-1']))
    const { reader, calls } = readerOver([fileEntry(BILLING_PATH)])
    const facts = factsFor(['pr-1'])

    expect(
      await enrichCycleFactsWithAreas(
        { db: fakeDb(), changedFilesReader: reader },
        { workspaceId: 'ws-1', facts },
      ),
    ).toBe(facts)
    expect(calls).toEqual([])
    expect(reads.prSources).not.toHaveBeenCalled()
  })

  it('makes ZERO provider calls once the workspace is over its spend cap', async () => {
    reads.aiConfig.mockResolvedValue({
      enabled: true,
      data: { models: {}, areas: RULES, spendCapUsd: 5 },
    })
    reads.spend.mockResolvedValue(5)
    reads.prSources.mockResolvedValue(sourcesFor(['pr-1']))
    const { reader, calls } = readerOver([fileEntry(BILLING_PATH)])
    const facts = factsFor(['pr-1'])

    expect(
      await enrichCycleFactsWithAreas(
        { db: fakeDb(), changedFilesReader: reader },
        { workspaceId: 'ws-1', facts },
      ),
    ).toBe(facts)
    expect(calls).toEqual([])
    expect(reads.prSources).not.toHaveBeenCalled()
  })

  it('still enriches while the workspace is under its spend cap', async () => {
    reads.aiConfig.mockResolvedValue({
      enabled: true,
      data: { models: {}, areas: RULES, spendCapUsd: 5 },
    })
    reads.spend.mockResolvedValue(4.99)
    reads.prSources.mockResolvedValue(sourcesFor(['pr-1']))
    const { reader, calls } = readerOver([fileEntry(BILLING_PATH)])

    const result = await enrichCycleFactsWithAreas(
      { db: fakeDb(), changedFilesReader: reader },
      { workspaceId: 'ws-1', facts: factsFor(['pr-1']) },
    )
    expect(calls).toEqual([480])
    expect(result.areas).toEqual([{ area: 'Billing', issueCount: 1, prCount: 1, sensitive: true }])
  })

  it('makes ZERO provider calls when the GitHub connector is disabled', async () => {
    const facts = factsFor(['pr-1'])
    expect(
      await enrichCycleFactsWithAreas(
        { db: fakeDb(), changedFilesReader: null },
        { workspaceId: 'ws-1', facts },
      ),
    ).toBe(facts)
    expect(reads.aiConfig).not.toHaveBeenCalled()
  })

  it('truncates at the per-cycle call cap, deterministically by ascending PR id', async () => {
    const prIds = Array.from({ length: 60 }, (_, index) => `pr-${String(index).padStart(3, '0')}`)
    reads.prSources.mockResolvedValue(sourcesFor(prIds))
    const { reader, calls } = readerOver([fileEntry(BILLING_PATH)])

    const result = await enrichCycleFactsWithAreas(
      { db: fakeDb(), changedFilesReader: reader },
      { workspaceId: 'ws-1', facts: factsFor(prIds) },
    )

    expect(calls).toHaveLength(MAX_PR_FILE_CALLS)
    expect(result.areaCoverage).toEqual({ enriched: 50, skipped: 10 })
    // The FIRST 50 by ascending id are the ones mapped, so a re-run maps the same set.
    const mapped = result.issues.filter((issue) => issue.areas !== undefined)
    expect(mapped).toHaveLength(50)
    expect(mapped.map((issue) => issue.issueId)).toEqual(
      Array.from({ length: 50 }, (_, index) => `issue-${index}`),
    )
    // Truncated, but still an area layer the digest can narrate.
    expect(result.areas).toEqual([
      { area: 'Billing', issueCount: 50, prCount: 50, sensitive: true },
    ])
  })

  it('stops mid-run once the installation quota falls below the floor', async () => {
    const prIds = ['pr-1', 'pr-2', 'pr-3', 'pr-4', 'pr-5']
    reads.prSources.mockResolvedValue(sourcesFor(prIds))
    const { logger, lines } = capturingLogger()
    // The second response reports 499 remaining — under RATE_LIMIT_FLOOR.
    const { reader, calls } = readerOver([fileEntry(BILLING_PATH)], (call) =>
      call >= 2 ? '499' : '5000',
    )

    const result = await enrichCycleFactsWithAreas(
      { db: fakeDb(), changedFilesReader: reader, logger },
      { workspaceId: 'ws-1', facts: factsFor(prIds) },
    )

    expect(calls).toHaveLength(2)
    expect(result.areaCoverage).toEqual({ enriched: 2, skipped: 3 })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('area enrichment stopped')
    expect(result.issues.filter((issue) => issue.areas !== undefined)).toHaveLength(2)
  })

  // yapm reads one page of files. A pull request that filled it is mapped from a PREFIX of what it
  // touched, so it is banded by what truncation already proves and counted as partially mapped —
  // never presented as a complete grouping.
  it('bands a truncated pull request xl and records it as partially mapped', async () => {
    reads.prSources.mockResolvedValue(sourcesFor(['pr-1']))
    const page = Array.from({ length: 100 }, (_, index) =>
      fileEntry(`apps/server/src/billing/file-${index}.ts`, 1),
    )
    const { reader } = readerOver(page)

    const result = await enrichCycleFactsWithAreas(
      { db: fakeDb(), changedFilesReader: reader },
      { workspaceId: 'ws-1', facts: factsFor(['pr-1']) },
    )

    // 100 files × 1 change = 100 lines, which alone would band `m`.
    expect(result.issues[0]?.sizeBand).toBe('xl')
    expect(result.areaCoverage).toEqual({ enriched: 1, skipped: 0, partial: 1 })
    expect(buildDigestInput(result)).toContain('touched more files than yapm reads in one page')
  })

  it('records no partial count when every file list fit in one page', async () => {
    reads.prSources.mockResolvedValue(sourcesFor(['pr-1']))
    const { reader } = readerOver([fileEntry(BILLING_PATH)])

    const result = await enrichCycleFactsWithAreas(
      { db: fakeDb(), changedFilesReader: reader },
      { workspaceId: 'ws-1', facts: factsFor(['pr-1']) },
    )
    expect(result.areaCoverage).toEqual({ enriched: 1, skipped: 0 })
    expect(buildDigestInput(result)).not.toContain('touched more files than yapm reads')
  })

  it('never runs when the cycle has no linked pull request', async () => {
    const facts = buildCycleFacts({
      cycle: { id: 'cycle-1', teamId: 'team-1', name: 'Cycle 8' },
      issues: [{ id: 'issue-0', number: 1, title: 'No PR', status: 'done', pullRequests: [] }],
    })
    const { reader, calls } = readerOver([fileEntry(BILLING_PATH)])
    expect(
      await enrichCycleFactsWithAreas(
        { db: fakeDb(), changedFilesReader: reader },
        { workspaceId: 'ws-1', facts },
      ),
    ).toBe(facts)
    expect(calls).toEqual([])
  })
})

// The coverage arithmetic is yapm's, so the reader is TOLD the grouping is partial rather than the
// model being asked to remember to mention it. It rides in the stored blob, not a new column.
describe('the stored digest carries yapm-computed area coverage', () => {
  it('writes the coverage yapm counted, and never a coverage the model wrote', async () => {
    const prIds = Array.from({ length: 60 }, (_, index) => `pr-${String(index).padStart(3, '0')}`)
    reads.prSources.mockResolvedValue(sourcesFor(prIds))
    const { reader } = readerOver([fileEntry(BILLING_PATH)])
    const enriched = await enrichCycleFactsWithAreas(
      { db: fakeDb(), changedFilesReader: reader },
      { workspaceId: 'ws-1', facts: factsFor(prIds) },
    )

    const { gateway, captured } = capturingGateway({
      headline: 'Billing moved.',
      sections: [
        {
          title: 'What shipped',
          items: [
            {
              kind: 'shipped',
              summary: 'Billing shortened the refund window.',
              evidenceRefs: [{ kind: 'issue', id: 'issue-0' }],
              confidence: 'high',
            },
          ],
        },
      ],
    })
    const { dbProvider, writes } = fakeDbProvider()
    await runCycleDigest(
      { gateway, db: fakeDb(), dbProvider },
      { workspaceId: 'ws-1', facts: enriched },
    )

    const stored = writes[0] as { content: { areaCoverage?: unknown } | null }
    expect(stored.content?.areaCoverage).toEqual({ enriched: 50, skipped: 10 })
    // The model-facing schema has no coverage field at all, so it cannot supply one.
    expect(Object.keys(captured[0] ?? {})).not.toContain('areaCoverage')
  })

  it('stores no coverage key at all for an un-enriched cycle', async () => {
    const { gateway } = capturingGateway({
      headline: 'The team shipped one issue.',
      sections: [
        {
          title: 'What shipped',
          items: [
            {
              kind: 'shipped',
              summary: 'The refund window shortened.',
              evidenceRefs: [{ kind: 'issue', id: 'issue-0' }],
              confidence: 'high',
            },
          ],
        },
      ],
    })
    const { dbProvider, writes } = fakeDbProvider()
    await runCycleDigest(
      { gateway, db: fakeDb(), dbProvider },
      { workspaceId: 'ws-1', facts: factsFor(['pr-1']) },
    )
    expect(writes[0]).not.toHaveProperty('content.areaCoverage')
  })
})

describe('enrichCycleFactsWithAreas — a failing changed-files provider degrades, never fails', () => {
  it('returns the un-enriched facts when the provider throws', async () => {
    reads.prSources.mockResolvedValue(sourcesFor(['pr-1']))
    const { logger, lines } = capturingLogger()
    const facts = factsFor(['pr-1'])
    const throwing: ChangedFilesReader = () => Promise.reject(new Error('502 Bad Gateway'))

    const result = await enrichCycleFactsWithAreas(
      { db: fakeDb(), changedFilesReader: throwing, logger },
      { workspaceId: 'ws-1', facts },
    )
    expect(result).toBe(facts)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('area enrichment failed')
  })

  it('still produces a READY digest, never a failed one, when the provider throws', async () => {
    reads.prSources.mockResolvedValue(sourcesFor(['pr-1']))
    const facts = factsFor(['pr-1'])
    const throwing: ChangedFilesReader = () => Promise.reject(new Error('502 Bad Gateway'))
    const enriched = await enrichCycleFactsWithAreas(
      { db: fakeDb(), changedFilesReader: throwing },
      { workspaceId: 'ws-1', facts },
    )

    const { gateway, captured } = capturingGateway({
      headline: 'The team shipped one issue.',
      sections: [
        {
          title: 'What shipped',
          items: [
            {
              kind: 'shipped',
              summary: 'The refund window shortened.',
              evidenceRefs: [{ kind: 'issue', id: 'issue-0' }],
              confidence: 'high',
            },
          ],
        },
      ],
    })
    const { dbProvider, writes } = fakeDbProvider()
    const result = await runCycleDigest(
      { gateway, db: fakeDb(), dbProvider },
      { workspaceId: 'ws-1', facts: enriched },
    )

    expect(result.status).toBe('ready')
    expect((writes[0] as { status: string }).status).toBe('ready')
    expect(captured[0]?.input).not.toContain('Product areas computed by yapm')
  })
})
