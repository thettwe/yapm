import { Label } from './label'
import { Select } from './select'
import { PresetGrid } from './story-presets'

export default {
  title: 'Select',
}

export function AllPresets() {
  return (
    <PresetGrid>
      <Label>
        Status
        <Select defaultValue="in-progress">
          <option value="backlog">Backlog</option>
          <option value="todo">Todo</option>
          <option value="in-progress">In progress</option>
          <option value="in-review">In review</option>
          <option value="done">Done</option>
        </Select>
      </Label>
    </PresetGrid>
  )
}
