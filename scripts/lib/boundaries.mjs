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

/**
 * @param rel POSIX-separated repo-relative path of the file.
 * @param source Its full text.
 * @returns One message per violation, each naming the file.
 */
export function findViolations(rel, source) {
  const violations = []

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

  if (inSchema(rel)) {
    for (const spec of SCHEMA_FORBIDDEN_IMPORTS) {
      if (specifierPattern(spec).test(source)) {
        violations.push(`${rel}: schema imports "${spec}" — ${SCHEMA_VIOLATION_REASON}`)
      }
    }
  }

  return violations
}
