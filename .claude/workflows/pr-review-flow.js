export const meta = {
  name: 'pr-review-flow',
  description: 'Open a PR for a feature branch, then autonomously review it through 3 grouped lenses, batch-confirm findings adversarially, fix ALL confirmed findings (critical -> low), loop until dry (<=3 rounds), and merge only when clean and gates are green.',
  phases: [
    { title: 'Open', detail: 'push branch, open PR to base' },
    { title: 'Review', detail: '3 grouped-lens reviewers, one batched adversarial confirm' },
    { title: 'Fix', detail: 'apply every confirmed fix, run gates, commit' },
    { title: 'Merge', detail: 'dry + gates green -> approve + squash-merge' },
  ],
}

// Lean rewrite (2026-07-24): the previous version used 8 separate lenses + one adversarial
// verifier PER finding + up to 5 rounds, which cost ~105 agents / ~7.5M tokens on one change.
// This version: 3 GROUPED lenses, ONE batched confirm agent per round, cap 3 rounds. Same
// guarantees (fix every confirmed finding; never merge on red gates or unresolved findings).

// args: { branch, base, changeName, prTitle, repoDir }
const A = args || {}
const REPO = A.repoDir || '/Users/thettwe/Works/yapm'
const BRANCH = A.branch
const BASE = A.base || 'main'
const CHANGE = A.changeName || BRANCH
const MAX_ROUNDS = 3

if (!BRANCH) throw new Error('pr-review-flow requires args.branch')

const CONTEXT =
  `Repository: ${REPO} (branch ${BRANCH} -> ${BASE}), change: ${CHANGE}.\n` +
  `Read ${REPO}/CLAUDE.md (the ten non-negotiable constraints), ${REPO}/PROCESS.md (docs-as-DoD, 3 test tiers, ` +
  `big-feature rule), ${REPO}/VISION.md, ${REPO}/DESIGN.md, the change specs under ` +
  `${REPO}/openspec/changes/${CHANGE}/specs/ (its acceptance criteria), and the verified API notes under ` +
  `${REPO}/reference/. Review the actual diff: git -C ${REPO} diff ${BASE}...${BRANCH}.\n` +
  `yapm hard constraints: exactly 3 containers (no new services); all ZQL + mutators only in packages/schema ` +
  `(client+server share the mutator); client-minted UUIDv7 at the mutator call site (never inside a mutator body); ` +
  `row-level permissions deny by empty query and check auth before existence; kysely 0.28.17, no kysely-codegen, no ` +
  `baseUrl, no TS-Compiler-API tools; every color/font via tokens; keyboard-first + works in all 3 themes light+dark; ` +
  `free means free; team-level metrics only. Docs freshness: a change must update README/ROADMAP/TECHSTACK and any ` +
  `root doc it makes stale, plus its docs-site pages.`

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
          failure_scenario: { type: 'string', description: 'concrete inputs/state -> wrong outcome; empty if not a bug' },
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

const CONFIRM_SCHEMA = {
  type: 'object',
  properties: {
    confirmed: {
      type: 'array',
      description: 'only the findings that are genuine defects worth fixing',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          summary: { type: 'string' },
          fix: { type: 'string', description: 'the corrected fix to apply' },
        },
        required: ['severity', 'file', 'summary', 'fix'],
        additionalProperties: false,
      },
    },
    rejectedCount: { type: 'integer', description: 'how many raw findings were rejected as nits/false-positives' },
  },
  required: ['confirmed', 'rejectedCount'],
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

// 3 grouped lenses replace the old 8 — same coverage, fewer agents.
const LENSES = [
  {
    key: 'correctness-security',
    prompt:
      'correctness AND security together: logic bugs and edge cases (give a concrete failure scenario for each), ' +
      'optimistic-mutation/rebase hazards, sync convergence, null/empty handling; AND authorization gaps, the ' +
      'row-level permission model, secret handling, injection, auth-before-existence, whether an agent/user could ' +
      'exceed their role.',
  },
  {
    key: 'constraints-tests',
    prompt:
      'yapm architectural constraints AND test coverage together: the CLAUDE.md constraint list (3 containers, ' +
      'ZQL/mutators only in packages/schema, client-minted UUIDv7 at the call site, kysely pin, no baseUrl, no ' +
      'TS-Compiler-API tools, no hardcoded colors/fonts, the sub-100ms budget, N+1/unscoped queries); AND the ' +
      'big-feature test rule (unit+integration+e2e when a change touches >=2 of {entity, mutator, permission ' +
      'surface, signature UI}) — do the tests assert real behavior and can they fail? Missing permission-scoping ' +
      'integration tests or e2e keyboard/sync coverage.',
  },
  {
    key: 'ux-docs',
    prompt:
      'user-facing quality AND documentation together: keyboard-first operability, focus management, ARIA, contrast ' +
      '(AA light+dark), design fidelity vs DESIGN.md/Warm across all 3 themes; AND documentation-per-change — did it ' +
      'ship the docs-site pages for what it adds AND update any ROOT doc (README/ROADMAP/TECHSTACK/.env.example) it ' +
      'made stale? Env vars documented and matching the Zod schema?',
  },
]

function fkey(f) {
  return `${(f.file || '').trim()}::${(f.category || '').trim().toLowerCase()}::${(f.summary || '').trim().slice(0, 80).toLowerCase()}`
}

phase('Open')
const opened = await agent(
  `${CONTEXT}\n\nOpen a pull request for this change. In ${REPO}:\n` +
    `1. Push the branch: git push -u origin ${BRANCH}.\n` +
    `2. Open a PR to ${BASE}: gh pr create --base ${BASE} --head ${BRANCH} --title ${JSON.stringify(A.prTitle || CHANGE)} ` +
    `--body describing what the change adds (summarize openspec/changes/${CHANGE}/proposal.md). Reuse the PR if one exists.\n` +
    `3. Print the PR number and git diff --stat ${BASE}...${BRANCH}.\n\nFinal message: the PR number and the diffstat.`,
  { label: 'open:pr', phase: 'Open', effort: 'medium' },
)
log(`PR opened: ${String(opened).slice(0, 140)}`)

let dry = false
let round = 0
const stuck = new Map()
for (round = 1; round <= MAX_ROUNDS; round++) {
  phase('Review')
  const reviews = await parallel(
    LENSES.map((l) => () =>
      agent(
        `${CONTEXT}\n\nYou are the ${l.key} reviewer (round ${round}). Review through these lenses: ${l.prompt}\n` +
          `Report only real defects against yapm's standards and the change's specs. Rank each critical/high/medium/low, ` +
          `with file + line + a concrete failure scenario where applicable and a specific fix. Do NOT invent issues to ` +
          `seem thorough; an empty list is correct when the code is clean on your lenses.`,
        { label: `review:${l.key}:r${round}`, phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' },
      ),
    ),
  )
  const all = reviews.filter(Boolean).flatMap((r) => r.findings || [])
  const uniq = [...new Map(all.map((f) => [fkey(f), f])).values()]
  log(`Round ${round}: ${all.length} raw findings -> ${uniq.length} unique`)
  if (uniq.length === 0) {
    dry = true
    break
  }

  // ONE batched adversarial confirm (replaces one-agent-per-finding).
  const list = uniq
    .map((f, i) => `${i + 1}. [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} (${f.category}) — ${f.summary}\n   scenario: ${f.failure_scenario || '(none)'}\n   proposed: ${f.suggested_fix}`)
    .join('\n')
  const confirm = await agent(
    `${CONTEXT}\n\nYou are the adversarial confirmer (round ${round}). For EACH finding below, try to REFUTE it by ` +
      `reading the actual code in the diff. Keep a finding ONLY if it is a genuine defect that violates a stated ` +
      `yapm standard or the change's specs. REJECT subjective style/polish, false positives, and already-handled ` +
      `cases — default to rejecting when uncertain. Return the confirmed findings (with a corrected fix each) and how ` +
      `many you rejected.\n\nFINDINGS:\n${list}`,
    { label: `confirm:r${round}`, phase: 'Review', schema: CONFIRM_SCHEMA, effort: 'high' },
  )
  const confirmed = (confirm && confirm.confirmed) || []
  log(`Round ${round}: ${confirmed.length} confirmed, ${confirm ? confirm.rejectedCount : 0} rejected`)
  if (confirmed.length === 0) {
    dry = true
    break
  }

  for (const f of confirmed) {
    const k = fkey(f)
    stuck.set(k, (stuck.get(k) || 0) + 1)
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3 }
  confirmed.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
  const fixList = confirmed
    .map((f, i) => `${i + 1}. [${f.severity}] ${f.file} — ${f.summary}\n   FIX: ${f.fix}`)
    .join('\n')

  phase('Fix')
  const fix = await agent(
    `${CONTEXT}\n\nRound ${round} fix pass. Apply fixes for EVERY confirmed finding below (critical -> low; fix ALL, ` +
      `not just severe ones). Diagnose root causes, not symptoms. Then run the full gates (pnpm turbo typecheck lint ` +
      `build test; node scripts/check-boundaries.mjs; the schema-drift test; and the relevant Playwright e2e against a ` +
      `live stack) and confirm they pass. Then git add -A && git commit -s (message fix(review): ...) and git push ` +
      `origin ${BRANCH}. If a finding genuinely cannot/should not be fixed, list it as unfixable with a reason rather ` +
      `than forcing it.\n\nCONFIRMED FINDINGS:\n${fixList}\n\nSet gatesGreen only if the gates actually passed.`,
    { label: `fix:r${round}`, phase: 'Fix', schema: FIX_SCHEMA, effort: 'high' },
  )
  log(`Round ${round}: fixed ${fix ? fix.fixed.length : 0}, unfixable ${fix ? fix.unfixable.length : 0}, gates ${fix?.gatesGreen ? 'green' : 'RED'}`)
}

const persistent = [...stuck.entries()].filter(([, n]) => n >= 2).map(([k]) => k)

phase('Merge')
const merge = await agent(
  `${CONTEXT}\n\nFinal gate + merge decision for PR on branch ${BRANCH}.\n` +
    `State: ${dry ? 'review converged to DRY (no confirmed findings remain)' : `hit the ${MAX_ROUNDS}-round cap`}.` +
    `${persistent.length ? ` Findings that reappeared across rounds (possible stuck fixes): ${persistent.join('; ')}.` : ''}\n\n` +
    `1. Run the FULL gates once more on ${BRANCH}: pnpm turbo typecheck lint build test; node scripts/check-boundaries.mjs; ` +
    `schema-drift; three-container check; and the full Playwright e2e against a live stack. ALSO wait for the PR's ` +
    `GitHub CI to finish (gh pr checks with --watch) and read every check.\n` +
    `2. MERGE ONLY IF: the review is dry (no unresolved confirmed findings) AND every local gate AND every GitHub CI ` +
    `check is green. Then: gh pr review --approve (if self-approval is blocked, note it and proceed), then ` +
    `gh pr merge --squash --delete-branch. Confirm ${BASE} now contains the change.\n` +
    `3. If findings remain unresolved OR any gate/CI check is red: DO NOT merge. Leave the PR open and report exactly ` +
    `what blocks it.\n\nReport: merged or not, the final gate + CI results, and any residual issues.`,
  { label: 'merge:decide', phase: 'Merge', effort: 'high' },
)

return { prOpened: opened, rounds: round - (dry ? 1 : 0), converged: dry, persistent, mergeReport: merge }
