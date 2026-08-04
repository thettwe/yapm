import * as z from 'zod'
import type { CycleFacts } from './cycle-facts.js'
import { digestContentSchema } from './digest.js'

// THE PM ARTIFACT'S CONTENT SHAPE, AND IT IS DELIBERATELY THE TEAM DIGEST'S SHAPE, BYTE FOR BYTE.
//
// `pmDigestContentSchema` IS `digestContentSchema`. That is not laziness — it is what makes all three
// shipped validators (`dropUncitedItems` → `dropItemsNamingMembers` → `dropItemsDisclosingPaths`)
// reusable with ZERO refactor of injection-critical code. A distinct PM shape would have forced
// `dropItemsDisclosingPaths`, which is typed to `DigestContent`, to be generalized onto `AiArtifact`
// — re-typing the exact code the disclosure guarantee rests on, for no behavioural gain and while
// this is the first change whose output crosses a permission boundary.
//
// What differs between the two artifacts is the SYSTEM PROMPT, the AUDIENCE and the RENDER. Not the
// shape. Do not add a second walker here, and do not generalize the ones in `digest.ts`.
export const pmDigestContentSchema = digestContentSchema

export type PmDigestContent = z.infer<typeof pmDigestContentSchema>

// What the row must carry so that the query serving it can traverse NOTHING. A PM outside the
// producing team can read no `team` row and no `cycle` row, so a `.related(...)` would be a second,
// ungated disclosure — the row is self-sufficient instead, and this is the yapm-authored half of it.
export const pmDigestSubjectSchema = z.object({
  teamName: z.string(),
  cycleName: z.string(),
  // Epoch millis, matching every other timestamp that crosses the sync boundary.
  startDate: z.number().nullable(),
  endDate: z.number().nullable(),
})

export type PmDigestSubject = z.infer<typeof pmDigestSubjectSchema>

// THE STORED BLOB: the model's content plus fields yapm authored and the model never saw. Separate
// from the model-facing schema for the same reason `storedDigestContentSchema` is — a field the
// model could fill is a field the model could invent.
export const storedPmDigestContentSchema = pmDigestContentSchema.extend({
  subject: pmDigestSubjectSchema.optional(),
  // Evidence id → a baked plain-text label like `ENG-142 · PR #331`. NOT a link, and the render
  // reads only from here: a PM outside the team can open none of the targets, so a link would
  // dead-end, and making it work means widening reads on issues and pull requests — a far larger
  // disclosure than the prose the link was meant to make verifiable.
  evidenceLabels: z.record(z.string(), z.string()).optional(),
})

export type StoredPmDigestContent = z.infer<typeof storedPmDigestContentSchema>

// One label per CITED evidence id, built from the same `CycleFacts` the model summarized.
// Pure, so the "labels come from yapm, never the model" claim is unit-testable on its own.
//
// `cited` IS A REQUIRED ARGUMENT, and that is the disclosure control rather than an optimization:
// the map is stored on the row and syncs verbatim to a reader outside the producing team, so a map
// built over the whole cycle would hand that reader every issue key and pull-request number of the
// cycle — including the work no surviving item mentions. Passing the ids the validated content
// actually cites keeps the stored map to exactly what the render can resolve. There is deliberately
// no default: a caller that does not know its citations must not get the whole index by omission.
//
// An issue contributes its key (`ENG-142` when the team key is known, `#142` when it is not); a
// linked pull request appends ` · PR #331`; a CI check inherits the label of the pull request it
// ran on, because "the check on ENG-142 · PR #331" is the only thing about it a PM can act on.
// An evidence id with no computed label renders as nothing rather than as a bare uuid — and an id
// the model invented was already dropped by `dropUncitedItems` before this map is consulted.
export function buildPmEvidenceLabels(
  facts: CycleFacts,
  cited: ReadonlySet<string>,
): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const issue of facts.issues) {
    const issueRef = issue.evidenceRefs.find((ref) => ref.kind === 'issue')
    const issueLabel = issueRef?.label
    if (issueLabel === undefined) continue
    // `current` still advances over every ref, cited or not: a CI check's label is inherited from
    // the pull request BEFORE it in the list, so skipping an uncited PR outright would mislabel a
    // cited check that ran on it.
    let current = issueLabel
    for (const ref of issue.evidenceRefs) {
      if (ref.kind === 'issue') {
        if (cited.has(ref.id)) labels[ref.id] = issueLabel
        continue
      }
      if (ref.kind === 'pull_request') {
        // `label` on a PR ref is the provider's own `#331`; absent, the issue label alone is honest.
        current = ref.label === undefined ? issueLabel : `${issueLabel} · PR ${ref.label}`
      }
      if (cited.has(ref.id)) labels[ref.id] = current
    }
  }
  return labels
}
