# projects-roadmap — tasks

## 1. Schema: project entity + issue reference

- [x] 1.1 Migration `0008_projects`: workspace-level `project` table (status check, nullable `lead_id`/`target_date`), `issue.project_id` (`ON DELETE SET NULL`) + indexes
- [x] 1.2 `PROJECT_STATUSES`/`ProjectStatus` in context; `ProjectTable` + `issue.project_id` in the Kysely `DB` interface
- [x] 1.3 Zero schema: `project` table, `issue.projectId`, workspace↔projects / project↔lead / project↔issues / issue↔project relationships
- [x] 1.4 Extend the schema-drift test (project table, issue.project_id); verify against live Postgres
- [x] 1.5 Seed demo projects (active + planned) and point a few demo issues at them

## 2. Mutators + queries

- [x] 2.1 `project.create` / `project.update` / `project.delete` (workspace-level, `canWrite`, lead validated as a workspace member) + unit tests
- [x] 2.2 `issue.setProject` (issue's team-scoped write gate; any team's issue may join any project) + unit tests
- [x] 2.3 `projects.all` / `projects.get` workspace-level (`isMember`) queries with `teamScoped` related issues; export the new surface
- [x] 2.4 Query-scoping tests: member-gated reads, non-member denied, related issues carry the membership predicate

## 3. Projects view (web)

- [x] 3.1 Project model (computed progress, sort order, roadmap layout) + unit tests
- [x] 3.2 `ProjectsView` + `/teams/$teamId/projects` route: rail, detail (metadata + progress + issues), create/edit/delete
- [x] 3.3 View-switch entry (adds Projects)

## 4. Roadmap timeline (web)

- [x] 4.1 `roadmapTimeline` pure layout (month axis, positions, now-line, undated aside) + unit tests
- [x] 4.2 `RoadmapView` + `/teams/$teamId/roadmap` route: tokenized, keyboard-navigable timeline
- [x] 4.3 View-switch entry (adds Roadmap)

## 5. List + palette integration

- [x] 5.1 Project group-by + project filter in the issue list (web-only axis, mirroring cycle)
- [x] 5.2 Command-palette "Move to project" action + `p` hotkey, writer-gated

## 6. Documentation

- [ ] 6.1 `apps/docs` Projects & roadmap feature page + sidebar + home link; `pnpm --filter @yapm/docs build` passes
- [ ] 6.2 Root docs: README (status + features), ROADMAP (#7 status)

## 7. Tests + gates

- [x] 7.1 Unit: mutator validation, progress math, roadmap layout, project scoping AST
- [ ] 7.2 E2E: keyboard-first project create + assign + roadmap navigation, viewer read-only
- [ ] 7.3 `pnpm turbo lint typecheck test build` green; docs build green
