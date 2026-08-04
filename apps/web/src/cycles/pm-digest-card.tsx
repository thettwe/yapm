import { useQuery, useZero } from '@rocicorp/zero/react'
import { mutators, queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { MegaphoneIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import { runMutation } from '@/lib/mutation'
import {
  type PmDigestRowData,
  pmDigestContent,
  pmDigestFraming,
  pmReviewStatusNote,
  sharedReadersLabel,
} from '@/pm-digest/model'
import { PmDigestNarrative } from '@/pm-digest/narrative'

// THE PRODUCING TEAM'S OWN VIEW OF WHAT LEAVES THE TEAM, beside the team-internal digest and reading
// the same row through the team axis rather than the audience axis.
//
// The card is the review half of the review-and-publish gate, and it is also the answer to "what
// does the team learn about what was disclosed about their work": they read the exact text first,
// they release it themselves, and afterwards they are told how many people it went to. Never WHO —
// there is no reader list on this surface and there is not one anywhere in the product.
export function PmDigestShareCard({ cycleId }: { cycleId: string }) {
  const [row] = useQuery(queries.pmDigestReview.byCycle({ cycleId }))
  const digest = row as PmDigestRowData | undefined
  const content = useMemo(() => (digest ? pmDigestContent(digest) : null), [digest])

  // No row means the workspace or this team has product sharing off, and there is nothing to review.
  if (!digest) return null

  const published = digest.publishedAt != null

  return (
    <section
      aria-labelledby="pm-digest-share-heading"
      data-testid="pm-digest-share"
      data-published={published ? 'true' : 'false'}
      className="flex flex-col gap-3 border-b border-border p-4"
    >
      <div className="flex items-center gap-2">
        <MegaphoneIcon className="size-4 text-text-3" aria-hidden="true" />
        <h3
          id="pm-digest-share-heading"
          className="text-sm font-semibold tracking-tight text-text-1"
        >
          Shared with product
        </h3>
      </div>

      {content === null ? (
        <p className="text-[12px] text-text-3" data-testid="pm-digest-share-note">
          {pmReviewStatusNote(digest.status)}
        </p>
      ) : (
        <>
          <p className="text-[12px] text-text-3">
            {published
              ? 'This is the text people outside your team can read.'
              : 'This is what would be shared. Nobody outside your team can read it until you share it.'}
          </p>
          <PmDigestNarrative content={content} />
          <p className="text-[11px] text-text-3" data-testid="pm-digest-share-framing">
            {pmDigestFraming(digest)}
          </p>
          <PmShareControls digest={digest} published={published} />
        </>
      )}
    </section>
  )
}

function PmShareControls({ digest, published }: { digest: PmDigestRowData; published: boolean }) {
  const zero = useZero()
  const { canWrite } = useMembership()
  const [error, setError] = useState<string | undefined>(undefined)
  const [announcement, setAnnouncement] = useState('')

  // Only a completed run can be released. `pending`, `failed` and `ai_off` never reach here, and the
  // mutator rejects them anyway — the control is absent rather than present-and-failing.
  const releasable = digest.status === 'ready'

  async function share() {
    setError(undefined)
    // Minted at the call site: a `Date.now()` inside the mutator body would differ between the
    // optimistic pass and every rebase, and this timestamp is a permission fact.
    const now = Date.now()
    const failure = await runMutation(
      zero.mutate(mutators.pmDigest.publish({ id: digest.id, updatedAt: now })),
    )
    if (failure !== undefined) {
      setError(failure)
      return
    }
    setAnnouncement('Shared with product.')
  }

  async function retract() {
    setError(undefined)
    const now = Date.now()
    const failure = await runMutation(
      zero.mutate(mutators.pmDigest.unpublish({ id: digest.id, updatedAt: now })),
    )
    if (failure !== undefined) {
      setError(failure)
      return
    }
    setAnnouncement('Retracted. No further reads.')
  }

  return (
    <div className="flex flex-col gap-2">
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="pm-digest-share-announcement"
      >
        {announcement}
      </p>

      {error !== undefined ? (
        <p className="text-xs text-status-urgent" role="alert">
          {error}
        </p>
      ) : null}

      {published ? (
        <>
          <p className="text-[12px] text-text-2" data-testid="pm-digest-share-readers">
            {sharedReadersLabel(digest.audienceSizeAtPublish ?? null)} That is how many people were
            named when you shared it, not a running count.
          </p>
          {canWrite ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void retract()}
                data-testid="pm-digest-retract"
              >
                Retract
              </Button>
              <span className="text-[11px] text-text-3">
                Retracting stops further reads. It does not un-read what has already been read.
              </span>
            </div>
          ) : null}
        </>
      ) : canWrite && releasable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void share()} data-testid="pm-digest-publish">
            Share with product
          </Button>
          <span className="text-[11px] text-text-3">
            Sharing cannot be taken back once it has been read.
          </span>
        </div>
      ) : null}
    </div>
  )
}
