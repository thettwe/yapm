// `node --test`, not Vitest, and that is deliberate: CI's `boundary-guard` job runs with no
// `pnpm install` (`.github/workflows/ci.yml` records the two ways giving it a toolchain turned main
// red), so the test for the rule has to run on node builtins alone — the same constraint the rule
// itself lives under.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findViolations } from './boundaries.mjs'

const SCHEMA_FILE = 'packages/schema/src/probe.ts'

function messages(rel, source) {
  return findViolations(rel, source)
}

test('rule 1: a package importing an app is a violation', () => {
  const found = messages('packages/ui/src/components/x.tsx', "import { App } from '@yapm/web'\n")

  assert.equal(found.length, 1)
  assert.match(found[0], /packages\/ui\/src\/components\/x\.tsx/)
  assert.match(found[0], /MUST NOT import from apps/)
})

test('rule 2: a Zero definition import outside packages/schema is a violation', () => {
  const found = messages('apps/web/src/data.ts', "import { defineQuery } from '@rocicorp/zero'\n")

  assert.equal(found.length, 1)
  assert.match(found[0], /apps\/web\/src\/data\.ts/)
  assert.match(found[0], /defineQuery/)
})

test('rule 2: the same import inside packages/schema is allowed', () => {
  assert.deepEqual(
    messages('packages/schema/src/queries.ts', "import { defineQuery } from '@rocicorp/zero'\n"),
    [],
  )
})

// One row per import form the rule has to see. The static `from`/side-effect pair was all the
// original pattern matched; a dynamic `import()` and a `require()` cost the server bundle a chunk
// each and evaded it entirely.
const SCHEMA_VIOLATIONS = [
  ['a side-effect import', "import '@tiptap/core'\n", '@tiptap/*'],
  ['a named import', "import { Editor } from '@tiptap/core'\n", '@tiptap/*'],
  ['a bare prosemirror package', "import { Node } from 'prosemirror-model'\n", 'prosemirror-*'],
  ['a React hook import', "import { useMemo } from 'react'\n", 'react'],
  ['a UI-package subpath import', "export { X } from '@yapm/ui/components/x'\n", '@yapm/ui'],
  ['a dynamic import', "const m = await import('@tiptap/core')\n", '@tiptap/*'],
  ['a require call', "const react = require('react')\n", 'react'],
  [
    'a floating-ui subpath',
    "import { computePosition } from '@floating-ui/dom'\n",
    '@floating-ui/*',
  ],
]

for (const [label, source, spec] of SCHEMA_VIOLATIONS) {
  test(`rule 3: ${label} under packages/schema is a violation`, () => {
    const found = messages(SCHEMA_FILE, source)

    assert.equal(found.length, 1)
    assert.match(found[0], /packages\/schema\/src\/probe\.ts/)
    assert.ok(found[0].includes(`schema imports "${spec}"`), found[0])
    assert.match(found[0], /plaintext\.ts/)
  })
}

test('rule 3: the same imports outside packages/schema are allowed', () => {
  for (const [, source] of SCHEMA_VIOLATIONS) {
    assert.deepEqual(messages('packages/ui/src/lib/markdown.ts', source), [])
  }
})

// Rule 4: the AI substrate's three single-definition guarantees. Each row is (label, source, the
// file that legitimately owns it, a fragment of the expected message).
const SINGLE_DEFINITION_VIOLATIONS = [
  [
    'a second needle builder',
    'export function rosterNameNeedles(roster) {\n  return roster\n}\n',
    'packages/schema/src/zero/ai-content.ts',
    'a second `rosterNameNeedles`',
  ],
  [
    'a second word-boundary name walker',
    `const hit = new RegExp(\`\\\\b\${needle}\\\\b\`, "i").test(text)\n`,
    'packages/schema/src/zero/ai-content.ts',
    'a second word-boundary member-name walker',
  ],
  [
    'a second spend accessor',
    "const total = eb.fn.sum('cycle_digest.estimated_cost_usd')\n",
    'packages/schema/src/db/cycle-digest.ts',
    'a second `sum(estimated_cost_usd)`',
  ],
]

for (const [label, source, owner, fragment] of SINGLE_DEFINITION_VIOLATIONS) {
  test(`rule 4: ${label} elsewhere under packages/schema is a violation`, () => {
    const found = messages(SCHEMA_FILE, source)

    assert.equal(found.length, 1)
    assert.ok(found[0].includes(fragment), found[0])
  })

  test(`rule 4: ${label} in the file that owns it is allowed`, () => {
    assert.deepEqual(messages(owner, source), [])
  })

  test(`rule 4: ${label} outside packages/schema is not this rule's business`, () => {
    assert.deepEqual(messages('apps/server/src/ai/digest.ts', source), [])
  })
}

test('rule 4: re-exporting the needle builder is not a second definition', () => {
  assert.deepEqual(
    messages(SCHEMA_FILE, "export { rosterNameNeedles } from './ai-content.js'\n"),
    [],
  )
})

test('rule 5: the retro-AI server modules may not reach the agent loop', () => {
  for (const file of ['apps/server/src/ai/retro-draft.ts', 'apps/server/src/jobs/retro-draft.ts']) {
    const found = messages(file, "import { runAgent } from './agent.js'\n")

    assert.equal(found.length, 1)
    assert.match(found[0], /structured-output ONLY/)
  }
})

test('rule 5: a comment saying the module never uses runAgent is not a violation', () => {
  assert.deepEqual(
    messages(
      'apps/server/src/ai/retro-draft.ts',
      '// Structured output ONLY: no ToolSet, no activeTools, never runAgent.\n',
    ),
    [],
  )
})

test('rule 5: the cycle digest is not covered by the retro-AI agent ban', () => {
  assert.deepEqual(
    messages('apps/server/src/ai/digest.ts', "import { buildAgentTools } from './tools.js'\n"),
    [],
  )
})

test('a clean schema source produces no violation at all', () => {
  const clean = [
    "import { z } from 'zod'",
    'export function richTextToPlainText(doc) {',
    '  return doc.content.map((n) => n.text ?? "").join("")',
    '}',
    '',
  ].join('\n')

  assert.deepEqual(messages(SCHEMA_FILE, clean), [])
})

test('a word merely ENDING in an import keyword is not a specifier', () => {
  assert.deepEqual(messages(SCHEMA_FILE, "const reimport = fakerequire('react')\n"), [])
})

// Rule 6 — the app frame owns bands 1 and 3. Ten routes each hand-rolled a sticky app header
// before the frame landed, and each copy silently dropped search, digests and the inbox.
test('rule 6: a sticky page-top header outside the frame is a violation', () => {
  const header =
    'export function Page() {\n  return <header className="sticky top-0 z-10 flex" />\n}\n'

  assert.equal(messages('apps/web/src/routes/teams.$teamId.board.tsx', header).length, 1)
  assert.match(
    messages('apps/web/src/routes/teams.$teamId.board.tsx', header)[0],
    /no page hand-rolls chrome/,
  )
  // The frame itself is where that markup belongs, and a test may render one to assert about it.
  assert.deepEqual(messages('apps/web/src/frame/deck.tsx', header), [])
  assert.deepEqual(messages('apps/web/src/issues/issue-list.test.tsx', header), [])
  // A surface's own furniture is not chrome: a sticky group heading inside a scrolling list and a
  // sticky month ruler inside a timeline both stay legal.
  const heading = 'return <h2 className="sticky top-0 z-10 border-b" >{label}</h2>\n'
  assert.deepEqual(messages('apps/web/src/notifications/inbox-view.tsx', heading), [])
  const ruler = 'return <div className="sticky top-0 z-10 flex border-b" />\n'
  assert.deepEqual(messages('apps/web/src/projects/roadmap-view.tsx', ruler), [])
})

// Rule 7 — the e2e isolation contract. The per-test reset lives in the `test` exported by
// `apps/web/e2e/fixtures.ts`, so a spec that imports `test` from the package instead opts out of it
// with nothing going red anywhere: the accumulation comes back and only the next flake reports it.
const SPEC = 'apps/web/e2e/projects.spec.ts'

test('rule 7: an e2e spec importing `test` from @playwright/test is a violation', () => {
  const found = messages(SPEC, "import { expect, test } from '@playwright/test'\n")

  assert.equal(found.length, 1)
  assert.match(found[0], /apps\/web\/e2e\/projects\.spec\.ts/)
  assert.match(found[0], /MUST import `test` from \.\/fixtures/)
})

test('rule 7: aliasing the import does not evade it', () => {
  assert.equal(messages(SPEC, "import { test as base } from '@playwright/test'\n").length, 1)
})

test('rule 7: the shape every migrated spec already has is clean', () => {
  const clean = [
    "import { expect, type Page } from '@playwright/test'",
    "import { test } from './fixtures'",
    '',
    "test('a viewer reads the workspace-level projects', async ({ page, newContext }) => {",
    '  const viewer = await newContext()',
    '})',
    '',
  ].join('\n')

  assert.deepEqual(messages(SPEC, clean), [])
})

test('rule 7: a type-only import of the package is not an opt-out', () => {
  assert.deepEqual(messages(SPEC, "import type { test } from '@playwright/test'\n"), [])
})

test('rule 7: a hand-rolled browser.newContext() in a spec is a violation', () => {
  const found = messages(SPEC, 'const context = await browser.newContext()\n')

  assert.equal(found.length, 1)
  assert.match(found[0], /Failed to find context/)
})

test('rule 7: the fixtures module itself owns both, and is not a spec', () => {
  const fixtures = [
    "import { test as base } from '@playwright/test'",
    'const context = await browser.newContext(options)',
    '',
  ].join('\n')

  assert.deepEqual(messages('apps/web/e2e/fixtures.ts', fixtures), [])
  // Nor is the unit test over the reset's pure helpers, which sits in the same directory.
  assert.deepEqual(messages('apps/web/e2e/order.test.ts', fixtures), [])
})
