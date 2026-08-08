import { createFileRoute } from '@tanstack/react-router'
import { restPhrase } from '@yapm/schema'
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
import { Door } from '@yapm/ui/components/door'
import { How } from '@yapm/ui/components/how'
import { Input } from '@yapm/ui/components/input'
import { IssueRow } from '@yapm/ui/components/issue-row'
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
import { PeekFact, PeekPanel, PeekProvider, PeekTitle, usePeek } from '@yapm/ui/components/peek'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@yapm/ui/components/popover'
import { PRIORITY, type PriorityKind, PriorityMark } from '@yapm/ui/components/priority-mark'
import { ProvenanceMark } from '@yapm/ui/components/provenance-mark'
import {
  buildRealityShape,
  formatReviewAge,
  RealityTrack,
  realityTrackLabel,
  type TrackShape,
} from '@yapm/ui/components/reality-track'
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
import { type CSSProperties, useCallback, useMemo, useState } from 'react'
import { useCommandSource } from '@/frame/command-registry'

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

// The two ends of the vocabulary, drawn on the same row: reality ran ahead of the board (the
// `//` break), and a change that is merged, green and live.
const DIVERGED = {
  pr: 'merged',
  ci: 'passing',
  reviewAgeMs: 86_400_000,
  reviewAgeFrom: 'review',
  deployedAt: null,
} as const
const SHIPPED = {
  pr: 'merged',
  ci: 'passing',
  reviewAgeMs: 3_600_000,
  reviewAgeFrom: 'review',
  deployedAt: 1_759_000_000_000,
} as const

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
          realityTrack={
            <RealityTrack
              shape={buildRealityShape(DIVERGED, { divergence: 'status_behind_merge' })}
              age={formatReviewAge(DIVERGED.reviewAgeMs)}
              label={realityTrackLabel(DIVERGED, 'PR merged but this issue is not marked done')}
            />
          }
        />
        <IssueRow
          issueKey="ENG-138"
          title="Issue row reserves one reality-track slot"
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
          realityTrack={
            <RealityTrack
              shape={buildRealityShape(SHIPPED)}
              age={formatReviewAge(SHIPPED.reviewAgeMs)}
              label={realityTrackLabel(SHIPPED)}
            />
          }
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

// The rail is the same shape the row draws, turned on its side and given a sentence and a mono
// fact per station — one implementation, two axes.
const DELIVERY_RAIL: TrackShape = {
  stations: [
    { id: 'idea', node: 'done', label: 'Idea filed', fact: 'ENG-142 · 6 Jun' },
    { id: 'designed', node: 'done', label: 'Designed', fact: 'figma · 2 revisions' },
    { id: 'built', node: 'done', label: 'Built', fact: 'merged 8f21c4a · 14/14 checks' },
    { id: 'live', node: 'empty-urgent', label: 'Live', fact: 'no deploy carries this commit' },
  ],
  segments: ['solid', 'solid', 'broken'],
  // A rail is never quiet: the page it is drawn on has the change for its subject.
  factless: false,
}

function ShippedPeek() {
  const { open, triggerProps, peekProps } = usePeek<HTMLAnchorElement>('showcase-peek', {
    label: 'ENG-142 — Investigate flaky sync on reconnect',
  })
  return (
    <span className="relative inline-flex">
      <a
        href="#showcase"
        {...triggerProps}
        className="inline-flex items-center gap-1.5 rounded-control px-1.5 py-0.5 font-mono text-[11.5px] text-text-1 hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <StatusGlyph status="in-progress" className="size-[13px]" />
        <Door hot={open}>ENG-142</Door>
      </a>
      {open ? (
        <PeekPanel {...peekProps}>
          <PeekTitle>Investigate flaky sync on reconnect</PeekTitle>
          <div className="mt-2.5">
            <RealityTrack
              shape={buildRealityShape(DIVERGED, { divergence: 'status_behind_merge' })}
              label={realityTrackLabel(
                DIVERGED,
                restPhrase('diverged_behind_merge', 'neutral').text,
              )}
            />
          </div>
          <PeekFact
            phrase={restPhrase('merged_not_deployed', 'neutral').text ?? ''}
            detail={
              <>
                merged 8f21c4a · 14/14 checks
                <ProvenanceMark provider="github" label={null} className="ml-[5px]" />
              </>
            }
          />
        </PeekPanel>
      ) : null}
    </span>
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

  // The showcase registers its demo palette with the frame's one ⌘K owner rather than binding its
  // own listener (design app-frame §D6).
  const openPalette = useCallback(() => {
    setPaletteOpen((open) => !open)
    return true
  }, [])
  useCommandSource(
    'showcase',
    useMemo(() => ({ open: openPalette }), [openPalette]),
  )

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

          <Section title="Reality vocabulary — the rail, the peek, the how, provenance">
            <PeekProvider>
              <div className="flex flex-wrap items-start gap-10">
                <RealityTrack shape={DELIVERY_RAIL} orientation="vertical" label="Delivery" />
                <div className="flex flex-col gap-5">
                  <ShippedPeek />
                  <span className="flex items-baseline gap-2 text-[13px] text-text-2">
                    <b className="font-heading text-[22px] font-semibold text-text-1">3.2d</b>
                    open to merged
                    <How
                      label="open to merged"
                      constraint="12 merged PRs · cycle 24 · team-level only"
                    >
                      Median hours from a pull request opening to the moment it merged, over every
                      PR linked to an issue this team closed in the window.
                    </How>
                  </span>
                  <span className="flex items-center gap-2 text-[13px] text-text-2">
                    yapm/yapm#412 merged
                    <ProvenanceMark provider="github" />
                  </span>
                </div>
              </div>
            </PeekProvider>
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
