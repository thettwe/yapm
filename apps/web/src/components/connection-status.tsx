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

  return (
    <div
      className="text-muted-foreground flex items-center gap-2 text-sm"
      data-testid="connection-status"
      data-connection={connection.state}
      data-recovery={connection.recovery}
    >
      <p className="flex items-center gap-2" role="status" aria-live="polite">
        <span aria-hidden="true" className={`size-2 rounded-full ${DOT_CLASS[connection.state]}`} />
        <span>{connection.label}</span>
        {connection.detail ? <span className="sr-only">{connection.detail}</span> : null}
      </p>
      {connection.retryOffered ? (
        <button
          type="button"
          className="text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
          onClick={retryNow}
          data-testid="connection-retry"
        >
          Retry now
        </button>
      ) : null}
    </div>
  )
}
