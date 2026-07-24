import { Button } from './button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from './popover'
import { PresetGrid } from './story-presets'

export default {
  title: 'Popover',
}

export function AllPresets() {
  return (
    <PresetGrid>
      <Popover>
        <PopoverTrigger render={<Button variant="outline">Filter</Button>} />
        <PopoverContent>
          <PopoverTitle>Delivery filters</PopoverTitle>
          <PopoverDescription>Narrow the list by reality signals.</PopoverDescription>
        </PopoverContent>
      </Popover>
    </PresetGrid>
  )
}
