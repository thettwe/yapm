// `runCycleMaintenance` sweeps EVERY cycle in its database — it has no team filter, by design.
// packages/schema's live-Postgres suites drive cycles through the same shared mutators, and turbo
// runs both `test` tasks at once, so on one shared database each tier completes and deletes rows
// the other is mid-assertion on. They get a database each instead: same Postgres container, no new
// service, and each tier owns a whole schema it can sweep without reaching another suite's rows.
export const SERVER_TEST_DATABASE = 'yapm_server_test'

// `runRetroAiDraftTail` sweeps EVERY `pending` retro_ai_draft row in its database — no workspace and
// no team filter, by design: one instance drains the queue for every workspace on it, and the batch
// limit exists so a backlog drains steadily rather than all at once. `ai/retro-draft.pg.test.ts`
// records the tables ONE tail pass reads and asserts SET EQUALITY against the D2 allowlist, which is
// what proves the retro content tables are unreachable from the AI pipeline. A pending row belonging
// to another suite — `ai/retro-draft.test.ts` and `ai/admin-routes.test.ts` both seed one, and vitest
// runs the files in parallel workers — is therefore swept into that recording, and the foreign team's
// facts add whatever they reach for (a prior retro's `retro_action`, say) to a set that must equal the
// allowlist exactly. The sweep is correct and the assertion is security-relevant, so neither gives:
// the recording gets a database nobody else writes, for the same reason the tiers each get one.
export const RETRO_DRAFT_TEST_DATABASE = 'yapm_retro_draft_test'

export function withDatabase(connectionString: string, name: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${name}`
  return url.toString()
}
