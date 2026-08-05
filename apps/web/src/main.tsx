import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './routeTree.gen'
import { ThemeProvider } from './theme/provider'
import { ZeroRoot } from './zero/provider'
import { RuntimeConfigGate } from './zero/runtime-config'
import './styles.css'

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('app')
if (rootElement && !rootElement.innerHTML) {
  createRoot(rootElement).render(
    // The gate is ABOVE `ZeroRoot` on purpose: no Zero client exists until the sync origin is
    // known, so none is ever constructed against a placeholder and torn down when the real value
    // arrives.
    <StrictMode>
      <RuntimeConfigGate>
        {(config) => (
          <ZeroRoot cacheUrl={config.zeroCacheUrl}>
            <ThemeProvider>
              <RouterProvider router={router} />
            </ThemeProvider>
          </ZeroRoot>
        )}
      </RuntimeConfigGate>
    </StrictMode>,
  )
}
