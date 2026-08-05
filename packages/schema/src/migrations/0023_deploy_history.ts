import { type Kysely, sql } from 'kysely'

// Deployment stops being a per-environment current state and becomes a history.
//
// `deployed_at` is the moment a deployment first reached `success`, and it is immutable once set:
// GitHub's `auto_inactive` flips a superseded deployment to `inactive` and bumps `updated_at`, so
// `updated_at` records the moment of SUPERSESSION, not of success. Without a separate column the
// fact is destroyed by the next deploy, and "how often do we ship" is unanswerable.
//
// `sha` is the commit the deployment carried — sent on every GitHub deployment object and dropped
// by the mapper until now. `pull_request.merge_commit_sha` is the other half of the exact
// PR->deployment join; both are free from payloads yapm already receives.
//
// All three nullable with no default and no CHECK: null means "not known", which is the truth for
// every row that predates this migration and for every deployment that has not succeeded. The
// write-once rule lives in `applyWorkGraphMutation`, not in a trigger — a second place for the rule
// is a second thing to drift. No backfill: the timestamp of a past success is exactly what was
// overwritten, and writing `updated_at` into `deployed_at` would manufacture a plausible wrong
// number indistinguishable from a real one. The reconcile cron heals what GitHub still lists.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('deployment').addColumn('deployed_at', 'timestamptz').execute()
  await db.schema.alterTable('deployment').addColumn('sha', 'text').execute()
  await db.schema.alterTable('pull_request').addColumn('merge_commit_sha', 'text').execute()

  // Every question asked of this column is asked within one team over a time window.
  await db.schema
    .createIndex('deployment_team_deployed_at_idx')
    .on('deployment')
    .columns(['team_id', 'deployed_at'])
    .execute()

  // The reconcile sweep IS the backfill (design §D5) — but it is a conditional GET gated by a
  // stored per-resource ETag, so on an unchanged deployment list GitHub answers `304`, the sweep
  // emits no mutation, and the commit and the success moment would only fill in on a repository's
  // NEXT deployment. Dropping the stored deployment-list ETags costs one unconditional re-poll per
  // mapped repo on the first sweep after the upgrade, which is what makes the backfill real rather
  // than promised. Every other resource's ETag is left alone: nothing about a PR or a check run
  // changed here.
  await sql`
    update connector_installation
    set etags = coalesce(
      (
        select jsonb_object_agg(key, value)
        from jsonb_each(etags)
        where key not like 'deployments:%'
      ),
      '{}'::jsonb
    )
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('deployment_team_deployed_at_idx').ifExists().execute()
  await db.schema.alterTable('pull_request').dropColumn('merge_commit_sha').execute()
  await db.schema.alterTable('deployment').dropColumn('sha').execute()
  await db.schema.alterTable('deployment').dropColumn('deployed_at').execute()
}
