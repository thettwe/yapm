export const meta = {
  name: 'pr-review-flow',
  description: 'Open a PR for a feature branch, then autonomously multi-lens review, adversarially confirm findings, fix ALL confirmed findings (critical→low), loop until dry, and merge only when clean and gates are green.',
  phases: [
    { title: 'Open', detail: 'push branch, open PR to base' },
    { title: 'Review', detail: 'parallel multi-lens review of the diff' },
    { title: 'Confirm', detail: 'adversarially confirm/refute each finding' },
    { title: 'Fix', detail: 'apply every confirmed fix, run gates, commit' },
    { title: 'Merge', detail: 'dry + gates green → approve + squash-merge' },
  ],
}

// args: { branch, base, changeName, prTitle, prBody, repoDir }
const A = args || {}
const REPO = A.repoDir || '/Users/thettwe/Works/yapm'
const BRANCH = A.branch
const BASE = A.base || 'main'
const CHANGE = A.changeName || BRANCH
const MAX_ROUNDS = 4

if (!BRANCH) throw new Error('pr-review-flow requires args.branch')

const CONTEXT = `Repository: ${REPO} (branch \`${BRANCH}\` → \`${BASE}\`), change: ${CHANGE}.\n` +
  `Read ${REPO}/CLAUDE.md (the ten non-negotiable constraints), ${REPO}/VISION.md, ${REPO}/DESIGN.md, the change's ` +
  `specs under ${REPO}/openspec/changes/${CHANGE}/specs/ (its acceptance criteria), and the verified API notes under ` +
  `${REPO}/reference/. Review the actual diff: \`git -C ${REPO} diff ${BASE}...${BRANCH}\`.\n` +
  `yapm hard constraints a reviewer MUST check: exactly 3 containers (no new services); all ZQL + mutators only in ` +
  `packages/schema (client+server share the mutator); client-minted UUIDv7 at the mutator call site (never inside a ` +
  `mutator body — rebase-unsafe); row-level permissions deny by empty query and check auth before existence; kysely ` +
  `0.28.17, no kysely-codegen, no baseUrl, no TS-Compiler-API tools; every color/font via tokens (no hardcoded values); ` +
  `keyboard-first + works in all 3 themes light+dark; free means free (no seat caps / SSO tax / feature gates); ` +
  `team-level metrics only.`

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string', description: 'concrete inputs/state → wrong outcome; empty if not a bug' },
          suggested_fix: { type: 'string' },
        },
        required: ['severity', 'category', 'file', 'summary', 'suggested_fix'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    confirmed: { type: 'boolean', description: 'true only if the finding is a real defect against yapm standards' },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    reason: { type: 'string' },
    corrected_fix: { type: 'string', description: 'the fix to apply, corrected if the original was wrong' },
  },
  required: ['confirmed', 'severity', 'reason', 'corrected_fix'],
  additionalProperties: false,
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    gatesGreen: { type: 'boolean' },
    fixed: { type: 'array', items: { type: 'string' } },
    unfixable: {
      type: 'array',
      items: {
        type: 'object',
        properties: { summary: { type: 'string' }, reason: { type: 'string' } },
        required: ['summary', 'reason'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string' },
  },
  required: ['gatesGreen', 'fixed', 'unfixable', 'notes'],
  additionalProperties: false,
}

const LENSES = [
  { key: 'correctness', prompt: 'logic/correctness bugs and edge cases. For each, give a concrete failure scenario (inputs/state → wrong output). Optimistic-mutation/rebase hazards, sync convergence, null/empty handling.' },
  { key: 'security', prompt: 'security: authorization gaps, the row-level permission model, secret handling/encryption, injection, auth-before-existence, whether an agent/user could exceed their role.' },
  { key: 'constraints', prompt: 'yapm architectural constraints (the CLAUDE.md list): 3-container promise, ZQL/mutators only in packages/schema, client-minted UUIDv7 at the call site, kysely pin, no baseUrl, no TS-Compiler-API tools, no hardcoded colors/fonts.' },
  { key: 'tests', prompt: 'test coverage vs the big-feature rule (unit+integration+e2e when a change touches ≥2 of {entity, mutator, permission surface, signature UI}). Do tests assert real behavior and can they fail? Missing integration permission-scoping or e2e keyboard/sync/offline coverage.' },
  { key: 'perf', prompt: 'performance: the sub-100ms budget, N+1 or unscoped queries, unnecessary re-renders, sync/query inefficiency, oversized client bundles.' },
  { key: 'a11y', prompt: 'accessibility + keyboard-first: full keyboard operability, focus management, ARIA, contrast (AA in light+dark).' },
  { key: 'design', prompt: 'design fidelity vs DESIGN.md/Warm and correctness across all 3 themes in light+dark; tokenized styling only.' },
  { key: 'docs', prompt: 'documentation-per-change: did it ship the user-facing docs for what it adds and update the architecture/config/API docs it touches? Env vars documented and matching the Zod schema?' },
]

function fkey(f) { return `${(f.file || '').trim()}::${(f.category || '').trim().toLowerCase()}::${(f.summary || '').trim().slice(0, 80).toLowerCase()}` }

phase('Open')
const opened = await agent(
  `${CONTEXT}\n\nOpen a pull request for this change. Steps in ${REPO}:\n` +
  `1. Ensure branch \`${BRANCH}\` is pushed: \`git push -u origin ${BRANCH}\`.\n` +
  `2. Open a PR to \`${BASE}\` with \`gh pr create --base ${BASE} --head ${BRANCH} --title ${JSON.stringify(A.prTitle || CHANGE)} ` +
  `--body\` describing what the change adds (summarize from openspec/changes/${CHANGE}/proposal.md). If a PR already exists, reuse it.\n` +
  `3. Print the PR number and \`git diff --stat ${BASE}...${BRANCH}\`.\n\nFinal message: the PR number and the diffstat.`,
  { label: 'open:pr', phase: 'Open', effort: 'medium' },
)
log(`PR opened: ${String(opened).slice(0, 140)}`)

const stuck = new Map()
let dry = false
let round = 0
for (round = 1; round <= MAX_ROUNDS; round++) {
  phase('Review')
  const reviews = await parallel(LENSES.map((l) => () =>
    agent(
      `${CONTEXT}\n\nYou are the **${l.key}** reviewer (round ${round}). Review ONLY through this lens: ${l.prompt}\n` +
      `Report real defects against yapm's standards and the change's specs. Rank each critical/high/medium/low. Be ` +
      `precise (file + line + a concrete failure scenario where applicable) and propose a specific fix. Do not invent ` +
      `issues to seem thorough; an empty findings list is fine if the code is clean on this lens.`,
      { label: `review:${l.key}:r${round}`, phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' },
    )
  ))
  const all = reviews.filter(Boolean).flatMap((r) => r.findings || [])
  const uniq = [...new Map(all.map((f) => [fkey(f), f])).values()]
  log(`Round ${round}: ${all.length} raw findings → ${uniq.length} unique`)
  if (uniq.length === 0) { dry = true; break }

  phase('Confirm')
  const verdicts = await parallel(uniq.map((f) => () =>
    agent(
      `${CONTEXT}\n\nAdversarially assess ONE review finding. Try to REFUTE it — is it a real defect against yapm's ` +
      `standards, or a false positive / style nit / already-handled case? Read the actual code around ${f.file}` +
      `${f.line ? `:${f.line}` : ''} in the diff.\n\nFINDING (${f.severity}, ${f.category}): ${f.summary}\n` +
      `Failure scenario: ${f.failure_scenario || '(none given)'}\nProposed fix: ${f.suggested_fix}\n\n` +
      `Set confirmed=true ONLY if it is a genuine defect worth fixing; default to confirmed=false when uncertain or ` +
      `when it is subjective polish that does not violate a stated standard. If confirmed, give the corrected fix.`,
      { label: `confirm:${(f.category || 'x').slice(0, 12)}:r${round}`, phase: 'Confirm', schema: VERDICT_SCHEMA, effort: 'high' },
    ).then((v) => ({ finding: f, verdict: v }))
  ))
  const confirmed = verdicts.filter(Boolean).filter((x) => x.verdict && x.verdict.confirmed)
    .map((x) => ({ ...x.finding, severity: x.verdict.severity, fix: x.verdict.corrected_fix }))
  log(`Round ${round}: ${confirmed.length} confirmed findings`)
  if (confirmed.length === 0) { dry = true; break }

  for (const f of confirmed) { const k = fkey(f); stuck.set(k, (stuck.get(k) || 0) + 1) }
  const order = { critical: 0, high: 1, medium: 2, low: 3 }
  confirmed.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
  const list = confirmed.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.summary}\n   FIX: ${f.fix}`).join('\n')

  phase('Fix')
  const fix = await agent(
    `${CONTEXT}\n\nRound ${round} fix pass. Apply fixes for EVERY confirmed finding below (critical→low — fix ALL of ` +
    `them, not just the severe ones). Diagnose root causes, not symptoms. After applying, run the full gates ` +
    `(\`pnpm turbo typecheck lint build test\`, \`node scripts/check-boundaries.mjs\`, the schema-drift test, and the ` +
    `relevant Playwright e2e against a live stack) and confirm they pass. Then \`git add -A && git commit -s\` with a ` +
    `Conventional Commit message (\`fix(review): ...\`) and \`git push origin ${BRANCH}\`.\n\n` +
    `If a finding genuinely cannot or should not be fixed, do NOT force it — list it as unfixable with a clear reason.\n\n` +
    `CONFIRMED FINDINGS:\n${list}\n\nSet gatesGreen only if the gates actually passed after your fixes.`,
    { label: `fix:r${round}`, phase: 'Fix', schema: FIX_SCHEMA, effort: 'high' },
  )
  log(`Round ${round}: fixed ${fix ? fix.fixed.length : 0}, unfixable ${fix ? fix.unfixable.length : 0}, gates ${fix && fix.gatesGreen ? 'green' : 'RED'}`)
}

const persistent = [...stuck.entries()].filter(([, n]) => n >= 2).map(([k]) => k)

phase('Merge')
const merge = await agent(
  `${CONTEXT}\n\nFinal gate + merge decision for PR on branch \`${BRANCH}\`.\n` +
  `State reached: ${dry ? 'review converged to DRY (no confirmed findings remain)' : `hit the ${MAX_ROUNDS}-round cap`}.` +
  `${persistent.length ? ` Findings that reappeared across rounds (possible stuck fixes): ${persistent.join('; ')}.` : ''}\n\n` +
  `1. Run the FULL gates one more time on \`${BRANCH}\`: \`pnpm turbo typecheck lint build test\`, ` +
  `\`node scripts/check-boundaries.mjs\`, schema-drift, three-container check, and the full Playwright e2e against a ` +
  `live stack.\n` +
  `2. MERGE ONLY IF: the review is dry (zero unresolved confirmed findings) AND every gate is green. In that case: post ` +
  `a summarizing PR review, then \`gh pr review --approve\` (if GitHub blocks self-approval, note it and proceed), then ` +
  `\`gh pr merge --squash --delete-branch\`. Confirm ${BASE} now contains the change.\n` +
  `3. If findings remain unresolved or any gate is red: DO NOT merge. Leave the PR open and report exactly what blocks it.\n\n` +
  `Report honestly: merged or not, the final gate results, and any residual issues.`,
  { label: 'merge:decide', phase: 'Merge', effort: 'high' },
)

return { prOpened: opened, rounds: round - (dry ? 1 : 0), converged: dry, persistent, mergeReport: merge }
