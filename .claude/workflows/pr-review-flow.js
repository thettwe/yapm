export const meta = {
  name: 'pr-review-flow',
  description:
    'Open a PR for a feature branch, review it through three adversarial lenses, fix every confirmed finding, and merge only on green CI.',
  phases: [
    { title: 'Open', detail: 'push branch, open PR to base' },
    { title: 'Review', detail: 'round 1: 3 parallel lenses on the full diff; later rounds: one delta reviewer on the fix commits' },
    { title: 'Fix', detail: 'apply every confirmed finding, fast local gates, push — CI starts running in parallel' },
    { title: 'Merge', detail: 'join GitHub CI; merge only when the review is settled and every check is green' },
  ],
}

// Wall clock: the previous version averaged 92.9 min across 5 measured runs, two thirds of it spent
// re-running the full gate suite (build + Playwright + docker) on every fix pass and once more at
// merge — ground GitHub CI already covers in 8-10 min. The fix pass now runs fast gates only and
// pushes immediately so CI overlaps the next review round; the merge pass runs no local gates at all.
//
// Rating integrity: an adversarial pass over an earlier draft of this file found that a rating which
// controls control flow is a rating worth bending, and that the defences then in place (an honour-code
// rubric plus withholding the rule from raters) were unenforceable — the confirmer's schema had no
// field in which to record the justification the rubric demanded, and the rule itself was published in
// four places raters are instructed to read. The structure below replaces both:
//   - a downgrade or a rejection must be WRITTEN DOWN and cited, and is otherwise not applied;
//   - a finding is weighed at the worse of the reviewer's and the confirmer's rating;
//   - the last fix pass is re-reviewed once regardless of how it was rated, so lowering a rating does
//     not shorten the review and there is nothing to gain by it.
// The last of these is the load-bearing one: it does not depend on any agent choosing to comply.

// args: { branch, base, changeName, prTitle, repoDir, falsifiableCheck, knownUnresolved }
const A = args || {}
const REPO = A.repoDir || '/Users/thettwe/Works/yapm'
const BRANCH = A.branch
const BASE = A.base || 'main'
const CHANGE = A.changeName || BRANCH
// Two, not three. Across notifications, mentions, search and retro-board, round three never once
// produced a critical or high finding — only polish, at roughly 40 min and 500K tokens a round. Round
// two has produced confirmed highs, so it stays. The guaranteed verification round still applies, so a
// clean second round is a real re-review of the last fix rather than an assumption.
const MAX_ROUNDS = 2

if (!BRANCH) throw new Error('pr-review-flow requires args.branch')

// Reviewing this flow's own source inside a PR would put the rating mechanism into a rater's context.
// Scope every review diff away from it.
const DIFF_SCOPE = `-- . ':(exclude).claude/workflows'`

const CONTEXT =
  `Repository: ${REPO} (branch ${BRANCH} -> ${BASE}), change: ${CHANGE}.\n` +
  `Read ${REPO}/CLAUDE.md (the ten numbered constraints AND the Conventions section), ${REPO}/PROCESS.md ` +
  `(docs-as-DoD, 3 test tiers, big-feature rule), ${REPO}/VISION.md, ${REPO}/DESIGN.md, the change specs under ` +
  `${REPO}/openspec/changes/${CHANGE}/specs/ (its acceptance criteria), ${REPO}/openspec/specs/ (the capability ` +
  `specs describing behavior that ALREADY SHIPS — this change must not break those either), and the verified API ` +
  `notes under ${REPO}/reference/.\n` +
  `yapm hard constraints: exactly 3 containers (no new services); all ZQL + mutators only in packages/schema ` +
  `(client+server share the mutator); client-minted UUIDv7 at the mutator call site (never inside a mutator body); ` +
  `row-level permissions deny by empty query and check auth before existence; kysely 0.28.17, no kysely-codegen, no ` +
  `baseUrl, no TS-Compiler-API tools; every color/font via tokens; keyboard-first + works in all 3 themes light+dark; ` +
  `free means free; team-level metrics only. Docs freshness: a change must update README/ROADMAP/TECHSTACK and any ` +
  `root doc it makes stale, plus its docs-site pages.\n` +
  `Settled precedent: the "## Decisions made during implementation" sections in the two or three most recent ` +
  `changes under ${REPO}/openspec/changes/ (and openspec/changes/archive/) record decisions already argued and ` +
  `closed. Read them before reporting a finding that second-guesses one — re-litigating a settled decision produces ` +
  `no improvement.` +
  (A.falsifiableCheck ? `\nHow this change proves itself: ${A.falsifiableCheck}` : '') +
  (A.knownUnresolved && A.knownUnresolved.length
    ? `\nThe build flow already reported these as unresolved — treat them as KNOWN rather than as new discoveries, ` +
      `and assess each on its merits against the rubric:\n- ${A.knownUnresolved.join('\n- ')}`
    : '')

// The fix pass deliberately does NOT run build, Playwright e2e, docker compose, or the compose smoke test.
// GitHub CI covers all four (jobs: quality, e2e, smoke) and runs them in parallel with the next review round.
const FAST_GATES =
  `pnpm turbo run typecheck --filter=...[origin/${BASE}] && pnpm lint && ` +
  `pnpm turbo run test --filter=...[origin/${BASE}] && node scripts/check-boundaries.mjs`

// Severity is harm; confidence is how well it can be shown. Keeping them on separate axes is what
// stops "I could not reproduce it" from functioning as a downgrade.
const EVIDENCE = {
  confidence: { type: 'string', enum: ['observed', 'reasoned', 'speculative'] },
  citation: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['constraint', 'spec-scenario', 'repro', 'code-path', 'none'] },
      ref: {
        type: 'string',
        description:
          'the constraint text, the spec file + scenario heading, the reproduction steps, or file:line -> file:line for a traced code path',
      },
    },
    required: ['kind', 'ref'],
    additionalProperties: false,
  },
}

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
          ...EVIDENCE,
          category: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string', description: 'concrete inputs/state -> wrong outcome; empty if not a bug' },
          suggested_fix: { type: 'string' },
        },
        required: ['severity', 'confidence', 'citation', 'category', 'file', 'summary', 'suggested_fix'],
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
          reviewerSeverity: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low'],
            description: "the reviewer's rating, copied verbatim",
          },
          downgradeJustification: {
            type: 'string',
            description:
              'required when severity is lower than reviewerSeverity: which rubric clause fails, and the code you read that rules the higher tier out. Empty string otherwise.',
          },
          ...EVIDENCE,
          category: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string' },
          fix: { type: 'string', description: 'the corrected fix to apply' },
        },
        required: [
          'severity',
          'reviewerSeverity',
          'downgradeJustification',
          'confidence',
          'citation',
          'category',
          'file',
          'summary',
          'failure_scenario',
          'fix',
        ],
        additionalProperties: false,
      },
    },
    rejected: {
      type: 'array',
      description: 'findings dropped as nits or false positives',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: "the reviewer's rating" },
          category: { type: 'string' },
          file: { type: 'string' },
          summary: { type: 'string' },
          refutingEvidence: {
            type: 'string',
            description:
              'the code you READ that proves this is not a defect, as file:line. Leave empty if you are merely unsure — see the rubric.',
          },
        },
        required: ['severity', 'category', 'file', 'summary', 'refutingEvidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['confirmed', 'rejected'],
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
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          summary: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['severity', 'summary', 'reason'],
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
const rank = (s) => SEVERITY_ORDER[s] ?? 9
const worst = (a, b) => (rank(a) <= rank(b) ? a : b)
const cited = (f) => f.citation && f.citation.kind !== 'none' && (f.citation.ref || '').trim().length > 20
const justified = (f) =>
  rank(f.severity) <= rank(f.reviewerSeverity) || (f.downgradeJustification || '').trim().length > 40

// Severity is load-bearing, so it is not taken on one agent's word. A finding is weighed at the WORSE
// of the reviewer's and the confirmer's rating unless the confirmer wrote down why it lowered it, and
// an uncited critical/high still counts — missing paperwork is not evidence of low severity.
const effectiveSeverity = (f) =>
  justified(f) && cited(f) ? f.severity : worst(f.severity, f.reviewerSeverity)
const isBlocking = (f) => effectiveSeverity(f) === 'critical' || effectiveSeverity(f) === 'high'

const SEVERITY_RUBRIC =
  `## Severity rubric — severity is HARM IF REAL, not how well you can prove it\n` +
  `Rate the damage the defect does if it is real. Report how sure you are separately, in \`confidence\`.\n` +
  `- **critical**: data loss or corruption — including rows persisted that should not exist (duplicates, orphans, ` +
  `anything a user must undo by hand); secret exposure; or any path that returns, syncs, or writes a row the ` +
  `requesting principal is not entitled to, whether a check was evaded or merely absent, whether or not the ` +
  `principal is authenticated, and whether or not they are in the same workspace. Over-fetch across a team or ` +
  `workspace boundary IS a permission bypass, and scoping covers hydrated relations (labels, comments, assignees, ` +
  `activity), not just the primary entity. Also: a common user path left unusable — *common* = the specs give it a ` +
  `scenario, or it is within three interactions of the default post-login view, or a connector/automation drives ` +
  `it (rate the intended steady state, never current adoption of a surface shipping in this PR); *unusable* = ` +
  `finishing the task needs a reload, a pointer, manual cleanup, or steps outside the documented flow. A workaround ` +
  `does not make a path usable.\n` +
  `- **high**: violates any written yapm rule — CLAUDE.md's ten numbered constraints, CLAUDE.md's Conventions ` +
  `(forward-only migrations, Zod env fail-fast, /api/v1 additive-only within a major, docs freshness, DCO), ` +
  `PROCESS.md §3 (three test tiers and the big-feature rule) or §6, DESIGN.md's token/contrast/theme rules, or the ` +
  `hard constraints listed above; OR breaks a scenario or SHALL asserted by the change's specs, by any capability ` +
  `spec under openspec/specs/, or by an archived change — a regression against shipped, specced behavior is high ` +
  `regardless of which change specced it; OR has a concrete reproduction producing a wrong result.\n` +
  `- **medium**: real but bounded harm — recoverable, narrow blast radius, or degrades quality without breaking a ` +
  `stated rule. "I could not reproduce it" is NOT what makes a finding medium.\n` +
  `- **low**: polish, naming, ordering, style.\n\n` +
  `### Citing\n` +
  `Every finding carries a \`citation\`: the rule text, the spec file + scenario heading, the reproduction, or a ` +
  `traced code path. A reproduction is **concrete** when a reader can follow it in the diff without running ` +
  `anything — name the entry point (file:line), the input or state, the line that produces the wrong value, and the ` +
  `wrong value. A precise code trace IS a concrete reproduction. Executing the app is not required.\n` +
  `Read constraints by PURPOSE, not literal wording. Constraint 4 covers any identifier or nondeterministic value ` +
  `(uuid, Date.now(), Math.random()) produced anywhere in a mutator's synchronous call tree — helpers included — ` +
  `for any column, not only primary keys. Constraint 2 covers client/server mutator divergence.\n` +
  `CLAUDE.md's ten contain no security or data-integrity rule. A permission bypass, an auth-before-existence ` +
  `violation, or secret exposure is critical on its own terms — cite the code path, not a constraint number. If you ` +
  `are unsure whether a boundary is a security boundary, rate it as if it is.\n\n` +
  `### What may NOT lower a rating\n` +
  `- Missing reproduction. If the only obstacle is infrastructure this review lacks (a second concurrent client, a ` +
  `populated pre-upgrade database, a live provider key, sustained load, a real browser), rate the harm and set ` +
  `\`confidence: "reasoned"\`. Absence of a runtime is a property of the harness, not of the defect.\n` +
  `- No matching \`#### Scenario\` heading. Requirement prose and "Permission story:" lines are assertions; a ` +
  `missing scenario is a gap in the spec, not a licence to downgrade.\n` +
  `- Not having finished checking. That is an unfinished check: keep the finding at \`confidence: "speculative"\`, ` +
  `do not drop it and do not lower it.\n` +
  `- A missing test PROCESS.md §3 requires. Rate it on the rule, not on whether the untested code happens to work.\n\n` +
  `### Two constraints are broad enough to be cited against anything — bound them\n` +
  `- Constraint 9 (sub-100ms) reaches high only when the diff puts a network round-trip, or an unbounded/unindexed ` +
  `query, in the synchronous path of an interaction that previously had none; name the call site and what it ` +
  `awaits. "Feels slow", or an await off the interactive path, is medium at most.\n` +
  `- Constraint 10 (keyboard-first) reaches high only when a control has no keyboard path to its function, or a ` +
  `focus trap has no escape. A missing ARIA role, imperfect focus order, or missing focus restore is medium; a ` +
  `missing focus ring is low.\n\n` +
  `Cite evidence for whichever tier you assign — including when you lower someone else's rating.`

function severityTally(list, sev) {
  const t = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of list) {
    const s = sev ? sev(f) : f.severity
    if (t[s] !== undefined) t[s]++
  }
  return `critical=${t.critical} high=${t.high} medium=${t.medium} low=${t.low}`
}

function fkey(f) {
  return `${(f.file || '').trim()}::${(f.category || '').trim().toLowerCase()}::${(f.summary || '').trim().slice(0, 80).toLowerCase()}`
}

function renderFindings(list) {
  return list
    .map(
      (f, i) =>
        `${i + 1}. [${f.severity}/${f.confidence}] ${f.file}${f.line ? `:${f.line}` : ''} (${f.category}) — ${f.summary}\n` +
        `   cites: ${f.citation ? `${f.citation.kind}: ${f.citation.ref}` : '(none)'}\n` +
        `   scenario: ${f.failure_scenario || '(none)'}\n   proposed: ${f.suggested_fix}`,
    )
    .join('\n')
}

phase('Open')
// The build flow now opens the PR before writing any code, so CI runs on every build push rather than
// only once at the end. When it hands us that PR number there is nothing to create — just read it.
const opened = await agent(
  `${CONTEXT}\n\n` +
    (A.existingPr
      ? `PR #${A.existingPr} is ALREADY OPEN for this branch — the build flow opened it before writing code so that ` +
        `CI would run on every push. Do NOT create another one. In ${REPO}:\n` +
        `1. Push anything not yet pushed: git push origin ${BRANCH}.\n` +
        `2. Report PR #${A.existingPr}'s number, the full head SHA (git rev-parse ${BRANCH}), and ` +
        `git diff --stat ${BASE}...${BRANCH}.\n\n`
      : `Open a pull request for this change. In ${REPO}:\n` +
        `1. Push the branch: git push -u origin ${BRANCH}.\n` +
        `2. Open a PR to ${BASE}: gh pr create --base ${BASE} --head ${BRANCH} --title ${JSON.stringify(A.prTitle || CHANGE)} ` +
        `--body describing what the change adds (summarize openspec/changes/${CHANGE}/proposal.md). Reuse the PR if one exists.\n` +
        `3. Report the PR number, the full head SHA (git rev-parse ${BRANCH}), and git diff --stat ${BASE}...${BRANCH}.\n\n`) +
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
// True once a fix pass has been granted its guaranteed re-review. Spent at most once per run.
let verified = false
let roundsRun = 0
let unverifiedFixes = []
let lastBlocking = []
const seen = new Map()
const allUnfixable = []
const severityLog = []

for (let round = 1; round <= MAX_ROUNDS; round++) {
  roundsRun = round
  phase('Review')

  let raw
  if (round === 1) {
    const reviews = await parallel(
      LENSES.map((l) => () =>
        agent(
          `${CONTEXT}\n\nYou are the ${l.key} reviewer. Review the full diff: ` +
            `git -C ${REPO} diff ${BASE}...${BRANCH} ${DIFF_SCOPE}\n` +
            `Review through these lenses: ${l.prompt}\n` +
            `Report only real defects against yapm's standards and the specs, with file + line + a concrete failure ` +
            `scenario where applicable and a specific fix. Do NOT invent issues to seem thorough; an empty list is ` +
            `correct when the code is clean on your lenses.\n\n${SEVERITY_RUBRIC}`,
          { label: `review:${l.key}:r1`, phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' },
        ),
      ),
    )
    raw = reviews.filter(Boolean).flatMap((r) => r.findings || [])
  } else {
    const delta = await agent(
      `${CONTEXT}\n\nYou are the delta reviewer (round ${round}). The previous round applied fixes. Review what ` +
        `changed since the last review: git -C ${REPO} diff ${reviewedSha}..${BRANCH} ${DIFF_SCOPE}. You do not need ` +
        `to re-review the rest of the PR — earlier rounds covered it — but DO follow a fix outward if it plausibly ` +
        `broke something beyond the lines it touched.\n\n` +
        `Two jobs:\n` +
        `1. Verify each fix below actually landed and genuinely resolves the finding (not a symptom patch).\n` +
        `2. Report any NEW defect the fix commits introduced — correctness, security, yapm constraints, tests, ` +
        `a11y/design, or docs freshness.\n\n` +
        `An empty list is the correct answer when the fixes are sound.\n\n${SEVERITY_RUBRIC}\n\n` +
        `FIXES CLAIMED IN THE LAST ROUND:\n${unverifiedFixes.join('\n') || '(none)'}`,
      { label: `review:delta:r${round}`, phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' },
    )
    raw = (delta && delta.findings) || []
  }

  // Deduplicate to the WORST rating, not the last writer. The lenses overlap by design (an unscoped
  // query is in scope for two of them); keying on last-wins let a later lens silently demote a
  // critical reported by an earlier one.
  const uniq = [
    ...raw
      .reduce((m, f) => {
        const prev = m.get(fkey(f))
        if (!prev || rank(f.severity) < rank(prev.severity)) m.set(fkey(f), f)
        return m
      }, new Map())
      .values(),
  ]
  log(`Round ${round}: ${raw.length} raw findings -> ${uniq.length} unique [${severityTally(uniq)}]`)

  if (uniq.length === 0) {
    dry = lastFixOk
    unverifiedFixes = []
    lastBlocking = []
    break
  }

  const confirm = await agent(
    `${CONTEXT}\n\nYou are the adversarial confirmer (round ${round}). For EACH finding below, try to REFUTE it by ` +
      `reading the actual code.\n` +
      `REJECT subjective style/polish, demonstrable false positives, and cases you have VERIFIED are already ` +
      `handled — cite the handling code in refutingEvidence. For correctness, permission, or data-integrity ` +
      `findings, uncertainty is NOT grounds for rejection: keep the finding and set confidence accordingly. ` +
      `Rejecting because you could not finish checking is an unfinished check, not a rejection.\n\n` +
      `${SEVERITY_RUBRIC}\n\n` +
      `Copy each reviewer's rating verbatim into reviewerSeverity. Re-rate against the rubric where the evidence ` +
      `warrants, in either direction — but any rating you place BELOW the reviewer's requires ` +
      `downgradeJustification naming the rubric clause that fails and the code you read that rules the higher tier ` +
      `out.\n\nFINDINGS:\n${renderFindings(uniq)}`,
    { label: `confirm:r${round}`, phase: 'Review', schema: CONFIRM_SCHEMA, effort: 'high' },
  )

  const confirmed = (confirm && confirm.confirmed) || []
  const rejected = (confirm && confirm.rejected) || []

  // A critical/high dropped without refuting evidence is an unfinished check, so it goes back on the
  // pile. Rejection was otherwise the cheapest exit of all: no fix, and invisible to the audit below.
  const unrefuted = rejected.filter(
    (r) => (r.severity === 'critical' || r.severity === 'high') && (r.refutingEvidence || '').trim().length < 20,
  )
  for (const r of unrefuted) {
    confirmed.push({
      ...r,
      reviewerSeverity: r.severity,
      downgradeJustification: '',
      confidence: 'reasoned',
      citation: { kind: 'none', ref: '' },
      line: 0,
      failure_scenario: '',
      fix: 'Confirmer dropped this without refuting evidence — verify against the code and fix if real.',
    })
  }
  if (unrefuted.length) {
    log(`Round ${round}: ${unrefuted.length} critical/high rejected without refuting evidence — reinstated`)
  }

  const blocking = confirmed.filter(isBlocking)
  log(
    `Round ${round}: ${confirmed.length} confirmed [eff ${severityTally(confirmed, effectiveSeverity)}] ` +
      `(${blocking.length} blocking), ${rejected.length} rejected`,
  )
  severityLog.push({
    round,
    raw: severityTally(uniq),
    confirmed: severityTally(confirmed, effectiveSeverity),
    downgrades: confirmed
      .filter((f) => rank(f.severity) > rank(f.reviewerSeverity))
      .map((f) => `${f.file}: ${f.reviewerSeverity}->${f.severity} (${f.downgradeJustification || 'UNJUSTIFIED'})`),
    uncitedBlocking: confirmed.filter((f) => isBlocking(f) && !cited(f)).map((f) => `${f.file}: ${f.summary}`),
    rejectedWithoutEvidence: unrefuted.map((r) => `[${r.severity}] ${r.file}: ${r.summary}`),
  })

  if (confirmed.length === 0) {
    dry = lastFixOk
    unverifiedFixes = []
    lastBlocking = []
    break
  }

  for (const f of confirmed) seen.set(fkey(f), (seen.get(fkey(f)) || 0) + 1)
  confirmed.sort((a, b) => rank(effectiveSeverity(a)) - rank(effectiveSeverity(b)))

  const fixList = confirmed.map((f, i) => `${i + 1}. ${f.file} — ${f.summary}\n   FIX: ${f.fix}`).join('\n')

  phase('Fix')
  const fix = await agent(
    `${CONTEXT}\n\nRound ${round} fix pass. Apply fixes for EVERY confirmed finding below — all of them, in the ` +
      `order given. Diagnose root causes, not symptoms.\n\n` +
      `Then run ONLY these fast gates:\n  ${FAST_GATES}\n` +
      `Do NOT run the full build, the Playwright e2e suite, docker compose, or the compose smoke test. GitHub CI ` +
      `covers all four and runs them in parallel with the next review round.\n\n` +
      `Then git add -A && git commit -s (message: fix(review): ...) and git push origin ${BRANCH}. Report the full ` +
      `head SHA after pushing. If a finding genuinely cannot or should not be fixed, list it as unfixable with its ` +
      `severity and a reason rather than forcing it.\n` +
      `Severity dispositions are not your call and must not be recorded in design.md.\n\n` +
      `CONFIRMED FINDINGS:\n${fixList}\n\nSet gatesGreen only if the fast gates actually passed.`,
    { label: `fix:r${round}`, phase: 'Fix', schema: FIX_SCHEMA, effort: 'high' },
  )

  // A fix agent that dies mid-response leaves its work ON DISK but unreported: the tool calls that
  // edited files already ran, only the final message failed. Twice now that has produced a PR that
  // looked complete and was not — auto-status had four files of confirmed fixes sitting uncommitted
  // while CI went green against the previous head, because the workflow believed the failure.
  // The script cannot run `git status` itself, so ask.
  let salvaged = null
  if (!fix || !fix.headSha) {
    salvaged = await agent(
      `${CONTEXT}\n\nThe round ${round} fix pass did not report back — it most likely died mid-response (a transient ` +
        `API error) AFTER its edits had already been written to disk. **Do not assume nothing happened.**\n\n` +
        `1. \`git -C ${REPO} status --porcelain\` and \`git -C ${REPO} diff\`. If the tree is CLEAN, nothing was ` +
        `salvaged — say so and stop.\n` +
        `2. If it is DIRTY, the fix pass got partway. Read the changes against the confirmed findings below and ` +
        `judge them: are they a coherent, complete attempt, or half-applied? Finish anything left incomplete.\n` +
        `3. Run the fast gates:\n   ${FAST_GATES}\n` +
        `   A dying agent often never reached the formatter, so expect \`pnpm lint\` to fail on formatting; ` +
        `\`pnpm format\` fixes that.\n` +
        `4. If the gates pass, git add -A && git commit -s (message: fix(review): ...) && git push origin ${BRANCH}, ` +
        `and report the head SHA.\n\n` +
        `Report honestly whether you recovered real work or found an empty tree — a false "recovered" is worse than ` +
        `a clean report of nothing.\n\nCONFIRMED FINDINGS THE PASS WAS APPLYING:\n${fixList}`,
      { label: `salvage:r${round}`, phase: 'Fix', schema: FIX_SCHEMA, effort: 'high' },
    )
    if (salvaged?.headSha) {
      log(`Round ${round}: salvaged uncommitted fix work from a dead agent — ${salvaged.headSha.slice(0, 8)}`)
    }
  }
  const effectiveFix = fix && fix.headSha ? fix : salvaged

  lastFixOk = Boolean(effectiveFix && effectiveFix.headSha && effectiveFix.gatesGreen)
  if (effectiveFix && effectiveFix.headSha) reviewedSha = effectiveFix.headSha
  if (effectiveFix && effectiveFix.unfixable) allUnfixable.push(...effectiveFix.unfixable)
  unverifiedFixes = confirmed.map((f) => `- [${effectiveSeverity(f)}] ${f.file} — ${f.summary}`)
  lastBlocking = blocking.map((f) => `- [${effectiveSeverity(f)}] ${f.file} — ${f.summary}`)
  log(
    `Round ${round}: fixed ${effectiveFix ? effectiveFix.fixed.length : 0}, ` +
      `unfixable ${effectiveFix ? effectiveFix.unfixable.length : 0}, ` +
      `fast gates ${lastFixOk ? 'green' : 'RED/not pushed'}${salvaged?.headSha ? ' (salvaged)' : ''}`,
  )

  // The last fix pass is re-reviewed once, whatever severity its findings carried. Rating a round down
  // therefore does not shorten the review, which is what makes the rating not worth bending. Rounds 2+
  // are a single delta reviewer, so the guarantee costs one agent rather than a full round.
  if (blocking.length === 0 && lastFixOk) {
    if (verified || round === MAX_ROUNDS) {
      dry = true
      break
    }
    verified = true
    continue
  }
  verified = false
}

const persistent = [...seen.entries()].filter(([, n]) => n >= 2).map(([k]) => k)
// A fix agent can retire any finding by declaring it unfixable. For critical/high that is a merge
// blocker decided in code, not a judgement call left to the merge prompt.
const unfixableBlocking = allUnfixable.filter((u) => u.severity === 'critical' || u.severity === 'high')
if (unfixableBlocking.length) dry = false

const audit = severityLog[severityLog.length - 1] || {}
const auditNotes = [
  audit.downgrades && audit.downgrades.length ? `Severity lowered by the confirmer: ${audit.downgrades.join('; ')}` : '',
  audit.uncitedBlocking && audit.uncitedBlocking.length
    ? `Blocking findings with no citation: ${audit.uncitedBlocking.join('; ')}`
    : '',
  audit.rejectedWithoutEvidence && audit.rejectedWithoutEvidence.length
    ? `Critical/high dropped without refuting evidence and reinstated: ${audit.rejectedWithoutEvidence.join('; ')}`
    : '',
].filter(Boolean)

const MERGE_STATE = unfixableBlocking.length
  ? `BLOCKED — a critical/high finding was declared unfixable: ` +
    `${unfixableBlocking.map((u) => `${u.summary} (${u.reason})`).join('; ')}. Do not merge around it.`
  : dry
    ? `review SETTLED — the last review surfaced no blocking findings` +
      (unverifiedFixes.length
        ? `, though the final round's fixes were applied after that review and have not themselves been re-reviewed.`
        : `.`)
    : lastFixOk
      ? `hit the ${MAX_ROUNDS}-round cap. The final round's blocking findings WERE fixed and the fast gates passed, ` +
        `but those fixes were never re-reviewed:\n${lastBlocking.join('\n')}\n` +
        `Verify them yourself in the diff before merging — do not merge on faith, and do not block on them if they ` +
        `are genuinely resolved.`
      : `the last fix pass did NOT land cleanly (fast gates red, or nothing was pushed). Treat as blocked unless you ` +
        `can establish from the diff and CI that the tree is actually correct.`

phase('Merge')
const merge = await agent(
  `${CONTEXT}\n\nFinal gate + merge decision for PR #${opened.prNumber} on branch ${BRANCH}.\n` +
    `State: ${MERGE_STATE}` +
    `${auditNotes.length ? `\n\nReview-integrity audit for the final round — weigh these, they are the places a real defect most easily slipped through:\n- ${auditNotes.join('\n- ')}` : ''}` +
    `${persistent.length ? `\nFindings that reappeared across rounds (possible stuck fixes): ${persistent.join('; ')}.` : ''}` +
    `${allUnfixable.length ? `\nReported unfixable: ${allUnfixable.map((u) => `[${u.severity}] ${u.summary} (${u.reason})`).join('; ')}.` : ''}` +
    `${unverifiedFixes.length ? `\nThese fixes landed in the final round and were NOT re-reviewed — eyeball them in the final diff:\n${unverifiedFixes.join('\n')}` : ''}\n\n` +
    `0. FIRST, check the PR is actually mergeable and that CI ran against its CURRENT head:\n` +
    `   \`gh pr view ${opened.prNumber} --json mergeable,mergeStateStatus,headRefOid\` and ` +
    `\`gh api repos/{owner}/{repo}/commits/<headRefOid>/check-runs --jq .total_count\`.\n` +
    `   - If \`mergeStateStatus\` is \`DIRTY\` or \`BEHIND\`, the base moved while the review rounds ran. Rebase onto ` +
    `${BASE}, resolve conflicts keeping BOTH sides' intent, re-run the fast gates, and \`git push ` +
    `--force-with-lease\`. Do not merge a branch you have not rebased.\n` +
    `   - **If the head commit has ZERO check-runs, CI never saw the code you are about to merge.** A green run on an ` +
    `older SHA is not evidence about this one — GitHub does not create \`pull_request\` runs while a PR is conflicted, ` +
    `so a stale-but-green PR is exactly the shape this trap takes. Rebase or push to trigger a run, then wait for it.\n` +
    `1. Do NOT re-run the gate suite locally. GitHub CI already covers lint, typecheck, unit + integration tests, ` +
    `build, catalog, boundaries, commit hygiene, the Playwright e2e suite, and the three-container compose smoke ` +
    `test. Run: gh pr checks ${opened.prNumber} --watch, then read EVERY check.\n` +
    `2. Know what CI does NOT cover, and do not read green as evidence about it: the e2e and smoke jobs start from ` +
    `FRESH VOLUMES, so upgrade-from-populated-database, concurrent multi-client convergence, sustained load, and ` +
    `long-lived-connection behavior are unobserved by every pass in this flow. If this change touches any of those, ` +
    `say so explicitly in your report rather than implying the suite vouched for it.\n` +
    `3. MERGE ONLY IF every GitHub CI check is green AND no blocking finding is genuinely unresolved. Where the ` +
    `state above asks you to verify unreviewed fixes, read those hunks in the diff and judge them — a fix that is ` +
    `real and complete does not block the merge. Then: gh pr review --approve (if self-approval is blocked, note it ` +
    `and proceed), then gh pr merge --squash --delete-branch. Confirm ${BASE} now contains the change.\n` +
    `4. If a blocking finding is genuinely unresolved OR any CI check is red: DO NOT merge. Leave the PR open and ` +
    `report exactly what blocks it. If a check is red, read its log and say which gate failed and why.\n\n` +
    `Report: merged or not, the CI check results, what CI could not tell you, and any residual issues.`,
  { label: 'merge:decide', phase: 'Merge', effort: 'high' },
)

return {
  pr: opened.prNumber,
  rounds: roundsRun,
  converged: dry,
  lastFixOk,
  persistent,
  unfixable: allUnfixable,
  // Kept so rating integrity is auditable across runs, not just within one: a rising rate of
  // downgrades, uncited blocking findings, or evidence-free rejections is the signal that the review
  // is terminating on ratings rather than on quality.
  severityLog,
  knownUnresolved: A.knownUnresolved || [],
  mergeReport: merge,
}
