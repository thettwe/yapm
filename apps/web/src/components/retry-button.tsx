import { cn } from '@yapm/ui/lib/utils'
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react'

export interface RetryButtonProps {
  onRetry: () => void
  // Where focus goes when this button disappears. Any focusable element that outlives it; the
  // control the retry belongs to is the obvious one, because that is where the user already was.
  fallbackRef: RefObject<HTMLElement | null>
  className?: string
  testId?: string
  children: ReactNode
}

/**
 * A retry offered by a failure state, which by construction is removed the moment the retry works.
 *
 * ITS OWN COMPONENT SO THE FOCUS HANDOFF IS A *DELETION* OF THIS FIBER: React runs a layout
 * effect's cleanup before it removes the subtree's DOM nodes, which is the only moment the button
 * both still exists and is known to be going away. Without the handoff, recovering while the button
 * holds focus drops focus to `<body>` and the next Tab restarts at the top of the document — from
 * anywhere but the last control on the page, that is the whole document to walk again.
 *
 * Styling is per-surface: the two callers sit in different type scales, so only the behaviour
 * (underline affordance, visible focus ring, the handoff) is shared here.
 */
export function RetryButton({
  onRetry,
  fallbackRef,
  className,
  testId,
  children,
}: RetryButtonProps) {
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
      className={cn(
        'underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
      onClick={onRetry}
      data-testid={testId}
    >
      {children}
    </button>
  )
}
