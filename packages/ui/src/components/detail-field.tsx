import { cn } from '@yapm/ui/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

export function DetailField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid grid-cols-[7rem_1fr] items-start gap-2 py-1.5', className)}>
      <span
        id={htmlFor ? `${htmlFor}-label` : undefined}
        className="pt-1 font-ui text-xs font-medium text-text-3"
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  )
}

export function PropertyButton({ className, children, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      data-slot="property-button"
      className={cn(
        'inline-flex min-h-6 items-center gap-1.5 rounded-control px-1.5 py-0.5 text-left font-ui text-[13px] text-text-1 transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none aria-expanded:bg-bg-hover disabled:pointer-events-none disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function DetailSection({
  title,
  children,
  className,
}: {
  title?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-1', className)}>
      {title ? (
        <h2 className="font-ui text-xs font-semibold tracking-wide text-text-3 uppercase">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  )
}
