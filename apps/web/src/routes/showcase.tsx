import { createFileRoute } from '@tanstack/react-router'
import { Avatar, AvatarFallback } from '@yapm/ui/components/avatar'
import { Badge } from '@yapm/ui/components/badge'
import { Button } from '@yapm/ui/components/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@yapm/ui/components/command-palette'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@yapm/ui/components/dialog'
import { Input } from '@yapm/ui/components/input'
import { DivergenceFlag, IssueRow } from '@yapm/ui/components/issue-row'
import { Label } from '@yapm/ui/components/label'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '@yapm/ui/components/menu'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@yapm/ui/components/popover'
import { PRIORITY, type PriorityKind, PriorityMark } from '@yapm/ui/components/priority-mark'
import { Select } from '@yapm/ui/components/select'
import { STATUS, StatusGlyph, type StatusKind } from '@yapm/ui/components/status-glyph'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@yapm/ui/components/tooltip'
import { deriveAccent } from '@yapm/ui/lib/color'
import { ArrowRightIcon, CircleDotIcon, GitPullRequestIcon, UserIcon } from 'lucide-react'
import { type CSSProperties, useEffect, useState } from 'react'

export const Route = createFileRoute('/showcase')({ component: Showcase })

const THEMES = ['warm', 'focused', 'editorial'] as const
type Preset = (typeof THEMES)[number]

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-3">
        {title}
      </h2>
      {children}
    </section>
  )
}

function IssueListMockup() {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-bg">
      <div className="flex h-[35px] items-center gap-2 border-b border-border bg-bg-sidebar px-4">
        <StatusGlyph status="in-progress" />
        <span className="font-ui text-[12.5px] font-semibold text-text-1">In Progress</span>
        <span className="font-mono text-[11px] text-text-3">3</span>
      </div>
      <div className="divide-y divide-border">
        <IssueRow
          issueKey="ENG-142"
          title="Investigate flaky sync on reconnect"
          priority="urgent"
          status="in-progress"
          labels={[{ name: 'sync', tone: 'accent' }]}
          cycle="C-24"
          date="3d"
          assignee={{ name: 'Ada Lovelace' }}
          divergenceFlag={<DivergenceFlag />}
        />
        <IssueRow
          issueKey="ENG-138"
          title="Issue row reserves reality-strip and divergence slots"
          priority="high"
          status="in-progress"
          labels={[{ name: 'graph', tone: 'in-review' }]}
          cycle="C-24"
          date="1d"
          assignee={{ name: 'Grace Hopper' }}
          selected
        />
        <IssueRow
          issueKey="ENG-140"
          title="Command palette keyboard model"
          priority="medium"
          status="in-progress"
          cycle="C-24"
          date="2d"
          assignee={{ name: 'Alan Turing' }}
        />
      </div>
      <div className="flex h-[35px] items-center gap-2 border-b border-t border-border bg-bg-sidebar px-4">
        <StatusGlyph status="done" />
        <span className="font-ui text-[12.5px] font-semibold text-text-1">Done</span>
        <span className="font-mono text-[11px] text-text-3">2</span>
      </div>
      <div className="divide-y divide-border">
        <IssueRow
          issueKey="ENG-131"
          title="Token layer passes WCAG AA in both modes"
          priority="medium"
          status="done"
          labels={[{ name: 'a11y', tone: 'done' }]}
          date="5d"
          assignee={{ name: 'Ada Lovelace' }}
        />
        <IssueRow
          issueKey="ENG-120"
          title="Backlog grooming for github-sync"
          priority="no-priority"
          status="done"
          date="2w"
          assignee={{ name: 'Grace Hopper' }}
        />
      </div>
    </div>
  )
}

function accentStyle(accent: string | null, dark: boolean): CSSProperties | undefined {
  if (!accent) return undefined
  const shades = deriveAccent(accent, dark ? 'dark' : 'light')
  return {
    '--accent': shades.accent,
    '--accent-strong': shades.strong,
    '--accent-hover': shades.hover,
    '--accent-active': shades.active,
    '--accent-soft': shades.soft,
    '--accent-line': shades.line,
    '--on-accent': shades.onAccent,
  } as CSSProperties
}

function Showcase() {
  const [preset, setPreset] = useState<Preset>('warm')
  const [dark, setDark] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [accent, setAccent] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      data-theme={preset}
      className={dark ? 'dark' : undefined}
      style={accentStyle(accent, dark)}
    >
      <div className="min-h-svh bg-bg font-ui text-text-1">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-bg/95 px-6 py-3 backdrop-blur">
          <span className="font-heading text-lg font-semibold tracking-tight">yapm showcase</span>
          <div className="flex-1" />
          <Label className="text-xs text-text-2">
            Preset
            <Select
              value={preset}
              onChange={(event) => setPreset(event.currentTarget.value as Preset)}
              className="w-36"
            >
              {THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {theme}
                </option>
              ))}
            </Select>
          </Label>
          <Button variant="outline" size="sm" onClick={() => setDark((value) => !value)}>
            {dark ? 'Dark' : 'Light'}
          </Button>
          <Label className="text-xs text-text-2">
            Accent
            <input
              type="color"
              aria-label="Custom accent color"
              value={accent ?? '#c15a38'}
              onChange={(event) => setAccent(event.currentTarget.value)}
              className="size-7 shrink-0 cursor-pointer rounded-control border border-border bg-transparent"
            />
          </Label>
          {accent ? (
            <Button variant="ghost" size="sm" onClick={() => setAccent(null)}>
              Reset accent
            </Button>
          ) : null}
          <Button size="sm" onClick={() => setPaletteOpen(true)}>
            Command palette ⌘K
          </Button>
        </header>

        <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 p-6 md:p-10">
          <Section title="Issue list — Warm mockup target">
            <IssueListMockup />
          </Section>

          <Section title="Buttons">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </div>
          </Section>

          <Section title="Inputs & labels">
            <div className="flex max-w-md flex-col gap-3">
              <Label>
                Issue title
                <Input placeholder="Summarize the problem…" />
              </Label>
              <Select defaultValue="in-progress">
                {(Object.keys(STATUS) as StatusKind[]).map((status) => (
                  <option key={status} value={status}>
                    {STATUS[status].label}
                  </option>
                ))}
              </Select>
            </div>
          </Section>

          <Section title="Badges & avatars">
            <div className="flex flex-wrap items-center gap-3">
              <Badge>Backlog</Badge>
              <Badge variant="accent">Selected</Badge>
              <Badge variant="solid">Primary</Badge>
              <Badge variant="outline">Outline</Badge>
              <div className="flex items-center gap-2">
                <Avatar size="sm">
                  <AvatarFallback aria-label="Ada Lovelace">AL</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback aria-label="Grace Hopper">GH</AvatarFallback>
                </Avatar>
                <Avatar size="lg">
                  <AvatarFallback aria-label="Alan Turing">AT</AvatarFallback>
                </Avatar>
              </div>
            </div>
          </Section>

          <Section title="Status glyphs & priority marks">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-4">
                {(Object.keys(STATUS) as StatusKind[]).map((status) => (
                  <span key={status} className="flex items-center gap-2 text-sm text-text-2">
                    <StatusGlyph status={status} />
                    {STATUS[status].label}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-4">
                {(Object.keys(PRIORITY) as PriorityKind[]).map((priority) => (
                  <span key={priority} className="flex items-center gap-2 text-sm text-text-2">
                    <PriorityMark priority={priority} />
                    {PRIORITY[priority]}
                  </span>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Overlays">
            <TooltipProvider>
              <div className="flex flex-wrap items-center gap-2">
                <Dialog>
                  <DialogTrigger render={<Button variant="outline">Open dialog</Button>} />
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

                <Popover>
                  <PopoverTrigger render={<Button variant="outline">Open popover</Button>} />
                  <PopoverContent>
                    <PopoverTitle>Delivery filters</PopoverTitle>
                    <PopoverDescription>Narrow the list by reality signals.</PopoverDescription>
                  </PopoverContent>
                </Popover>

                <Menu>
                  <MenuTrigger render={<Button variant="outline">Open menu</Button>} />
                  <MenuContent>
                    <MenuGroup>
                      <MenuGroupLabel>Issue</MenuGroupLabel>
                      <MenuItem>Assign to me</MenuItem>
                      <MenuItem>Change status</MenuItem>
                    </MenuGroup>
                    <MenuSeparator />
                    <MenuItem>Delete</MenuItem>
                  </MenuContent>
                </Menu>

                <Tooltip>
                  <TooltipTrigger render={<Button variant="ghost">Hover me</Button>} />
                  <TooltipContent>Merged 2 days ago</TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </Section>
        </main>

        <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
          <PaletteBody />
        </CommandDialog>
      </div>
    </div>
  )
}
