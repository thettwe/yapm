import { Avatar, AvatarFallback, AvatarImage } from '@yapm/ui/components/avatar'
import { cn } from '@yapm/ui/lib/utils'
import type { ReactNode } from 'react'

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export interface CommentCardProps {
  authorName: string
  authorImage?: string | null
  timestamp: string
  edited?: boolean
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export function CommentCard({
  authorName,
  authorImage,
  timestamp,
  edited = false,
  actions,
  children,
  className,
}: CommentCardProps) {
  return (
    <article className={cn('flex gap-2.5', className)}>
      <Avatar size="sm" className="mt-0.5 shrink-0" title={authorName}>
        {authorImage ? <AvatarImage src={authorImage} alt={authorName} /> : null}
        <AvatarFallback aria-label={authorName}>{initials(authorName)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-ui text-[13px] font-semibold text-text-1">{authorName}</span>
          <span className="font-mono text-[11px] text-text-3">{timestamp}</span>
          {edited ? <span className="font-ui text-[11px] text-text-3">(edited)</span> : null}
          {actions ? <span className="ml-auto flex items-center gap-0.5">{actions}</span> : null}
        </div>
        <div className="mt-0.5">{children}</div>
      </div>
    </article>
  )
}
