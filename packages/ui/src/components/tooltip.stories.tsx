import { Button } from './button'
import { PresetGrid } from './story-presets'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

export default {
  title: 'Tooltip',
}

export function AllPresets() {
  return (
    <TooltipProvider>
      <PresetGrid>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost">Hover or focus me</Button>} />
          <TooltipContent>Merged 2 days ago</TooltipContent>
        </Tooltip>
      </PresetGrid>
    </TooltipProvider>
  )
}
