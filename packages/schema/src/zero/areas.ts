import * as z from 'zod'

// Product areas: the admin-authored substitution that turns repository file paths into yapm-computed
// labels BEFORE anything is assembled for a model. This is the same structural move as never
// selecting an identity column — the model cannot disclose a path it was never given — and it is
// much stronger than filtering paths out of the output afterwards.
//
// The substitution is TOTAL. There is no input, including an empty rule set, for which a raw path
// is returned: an unmatched path becomes `UNMAPPED_AREA`. Pure, no dependency beyond zod.

export const areaRuleSchema = z.object({
  prefix: z.string().min(1),
  area: z.string().min(1),
  // Touching this area is a risk signal worth surfacing; never a judgement about the change.
  sensitive: z.boolean().optional(),
  // Work here collapses into one "N internal improvements" line rather than being narrated.
  internal: z.boolean().optional(),
})

// An ORDERED array, not a record: order is semantic (first match wins), so `apps/server/src/billing/`
// can win over `apps/server/`. A record would leave the winner up to key iteration order.
export const areaMapSchema = z.array(areaRuleSchema).default([])

export type AreaRule = z.infer<typeof areaRuleSchema>
export type AreaMap = z.infer<typeof areaMapSchema>

// The reserved fallback label. Reserved rather than pass-through: a fall-through that leaked the raw
// path would destroy the whole safety claim on the first repository an admin had not finished mapping.
export const UNMAPPED_AREA = 'unmapped'

export const CHANGE_SIZE_BANDS = ['xs', 's', 'm', 'l', 'xl'] as const

export type ChangeSizeBand = (typeof CHANGE_SIZE_BANDS)[number]

// A band, never the raw churn: a band is the decision-grade fact, and a raw line count invites the
// model to editorialize about it.
export function changeSizeBand(totalChanges: number): ChangeSizeBand {
  if (totalChanges < 10) return 'xs'
  if (totalChanges < 50) return 's'
  if (totalChanges < 250) return 'm'
  if (totalChanges < 1000) return 'l'
  return 'xl'
}

function normalizePath(value: string): string {
  let out = value.trim()
  while (out.startsWith('./')) out = out.slice(2)
  while (out.startsWith('/')) out = out.slice(1)
  return out.toLowerCase()
}

// Literal prefixes only — no glob, no regex. A regex typed into an admin form is an untyped
// denial-of-service surface (catastrophic backtracking) and a glob library is a dependency for a
// problem a prefix solves: repositories are directory trees and product areas are directories.
export function matchArea(rules: readonly AreaRule[], path: string): AreaRule | null {
  const normalized = normalizePath(path)
  for (const rule of rules) {
    const prefix = normalizePath(rule.prefix)
    if (prefix.length > 0 && normalized.startsWith(prefix)) return rule
  }
  return null
}

// An area as the fact layer needs it: the label plus the two admin flags. Carries no path.
export interface AreaDefinition {
  readonly area: string
  readonly sensitive?: boolean
  readonly internal?: boolean
}

export interface PathAreas {
  readonly areas: readonly string[]
  readonly sensitive: readonly string[]
  // True only when the path list is non-empty and every path matched a rule marked `internal`.
  readonly internalOnly: boolean
}

// Every path becomes a label. Deduplicated and sorted so the same file set always produces the same
// object, which is what makes a truncated or re-run enrichment reproducible.
export function areasForPaths(rules: readonly AreaRule[], paths: readonly string[]): PathAreas {
  const areas = new Set<string>()
  const sensitive = new Set<string>()
  let internalOnly = paths.length > 0
  for (const path of paths) {
    const rule = matchArea(rules, path)
    if (!rule) {
      areas.add(UNMAPPED_AREA)
      internalOnly = false
      continue
    }
    areas.add(rule.area)
    if (rule.sensitive) sensitive.add(rule.area)
    if (!rule.internal) internalOnly = false
  }
  return {
    areas: [...areas].sort(),
    sensitive: [...sensitive].sort(),
    internalOnly,
  }
}

// The label→flags catalog the fact layer aggregates against, collapsed from the ordered rules (the
// same label may appear in several rules; a flag set anywhere wins).
export function areaCatalogFromRules(rules: readonly AreaRule[]): AreaDefinition[] {
  const byArea = new Map<string, { area: string; sensitive: boolean; internal: boolean }>()
  for (const rule of rules) {
    const existing = byArea.get(rule.area) ?? { area: rule.area, sensitive: false, internal: false }
    existing.sensitive = existing.sensitive || rule.sensitive === true
    existing.internal = existing.internal || rule.internal === true
    byArea.set(rule.area, existing)
  }
  return [...byArea.values()].map((entry) => ({
    area: entry.area,
    ...(entry.sensitive ? { sensitive: true } : {}),
    ...(entry.internal ? { internal: true } : {}),
  }))
}
