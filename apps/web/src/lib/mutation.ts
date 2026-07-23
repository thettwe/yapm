import type { MutatorResult, MutatorResultDetails } from '@rocicorp/zero'

// Only an `app` error is an authoritative rejection. A `zero` error is a transport failure:
// the mutation stays queued and retries on reconnect, so it must not surface as a hard
// failure — the connection indicator already reflects it.
function appError(details: MutatorResultDetails): string | undefined {
  return details.type === 'error' && details.error.type === 'app'
    ? details.error.message
    : undefined
}

// Await both the optimistic (client) apply and the authoritative (server) apply, returning
// the first app-level rejection message, or undefined when the write is accepted.
export async function runMutation(write: MutatorResult): Promise<string | undefined> {
  const clientError = appError(await write.client)
  if (clientError !== undefined) return clientError
  return appError(await write.server)
}
