import { useQuery } from '@rocicorp/zero/react'
import { queries, type StoredPmDigestContent } from '@yapm/schema'
import { MegaphoneIcon } from 'lucide-react'
import { useMemo } from 'react'
import { AppFrame } from '@/frame/app-frame'
import { type PmDigestRowData, pmDigestFraming, readablePmDigests } from '@/pm-digest/model'
import { PmDigestNarrative } from '@/pm-digest/narrative'

// THE READER'S SURFACE, and the only one in the product served by the audience axis rather than by
// team membership. It is mounted only when the caller's audience is non-empty — the gate decides
// that BEFORE this component exists, so no query is issued by anyone the policy does not name.
//
// AND WHEN THERE IS NOTHING TO READ, THERE IS NO SURFACE EITHER — no shell, no heading, no empty
// state. "Nothing has been shared with you yet" tells a reader that the channel exists and that the
// team on the other side of it has chosen not to use it, which is a fact about another team's
// decision that nobody asked to publish. Absence is the graceful degradation this whole capability
// rests on, and it does not stop applying once somebody has been named.
//
// Nothing here links anywhere and nothing here loads a remote asset: every target belongs to a team
// this reader is not on.
export function PmDigestView() {
  const [rows] = useQuery(queries.pmDigests.inbox())
  const digests = useMemo(() => readablePmDigests(rows as readonly PmDigestRowData[]), [rows])

  if (digests.length === 0) return null

  return (
    <AppFrame>
      <section aria-labelledby="pm-digests-heading" className="flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h1
            id="pm-digests-heading"
            className="font-heading text-2xl font-semibold tracking-tight text-text-1"
          >
            Product digests
          </h1>
          <p className="text-sm text-text-3">
            Cycle summaries teams have chosen to share with you. Each one was written by a model
            from yapm's own record of the cycle and released by the team that did the work.
          </p>
        </header>

        <ul className="flex flex-col gap-4">
          {digests.map(({ row, content }) => (
            <PmDigestEntry key={row.id} digest={row} content={content} />
          ))}
        </ul>
      </section>
    </AppFrame>
  )
}

function PmDigestEntry({
  digest,
  content,
}: {
  digest: PmDigestRowData
  content: StoredPmDigestContent
}) {
  return (
    <li
      className="flex flex-col gap-3 rounded-card border border-border p-4"
      data-testid="pm-digest-card"
    >
      <div className="flex items-center gap-2">
        <MegaphoneIcon className="size-4 text-text-3" aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
          Shared with you
        </span>
      </div>
      <PmDigestNarrative content={content} headingLevel="h2" />
      <p className="text-[11px] text-text-3" data-testid="pm-digest-framing">
        {pmDigestFraming(digest)}
      </p>
    </li>
  )
}
