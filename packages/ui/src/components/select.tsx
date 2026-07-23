import { cn } from '@yapm/ui/lib/utils'
import { ChevronDownIcon } from 'lucide-react'
import type { ComponentProps } from 'react'

function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative inline-flex w-full items-center">
      <select
        data-slot="select"
        className={cn(
          'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full appearance-none rounded-md border py-1 pr-8 pl-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute right-2.5 size-3.5"
      />
    </div>
  )
}

export { Select }
