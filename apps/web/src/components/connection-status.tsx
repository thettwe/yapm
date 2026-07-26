import { useRef } from 'react'
import { RetryButton } from '@/components/retry-button'
import type { ConnectionSummary } from '@/zero/connection'
import { useSyncRecovery } from '@/zero/recovery'

const DOT_CLASS: Record<ConnectionSummary['state'], string> = {
  connected: 'bg-status-done',
  connecting: 'bg-status-in-progress',
  disconnected: 'bg-muted-foreground',
  'needs-auth': 'bg-status-in-progress',
  error: 'bg-status-urgent',
  closed: 'bg-muted-foreground',
}

export function ConnectionStatus({ connection }: { connection: ConnectionSummary }) {
  const { retryNow } = useSyncRecovery()
  const statusRef = useRef<HTMLParagraphElement>(null)

  return (
    <div
      className="text-muted-foreground flex items-center gap-2 text-sm"
      data-testid="connection-status"
      data-connection={connection.state}
      data-recovery={connection.recovery}
    >
      <p
        ref={statusRef}
        tabIndex={-1}
        className="flex items-center gap-2 outline-none"
        role="status"
        aria-live="polite"
      >
        <span aria-hidden="true" className={`size-2 rounded-full ${DOT_CLASS[connection.state]}`} />
        <span>{connection.label}</span>
        {connection.detail ? <span className="sr-only">{connection.detail}</span> : null}
      </p>
      {/* The pill sits in the header, so losing focus here costs the whole page on the next Tab. */}
      {connection.retryOffered ? (
        <RetryButton
          onRetry={retryNow}
          fallbackRef={statusRef}
          testId="connection-retry"
          className="text-foreground focus-visible:ring-ring rounded-sm"
        >
          Retry now
        </RetryButton>
      ) : null}
    </div>
  )
}
