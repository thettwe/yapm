import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@yapm/ui/components/command-palette'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

// THE ONE ⌘K OWNER. The deck advertises ⌘K on every page, so an affordance that does nothing on
// most of them is a lie this design forbids — and four independent `window.addEventListener`
// handlers is how it stayed a lie.
//
// This provider mounts above the frame in `routes/__root.tsx` and owns the single keydown listener.
// A surface REGISTERS rather than binds:
//
//   - `open`  — a surface with its own palette (issues, board, retros, the showcase) hands over the
//               opener it already had. The most recently mounted one wins, because it is the one
//               closest to what the reader is looking at.
//   - `groups`— a surface with plain commands hands over rows; with no `open` registered anywhere,
//               ⌘K opens THIS palette over the union of them.
//
// It is a registration refactor, not a redesign of palette contents: every command reachable before
// is reachable after, and every non-⌘K surface shortcut is untouched.

export interface FrameCommand {
  readonly id: string
  readonly label: string
  readonly shortcut?: string
  readonly onSelect: () => void
}

export interface FrameCommandGroup {
  readonly id: string
  readonly heading: string
  readonly commands: readonly FrameCommand[]
}

export interface CommandSource {
  readonly open?: () => void
  readonly groups?: readonly FrameCommandGroup[]
}

interface Registry {
  readonly register: (id: string, source: CommandSource) => void
  readonly unregister: (id: string) => void
  readonly openPalette: () => void
}

const RegistryContext = createContext<Registry | null>(null)

// Registration is inert without a provider — a surface rendered in isolation (a story, a focused
// unit test) must not throw for wanting to offer commands. Callers pass a stable `open` and stable
// `groups`; an unstable one would re-register on every render.
export function useCommandSource(id: string, source: CommandSource): void {
  const registry = useContext(RegistryContext)
  const { open, groups } = source

  useEffect(() => {
    if (registry === null) return
    registry.register(id, {
      ...(open === undefined ? {} : { open }),
      ...(groups === undefined ? {} : { groups }),
    })
    return () => registry.unregister(id)
  }, [registry, id, open, groups])
}

export function useCommandPalette(): { open: () => void } {
  const registry = useContext(RegistryContext)
  return useMemo(() => ({ open: () => registry?.openPalette() }), [registry])
}

export function CommandRegistryProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<readonly (readonly [string, CommandSource])[]>([])
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources

  const register = useCallback((id: string, source: CommandSource) => {
    setSources((previous) => {
      const without = previous.filter(([key]) => key !== id)
      return [...without, [id, source] as const]
    })
  }, [])

  const unregister = useCallback((id: string) => {
    setSources((previous) => previous.filter(([key]) => key !== id))
  }, [])

  const openPalette = useCallback(() => {
    // The surface closest to what the reader is looking at mounted last, so it answers ⌘K.
    for (let index = sourcesRef.current.length - 1; index >= 0; index -= 1) {
      const surfaceOpen = sourcesRef.current[index]?.[1].open
      if (surfaceOpen !== undefined) {
        surfaceOpen()
        return
      }
    }
    setSearch('')
    setOpen(true)
  }, [])

  const registry = useMemo<Registry>(
    () => ({ register, unregister, openPalette }),
    [register, unregister, openPalette],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      openPalette()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openPalette])

  const groups = useMemo(() => sources.flatMap(([, source]) => source.groups ?? []), [sources])

  return (
    <RegistryContext.Provider value={registry}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        label="Command palette"
        data-testid="frame-palette"
      >
        <CommandInput
          placeholder="Type a command or search…"
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.id} heading={group.heading}>
              {group.commands.map((command) => (
                <CommandItem
                  key={command.id}
                  value={`${command.label} ${command.id}`}
                  onSelect={() => {
                    setOpen(false)
                    command.onSelect()
                  }}
                >
                  {command.label}
                  {command.shortcut === undefined ? null : (
                    <CommandShortcut>{command.shortcut}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
        <CommandFooter>
          <span>↑↓ to navigate</span>
          <span>↵ to select</span>
          <span>esc to close</span>
          <span className="ml-auto font-bold text-text-3">yapm</span>
        </CommandFooter>
      </CommandDialog>
    </RegistryContext.Provider>
  )
}
