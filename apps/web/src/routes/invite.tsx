import { createFileRoute } from '@tanstack/react-router'
import { InvitePage } from '@/components/auth/invite-page'

interface InviteSearch {
  token?: string
}

export const Route = createFileRoute('/invite')({
  component: InviteRoute,
  validateSearch: (search: Record<string, unknown>): InviteSearch =>
    typeof search.token === 'string' ? { token: search.token } : {},
})

function InviteRoute() {
  const { token } = Route.useSearch()

  return <InvitePage {...(token === undefined ? {} : { token })} />
}
