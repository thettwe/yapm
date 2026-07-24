import { Input } from './input'
import { Label } from './label'
import { PresetGrid } from './story-presets'

export default {
  title: 'Label',
}

export function AllPresets() {
  return (
    <PresetGrid>
      <div className="flex flex-col gap-2">
        <Label htmlFor="assignee">Assignee</Label>
        <Input id="assignee" placeholder="Unassigned" />
      </div>
    </PresetGrid>
  )
}
