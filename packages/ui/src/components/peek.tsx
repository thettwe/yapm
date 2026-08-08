import { cn } from '@yapm/ui/lib/utils'
import {
  type ComponentPropsWithoutRef,
  createContext,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

// Moving the pointer off the trigger and onto the panel crosses a gap. The corridor is the time
// the peek stays open across that gap; it is not an animation and nothing waits on it.
const HOVER_GRACE_MS = 140

interface PeekRegistry {
  readonly openPeekId: string | null
  open(id: string): void
  close(id: string): void
  scheduleClose(id: string): void
  cancelScheduledClose(): void
}

const PeekContext = createContext<PeekRegistry | null>(null)

// One page, one open peek — held as one nullable id, so opening B closes A because the state
// cannot hold two values. The invariant is the data structure, not a rule anybody has to keep.
function PeekProvider({ children }: { children: ReactNode }) {
  const [openPeekId, setOpenPeekId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelScheduledClose = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  useEffect(() => cancelScheduledClose, [cancelScheduledClose])

  const registry = useMemo<PeekRegistry>(
    () => ({
      openPeekId,
      open(id) {
        cancelScheduledClose()
        setOpenPeekId(id)
      },
      close(id) {
        cancelScheduledClose()
        setOpenPeekId((current) => (current === id ? null : current))
      },
      scheduleClose(id) {
        cancelScheduledClose()
        timer.current = setTimeout(() => {
          timer.current = null
          setOpenPeekId((current) => (current === id ? null : current))
        }, HOVER_GRACE_MS)
      },
      cancelScheduledClose,
    }),
    [openPeekId, cancelScheduledClose],
  )

  return <PeekContext.Provider value={registry}>{children}</PeekContext.Provider>
}

export interface UsePeekOptions {
  // Names the thing the panel is about. REQUIRED, and required here rather than on the panel: a
  // `role="dialog"` with no accessible name is announced as an unnamed dialog, and an optional
  // label is one somebody forgets at one of several call sites. Unnamed does not compile.
  readonly label: string
}

export interface UsePeekResult<T extends HTMLElement> {
  readonly open: boolean
  openPeek(): void
  closePeek(): void
  readonly triggerProps: {
    ref: RefObject<T | null>
    'aria-expanded': boolean
    'aria-describedby': string | undefined
    onPointerEnter(): void
    onPointerLeave(): void
    onFocus(): void
    onBlur(event: FocusEvent<HTMLElement>): void
    onKeyDown(event: KeyboardEvent<HTMLElement>): void
  }
  readonly peekProps: {
    ref: RefObject<HTMLDivElement | null>
    id: string
    role: 'dialog'
    'aria-modal': false
    'aria-label': string
    onPointerEnter(): void
    onPointerLeave(): void
    onKeyDown(event: KeyboardEvent<HTMLElement>): void
  }
}

// The trigger stays the link or the button it already was: `⏎` is its own native activation, so
// the peek never intercepts the key that goes to the thing. `esc` closes and hands focus back —
// the page keeps its focus order, because this is a transient, not a trap.
function usePeek<T extends HTMLElement = HTMLElement>(
  id: string,
  options: UsePeekOptions,
): UsePeekResult<T> {
  const registry = useContext(PeekContext)
  if (registry === null) {
    throw new Error('usePeek must be used inside a <PeekProvider>')
  }
  const triggerRef = useRef<T | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const reactId = useId()
  const panelId = `${reactId}-peek`
  const open = registry.openPeekId === id

  const openPeek = useCallback(() => registry.open(id), [registry, id])
  const closePeek = useCallback(() => registry.close(id), [registry, id])
  const scheduleClose = useCallback(() => registry.scheduleClose(id), [registry, id])

  const closeAndRestore = useCallback(() => {
    closePeek()
    triggerRef.current?.focus()
  }, [closePeek])

  const onEscape = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape' || !open) return
      // Only swallowed while a peek is actually open, so `esc` still reaches whatever owns it
      // otherwise — the palette, a dialog, the row's own editor.
      event.stopPropagation()
      closeAndRestore()
    },
    [open, closeAndRestore],
  )

  return {
    open,
    openPeek,
    closePeek,
    triggerProps: {
      ref: triggerRef,
      'aria-expanded': open,
      'aria-describedby': open ? panelId : undefined,
      onPointerEnter: openPeek,
      onPointerLeave: scheduleClose,
      onFocus: openPeek,
      onBlur: (event) => {
        // Focus landing inside the panel is still the peek's own business.
        if (panelRef.current?.contains(event.relatedTarget)) return
        closePeek()
      },
      onKeyDown: onEscape,
    },
    peekProps: {
      ref: panelRef,
      id: panelId,
      role: 'dialog',
      'aria-modal': false,
      'aria-label': options.label,
      onPointerEnter: registry.cancelScheduledClose,
      onPointerLeave: scheduleClose,
      onKeyDown: onEscape,
    },
  }
}

export interface PeekPanelProps extends ComponentPropsWithoutRef<'div'> {
  // The `⏎ open · esc stay` line the mock draws. `false` drops it for a peek whose trigger goes
  // nowhere; anything else replaces it.
  readonly footer?: ReactNode | false
}

// The one elevated surface in this language. Transients lift; pages do not. The shadow is a token
// per preset, so a dark theme is never handed a light theme's shadow.
function PeekPanel({ className, children, footer, ...props }: PeekPanelProps) {
  return (
    <div
      data-slot="peek"
      className={cn(
        'absolute left-0 top-[calc(100%+6px)] z-50 w-[312px] rounded-[12px] border border-border bg-bg-elevated px-[15px] pt-[13px] pb-[6px] font-ui text-text-1 shadow-elevated',
        className,
      )}
      {...props}
    >
      {children}
      {footer === false ? null : (
        <div className="mt-[11px] flex items-center gap-[7px] border-t border-row-hairline px-0 pt-[7px] pb-[6px] text-[11px] text-text-2">
          {footer ?? (
            <>
              <kbd className="rounded border border-border-strong bg-bg-elevated px-1 py-px font-mono text-[10px] text-text-2">
                ⏎
              </kbd>
              <span>open</span>
              <span className="text-border-strong">·</span>
              <kbd className="rounded border border-border-strong bg-bg-elevated px-1 py-px font-mono text-[10px] text-text-2">
                esc
              </kbd>
              <span>stay</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PeekTitle({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn('font-heading text-[14px] font-semibold tracking-[-0.008em]', className)}
      {...props}
    />
  )
}

// The peek's one bi-fact: the sentence a person reads, and the mono line the sentence was drawn
// from. Never a third line — a peek that needs three is a page.
function PeekFact({
  phrase,
  detail,
  className,
}: {
  phrase: ReactNode
  detail?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mt-2', className)}>
      <div className="text-[12.5px] font-semibold">{phrase}</div>
      {detail === undefined ? null : (
        <div className="mt-[3px] font-mono text-[10.5px] leading-[1.5] text-text-3">{detail}</div>
      )}
    </div>
  )
}

export { PeekFact, PeekPanel, PeekProvider, PeekTitle, usePeek }
