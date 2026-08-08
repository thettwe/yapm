import { useRef } from 'react'
import { RetryButton } from '@/components/retry-button'
import type { ConnectionSummary } from '@/zero/connection'
import { useSyncRecovery } from '@/zero/recovery'

// The sync state, right-aligned in band 3 — its ONLY home. `ia.html` draws sync once, at the right
// end of the statusline; two indicators would be the same class of bug as two attention numbers.
//
// This is a relocation of the old header pill, not a weakening of it: the same summary, the same
// dot, the same polite live region, the same `sr-only` failure reason, the same retry with its
// focus handoff, and the same `data-testid` / `data-connection` / `data-recovery` hooks fifteen
// e2e specs read as "the app is live". Band 3 is on every page, where the pill was on ten.
const DOT_CLASS: Record<ConnectionSummary['state'], string> = {
  connected: 'bg-status-done',
  connecting: 'bg-status-in-progress',
  disconnected: 'bg-muted-foreground',
  'needs-auth': 'bg-status-in-progress',
  error: 'bg-status-urgent',
  closed: 'bg-muted-foreground',
}

export function SyncIndicator({ connection }: { connection: ConnectionSummary }) {
  const { retryNow } = useSyncRecovery()
  const statusRef = useRef<HTMLParagraphElement>(null)

  return (
    <div
      className="flex items-center gap-2 text-text-3"
      data-testid="connection-status"
      data-connection={connection.state}
      data-recovery={connection.recovery}
    >
      <p
        ref={statusRef}
        tabIndex={-1}
        className="flex items-center gap-1.5 outline-none"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${DOT_CLASS[connection.state]}`}
        />
        <span>{connection.label}</span>
        {connection.detail ? <span className="sr-only">{connection.detail}</span> : null}
      </p>
      {/* The last control on the page, so losing focus here costs the whole document on the next
          Tab. */}
      {connection.retryOffered ? (
        <RetryButton
          onRetry={retryNow}
          fallbackRef={statusRef}
          testId="connection-retry"
          className="text-text-1 focus-visible:ring-accent rounded-sm"
        >
          Retry now
        </RetryButton>
      ) : null}
    </div>
  )
}
