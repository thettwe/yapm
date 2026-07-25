// `runCycleMaintenance` sweeps EVERY cycle in its database — it has no team filter, by design.
// packages/schema's live-Postgres suites drive cycles through the same shared mutators, and turbo
// runs both `test` tasks at once, so on one shared database each tier completes and deletes rows
// the other is mid-assertion on. They get a database each instead: same Postgres container, no new
// service, and each tier owns a whole schema it can sweep without reaching another suite's rows.
export const SERVER_TEST_DATABASE = 'yapm_server_test'

export function withDatabase(connectionString: string, name: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${name}`
  return url.toString()
}
