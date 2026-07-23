import { Button } from '@yapm/ui/components/button'
import { MailQuestionIcon } from 'lucide-react'
import { useSignOut } from '@/auth/use-sign-out'

// An authenticated user with no membership sees this instead of a blank or denied app:
// they can authenticate but need an invitation to be granted access.
export function AccessGate({ email }: { email?: string }) {
  const signOut = useSignOut()

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <section
        className="bg-card flex w-full max-w-md flex-col items-center gap-4 rounded-xl border p-8 text-center shadow-sm"
        aria-labelledby="access-gate-heading"
      >
        <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
          <MailQuestionIcon className="size-6" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1
            id="access-gate-heading"
            className="font-heading text-xl font-semibold tracking-tight"
          >
            You need an invitation
          </h1>
          <p className="text-muted-foreground text-sm">
            {email ? `You're signed in as ${email}, but ` : 'You are signed in, but '}
            this workspace hasn't granted you access yet. Ask an admin for an invite link, then open
            it while signed in.
          </p>
        </div>
        <Button variant="outline" size="lg" onClick={signOut.signOut} disabled={signOut.busy}>
          Sign out
        </Button>
      </section>
    </main>
  )
}
