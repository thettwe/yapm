import { cn } from '@yapm/ui/lib/utils'
import type { ComponentPropsWithoutRef } from 'react'

// Anything dotted opens something. Shipping the dotted rule as a component rather than a class
// keeps the affordance a single fact the whole language obeys: if a surface wants a doorway it
// wraps the words in a `Door`, and if it does not draw a `Door` it does not open.
export interface DoorProps extends ComponentPropsWithoutRef<'span'> {
  // Hot is the accent-inked doorway of `ia.html` — the number under an open `how`, the trigger
  // under an open peek. It is a state of the same door, never a second kind of door.
  hot?: boolean
}

function Door({ hot = false, className, ...props }: DoorProps) {
  return (
    <span
      data-slot="door"
      data-hot={hot ? '' : undefined}
      className={cn(
        'border-b border-dotted pb-px',
        hot ? 'border-accent' : 'border-border-strong',
        className,
      )}
      {...props}
    />
  )
}

export { Door }
