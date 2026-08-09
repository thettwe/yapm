import { CarryChain, type CarryNodeKind, ScopeBand, type ScopeBlockKind } from './drawn'
import { PresetGrid } from './story-presets'

export default {
  title: 'Drawn bands',
}

const FULL: ScopeBlockKind[] = [
  'landed',
  'landed',
  'landed',
  'landed',
  'landed',
  'landed',
  'landed',
  'landed',
  'open',
  'open',
  'added',
  'added',
]
const DEGRADED: ScopeBlockKind[] = FULL.filter((block) => block !== 'open')

// The same band at both scales, side by side: Home's hero measure and the register's row measure
// are one drawing, and this is where a divergence would show.
export function ScopeBandScales() {
  return (
    <PresetGrid>
      <div className="flex flex-col gap-5">
        <div>
          <div className="font-mono text-[10px] text-text-3">hero · 8/10</div>
          <ScopeBand band={FULL} />
        </div>
        <div className="flex items-center gap-2.5">
          <span className="w-[128px]">
            <ScopeBand band={FULL} size="row" />
          </span>
          <span className="font-mono text-[11px] text-text-2">8/10</span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="w-[128px]">
            <ScopeBand band={DEGRADED} size="row" />
          </span>
          <span className="font-mono text-[11px] text-text-2">8 landed</span>
        </div>
      </div>
    </PresetGrid>
  )
}

const DEEP: CarryNodeKind[] = ['unnamed', 'unnamed', 'origin', 'now']
const NAMED_ONE_HOP: CarryNodeKind[] = ['origin', 'now']
const UNNAMED: CarryNodeKind[] = ['unnamed', 'unnamed', 'now']

// The degenerate cases are the point of this story: a single hop draws two nodes and no lead-in,
// and a chain whose origin the schema can no longer name draws no solid node at all.
export function CarryChains() {
  return (
    <PresetGrid>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <CarryChain nodes={DEEP} leadIn originLabel="Cycle 1" labelled />
          <span className="font-mono text-[11.5px] text-text-2">carried 3×</span>
        </div>
        <div className="flex items-center gap-4">
          <CarryChain nodes={NAMED_ONE_HOP} leadIn={false} originLabel="Cycle 2" />
          <span className="font-mono text-[11.5px] text-text-2">carried 1×</span>
        </div>
        <div className="flex items-center gap-4">
          <CarryChain nodes={UNNAMED} leadIn />
          <span className="font-mono text-[11.5px] text-text-2">carried 2×</span>
        </div>
      </div>
    </PresetGrid>
  )
}
