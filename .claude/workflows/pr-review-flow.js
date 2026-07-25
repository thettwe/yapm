export const meta = {
  name: 'pr-review-flow',
  description:
    'Open a PR for a feature branch, review it, fix every confirmed finding, and merge on green CI. Loops only while critical/high findings remain; GitHub CI is the gate of record.',
  phases: [
    { title: 'Open', detail: 'push branch, open PR to base' },
    { title: 'Review', detail: 'round 1: 3 parallel lenses on the full diff; later rounds: one delta reviewer on the fix commits' },
    { title: 'Fix', detail: 'apply every confirmed finding, fast local gates, push — CI starts running in parallel' },
    { title: 'Merge', detail: 'join GitHub CI; merge only when dry and every check is green' },
  ],
}

// Rewrite (2026-07-25). Measured across 5 runs, the previous version averaged 92.9 min and used all 3
// rounds every single time. Fix+merge was 67% of that, because the fix pass re-ran the full gate suite
// (build + Playwright e2e + docker compose) every round and the merge pass ran it a fourth time on top
// of waiting for CI — which covers the same ground in 8-10 min. Changes:
//   1. Loop only while critical/high remain. Medium/low are fixed in the round they surface and never
//      re-open the loop; CI verifies them mechanically.
//   2. Fix runs fast gates only (typecheck, lint, affected tests, boundaries), then pushes immediately
//      so CI overlaps the next review round.
//   3. Merge runs no local gates — it joins CI and reads every check.
//   4. Rounds 2+ review only the fix commits, not base...head again.
// Guarantees are unchanged: every confirmed finding is fixed, and nothing merges on a red check or an
// unresolved critical/high finding.

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
  `${REPO}/reference/.\n` +
  `yapm hard constraints: exactly 3 containers (no new services); all ZQL + mutators only in packages/schema ` +
  `(client+server share the mutator); client-minted UUIDv7 at the mutator call site (never inside a mutator body); ` +
  `row-level permissions deny by empty query and check auth before existence; kysely 0.28.17, no kysely-codegen, no ` +
  `baseUrl, no TS-Compiler-API tools; every color/font via tokens; keyboard-first + works in all 3 themes light+dark; ` +
  `free means free; team-level metrics only. Docs freshness: a change must update README/ROADMAP/TECHSTACK and any ` +
  `root doc it makes stale, plus its docs-site pages.`

// The fix pass deliberately does NOT run build, Playwright e2e, docker compose, or the compose smoke test.
// GitHub CI covers all four (jobs: quality, e2e, smoke) and runs them in parallel with the next review round.
const FAST_GATES =
  `pnpm turbo run typecheck --filter=...[origin/${BASE}] && pnpm lint && ` +
  `pnpm turbo run test --filter=...[origin/${BASE}] && node scripts/check-boundaries.mjs`

const OPEN_SCHEMA = {
  type: 'object',
  properties: {
    prNumber: { type: 'integer' },
    headSha: { type: 'string', description: 'full SHA now at the tip of the branch' },
    diffstat: { type: 'string' },
  },
  required: ['prNumber', 'headSha', 'diffstat'],
  additionalProperties: false,
}

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
          category: { type: 'string' },
          file: { type: 'string' },
          summary: { type: 'string' },
          fix: { type: 'string', description: 'the corrected fix to apply' },
        },
        required: ['severity', 'category', 'file', 'summary', 'fix'],
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
    gatesGreen: { type: 'boolean', description: 'true only if every fast gate actually passed' },
    headSha: { type: 'string', description: 'full SHA pushed after the fixes; empty if nothing was pushed' },
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
  required: ['gatesGreen', 'headSha', 'fixed', 'unfixable', 'notes'],
  additionalProperties: false,
}

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

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }
const isBlocking = (f) => f.severity === 'critical' || f.severity === 'high'

function fkey(f) {
  return `${(f.file || '').trim()}::${(f.category || '').trim().toLowerCase()}::${(f.summary || '').trim().slice(0, 80).toLowerCase()}`
}

function renderFindings(list) {
  return list
    .map(
      (f, i) =>
        `${i + 1}. [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} (${f.category}) — ${f.summary}\n` +
        `   scenario: ${f.failure_scenario || '(none)'}\n   proposed: ${f.suggested_fix}`,
    )
    .join('\n')
}

phase('Open')
const opened = await agent(
  `${CONTEXT}\n\nOpen a pull request for this change. In ${REPO}:\n` +
    `1. Push the branch: git push -u origin ${BRANCH}.\n` +
    `2. Open a PR to ${BASE}: gh pr create --base ${BASE} --head ${BRANCH} --title ${JSON.stringify(A.prTitle || CHANGE)} ` +
    `--body describing what the change adds (summarize openspec/changes/${CHANGE}/proposal.md). Reuse the PR if one exists.\n` +
    `3. Report the PR number, the full head SHA (git rev-parse ${BRANCH}), and git diff --stat ${BASE}...${BRANCH}.\n\n` +
    `Do not run any gates here — CI starts on push and the review rounds run against the diff.`,
  { label: 'open:pr', phase: 'Open', schema: OPEN_SCHEMA, effort: 'medium' },
)
if (!opened) throw new Error('pr-review-flow: could not open the PR')
log(`PR #${opened.prNumber} opened at ${opened.headSha.slice(0, 8)} — ${opened.diffstat.split('\n').pop()}`)

let reviewedSha = opened.headSha
let dry = false
// True when the most recent fix pass (if any ran) actually pushed a commit AND its fast gates passed.
// Without this, a fix agent that dies or pushes nothing leaves an empty delta for the next round, which
// then reports zero findings and would otherwise be read as convergence.
let lastFixOk = true
let roundsRun = 0
let unverifiedFixes = []
let lastBlocking = []
const seen = new Map()
const allUnfixable = []

for (let round = 1; round <= MAX_ROUNDS; round++) {
  roundsRun = round
  phase('Review')

  let raw
  if (round === 1) {
    const reviews = await parallel(
      LENSES.map((l) => () =>
        agent(
          `${CONTEXT}\n\nYou are the ${l.key} reviewer. Review the full diff: git -C ${REPO} diff ${BASE}...${BRANCH}.\n` +
            `Review through these lenses: ${l.prompt}\n` +
            `Report only real defects against yapm's standards and the change's specs. Rank each critical/high/medium/low, ` +
            `with file + line + a concrete failure scenario where applicable and a specific fix. Severity matters: only ` +
            `critical/high hold up the merge, so rank honestly rather than inflating. Do NOT invent issues to seem ` +
            `thorough; an empty list is correct when the code is clean on your lenses.`,
          { label: `review:${l.key}:r1`, phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' },
        ),
      ),
    )
    raw = reviews.filter(Boolean).flatMap((r) => r.findings || [])
  } else {
    // Delta review: only the fix commits since the last review, plus verification that they landed.
    const delta = await agent(
      `${CONTEXT}\n\nYou are the delta reviewer (round ${round}). The previous round applied fixes. Review ONLY what ` +
        `changed since the last review: git -C ${REPO} diff ${reviewedSha}..${BRANCH}. Do NOT re-review the rest of ` +
        `the PR — earlier rounds already covered it.\n\n` +
        `Two jobs:\n` +
        `1. Verify each fix below actually landed and genuinely resolves the finding (not a symptom patch).\n` +
        `2. Report any NEW defect the fix commits introduced — correctness, security, yapm constraints, tests, ` +
        `a11y/design, or docs freshness.\n\n` +
        `Rank each critical/high/medium/low; only critical/high hold up the merge. An empty list is the correct ` +
        `answer when the fixes are sound.\n\nFIXES CLAIMED IN THE LAST ROUND:\n${unverifiedFixes.join('\n') || '(none)'}`,
      { label: `review:delta:r${round}`, phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' },
    )
    raw = (delta && delta.findings) || []
  }

  const uniq = [...new Map(raw.map((f) => [fkey(f), f])).values()]
  log(`Round ${round}: ${raw.length} raw findings -> ${uniq.length} unique`)

  if (uniq.length === 0) {
    dry = lastFixOk
    unverifiedFixes = []
    lastBlocking = []
    break
  }

  const confirm = await agent(
    `${CONTEXT}\n\nYou are the adversarial confirmer (round ${round}). For EACH finding below, try to REFUTE it by ` +
      `reading the actual code. Keep a finding ONLY if it is a genuine defect that violates a stated yapm standard or ` +
      `the change's specs. REJECT subjective style/polish, false positives, and already-handled cases — default to ` +
      `rejecting when uncertain.\n` +
      `Severity discipline matters more than it used to: critical/high keep the review loop running for another ` +
      `round, medium/low are fixed once and verified by CI. Reserve critical/high for defects that are wrong, ` +
      `unsafe, or violate a non-negotiable constraint — not for polish.\n` +
      `Return the confirmed findings (with a corrected fix each) and how many you rejected.\n\nFINDINGS:\n${renderFindings(uniq)}`,
    { label: `confirm:r${round}`, phase: 'Review', schema: CONFIRM_SCHEMA, effort: 'high' },
  )

  const confirmed = (confirm && confirm.confirmed) || []
  const blocking = confirmed.filter(isBlocking)
  log(
    `Round ${round}: ${confirmed.length} confirmed (${blocking.length} blocking), ` +
      `${confirm ? confirm.rejectedCount : 0} rejected`,
  )

  if (confirmed.length === 0) {
    dry = lastFixOk
    unverifiedFixes = []
    lastBlocking = []
    break
  }

  for (const f of confirmed) seen.set(fkey(f), (seen.get(fkey(f)) || 0) + 1)
  confirmed.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))

  const fixList = confirmed
    .map((f, i) => `${i + 1}. [${f.severity}] ${f.file} — ${f.summary}\n   FIX: ${f.fix}`)
    .join('\n')

  phase('Fix')
  const fix = await agent(
    `${CONTEXT}\n\nRound ${round} fix pass. Apply fixes for EVERY confirmed finding below (critical -> low; fix ALL, ` +
      `not just the blocking ones). Diagnose root causes, not symptoms.\n\n` +
      `Then run ONLY these fast gates:\n  ${FAST_GATES}\n` +
      `Do NOT run the full build, the Playwright e2e suite, docker compose, or the compose smoke test. GitHub CI ` +
      `covers all four and will run them in parallel with the next review round — duplicating them here is the single ` +
      `most expensive thing this flow used to do.\n\n` +
      `Then git add -A && git commit -s (message: fix(review): ...) and git push origin ${BRANCH}. Report the full ` +
      `head SHA after pushing. If a finding genuinely cannot/should not be fixed, list it as unfixable with a reason ` +
      `rather than forcing it.\n\nCONFIRMED FINDINGS:\n${fixList}\n\n` +
      `Set gatesGreen only if the fast gates actually passed.`,
    { label: `fix:r${round}`, phase: 'Fix', schema: FIX_SCHEMA, effort: 'high' },
  )

  lastFixOk = Boolean(fix && fix.headSha && fix.gatesGreen)
  if (fix && fix.headSha) reviewedSha = fix.headSha
  if (fix && fix.unfixable) allUnfixable.push(...fix.unfixable)
  unverifiedFixes = confirmed.map((f) => `- [${f.severity}] ${f.file} — ${f.summary}`)
  lastBlocking = blocking.map((f) => `- [${f.severity}] ${f.file} — ${f.summary}`)
  log(
    `Round ${round}: fixed ${fix ? fix.fixed.length : 0}, unfixable ${fix ? fix.unfixable.length : 0}, ` +
      `fast gates ${lastFixOk ? 'green' : 'RED/not pushed'}`,
  )

  // Loop only while blocking findings remain, or while the fix pass did not cleanly land. Medium/low
  // fixes ride out on CI rather than buying a whole extra review round.
  if (blocking.length === 0 && lastFixOk) {
    dry = true
    break
  }
}

const persistent = [...seen.entries()].filter(([, n]) => n >= 2).map(([k]) => k)

// Three distinct end states. Only the first is a clean auto-merge; the second needs the merge agent to
// verify the last round's blocking fixes itself, because the loop ran out of rounds before re-reviewing
// them; the third is a hard block.
const MERGE_STATE = dry
  ? 'review CONVERGED — the last review round surfaced no critical/high findings.'
  : lastFixOk
    ? `hit the ${MAX_ROUNDS}-round cap. The final round's critical/high findings WERE fixed and the fast gates ` +
      `passed, but those fixes were never re-reviewed:\n${lastBlocking.join('\n')}\n` +
      `You must verify them yourself in the diff before merging — do not merge on faith, and do not block on ` +
      `them if they are genuinely resolved.`
    : `the last fix pass did NOT land cleanly (fast gates red, or nothing was pushed). Treat as blocked unless you ` +
      `can establish from the diff and CI that the tree is actually correct.`

phase('Merge')
const merge = await agent(
  `${CONTEXT}\n\nFinal gate + merge decision for PR #${opened.prNumber} on branch ${BRANCH}.\n` +
    `State: ${MERGE_STATE}` +
    `${persistent.length ? `\nFindings that reappeared across rounds (possible stuck fixes): ${persistent.join('; ')}.` : ''}` +
    `${allUnfixable.length ? `\nReported unfixable: ${allUnfixable.map((u) => `${u.summary} (${u.reason})`).join('; ')}.` : ''}` +
    `${unverifiedFixes.length ? `\nThese medium/low fixes landed in the final round and were NOT re-reviewed — CI is their verification, but eyeball them in the final diff:\n${unverifiedFixes.join('\n')}` : ''}\n\n` +
    `1. Do NOT re-run the gate suite locally. GitHub CI is the gate of record and already covers lint, typecheck, ` +
    `unit + integration tests, build, catalog, boundaries, commit hygiene, the Playwright e2e suite, and the ` +
    `three-container compose smoke test. Run: gh pr checks ${opened.prNumber} --watch, then read EVERY check.\n` +
    `2. MERGE ONLY IF every GitHub CI check is green AND no critical/high finding is genuinely unresolved. Where the ` +
    `state above asks you to verify unreviewed blocking fixes, read those hunks in the diff and judge them — a fix ` +
    `that is real and complete does not block the merge. Then: gh pr review --approve (if self-approval is blocked, ` +
    `note it and proceed), then gh pr merge --squash --delete-branch. Confirm ${BASE} now contains the change.\n` +
    `3. If a critical/high finding is genuinely unresolved OR any CI check is red: DO NOT merge. Leave the PR open ` +
    `and report exactly what blocks it. If a check is red, read its log and say which gate failed and why.\n\n` +
    `Report: merged or not, the CI check results, and any residual issues.`,
  { label: 'merge:decide', phase: 'Merge', effort: 'high' },
)

return {
  pr: opened.prNumber,
  rounds: roundsRun,
  converged: dry,
  lastFixOk,
  persistent,
  unfixable: allUnfixable,
  mergeReport: merge,
}
