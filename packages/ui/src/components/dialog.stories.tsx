import { Button } from './button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import { Input } from './input'
import { Label } from './label'
import { PresetGrid } from './story-presets'

export default {
  title: 'Dialog',
}

export function AllPresets() {
  return (
    <PresetGrid>
      <Dialog>
        <DialogTrigger render={<Button variant="outline">Rename issue</Button>} />
        <DialogContent>
          <DialogTitle>Rename issue</DialogTitle>
          <DialogDescription>Give this issue a clearer title.</DialogDescription>
          <Label>
            Title
            <Input defaultValue="Investigate flaky sync" />
          </Label>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="ghost">Cancel</Button>} />
            <DialogClose render={<Button>Save</Button>} />
          </div>
        </DialogContent>
      </Dialog>
    </PresetGrid>
  )
}
