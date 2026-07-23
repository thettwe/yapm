import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useSession } from '@/auth/client'
import { LoginForm } from '@/components/auth/login-form'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const { data: session, isPending } = useSession()

  if (isPending) {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <p className="text-muted-foreground text-sm" role="status">
          Loading…
        </p>
      </main>
    )
  }

  if (session) {
    return <Navigate to="/" />
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <LoginForm />
    </main>
  )
}
