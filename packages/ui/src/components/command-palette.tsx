import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cn } from '@yapm/ui/lib/utils'
import { Command as CommandPrimitive } from 'cmdk'
import { SearchIcon } from 'lucide-react'
import type { ComponentProps } from 'react'

function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-card bg-bg-elevated font-ui text-text-1',
        className,
      )}
      {...props}
    />
  )
}

function CommandDialog({
  open,
  onOpenChange,
  label = 'Command palette',
  className,
  children,
  ...props
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  label?: string
} & ComponentProps<typeof CommandPrimitive>) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup
          aria-label={label}
          className="fixed top-[14vh] left-1/2 z-50 w-full max-w-[640px] -translate-x-1/2 overflow-hidden rounded-card border border-border-strong bg-bg-elevated shadow-lg transition-all data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
        >
          <Command label={label} className={className} {...props}>
            {children}
          </Command>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex h-[54px] items-center gap-3 border-b border-border px-4">
      <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-text-3" />
      <CommandPrimitive.Input
        autoFocus
        className={cn(
          'flex-1 bg-transparent text-base text-text-1 placeholder:text-text-3 outline-none',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-[376px] overflow-y-auto overflow-x-hidden scroll-py-1 p-1', className)}
      {...props}
    />
  )
}

function CommandEmpty({ className, ...props }: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn('py-10 text-center text-sm text-text-3', className)}
      {...props}
    />
  )
}

function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        'overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.07em] [&_[cmdk-group-heading]]:text-text-3',
        className,
      )}
      {...props}
    />
  )
}

function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'flex h-10 cursor-default items-center gap-3 rounded-control px-2 text-sm text-text-1 outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent-strong [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-2 data-[selected=true]:[&_svg]:text-accent-strong',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
  )
}

function CommandShortcut({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'ml-auto flex items-center gap-0.5 rounded-[4px] border border-border bg-bg-hover px-1.5 py-0.5 font-mono text-[10.5px] text-text-2',
        className,
      )}
      {...props}
    />
  )
}

function CommandFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-t border-border px-4 py-2 font-mono text-[10.5px] text-text-3',
        className,
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
