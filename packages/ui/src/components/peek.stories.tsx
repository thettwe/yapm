import { Door } from './door'
import { PeekFact, PeekPanel, PeekProvider, PeekTitle, usePeek } from './peek'
import { ProvenanceMark } from './provenance-mark'
import { buildRealityShape, RealityTrack, realityTrackLabel } from './reality-track'
import { StatusGlyph } from './status-glyph'
import { PresetGrid } from './story-presets'

export default {
  title: 'Peek',
}

const MERGED_NOT_LIVE = {
  pr: 'merged',
  ci: 'passing',
  reviewAgeMs: 86_400_000,
  deployedAt: null,
} as const

const DIVERGENCE_SENTENCE = 'Done in git, not on the board'
const BREAK_MARK = '//'

function IssuePeek({ id, title }: { id: string; title: string }) {
  const { open, triggerProps, peekProps } = usePeek<HTMLAnchorElement>(id, {
    label: `${id} — ${title}`,
  })
  const shape = buildRealityShape(MERGED_NOT_LIVE, { divergence: 'status_behind_merge' })
  return (
    <span className="relative inline-flex">
      <a
        href="#peek"
        {...triggerProps}
        className="inline-flex items-center gap-1.5 rounded-control px-1.5 py-0.5 font-mono text-[11.5px] text-text-1 hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <StatusGlyph status="in-progress" className="size-[13px]" />
        <Door hot={open}>{id}</Door>
      </a>
      {open ? (
        <PeekPanel {...peekProps}>
          <PeekTitle>{title}</PeekTitle>
          <div className="mt-[5px] flex items-center gap-1.5 text-[12px] text-text-2">
            <StatusGlyph status="in-progress" className="size-[13px]" />
            <b className="font-semibold text-text-1">In Progress</b>
            <span>· Cycle 2 · feature</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-status-urgent-ink">
            <span className="font-mono tracking-[-0.05em]">{BREAK_MARK}</span>
            {DIVERGENCE_SENTENCE}
          </div>
          <div className="mt-2.5">
            <RealityTrack
              shape={shape}
              label={realityTrackLabel(MERGED_NOT_LIVE, DIVERGENCE_SENTENCE)}
            />
          </div>
          <PeekFact
            phrase="Built — not live yet"
            detail={
              <>
                merged 8f21c4a · 14/14 checks · no prod deploy since
                <ProvenanceMark provider="github" label={null} className="ml-[5px]" />
              </>
            }
          />
        </PeekPanel>
      ) : null}
    </span>
  )
}

// Two triggers on one page: hover or focus either, and the other closes — the provider holds one
// id, so a second open peek is not a bug that can happen.
export function AllPresets() {
  return (
    <PresetGrid>
      <PeekProvider>
        <div className="flex min-h-[230px] items-start gap-4">
          <IssuePeek id="ENG-116" title="Apple Pay in the payment sheet" />
          <IssuePeek id="ENG-188" title="Retry the webhook queue" />
        </div>
      </PeekProvider>
    </PresetGrid>
  )
}
