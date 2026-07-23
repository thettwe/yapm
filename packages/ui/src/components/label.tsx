import { cn } from '@yapm/ui/lib/utils'
import type { ComponentProps } from 'react'

function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: consumers associate a control via htmlFor
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm font-medium leading-none select-none has-disabled:pointer-events-none has-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
