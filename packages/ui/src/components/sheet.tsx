import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cn } from '@yapm/ui/lib/utils'
import type { ReactNode } from 'react'

export function Sheet({
  open,
  onOpenChange,
  label,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/30 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup
          aria-label={label}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-border bg-bg shadow-lg transition-transform data-ending-style:translate-x-full data-starting-style:translate-x-full',
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
