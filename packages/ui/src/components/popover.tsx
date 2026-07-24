import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { cn } from '@yapm/ui/lib/utils'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverClose = PopoverPrimitive.Close

function PopoverContent({
  className,
  children,
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Popup.Props & { sideOffset?: number }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner sideOffset={sideOffset} className="z-50 outline-none">
        <PopoverPrimitive.Popup
          className={cn(
            'bg-popover text-popover-foreground min-w-56 origin-[var(--transform-origin)] rounded-card border p-4 shadow-md transition-all outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      className={cn('font-heading text-sm font-semibold tracking-tight', className)}
      {...props}
    />
  )
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      className={cn('text-muted-foreground mt-1 text-sm', className)}
      {...props}
    />
  )
}

export { Popover, PopoverClose, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger }
