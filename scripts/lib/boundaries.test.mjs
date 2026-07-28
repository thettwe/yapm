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
