// The subset of Zero's wire AST the test harnesses model, restated locally.
//
// `@rocicorp/zero` exports the runtime `Query` but not its AST/format types from its public entry,
// and the harness must be able to refuse a shape it does not understand (see design.md D-14). A
// local restatement makes "what we model" reviewable in one place: anything outside these types is
// an unmodelled construct and must throw rather than degrade.

export interface ColumnRef {
  readonly type: 'column'
  readonly name: string
}

export interface LiteralRef {
  readonly type: 'literal'
  readonly value: unknown
}

export interface SimpleCondition {
  readonly type: 'simple'
  readonly left: ColumnRef
  readonly right: LiteralRef
  readonly op: string
}

export interface JunctionCondition {
  readonly type: 'and' | 'or'
  readonly conditions: readonly Condition[]
}

export interface CorrelatedSubqueryCondition {
  readonly type: 'correlatedSubquery'
  readonly related: CorrelatedSubquery
  readonly op: 'EXISTS' | 'NOT EXISTS'
  readonly flip?: boolean
  readonly scalar?: boolean
}

export type Condition = SimpleCondition | JunctionCondition | CorrelatedSubqueryCondition

export interface Correlation {
  readonly parentField: readonly string[]
  readonly childField: readonly string[]
}

// `hidden` marks the join table of a junction relationship (`issue.labels` hops through
// `issue_label`): Zero runs it but hoists the far side up under the same alias, so the harness has
// to flatten it the same way or the shape it produces is not the shape a client receives.
export interface CorrelatedSubquery {
  readonly correlation: Correlation
  readonly subquery: QueryAst
  readonly hidden?: boolean
  readonly system?: string
}

export interface QueryAst {
  readonly table: string
  readonly alias?: string
  readonly where?: Condition
  readonly limit?: number
  readonly orderBy?: readonly (readonly [string, 'asc' | 'desc'])[]
  readonly related?: readonly CorrelatedSubquery[]
  readonly start?: unknown
}

// Zero's `Format`: whether a level is one row or many, recursively per relationship. It is what
// decides `.one()` and whether a related alias holds a row or an array — it is not in the AST.
export interface QueryFormat {
  readonly singular?: boolean
  readonly relationships?: Readonly<Record<string, QueryFormat>>
}

export interface BuiltQuery {
  readonly ast: QueryAst
  readonly format?: QueryFormat
}
