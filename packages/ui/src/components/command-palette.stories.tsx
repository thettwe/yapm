import { ArrowRightIcon, CircleDotIcon, GitPullRequestIcon, UserIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from './button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './command-palette'
import { PresetGrid } from './story-presets'

function PaletteBody() {
  return (
    <>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Issues">
          <CommandItem>
            <CircleDotIcon />
            New issue
            <CommandShortcut>C</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <GitPullRequestIcon />
            Link a pull request
          </CommandItem>
          <CommandItem>
            <UserIcon />
            Assign to me
            <CommandShortcut>I</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Navigate">
          <CommandItem>
            <ArrowRightIcon />
            Go to active issues
          </CommandItem>
          <CommandItem>
            <ArrowRightIcon />
            Go to my issues
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <CommandFooter>
        <span>↑↓ to navigate</span>
        <span>↵ to select</span>
        <span>esc to close</span>
      </CommandFooter>
    </>
  )
}

export default {
  title: 'Command palette',
}

export function Inline() {
  return (
    <PresetGrid>
      <Command className="rounded-card border border-border-strong shadow-md">
        <PaletteBody />
      </Command>
    </PresetGrid>
  )
}

export function AsDialog() {
  const [open, setOpen] = useState(false)
  return (
    <div className="p-4">
      <Button onClick={() => setOpen(true)}>Open command palette (⌘K)</Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <PaletteBody />
      </CommandDialog>
    </div>
  )
}
