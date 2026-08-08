---
title: Projects & roadmap
description: Lightweight, workspace-level projects with computed progress, and a keyboard-first roadmap timeline across teams.
---

A **project** is a lightweight way to group issues toward a shared outcome — a launch, a
milestone, a theme of work. Each project has a name, an optional **lead** (any workspace user),
a **status** (**Planned**, **Active**, **Completed**, or **Cancelled**), an optional **target
date**, and a **computed progress** (the share of its issues that are **Done**). The
**roadmap** lays your projects out on a timeline by target date, giving stakeholders a
cross-team overview at a glance.

Open **Projects** at `/teams/<teamId>/projects` and **Roadmap** at `/teams/<teamId>/roadmap`,
or take them from the **more▾** menu in [the deck](/features/app-frame/) — `g p` and `g m`.

## Projects are workspace-level

Unlike issues and cycles (which belong to a single team), **projects belong to the workspace**,
not a team. That is deliberate: a project is a cross-team overview, so an issue from **any**
team can belong to a project, and every workspace member — including free viewers — can see
every project. This is what makes the roadmap a whole-workspace picture rather than a per-team
one.

Because issues stay team-scoped, a project shows you the issues **you can see**: the ones in
teams you belong to. For a small team where everyone is in every team, that is the whole
project; if you are only in some of a cross-team project's teams, you see your teams' slice of
it, and its progress reflects that slice.

## The Projects view

The left rail lists every project, **Active** first, then **Planned**, then the terminal
states, each showing its target date and progress. Selecting one shows its detail: the status,
lead, target date, a progress bar, and the project's issues. Progress is the share of the
project's issues at **Done** — an empty project reads 0%, and canceled issues count toward the
total but not toward done.

## Creating and editing projects

Anyone who can write (admins and members — viewers are read-only) can create a project with the
**+** button in the Projects rail: give it a name, and optionally a lead, a status, and a target
date. Use **Edit** on a project to change any of those or to **Delete** it. Deleting a project
never deletes its issues — they are simply unassigned from it.

## Assigning issues to a project

From the issue list, open the command palette (⌘K / Ctrl-K) on a focused or selected issue —
or press **P** — and choose **Move to project**, then pick a project (or **No project** to
clear it). Any team's issue can join any project; the action respects your write permission on
that issue and is hidden for viewers.

**Routing an incoming issue is the second path.** The [triage](/features/triage/) inbox's
**Route** panel lists a **Project** row alongside status, assignee, cycle and labels, and writes
all five — plus clearing the triage flag — in one atomic action. It applies the same rule as
**Move to project**: the project need only exist in the workspace, because a project spans
teams, while the assignee, cycle and labels must belong to the issue's own team.

## The roadmap timeline

The roadmap places each project with a target date on a month axis, earliest to latest, with a
marker at its target and a line for **today**. Projects without a target date are listed
separately below the axis. It is fully keyboard-navigable: use **j/k** or the arrow keys to move
between projects and **Enter** to open one. The timeline is drawn entirely with the design
system — no heavy chart library — so it is fast and consistent in every theme, light and dark.

## Grouping and filtering by project in the list

The issue list can **filter by project** — pick one or more projects (or **No project**) to
narrow the list — and **group by project**, which buckets issues under each project with a **No
project** group last. Like the cycle axis, project grouping is a view-only convenience; saved
views persist the other groupings.

## Viewers

Viewers are free and unlimited and can read every project, its progress, and the roadmap like
anyone else. They cannot create, edit, or delete projects, and they cannot move issues into a
project — those actions are hidden and never written for a viewer.
