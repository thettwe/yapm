import { type RefObject, useLayoutEffect, useRef } from 'react'
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
      {connection.retryOffered ? <RetryButton onRetry={retryNow} fallbackRef={statusRef} /> : null}
    </div>
  )
}

interface RetryButtonProps {
  onRetry: () => void
  fallbackRef: RefObject<HTMLElement | null>
}

// Its own component so the focus handoff is a *deletion* of this fiber: React runs a layout
// effect's cleanup before it removes the subtree's DOM nodes, which is the only moment the
// button both still exists and is known to be going away. Without the handoff, recovering
// while the button holds focus drops focus to `<body>` and the next Tab restarts at the top
// of the document — the pill sits in the header, so that is the whole page to walk again.
function RetryButton({ onRetry, fallbackRef }: RetryButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const button = ref.current
    return () => {
      if (button !== null && document.activeElement === button) fallbackRef.current?.focus()
    }
  }, [fallbackRef])

  return (
    <button
      ref={ref}
      type="button"
      className="text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
      onClick={onRetry}
      data-testid="connection-retry"
    >
      Retry now
    </button>
  )
}
