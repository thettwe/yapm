import type { NotificationKind } from '@yapm/schema'
import type { ReactNode } from 'react'

// The four kinds, drawn in the house manner — 20-unit box, 1.6 hairline, `currentColor`, no
// borrowed icon set — transcribed from `destinations/inbox.html`'s `<symbol>` defs.
//
// PAGE-LOCAL, not `packages/ui`: the repo's rule is that a drawing moves into the shared package
// when it gains a SECOND consumer, and this one has one. Every glyph is `aria-hidden`; the kind
// reaches assistive technology as the word `KIND_LABEL` holds, on the row itself.

const STROKE = 1.6

function Assigned() {
  return (
    <>
      <path
        d="M2.6 10 H10.8 M8.2 7.2 L11 10 L8.2 12.8"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The landing disc — the one filled mark in the set: it arrives, and it lands on someone. */}
      <circle cx="15.2" cy="10" r="2.6" fill="currentColor" />
    </>
  )
}

function Commented() {
  return (
    <path
      d="M3.4 7.2 A2.4 2.4 0 0 1 5.8 4.8 h8.4 A2.4 2.4 0 0 1 16.6 7.2 v4.2 A2.4 2.4 0 0 1 14.2 13.8 H9.2 L5.8 16.4 V13.8 A2.4 2.4 0 0 1 3.4 11.4 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinejoin="round"
    />
  )
}

function Mentioned() {
  return (
    <>
      <circle cx="10" cy="10" r="2.9" fill="none" stroke="currentColor" strokeWidth={STROKE} />
      <path
        d="M12.9 10 v1.9 a2.3 2.3 0 0 0 4.1 1.1 A7.1 7.1 0 1 0 13.9 16.2"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </>
  )
}

function Digest() {
  return (
    <>
      <rect
        x="4.2"
        y="3.4"
        width="11.6"
        height="13.2"
        rx="2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
      />
      <path
        d="M7 7.4 H13 M7 10 H13 M7 12.6 H10.6"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </>
  )
}

const MARK: Record<NotificationKind, () => ReactNode> = {
  issue_assigned: Assigned,
  issue_commented: Commented,
  mention: Mentioned,
  pm_digest_published: Digest,
}

export function KindGlyph({ kind, className }: { kind: NotificationKind; className?: string }) {
  const Mark = MARK[kind]
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={className}>
      <Mark />
    </svg>
  )
}

// The settled loop: nothing has started, and nothing needs to. The empty state's one mark, drawn at
// the mock's 34px by the surface that mounts it.
export function SettledLoop({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={className}>
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth={STROKE} />
    </svg>
  )
}
