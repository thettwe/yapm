import { useQuery } from '@rocicorp/zero/react'
import { queries } from '@yapm/schema'
import { MegaphoneIcon } from 'lucide-react'
import { useMemo } from 'react'
import { type PmDigestRowData, pmDigestContent, pmDigestFraming } from '@/pm-digest/model'
import { PmDigestNarrative } from '@/pm-digest/narrative'

// THE READER'S SURFACE, and the only one in the product served by the audience axis rather than by
// team membership. It is mounted only when the caller's audience is non-empty — the route decides
// that BEFORE this component exists, so no query is issued by anyone the policy does not name.
//
// Nothing here links anywhere and nothing here loads a remote asset: every target belongs to a team
// this reader is not on.
export function PmDigestView() {
  const [rows] = useQuery(queries.pmDigests.inbox())
  const digests = rows as readonly PmDigestRowData[]

  return (
    <section aria-labelledby="pm-digests-heading" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1
          id="pm-digests-heading"
          className="font-heading text-2xl font-semibold tracking-tight text-text-1"
        >
          Product digests
        </h1>
        <p className="text-sm text-text-3">
          Cycle summaries teams have chosen to share with you. Each one was written by a model from
          yapm's own record of the cycle and released by the team that did the work.
        </p>
      </header>

      {digests.length === 0 ? (
        <p className="text-sm text-text-3" role="status" data-testid="pm-digests-empty">
          Nothing has been shared with you yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {digests.map((digest) => (
            <PmDigestEntry key={digest.id} digest={digest} />
          ))}
        </ul>
      )}
    </section>
  )
}

function PmDigestEntry({ digest }: { digest: PmDigestRowData }) {
  const content = useMemo(() => pmDigestContent(digest), [digest])
  // A published row whose blob cannot be walked has nothing to say, and saying so with an empty
  // card would still be saying something. It renders as absent.
  if (content === null) return null

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
