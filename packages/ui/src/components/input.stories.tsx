import { Input } from './input'
import { Label } from './label'
import { PresetGrid } from './story-presets'

export default {
  title: 'Input',
}

export function AllPresets() {
  return (
    <PresetGrid>
      <div className="flex flex-col gap-3">
        <Label>
          Issue title
          <Input placeholder="Summarize the problem…" />
        </Label>
        <Input defaultValue="ENG-142 investigate flaky sync" />
        <Input placeholder="Disabled" disabled />
        <Input placeholder="Invalid" aria-invalid />
      </div>
    </PresetGrid>
  )
}
