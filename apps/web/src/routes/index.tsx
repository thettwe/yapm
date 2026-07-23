import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@yapm/ui/components/button'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">yapm</h1>
        <p className="text-muted-foreground text-sm">
          Project management that respects your keyboard.
        </p>
      </header>
      <div className="flex items-center gap-2">
        <Button>Primary action</Button>
        <Button variant="outline">Secondary action</Button>
      </div>
    </main>
  )
}
