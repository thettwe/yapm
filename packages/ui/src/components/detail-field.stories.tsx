import { DetailField, DetailSection, PropertyButton } from './detail-field'
import { PriorityMark } from './priority-mark'
import { StatusGlyph } from './status-glyph'
import { PresetGrid } from './story-presets'

export default {
  title: 'Detail field',
}

export function Metadata() {
  return (
    <PresetGrid>
      <DetailSection title="Properties">
        <DetailField label="Status">
          <PropertyButton>
            <StatusGlyph status="in-progress" />
            In Progress
          </PropertyButton>
        </DetailField>
        <DetailField label="Priority">
          <PropertyButton>
            <PriorityMark priority="high" />
            High
          </PropertyButton>
        </DetailField>
        <DetailField label="Assignee">
          <PropertyButton>
            <span className="size-4 rounded-full bg-accent-soft" aria-hidden="true" />
            Ada Lovelace
          </PropertyButton>
        </DetailField>
        <DetailField label="Labels">
          <PropertyButton>
            <span className="size-2 rounded-full" style={{ backgroundColor: '#e5a54b' }} />
            sync
          </PropertyButton>
          <PropertyButton>+ Add label</PropertyButton>
        </DetailField>
      </DetailSection>
    </PresetGrid>
  )
}
