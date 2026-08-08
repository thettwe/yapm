import { createRootRoute, Outlet } from '@tanstack/react-router'
import { CommandRegistryProvider } from '@/frame/command-registry'

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFound,
})

// The command registry mounts ABOVE the frame, because it owns the one ⌘K binding in the product
// and the deck advertises that binding on every page.
function RootComponent() {
  return (
    <div className="min-h-full bg-background text-foreground">
      <CommandRegistryProvider>
        <Outlet />
      </CommandRegistryProvider>
    </div>
  )
}

function NotFound() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Not found</h1>
    </main>
  )
}
