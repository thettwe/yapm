import type { MutatorResultDetails } from '@rocicorp/zero'
import { useZero } from '@rocicorp/zero/react'
import { mutators } from '@yapm/schema'
import { useEffect, useRef, useState } from 'react'
import type { ConnectionSummary } from '@/zero/connection'

export interface WorkspaceNameProps {
  workspace: { id: string; name: string }
  connection: ConnectionSummary
}

export const OFFLINE_MESSAGE =
  'Not connected — your change is not saved yet. Press Enter again once the connection is back.'

// Only an `app` error is an authoritative rejection of the write. A `zero` error is a
// transport failure — the mutation stays queued and retries on reconnect, and the
// connection indicator already surfaces it, so it must not roll the editor back.
function appError(details: MutatorResultDetails): string | undefined {
  return details.type === 'error' && details.error.type === 'app'
    ? details.error.message
    : undefined
}

export function WorkspaceName({ workspace, connection }: WorkspaceNameProps) {
  const zero = useZero()
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const saving = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const editing = draft !== undefined

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function startEditing() {
    setDraft(workspace.name)
    setError(undefined)
  }

  function cancelEditing() {
    setDraft(undefined)
    setError(undefined)
  }

  async function submit(name: string) {
    if (saving.current) return

    if (!connection.writable) {
      setError(OFFLINE_MESSAGE)
      return
    }

    setError(undefined)
    saving.current = true
    const write = zero.mutate(
      mutators.workspace.rename({ id: workspace.id, name, updatedAt: Date.now() }),
    )

    let clientError: string | undefined
    try {
      clientError = appError(await write.client)
    } finally {
      saving.current = false
    }

    if (clientError !== undefined) {
      setError(clientError)
      return
    }

    setDraft(undefined)
    const serverError = appError(await write.server)
    if (serverError !== undefined) {
      setDraft((current) => current ?? name)
      setError(serverError)
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          className="hover:bg-accent focus-visible:ring-ring -mx-2 rounded-md px-2 py-1 text-left font-heading text-2xl font-semibold tracking-tight focus-visible:ring-2 focus-visible:outline-none"
          onClick={startEditing}
          data-testid="workspace-name"
          aria-label={`Workspace name: ${workspace.name}. Activate to rename.`}
        >
          {workspace.name}
        </button>
        {error === undefined ? null : (
          <p className="text-destructive text-sm" role="alert" data-testid="workspace-error">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(draft)
      }}
    >
      <input
        ref={inputRef}
        className="border-input focus-visible:ring-ring -mx-2 rounded-md border px-2 py-1 font-heading text-2xl font-semibold tracking-tight focus-visible:ring-2 focus-visible:outline-none"
        value={draft}
        aria-label="Workspace name"
        data-testid="workspace-name-input"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelEditing()
          }
        }}
      />
      {error === undefined ? null : (
        <p className="text-destructive text-sm" role="alert" data-testid="workspace-error">
          {error}
        </p>
      )}
    </form>
  )
}
