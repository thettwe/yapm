import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFound,
})

function RootComponent() {
  return (
    <div className="min-h-full bg-background text-foreground">
      <Outlet />
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
