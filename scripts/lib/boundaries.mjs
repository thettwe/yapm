// The three boundary rules as one pure function over (path, source), so the patterns that decide
// whether CI goes red are reachable from a test instead of only from a scratch file somebody once
// ran by hand. `scripts/lib/boundaries.test.mjs` is that test.
//
// Node builtins only, and nothing imported from the workspace: CI's `boundary-guard` job runs this
// with no `pnpm install` at all (see `.github/workflows/ci.yml` for why every attempt to give that
// job a toolchain has failed it). A workspace dependency here breaks that job.

export const APP_PACKAGES = ['@yapm/web', '@yapm/server', '@yapm/docs']

export const ZERO_DEFINITION_NAMES = [
  'createSchema',
  'createBuilder',
  'table',
  'defineQuery',
  'defineQueries',
  'defineMutator',
  'defineMutators',
]

// CLAUDE.md #3, "packages/schema has no UI dependencies", was a doc-level rule with nothing behind
// it until this list existed. `apps/server` imports `@yapm/schema`, so any one of these in a schema
// file quietly drags an editor's worth of graph into the server bundle — a bigger image nobody
// attributes to the change that caused it, and something lint, typecheck and build all pass.
export const SCHEMA_FORBIDDEN_IMPORTS = [
  '@tiptap/*',
  'prosemirror-*',
  '@yapm/ui',
  'react',
  'react-dom',
  '@base-ui/react',
  'lucide-react',
  '@floating-ui/*',
]

const SCHEMA_VIOLATION_REASON =
  'packages/schema MUST NOT depend on the UI. apps/server imports @yapm/schema, so a TipTap, React or ProseMirror import here ships an editor to the server. See packages/schema/src/rich-text/plaintext.ts: it imports NOTHING, and that is why a rich-text walk is allowed to live in schema at all. The markdown serialiser lives in packages/ui/src/lib/markdown.ts for this reason.'

/**
 * Matches every way a module specifier can be named: `from 'pkg'`, a side-effect `import 'pkg'`,
 * a dynamic `import('pkg')` and a `require('pkg')`. A side-effect import of an editor package costs
 * the server bundle exactly as much as a named one, and a dynamic one costs it a chunk — the whole
 * point of the rule is bundle weight, and every form carries it.
 */
function specifierPattern(spec) {
  // A trailing `*` is the wildcard, wherever it sits: `@tiptap/*` is a scope and `prosemirror-*` is
  // a name prefix, and the bare `prosemirror-model`/`prosemirror-view` packages are exactly the ones
  // a schema file would reach for without going through `@tiptap/pm`.
  const wildcard = spec.endsWith('*')
  const base = wildcard ? spec.slice(0, -1) : spec
  const tail = wildcard ? '[^\'"]*' : '(?:/[^\'"]*)?'
  return new RegExp(`\\b(?:from|import|require)\\s*\\(?\\s*['"]${base}${tail}['"]`)
}

function inPackages(rel) {
  return rel.startsWith('packages/')
}

function inSchema(rel) {
  return rel.startsWith('packages/schema/')
}

// Rule 4, the AI-substrate single-definition rule (`SCOPE-ai-features.md` §1). Each of these three
// exists EXACTLY ONCE under `packages/schema/src`, and a second copy is the failure mode the rule
// exists to catch:
//   - a second `rosterNameNeedles` or a second word-boundary member-name walker means the blameless
//     guarantee is enforced in two places and drifts in one of them;
//   - a second `sum('estimated_cost_usd')` means one of them will miss an artifact table, and a
//     spend cap that misses a table under-fires silently on someone else's BYO key.
// The check is a definition check, not a usage check: importing or re-exporting these is the point.
const SINGLE_DEFINITION_RULES = [
  {
    // `export function rosterNameNeedles(` — a re-export (`export { rosterNameNeedles } from`) is
    // deliberately not matched.
    pattern: /\b(?:export\s+)?(?:async\s+)?function\s+rosterNameNeedles\b/,
    owner: 'packages/schema/src/zero/ai-content.ts',
    reason:
      'a second `rosterNameNeedles`. The needle builder is defined ONCE, in packages/schema/src/zero/ai-content.ts — import it',
  },
  {
    // The word-boundary name walker: a `new RegExp` with a `\b...\b` body. One implementation,
    // beside the needles it consumes.
    pattern: /new RegExp\(\s*[`'"]\\\\b/,
    owner: 'packages/schema/src/zero/ai-content.ts',
    reason:
      'a second word-boundary member-name walker. There is ONE, in packages/schema/src/zero/ai-content.ts — adapt your artifact onto `AiArtifact` and reuse `dropAiItemsNamingMembers`',
  },
  {
    pattern: /sum\(\s*['"][\w.]*estimated_cost_usd['"]\s*\)/,
    owner: 'packages/schema/src/db/cycle-digest.ts',
    reason:
      'a second `sum(estimated_cost_usd)`. The workspace spend total is ONE accessor — `getWorkspaceAiSpendUsd` in packages/schema/src/db/cycle-digest.ts — and it must union EVERY AI artifact table, or a spend cap silently under-fires',
  },
]

// Rule 5. The retro-AI server modules are structured-output only: `generateStructured`, no tools,
// no agent loop. That is what makes "the worst case is a bad paragraph, never a bad action or a
// leak" true for this shape, and it is a grep rather than a convention because an agent import is
// one autocomplete away.
const NO_AGENT_FILES = ['apps/server/src/ai/retro-draft.ts', 'apps/server/src/jobs/retro-draft.ts']
const AGENT_SYMBOLS = ['buildAgentTools', 'runAgent']

// Rule 6, the app frame's chrome rule (`openspec/changes/app-frame` §D7). Bands 1 and 3 belong to
// `apps/web/src/frame/`; the page owns band 2 and adapts it. Before this change ten routes each
// hand-rolled a copy of the app header — and each copy silently dropped search, digests and the
// inbox. A sticky `<header>` outside the frame is that duplication starting again.
//
// A `<header>` specifically: a sticky group heading inside a scrolling list, or a sticky month
// ruler inside a timeline, is a surface's own furniture and not chrome.
const CHROME_OWNER_PREFIX = 'apps/web/src/frame/'
// The component gallery is a dev-only surface that deliberately sits OUTSIDE the frame — it renders
// primitives against three themes, which the app's own chrome would fight.
const CHROME_EXEMPT = ['apps/web/src/routes/showcase.tsx']
const STICKY_HEADER = /<header[^>]*className=(?:"|\{`|')[^"`']*\bsticky\s+top-0\b/

// Rule 7, the e2e isolation contract (`apps/web/e2e/README.md`, `openspec/changes/e2e-isolation`).
// Every Playwright spec gets its per-test reset from the `test` exported by
// `apps/web/e2e/fixtures.ts`. A spec that takes `test` from `@playwright/test` instead runs with no
// reset at all: it sees the previous test's rows and quietly reintroduces the accumulation the
// contract exists to remove, and nothing anywhere goes red — the isolation is unobservable from
// inside a spec that opted out of it. The same file shape also bans a hand-rolled
// `browser.newContext()`, whose `finally { close() }` races Playwright's teardown when a test times
// out and reports a protocol error over the real failure.
const E2E_SPEC = /^apps\/web\/e2e\/[^/]+\.spec\.ts$/
const PLAYWRIGHT_IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]@playwright\/test['"]/g
const MANUAL_CONTEXT = /\bbrowser\s*\.\s*newContext\s*\(/

function importsPlaywrightTest(source) {
  for (const match of source.matchAll(PLAYWRIGHT_IMPORT)) {
    // `import type { … }` names no runtime binding, so it cannot be the `test` a spec runs with.
    if (match[1]) continue
    const named = match[2].split(',').map((name) =>
      name
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        .trim(),
    )
    // Pre-alias: `import { test as base }` in a spec is the same opt-out with a different name.
    if (named.includes('test')) return true
  }
  return false
}

/**
 * @param rel POSIX-separated repo-relative path of the file.
 * @param source Its full text.
 * @returns One message per violation, each naming the file.
 */
export function findViolations(rel, source) {
  const violations = []

  if (inSchema(rel)) {
    for (const rule of SINGLE_DEFINITION_RULES) {
      if (rel === rule.owner) continue
      if (rule.pattern.test(source)) violations.push(`${rel}: ${rule.reason}`)
    }
  }

  if (NO_AGENT_FILES.includes(rel)) {
    // Imported, not merely mentioned: these files DOCUMENT that they never reach the agent loop, and
    // a comment saying so must not fail the rule that enforces it. Every import form counts.
    const imported = new Set(
      [...source.matchAll(/(?:import|export)\s*(?:type\s*)?\{([^}]*)\}/g)].flatMap((match) =>
        match[1].split(',').map((name) =>
          name
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)[0]
            .trim(),
        ),
      ),
    )
    for (const symbol of AGENT_SYMBOLS) {
      if (imported.has(symbol)) {
        violations.push(
          `${rel}: imports "${symbol}" — the retro AI draft is structured-output ONLY (no tools, no agent loop, no outbound egress)`,
        )
      }
    }
  }

  if (inPackages(rel)) {
    for (const app of APP_PACKAGES) {
      if (new RegExp(`from ['"]${app}(/[^'"]*)?['"]`).test(source)) {
        violations.push(
          `${rel}: package imports from app "${app}" — packages MUST NOT import from apps`,
        )
      }
    }
  }

  if (!inSchema(rel)) {
    const imports = source.matchAll(
      /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@rocicorp\/zero['"]/g,
    )
    for (const match of imports) {
      const named = match[1].split(',').map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      const banned = named.filter((n) => ZERO_DEFINITION_NAMES.includes(n))
      if (banned.length > 0) {
        violations.push(
          `${rel}: imports Zero definition API {${banned.join(', ')}} — all ZQL and mutators MUST be defined in packages/schema`,
        )
      }
    }
  }

  if (
    rel.startsWith('apps/web/src/') &&
    !rel.startsWith(CHROME_OWNER_PREFIX) &&
    !CHROME_EXEMPT.includes(rel) &&
    !/\.(test|stories)\.tsx?$/.test(rel) &&
    STICKY_HEADER.test(source)
  ) {
    violations.push(
      `${rel}: a \`sticky top-0\` header outside ${CHROME_OWNER_PREFIX} — bands 1 and 3 are the frame's; no page hand-rolls chrome`,
    )
  }

  if (inSchema(rel)) {
    for (const spec of SCHEMA_FORBIDDEN_IMPORTS) {
      if (specifierPattern(spec).test(source)) {
        violations.push(`${rel}: schema imports "${spec}" — ${SCHEMA_VIOLATION_REASON}`)
      }
    }
  }

  if (E2E_SPEC.test(rel)) {
    if (importsPlaywrightTest(source)) {
      violations.push(
        `${rel}: imports "test" from @playwright/test — every e2e spec MUST import \`test\` from ./fixtures, which is what runs the per-test reset to the bootstrapped baseline (expect and the types still come from @playwright/test). See apps/web/e2e/fixtures.ts`,
      )
    }
    if (MANUAL_CONTEXT.test(source)) {
      violations.push(
        `${rel}: calls browser.newContext() by hand — take the \`newContext\` fixture instead, so Playwright owns the teardown and a timing-out test reports its real failure rather than "Failed to find context". See apps/web/e2e/fixtures.ts`,
      )
    }
  }

  return violations
}
