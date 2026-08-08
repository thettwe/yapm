import { cn } from '@yapm/ui/lib/utils'
import type { ReactElement } from 'react'

// Our glyphs carry meaning; brand marks carry provenance. A provider that yapm draws facts from
// gets a member here and its path data below — that is the whole of adding one. There is
// deliberately no `upload` member: an uploaded artifact is yapm-native and carries no mark, and
// the type system is what says so rather than a comment somebody can read past.
export type ProvenanceProvider = 'github' | 'figma'

// 12–14px and nothing else. A size prop that took a number would be the first step toward a brand
// mark larger than the text it follows.
export type ProvenanceSize = 12 | 13 | 14

const PROVIDER_NAME: Record<ProvenanceProvider, string> = {
  github: 'GitHub',
  figma: 'Figma',
}

const PROVIDER_PATH: Record<ProvenanceProvider, ReactElement> = {
  github: (
    <path
      fill="currentColor"
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
    />
  ),
  figma: (
    <g fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round">
      <path d="M8 1.6 H5.5 a2.3 2.3 0 0 0 0 4.6 H8 Z" />
      <path d="M8 1.6 h2.5 a2.3 2.3 0 0 1 0 4.6 H8 Z" />
      <path d="M8 6.2 H5.5 a2.3 2.3 0 0 0 0 4.6 H8 Z" />
      <circle cx="10.5" cy="8.5" r="2.3" />
      <path d="M8 10.8 H5.5 a2.3 2.3 0 1 0 2.5 2.3 Z" />
    </g>
  ),
}

export interface ProvenanceMarkProps {
  readonly provider: ProvenanceProvider
  readonly size?: ProvenanceSize
  // `null` when the sentence beside the mark already names the source, so a screen reader is not
  // told "GitHub" twice. Omitted, the mark names itself.
  readonly label?: string | null
  readonly className?: string
}

// Monochrome, `currentColor`, after the fact it sourced. There is no `color` prop: a brand mark
// that could be tinted would eventually be tinted, and a coloured mark reads as one of our own
// glyphs — which carry meaning the brand does not.
function ProvenanceMark({ provider, size = 12, label, className }: ProvenanceMarkProps) {
  const accessible = label === null ? null : (label ?? PROVIDER_NAME[provider])
  return (
    <span
      data-slot="provenance-mark"
      data-provider={provider}
      className={cn('inline-flex flex-none align-[-2px] text-text-3', className)}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        role={accessible === null ? 'presentation' : 'img'}
        aria-hidden={accessible === null ? true : undefined}
        aria-label={accessible ?? undefined}
      >
        {accessible === null ? null : <title>{accessible}</title>}
        {PROVIDER_PATH[provider]}
      </svg>
    </span>
  )
}

export { ProvenanceMark }
