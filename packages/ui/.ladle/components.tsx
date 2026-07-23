import { type ReactNode, useEffect } from 'react'
import '../src/styles/globals.css'

interface LadleProviderProps {
  globalState: { theme: string }
  children: ReactNode
}

export const Provider = ({ children, globalState }: LadleProviderProps) => {
  const dark = globalState.theme === 'dark'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  return <div className="bg-background text-foreground p-6">{children}</div>
}
