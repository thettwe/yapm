import { cn } from '@yapm/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-pill border border-transparent px-2 py-0.5 font-ui text-[11.5px] font-medium whitespace-nowrap transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-bg-hover text-text-2',
        accent: 'bg-accent-soft text-accent-strong',
        solid: 'bg-accent text-on-accent',
        outline: 'border-border text-text-2',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />
}

export { Badge, badgeVariants }
