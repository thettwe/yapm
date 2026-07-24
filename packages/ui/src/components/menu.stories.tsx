import { Button } from './button'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from './menu'
import { PresetGrid } from './story-presets'

export default {
  title: 'Menu',
}

export function AllPresets() {
  return (
    <PresetGrid>
      <Menu>
        <MenuTrigger render={<Button variant="outline">Actions</Button>} />
        <MenuContent>
          <MenuGroup>
            <MenuGroupLabel>Issue</MenuGroupLabel>
            <MenuItem>Assign to me</MenuItem>
            <MenuItem>Change status</MenuItem>
            <MenuItem>Set priority</MenuItem>
          </MenuGroup>
          <MenuSeparator />
          <MenuItem>Delete</MenuItem>
        </MenuContent>
      </Menu>
    </PresetGrid>
  )
}
