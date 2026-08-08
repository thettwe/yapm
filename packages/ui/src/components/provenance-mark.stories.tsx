import { ProvenanceMark } from './provenance-mark'
import { StatusGlyph } from './status-glyph'
import { PresetGrid } from './story-presets'

export default {
  title: 'Provenance mark',
}

// Our glyphs carry meaning; brand marks carry provenance. The mark always follows the fact it
// sourced, never replaces a status arc, and an uploaded artifact carries no mark at all — there
// is no member of the union that could draw one.
export function AllPresets() {
  return (
    <PresetGrid>
      <div className="grid grid-cols-[70px_1fr] items-center gap-x-3 gap-y-2.5 text-text-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">
          change
        </span>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-control border border-border-strong px-1.5 py-0.5 font-mono text-[11.5px]">
          <StatusGlyph status="done" className="size-[13px]" />
          <span>#188</span>
          <ProvenanceMark provider="github" label={null} className="ml-0.5" />
        </span>

        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">check</span>
        <span className="font-mono text-[11px] text-text-3">
          14/14 checks passed
          <ProvenanceMark provider="github" className="ml-[5px]" />
        </span>

        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">link</span>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-control border border-border-strong px-1.5 py-0.5 font-mono text-[11.5px]">
          <ProvenanceMark provider="figma" size={13} />
          <span>payment-sheet-v2</span>
        </span>

        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-3">
          upload
        </span>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-control border border-border-strong px-1.5 py-0.5 font-mono text-[11.5px] text-text-2">
          payment-sheet-v3
        </span>
      </div>
    </PresetGrid>
  )
}
