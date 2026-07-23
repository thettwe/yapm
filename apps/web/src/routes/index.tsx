import { useQuery } from '@rocicorp/zero/react'
import { createFileRoute } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { ConnectionStatus } from '@/components/connection-status'
import { WorkspaceName } from '@/components/workspace-name'
import { useConnectionSummary } from '@/zero/connection'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const connection = useConnectionSummary()
  const [workspace, result] = useQuery(queries.workspace.current())

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-2">
        {workspace ? (
          <WorkspaceName workspace={workspace} connection={connection} />
        ) : (
          <h1
            className="font-heading text-2xl font-semibold tracking-tight"
            data-testid="workspace-placeholder"
          >
            {result.type === 'complete' ? 'No workspace' : 'Loading workspace…'}
          </h1>
        )}
        <p className="text-muted-foreground text-sm">
          Project management that respects your keyboard.
        </p>
      </header>
      <ConnectionStatus connection={connection} />
    </main>
  )
}
