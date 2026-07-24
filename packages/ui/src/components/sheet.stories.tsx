import { useState } from 'react'
import { Button } from './button'
import { Sheet } from './sheet'

export default {
  title: 'Sheet',
}

export function RightDrawer() {
  const [open, setOpen] = useState(false)
  return (
    <div data-theme="warm" className="bg-bg p-6">
      <Button onClick={() => setOpen(true)}>Open sheet</Button>
      <Sheet open={open} onOpenChange={setOpen} label="Example sheet">
        <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="font-mono text-xs text-text-2">ENG-142</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            className="ml-auto"
            onClick={() => setOpen(false)}
          >
            ✕
          </Button>
        </header>
        <div className="p-5 font-ui text-sm text-text-1">Side panel content.</div>
      </Sheet>
    </div>
  )
}
