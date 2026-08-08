import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// Testing Library's 1s default assumes a browser holding a pre-built bundle. These suites run under
// vite-node, where a `findBy*` on a router-mounted surface is also waiting on a route chunk being
// transformed and evaluated for the first time — `autoCodeSplitting` applies in test mode too. That
// is ~100-200ms on a developer's machine and seconds on CI's runner, which is an order of magnitude
// slower. The budget is for a module load, not for an assertion: nothing here waits on a network or
// a query, and a longer wait cannot turn a wrong answer into a right one.
configure({ asyncUtilTimeout: 5_000 })
