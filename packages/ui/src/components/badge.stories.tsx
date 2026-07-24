import { Badge } from './badge'
import { PresetGrid } from './story-presets'

export default {
  title: 'Badge',
}

export function AllPresets() {
  return (
    <PresetGrid>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Backlog</Badge>
        <Badge variant="accent">Selected</Badge>
        <Badge variant="solid">Primary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="accent">
          <span className="size-2 rounded-full bg-signal-sync" />
          Synced
        </Badge>
      </div>
    </PresetGrid>
  )
}
