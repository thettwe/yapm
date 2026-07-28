import { useQuery } from '@rocicorp/zero/react'
import {
  type CycleDigestStatus,
  type DigestItemKind,
  queries,
  type StoredDigestContent,
} from '@yapm/schema'
import { Badge } from '@yapm/ui/components/badge'
import { cn } from '@yapm/ui/lib/utils'
import { ExternalLinkIcon, SparklesIcon } from 'lucide-react'
import { useMemo } from 'react'
import {
  areaCoverageNote,
  buildCycleFallback,
  buildEvidenceIndex,
  type CycleFallback,
  type DigestDeploymentRow,
  type DigestIssueRow,
  type EvidenceIndex,
  type EvidenceTarget,
  type FallbackIssue,
  hasNarrative,
  resolveEvidence,
} from '@/cycles/digest'

const ITEM_KIND_LABEL: Record<DigestItemKind, string> = {
  shipped: 'Shipped',
  carried: 'Carried',
  risk: 'Risk',
  highlight: 'Highlight',
}

// A completed cycle always shows this section; an in-progress cycle shows it only once a digest row
// exists. The section renders the AI narrative when one is ready, and the raw-evidence fallback
// otherwise — the narrative never gates the reader from the underlying evidence.
export function CycleDigestPanel({
  teamId,
  cycle,
  issues,
  onOpenIssue,
}: {
  teamId: string
  cycle: { readonly id: string; readonly status: string }
  issues: readonly DigestIssueRow[]
  onOpenIssue: (issueId: string) => void
}) {
  const [digest] = useQuery(queries.digests.byCycle({ cycleId: cycle.id }))
  const [deploymentsRaw] = useQuery(queries.deployments.byTeam({ teamId }))
  const deployments = deploymentsRaw as readonly DigestDeploymentRow[]

  const index = useMemo(() => buildEvidenceIndex(issues, deployments), [issues, deployments])
  const fallback = useMemo(() => buildCycleFallback(issues, deployments), [issues, deployments])

  const status = digest?.status as CycleDigestStatus | undefined
  const content = (digest?.content ?? null) as StoredDigestContent | null

  if (cycle.status !== 'completed' && digest === undefined) return null

  return (
    <section
      aria-labelledby="cycle-digest-heading"
      data-testid="cycle-digest"
      className="flex flex-col gap-3 border-b border-border p-4"
    >
      <div className="flex items-center gap-2">
        <SparklesIcon className="size-4 text-text-3" aria-hidden="true" />
        <h3 id="cycle-digest-heading" className="text-sm font-semibold tracking-tight text-text-1">
          Cycle digest
        </h3>
      </div>

      {digest && hasNarrative(status, content) ? (
        <DigestNarrative
          digest={digest}
          content={content}
          index={index}
          onOpenIssue={onOpenIssue}
        />
      ) : (
        <DigestFallback status={status} fallback={fallback} onOpenIssue={onOpenIssue} />
      )}
    </section>
  )
}

interface DigestRow {
  readonly provider?: string | null
  readonly model?: string | null
  readonly generatedAt?: number | null
  readonly estimatedCostUsd?: number | null
}

function DigestNarrative({
  digest,
  content,
  index,
  onOpenIssue,
}: {
  digest: DigestRow
  content: StoredDigestContent
  index: EvidenceIndex
  onOpenIssue: (issueId: string) => void
}) {
  // yapm's own arithmetic, rendered as yapm's own sentence — the same rule the counts follow. The
  // model is told the grouping is partial; the reader is TOLD it, deterministically.
  const coverage = areaCoverageNote(content.areaCoverage)

  return (
    <div className="flex flex-col gap-4" data-testid="digest-narrative">
      {content.headline.trim().length > 0 ? (
        <p className="text-sm text-text-1">{content.headline}</p>
      ) : null}

      {coverage !== null ? (
        <p className="text-[11px] text-text-3" data-testid="digest-area-coverage">
          {coverage}
        </p>
      ) : null}

      {content.sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
            {section.title}
          </span>
          <ul className="flex flex-col gap-2">
            {section.items.map((item, itemIndex) => (
              <li
                key={`${section.title}-${itemIndex}`}
                className="flex flex-col gap-1.5 rounded-control bg-bg-sidebar/60 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="mt-0.5 shrink-0">
                    {ITEM_KIND_LABEL[item.kind]}
                  </Badge>
                  <span className="min-w-0 flex-1 text-[13px] text-text-1">{item.summary}</span>
                  <ConfidenceBadge confidence={item.confidence} />
                </div>
                <div className="flex flex-wrap gap-1.5 pl-1">
                  {item.evidenceRefs.map((ref) => (
                    <EvidenceLink
                      key={`${ref.kind}-${ref.id}`}
                      target={resolveEvidence(ref, index)}
                      onOpenIssue={onOpenIssue}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <DigestFraming digest={digest} />
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  if (confidence === 'high') return null
  return (
    <span
      className={cn(
        'shrink-0 text-[11px]',
        confidence === 'low' ? 'text-status-urgent' : 'text-text-3',
      )}
    >
      {confidence === 'low' ? 'possible' : 'medium confidence'}
    </span>
  )
}

function EvidenceLink({
  target,
  onOpenIssue,
}: {
  target: EvidenceTarget
  onOpenIssue: (issueId: string) => void
}) {
  const chrome =
    'inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent'

  if (target.kind === 'issue') {
    return (
      <button
        type="button"
        onClick={() => onOpenIssue(target.issueId)}
        className={cn(chrome, 'bg-bg-hover text-accent-strong hover:underline')}
        data-testid="evidence-issue"
      >
        {target.label}
      </button>
    )
  }
  if (target.kind === 'external') {
    return (
      <a
        href={target.href}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(chrome, 'bg-bg-hover text-accent-strong hover:underline')}
        data-testid="evidence-external"
      >
        {target.label}
        <ExternalLinkIcon className="size-3" aria-hidden="true" />
      </a>
    )
  }
  return <span className={cn(chrome, 'bg-bg-hover text-text-3')}>{target.label}</span>
}

function DigestFraming({ digest }: { digest: DigestRow }) {
  const parts: string[] = ['AI-generated']
  if (digest.model) parts.push(digest.model)
  if (digest.generatedAt) {
    parts.push(
      new Date(digest.generatedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    )
  }
  if (typeof digest.estimatedCostUsd === 'number') {
    parts.push(`~$${digest.estimatedCostUsd.toFixed(2)} estimated`)
  }
  return (
    <p className="text-[11px] text-text-3" data-testid="digest-framing">
      {parts.join(' · ')}. Some items may be imprecise — open any linked entity to verify.
    </p>
  )
}

const FALLBACK_NOTE: Record<'ai_off' | 'failed' | 'absent', string> = {
  ai_off: 'AI is off for this workspace, so here is the raw linked delivery evidence.',
  failed: 'The digest could not be generated; here is the raw linked delivery evidence.',
  absent: 'No digest yet — here is the raw linked delivery evidence for this cycle.',
}

function DigestFallback({
  status,
  fallback,
  onOpenIssue,
}: {
  status: CycleDigestStatus | undefined
  fallback: CycleFallback
  onOpenIssue: (issueId: string) => void
}) {
  const noteKey = status === 'ai_off' ? 'ai_off' : status === 'failed' ? 'failed' : 'absent'
  const { scope } = fallback

  return (
    <div className="flex flex-col gap-3" data-testid="digest-fallback">
      <p className="text-[12px] text-text-3">{FALLBACK_NOTE[noteKey]}</p>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <ScopeStat label="Shipped" value={`${scope.shipped}/${scope.total}`} />
        <ScopeStat label="Carried" value={scope.carried} />
        <ScopeStat label="Canceled" value={scope.canceled} />
      </dl>

      <FallbackGroup
        label="Shipped"
        issues={fallback.shipped}
        onOpenIssue={onOpenIssue}
        emptyLabel="Nothing shipped this cycle."
      />
      <FallbackGroup
        label="Carried"
        issues={fallback.carried}
        onOpenIssue={onOpenIssue}
        emptyLabel="No carried work."
      />

      {fallback.deployments.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
            Deploys
          </span>
          <ul className="flex flex-col gap-1">
            {fallback.deployments.map((deploy) => (
              <li key={deploy.id} className="flex items-center gap-2 text-[12px] text-text-2">
                <span className="font-mono text-[11px] text-text-3">
                  {deploy.environment ?? 'deploy'}
                </span>
                <span>{deploy.state}</span>
                <span className="text-text-3">{deploy.repo}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function ScopeStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-text-3">{label}</dt>
      <dd className="font-mono text-text-1">{value}</dd>
    </div>
  )
}

function FallbackGroup({
  label,
  issues,
  onOpenIssue,
  emptyLabel,
}: {
  label: string
  issues: readonly FallbackIssue[]
  onOpenIssue: (issueId: string) => void
  emptyLabel: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</span>
      {issues.length === 0 ? (
        <p className="text-[12px] text-text-3">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {issues.map((issue) => (
            <li key={issue.id} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenIssue(issue.id)}
                className="inline-flex items-center gap-1.5 rounded-control px-1 text-left text-[13px] text-text-1 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
                data-testid="fallback-issue"
              >
                {issue.number != null ? (
                  <span className="font-mono text-[11px] text-text-3">#{issue.number}</span>
                ) : null}
                <span className="min-w-0">{issue.title}</span>
              </button>
              {issue.prs.map((pr) => (
                <PrChip key={pr.id} pr={pr} />
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PrChip({ pr }: { pr: FallbackIssue['prs'][number] }) {
  const health =
    pr.ciHealth === 'failing'
      ? 'text-status-urgent'
      : pr.ciHealth === 'passing'
        ? 'text-status-done'
        : 'text-text-3'
  const chrome =
    'inline-flex items-center gap-1 rounded-control bg-bg-hover px-1.5 py-0.5 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent'
  const body = (
    <>
      <span className="text-text-2">
        {pr.repo}#{pr.number}
      </span>
      <span className={health}>{pr.state}</span>
    </>
  )
  if (pr.url) {
    return (
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(chrome, 'hover:underline')}
      >
        {body}
        <ExternalLinkIcon className="size-3 text-text-3" aria-hidden="true" />
      </a>
    )
  }
  return <span className={chrome}>{body}</span>
}
