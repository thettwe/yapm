import type { ConnectionSummary } from '@/zero/connection'

const DOT_CLASS: Record<ConnectionSummary['state'], string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500',
  disconnected: 'bg-muted-foreground',
  'needs-auth': 'bg-amber-500',
  error: 'bg-destructive',
  closed: 'bg-muted-foreground',
}

export function ConnectionStatus({ connection }: { connection: ConnectionSummary }) {
  return (
    <p
      className="text-muted-foreground flex items-center gap-2 text-sm"
      role="status"
      data-testid="connection-status"
      data-connection={connection.state}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${DOT_CLASS[connection.state]}`} />
      <span>{connection.label}</span>
      {connection.detail ? <span className="sr-only">{connection.detail}</span> : null}
    </p>
  )
}
