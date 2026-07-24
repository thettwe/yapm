import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar'
import { cn } from '@yapm/ui/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'

const avatarVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-bg-hover align-middle select-none',
  {
    variants: {
      size: {
        xs: 'size-5 text-[9px]',
        sm: 'size-6 text-[10px]',
        default: 'size-7 text-[11px]',
        lg: 'size-9 text-xs',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
)

function Avatar({
  className,
  size = 'default',
  ...props
}: AvatarPrimitive.Root.Props & VariantProps<typeof avatarVariants>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(avatarVariants({ size, className }))}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return <AvatarPrimitive.Image className={cn('size-full object-cover', className)} {...props} />
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        'flex size-full items-center justify-center font-ui font-medium text-text-2',
        className,
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarFallback, AvatarImage, avatarVariants }
