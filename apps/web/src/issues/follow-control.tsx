import { useQuery, useZero } from '@rocicorp/zero/react'
import { mutators, queries } from '@yapm/schema'
import { PropertyButton } from '@yapm/ui/components/detail-field'
import { BellIcon, BellOffIcon } from 'lucide-react'
import { useCallback, useState } from 'react'
import { runMutation } from '@/lib/mutation'

export const FOLLOWING_HINT = 'Updates on this issue reach your inbox. Select to stop.'
export const NOT_FOLLOWING_HINT = 'Follow to get updates on this issue in your inbox.'
export const PENDING_HINT = 'Checking whether you follow this issue…'
export const UNAVAILABLE_HINT = 'Couldn’t check whether you follow this issue.'

interface SubscriptionRow {
  state?: string | null
}

/**
 * The escape hatch for an auto-subscription, placed on the thing that created it. Being mentioned
 * subscribes you without asking, so the way out has to be discoverable from the issue itself and
 * reachable by keyboard alone — an auto-subscribe with no exit is a mail trap.
 *
 * It shows the viewer's OWN subscription and nothing else. There is deliberately no follower count
 * and no list of who follows, for anybody, admins included: `subscriptions.mine` is the only query
 * over the table and it is self-scoped, so this component could not render one if it tried.
 */
export function FollowControl({ issueId }: { issueId: string }) {
  const zero = useZero()
  const [subscription, result] = useQuery(queries.subscriptions.mine({ issueId }))
  const [error, setError] = useState<string | undefined>(undefined)

  // AN UNHYDRATED QUERY IS NOT AN ANSWER. Until the row has actually arrived, "no row" and "no
  // subscription" are indistinguishable, and defaulting to "not following" tells a subscriber
  // opening the issue on a fresh client that they are not following it — and offers them a button
  // that would then unfollow rather than follow. So the control asserts nothing: no `aria-pressed`
  // for a screen reader to read out, and no press to mis-fire.
  //
  // `aria-disabled`, NOT `disabled`. A native `disabled` button leaves the tab order and its
  // `aria-describedby` goes unannounced, so the hint saying what the control is waiting for reaches
  // nobody and a keyboard user's tab stop appears from under them when zero-cache answers. The
  // `if (!settled) return` guard below — not the attribute — is what prevents a mis-fire.
  const settled = result.type === 'complete'
  // A FAILED QUERY IS NOT A SLOW ONE. Left as "unsettled" it renders a permanent "checking…" and an
  // inert control with no way out, so the error states itself and offers Zero's own retry.
  const failed = result.type === 'error'
  const following = (subscription as SubscriptionRow | undefined)?.state === 'subscribed'

  const toggle = useCallback(async () => {
    if (!settled) return
    const args = { issueId, updatedAt: Date.now() }
    const write = following
      ? zero.mutate(mutators.issueSubscription.unfollow(args))
      : zero.mutate(mutators.issueSubscription.follow(args))
    setError(await runMutation(write))
  }, [following, issueId, settled, zero])

  const hint = !settled ? PENDING_HINT : following ? FOLLOWING_HINT : NOT_FOLLOWING_HINT
  // One region, mounted for the component's whole life and empty until there is something to say —
  // a live region inserted with its text already present has no CHANGE to announce (design I36),
  // which is exactly how an error that appears once goes unheard.
  const alert = error ?? (failed ? UNAVAILABLE_HINT : '')

  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-1">
        <PropertyButton
          {...(settled ? { 'aria-pressed': following } : { 'aria-disabled': true })}
          aria-describedby={failed ? `follow-alert-${issueId}` : `follow-hint-${issueId}`}
          onClick={() => void toggle()}
        >
          {following ? (
            <BellIcon className="size-3.5 text-accent-strong" />
          ) : (
            <BellOffIcon className="size-3.5 text-text-3" />
          )}
          {!settled ? 'Updates' : following ? 'Following' : 'Follow'}
        </PropertyButton>
        {result.type === 'error' ? (
          <button
            type="button"
            className="rounded-control px-1 py-0.5 font-ui text-[11px] text-accent-strong underline underline-offset-2 hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            onClick={result.retry}
          >
            Retry
          </button>
        ) : null}
      </span>
      {failed ? null : (
        <span id={`follow-hint-${issueId}`} className="text-[11px] text-text-2">
          {hint}
        </span>
      )}
      <span id={`follow-alert-${issueId}`} className="text-[11px] text-status-urgent" role="alert">
        {alert}
      </span>
    </span>
  )
}
