export const meta = {
  name: 'docs-change-flow',
  description:
    'Land a documentation / spec-only change: do the work, prove it touched no product code, run the docs gates, and push. No Docker, no e2e, no multi-lens review.',
  phases: [
    { title: 'Write', detail: 'do the documentation or spec work' },
    { title: 'Verify', detail: 'prove it is docs-only, then run the cheap gates' },
    { title: 'Land', detail: 'commit and push' },
  ],
}

// The lightweight path. change-build-flow exists for changes that ship product code: it plans stages
// from tasks.md, builds behind verifiers, boots Docker once, runs the full Playwright suite, and hands
// off to a three-lens review. Running a markdown edit through that machinery would boot Postgres to
// verify prose — the same over-verification the build flow was rewritten to remove, just relocated.
//
// This flow is the other half. It is cheap ON PURPOSE, which means its integrity rests entirely on one
// guarantee: THE CHANGE REALLY IS DOCS-ONLY. If product code can slip through here, this stops being a
// lightweight path and becomes a way around review. The Verify phase therefore classifies every changed
// file against the deny list below and REFUSES rather than proceeding — that check is the whole reason
// this flow is allowed to skip everything else.

// args: { title, mission, repoDir, base, landOn, allowTooling }
const A = args || {}
const REPO = A.repoDir || '/Users/thettwe/Works/yapm'
const BASE = A.base || 'main'
const LAND_ON = A.landOn || 'main' // 'main' | 'pr'
const TITLE = A.title

if (!TITLE) throw new Error('docs-change-flow requires args.title')
if (!A.mission) throw new Error('docs-change-flow requires args.mission')

// Touching any of these means the change can alter runtime behaviour, and it belongs in
// change-build-flow instead. Deliberately broad: a false refusal costs one re-route, a false pass
// ships unreviewed product code.
const DENY = [
  'apps/web/src/**',
  'apps/server/src/**',
  'packages/*/src/**',
  '**/migrations/**',
  'package.json',
  '*/package.json',
  '**/package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'turbo.json',
  'biome.json',
  'tsconfig*.json',
  'docker/**',
  '.github/workflows/**',
  '.env.example',
]

// Documentation, specs, and the design-history screenshots. apps/docs is allowed wholesale — its
// astro.config.mjs is how a sidebar entry is registered, which is documentation work.
const ALLOW = [
  '**/*.md',
  '**/*.mdx',
  'apps/docs/**',
  'openspec/**',
  'design-explorations/**',
  ...(A.allowTooling ? ['.claude/**'] : []),
]

const CONTEXT =
  `Repository: ${REPO} (base ${BASE}). Task: ${TITLE}.\n` +
  `Read ${REPO}/CLAUDE.md, ${REPO}/PROCESS.md (especially §1 spec-driven and §2 docs-as-DoD), ` +
  `${REPO}/VISION.md and ${REPO}/DESIGN.md before writing anything.\n\n` +
  `## This is the DOCS-ONLY path\n` +
  `It skips Docker, the Playwright suite, the full build, and the three-lens review, because none of ` +
  `those can tell you anything about prose. That is only sound while the change genuinely ships no ` +
  `product code. If the work turns out to need a code change — even a small one — STOP and say so ` +
  `rather than making it here. Being re-routed to the build flow costs minutes; slipping code through ` +
  `an unreviewed path costs more.\n` +
  `Allowed: ${ALLOW.join(', ')}\n` +
  `Refused: ${DENY.join(', ')}\n\n` +
  `## Style\n` +
  `Match the surrounding voice — plain, specific, no marketing superlatives. Documentation states what ` +
  `the system does and does not do; a promise the code cannot keep is a bug in the docs. Conventional ` +
  `Commits with DCO sign-off (git commit -s).`

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    docsOnly: { type: 'boolean', description: 'false if ANY changed path matches the deny list' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    offendingFiles: { type: 'array', items: { type: 'string' }, description: 'deny-list matches; empty when clean' },
    passed: { type: 'boolean' },
    ranCommands: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['docsOnly', 'changedFiles', 'offendingFiles', 'passed', 'ranCommands', 'failures', 'notes'],
  additionalProperties: false,
}

phase('Write')
const written = await agent(
  `${CONTEXT}\n\n## YOUR ASSIGNMENT\n${A.mission}\n\n` +
    `Do the work. Do NOT commit — an independent verifier runs next.\n` +
    `If you find that the task cannot be completed without touching product code, do not attempt it: ` +
    `report exactly which file and why, and stop.`,
  { label: 'write:docs', phase: 'Write', effort: 'high' },
)

phase('Verify')
const v = await agent(
  `${CONTEXT}\n\nYou are the INDEPENDENT verifier. The writer reported:\n${String(written).slice(0, 2500)}\n\n` +
    `## 1. The gate that matters — prove this is docs-only\n` +
    `Run \`git -C ${REPO} status --porcelain\` and \`git -C ${REPO} diff --stat\`, list EVERY changed and ` +
    `untracked path, and classify each one. Set docsOnly=false and list them in offendingFiles if any path ` +
    `matches the deny list:\n${DENY.map((d) => `  - ${d}`).join('\n')}\n` +
    `Be strict and literal. A changed \`.env.example\` is a config-contract change; a changed migration or ` +
    `anything under a package's \`src/\` is product code. Any of those means this flow is the wrong tool — ` +
    `set passed=false, say so plainly, and do NOT commit. This check is the only thing that justifies ` +
    `skipping the rest of the process, so do not soften it.\n\n` +
    `## 2. Then the cheap gates\n` +
    `- If anything under apps/docs changed: \`pnpm --filter @yapm/docs build\` must pass and the new or ` +
    `edited pages must appear in the output. Confirm any new page is reachable from the sidebar.\n` +
    `- If anything under openspec/changes/ changed: ` +
    `\`npx -y @fission-ai/openspec@latest validate <change>\` (positional, NOT --change) must pass for each.\n` +
    `- \`pnpm lint\` must pass.\n` +
    `- Do NOT run turbo build, the test suite, Docker, or Playwright. They cannot observe prose, and ` +
    `running them here is the waste this flow exists to avoid.\n\n` +
    `## 3. Read the content, not just the gates\n` +
    `A green docs build proves the site compiles, not that it is true. Check the claims against the ` +
    `repository: does a documented flag exist, does a described behaviour match the code, does a ROADMAP ` +
    `status match what actually shipped? A doc that states something the code does not do is a defect, and ` +
    `it is the only kind of defect this flow can catch.\n\n` +
    `Report concrete failures; do not paper over a partial result.`,
  { label: 'verify:docs-only', phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'high' },
)

if (!v) throw new Error('docs-change-flow: verifier returned nothing')

if (!v.docsOnly) {
  log(`REFUSED — not a docs-only change. Product code touched: ${v.offendingFiles.join(', ')}`)
  return {
    landed: false,
    refused: true,
    reason: 'Change touches product code; it belongs in change-build-flow, not the docs path.',
    offendingFiles: v.offendingFiles,
    changedFiles: v.changedFiles,
  }
}
if (!v.passed) {
  log(`Gates failed: ${v.failures.join('; ')}`)
  return { landed: false, refused: false, reason: 'Docs gates failed', failures: v.failures, changedFiles: v.changedFiles }
}
log(`Docs-only confirmed (${v.changedFiles.length} files), gates green`)

phase('Land')
const landed = await agent(
  `${CONTEXT}\n\n## Land it\nThe change is verified docs-only and its gates are green. Changed files:\n` +
    v.changedFiles.map((f) => `  - ${f}`).join('\n') +
    `\n\n` +
    (LAND_ON === 'pr'
      ? `Open a PR: create a branch, commit, push, and \`gh pr create --base ${BASE}\`. Then wait for CI ` +
        `(\`gh pr checks --watch\`) and merge with \`gh pr merge --squash\` once green.\n`
      : `Commit and push directly to ${BASE}. This matches the established precedent for documentation and ` +
        `tooling commits (d906247, 996de4e, dcad64a, 6b84ad0) — PROCESS.md §1 exempts changes that ship no ` +
        `behaviour from the full ceremony.\n` +
        `\`git add -A && git commit -s\` with a Conventional Commit message, then \`git push origin ${BASE}\`. ` +
        `If the push is rejected because ${BASE} moved, \`git pull --rebase\` and push again.\n`) +
    `\nNote that pushing still triggers the full CI workflow, including the e2e and compose-smoke jobs, ` +
    `even though nothing they exercise has changed. Do not wait on them and do not treat them as this ` +
    `change's gate — but DO report if any turns red, because that would mean something unexpected moved.\n\n` +
    `Report: the commit SHA, what landed, and anything you noticed that should follow up.`,
  { label: 'land:push', phase: 'Land', effort: 'medium' },
)

return { landed: true, refused: false, changedFiles: v.changedFiles, notes: v.notes, report: landed }
