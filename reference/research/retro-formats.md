# Retrospective Formats & Facilitation — Research for yapm

Research brief for building a retrospective feature in yapm. Covers the common
retro formats and when each fits, the canonical five-phase structure of a good
retro, the facilitation mechanics a tool must support, and the anti-patterns to
design against.

Scope note for yapm: this maps cleanly onto yapm's principles — **team-level, not
surveillance** (VISION #4), **reality over ritual** (a retro tool that can pull
real data — DORA, PR turnaround, CI health, incidents — into the "gather data"
phase instead of relying on memory), and **speed / keyboard-first**. Wherever a
mechanic below could be fed by yapm's native work graph rather than asked of a
human, that is the differentiated path.

Sources are cited inline. Items I could not confirm against a primary/authoritative
source are marked **UNVERIFIED**.

---

## 1. The canonical structure: Derby & Larsen's five phases

The dominant mental model for retrospective structure comes from Esther Derby &
Diana Larsen, *Agile Retrospectives: Making Good Teams Great* (Pragmatic
Bookshelf, 2006). They define a **five-phase flow** that every session should move
through in order:

1. **Set the stage** — get everyone present and engaged; establish safety, the
   goal, and the working agreement for the session. Skipping it is a common
   mistake; a quick check-in dramatically raises participation because people who
   speak early are far more likely to speak later.
2. **Gather data** — build a *shared* picture of what actually happened during the
   period (both hard/objective data — metrics, events, timeline — and soft/subjective
   data — feelings, energy). This is "the only phase that fits the classical
   definition of the word retrospective (looking back on past events)."
3. **Generate insights** — analyze the gathered data to find patterns, root causes,
   and the "why" behind events (e.g. 5 Whys, fishbone). Move from *what* to *why*.
4. **Decide what to do** — prioritize and commit to a small number of concrete
   improvements / experiments with owners; turn insight into action items.
5. **Close the retrospective** — summarize commitments, appreciate contributions,
   and reflect on the retro itself (retro the retro).

Sources:
- Derby & Larsen, *Agile Retrospectives* (book PDF excerpt lists the five stages):
  https://agile.2ia.net/Agile%20Retrospectives.pdf
- Retrium, "The Five Phases of a Successful Retrospective":
  https://www.retrium.com/ultimate-guide-to-agile-retrospectives/five-phases-of-a-successful-retrospective
- Scrum.org forum, "The 5 Phases of the Retrospective":
  https://www.scrum.org/forum/scrum-forum/49541/5-phases-retrospective
- MindTools, "Sprint Retrospectives in Agile Project Management":
  https://www.mindtools.com/ao5tslk/sprint-retrospectives-in-agile-project-management/

**Design implication for a tool:** a retro tool should visibly model these phases
as steps (with the ability to skip/collapse for short retros), because the single
most common failure is teams jumping straight from a format's columns into
solutions, skipping *set the stage* and *generate insights*. A phase-aware UI
(with an optional per-phase timer) nudges teams through the full loop.

**Note on Norm Kerth's Prime Directive** — the safety statement Derby & Larsen
open retros with, from Norman Kerth's *Project Retrospectives* (2001):

> "Regardless of what we discover, we understand and truly believe that everyone
> did the best job they could, given what they knew at the time, their skills and
> abilities, the resources available, and the situation at hand."

This is the origin of the "blameless" framing. Source (quote confirmed across
multiple secondary sources; exact wording per Kerth):
https://docs.google.com/document/d/1lVOu9oxTP4BmB4WdB2L7p4ATU2PrOdLxQsMq10OgH3w/edit
and https://www.shortform.com/best-books/genre/best-scrum-books-of-all-time

---

## 2. Common formats and when each fits

All of these are essentially **column/quadrant schemes for the "gather data" phase**
(sometimes bleeding into "decide what to do"). The choice of format changes what
kind of reflection you provoke — action-focused, emotion-focused, learning-focused,
or forward-looking. A tool should treat them as **swappable templates over the
same underlying board + voting + action-item machinery**, not as separate features.

### Start / Stop / Continue
- **Columns:** Start doing, Stop doing, Continue doing.
- **What it provokes:** action-oriented, behavior-focused reflection. Low emotional
  overhead — good for teams that "get twitchy" talking about feelings.
- **Best fit:** new teams; teams that want simple, concrete outcomes fast; can also
  be run lightning-round at the *end* of another retro to crystallize action items.
- **Weakness:** shallow; can miss root causes and emotional signals.
- Sources: Atlassian, "9 retrospective techniques":
  https://www.atlassian.com/blog/teamwork/revitalize-retrospectives-fresh-techniques
  ; format comparison: https://kollabe.com/posts/retrospective-formats-compared

### Mad / Sad / Glad
- **Columns:** Mad (angry/irritated), Sad (disappointed), Glad (happy).
- **What it provokes:** *emotional* reflection — surfaces how the work felt before
  jumping to problem-solving; individual emotional journey.
- **Best fit:** after emotionally significant periods — a failed release, high
  stress, conflict, a big win, post-incident; or when a team seems disengaged.
  Naming feelings first often unblocks honest conversation other formats can't.
- **Weakness:** can stay in venting mode if not paired with an action phase.
- Sources: Atlassian (above); Kollabe (above); Echometer "21 retrospective
  techniques": https://echometerapp.com/en/21-retrospective-techniques/

### 4Ls — Liked / Learned / Lacked / Longed-for
- **Columns:** Liked, Learned, Lacked, Longed for.
- **What it provokes:** balanced reflection that explicitly includes **learning**
  and **unmet needs/desires**, not just good/bad.
- **Best fit:** end of a project/milestone, or teams that want to dig into learning
  and knowledge-sharing; also works well as a *personal* retrospective (year in
  review, performance period).
- Sources: Atlassian "Like, loathed, lacked, learned" variant (above); Atlassian
  Team Playbook 4Ls (referenced from the article); sessionplan.de "5 Retrospective
  Formats That Actually Work": https://sessionplan.de/en/blog/retrospective-formats
- **UNVERIFIED:** attribution of 4Ls to a specific originator (commonly credited to
  Mary Gorman & Ellen Gottesdiener) — could not confirm a primary source in this
  research pass.

### Sailboat / Speedboat
- **Elements (metaphor):** the boat = the team/goal; **Wind** = what pushes you
  forward; **Anchors** = what holds you back / bottlenecks; **Rocks** = risks and
  obstacles ahead; **Land / Island** = the goal or vision. (Speedboat is the same
  metaphor with a motorboat, often just anchors = what slows you down.)
- **What it provokes:** *forward-looking* + visual/metaphorical thinking. The
  "Rocks" (upcoming risks) category is explicitly future-oriented, which most
  formats are not.
- **Best fit:** teams stuck producing the same feedback every sprint; when you want
  to shift from "what went wrong" to "what's coming next"; visual teams tired of
  text-heavy columns.
- **Tool need:** benefits from a drawing/canvas or at least an image template;
  translates less cleanly to pure columns than Start/Stop/Continue does.
- Sources: Atlassian (Sailboat section, above); Kollabe (Sailboat, above).

### DAKI — Drop / Add / Keep / Improve
- **Columns:** Drop (stop entirely), Add (new practice), Keep (working, retain),
  Improve (exists but needs to be better).
- **What it provokes:** process auditing with a key nuance over Start/Stop/Continue:
  it separates "add something new" from "improve something that partly works" — so
  mature teams can fine-tune rather than make blunt start/stop calls. Every item
  maps to a clear action type.
- **Best fit:** established teams with practices worth evaluating; process changes;
  quarterly reviews / process audits.
- **Weakness:** very similar to Start/Stop/Continue (teams may not feel a
  difference); can be over-process-focused at the expense of team dynamics; "Drop"
  and "Improve" overlap when something is mostly broken; weak for brand-new teams.
- Source: Kollabe (DAKI section, above); goretro.ai:
  https://www.goretro.ai/post/agile-retrospective-formats

### What-went-well / What-didn't (Glad/Sad, "Plus/Delta", "Went well / To improve")
- **Columns:** What went well, What didn't go well (often + a third: action items /
  what to change).
- **What it provokes:** the simplest good/bad split; fastest to run.
- **Best fit:** default/first retro for a team; time-boxed short retros; when you
  want zero learning curve. Often the implicit baseline every other format extends.
- **Weakness:** binary; no nuance, no emotion, no forward look; risks skipping root
  cause.
- Source: general/common knowledge; easyretro "17+ Most Popular Retrospective
  Formats": https://easyretro.io/ideas/retrospective-formats/ **(secondary)**

### KALM — Keep / Add / Less / More
- **Quadrants:** Keep (valuable, continue), Add (new activities to try), Less (do
  less of — draining/low-value), More (do more of — high-value).
- **What it provokes:** weighing the *perceived value* of current activities on a
  spectrum (not just binary start/stop) — trims waste and amplifies what works.
  Distinct from DAKI mainly in "Less/More" being dial-turning vs DAKI's
  "Drop/Improve."
- **Best fit:** teams tuning an existing, functioning process; when you want
  gradation rather than all-or-nothing.
- Sources: FunRetrospectives (the canonical description of KALM as an activity):
  https://www.funretrospectives.com/kalm-keep-add-more-less/ ; TeamRetro KALM
  template: https://www.teamretro.com/retrospective-templates/kalm-retrospective/
  ; Scatterspoke: https://www.scatterspoke.com/retrospective-library/kalm-retrospective/

### Starfish — Keep Doing / More Of / Less Of / Start / Stop
- **Five categories (arms of the starfish):** Keep doing, More of, Less of, Start
  doing, Stop doing.
- **What it provokes:** the most *granular* of the "action" formats — adds intensity
  gradation (more/less) on top of the binary start/stop/keep. Balance +
  actionability.
- **Best fit:** mature teams that find Start/Stop/Continue too coarse and want
  nuance about *degree*, not just presence/absence.
- **Weakness:** five categories can overwhelm new teams; "Less of" vs "Stop" and
  "More of" vs "Start" boundaries blur.
- Attribution: widely credited to **Patrick (Pat) Kua**. **UNVERIFIED** against a
  primary Kua source in this pass; asserted by multiple secondary sources.
- Sources: TeamRetro Starfish template:
  https://www.teamretro.com/retrospective-templates/starfish-retrospective/ ;
  Teleretro: https://www.teleretro.com/retro-formats/starfish ;
  sessionplan.de (above).

### Quick "which format when" cheat sheet
| Situation | Suggested format |
|---|---|
| Brand-new team / first retro | What-went-well/didn't, or Start/Stop/Continue |
| Want concrete actions, low emotion | Start/Stop/Continue |
| After a painful/emotional period or incident | Mad/Sad/Glad |
| End of project / milestone, focus on learning | 4Ls |
| Stuck in a rut, want forward look at risks | Sailboat/Speedboat |
| Mature team auditing its process | DAKI or KALM |
| Want nuance on *degree* (more/less) | Starfish or KALM |
| Quarterly / process-change review | DAKI |

**A common composite pattern:** run an emotion-surfacing format (Mad/Sad/Glad) for
*gather data*, then switch to an action format (DAKI or Start/Stop/Continue) for
*decide what to do*. A good tool should let a team mix phases rather than lock the
whole session to one template. Source: Kollabe FAQ (above).

---

## 3. Facilitation mechanics a tool must support

These are the concrete features that separate a real retro tool from a shared doc.

### 3.1 Anonymous vs attributed input
- **Anonymous input** removes social pressure and fear of reprisal, which is
  especially important for remote/distributed teams (reduced social cues), for
  junior members, and when there are power differentials (manager in the room).
  Tools that allow anonymous input are repeatedly cited as a core lever for a
  psychologically safe retro.
- **Attributed input** is valuable when the team already has high trust and wants
  faster follow-up ("tell me more about your card"), accountability, and recognition.
- **Design guidance:** support *both*, ideally configurable per-board or even
  per-column; consider "anonymous during writing, reveal optional during discussion."
  Default toward anonymous for young/low-trust teams.
- Sources: TeamRetro "Build a psychologically safe retrospective" (lists
  anonymous-input tooling as a pillar):
  https://www.teamretro.com/guides/scrum-masters-retrospective-guide/how-to-build-a-psychologically-safe-space/
  ; Kollabe remote-teams FAQ (anonymity compensates for reduced social pressure,
  above).

### 3.2 Timed phases / timer
- Retros are time-boxed (classically ~60–90 min for a 2-week sprint). Each phase
  gets its own budget; Retrium's example allocation: Set the stage 10m, Gather data
  10m, Generate insights 20m, Decide what to do 15m, Close 5m.
- **Tool need:** a visible countdown timer, ideally per-phase, with the ability to
  extend; silent independent writing is usually time-boxed (e.g. 5–7 min) before
  discussion. Timers keep the session from dying in the first column and protect
  the *decide/close* phases that tend to get squeezed.
- Source: Retrium five-phases timing example (above).

### 3.3 Dot voting / weighted voting to prioritize
- After data is gathered you typically have far more items than you can discuss.
  **Dot voting** gives each participant a fixed budget of votes ("dots") to spend on
  the items/topics they most want to discuss or act on; highest-voted items rise to
  the top and set the discussion order.
- **Variants a tool should consider:** N votes per person (typical 3–5); allow
  stacking multiple votes on one item (weighted/cumulative voting) vs one-per-item;
  anonymous vs visible vote tallies (hide running totals to avoid bandwagoning,
  reveal at the end).
- Source: Retrium, "Use Agile Dot Voting To Prioritize Your Retrospective Topics":
  https://www.retrium.com/blog/use-agile-dot-voting-to-prioritize-and-filter-a-list-of-topics

### 3.4 Grouping / clustering similar cards
- Independently written cards produce duplicates and themes. Facilitators **group
  (cluster) similar cards** into affinity groups and name the theme, usually
  *before* voting so people vote on themes rather than splitting votes across
  duplicates.
- **Tool need:** drag-to-group / merge cards, group labels, and vote-on-group.
  Auto-clustering suggestions (by similarity) are a plausible AI-assisted feature but
  should stay human-confirmed.
- Source: implied across Derby/Larsen "generate insights" phase and tool guides;
  Retrium/TeamRetro treat grouping as standard board behavior **(secondary)**.

### 3.5 Converting discussion into action items with owners
- The output of a retro is **a small number of committed action items**, each with a
  clear **owner** and ideally a due date / definition of done. Keep the count small
  (often 1–3) so they actually get done.
- **Tool need:** promote a card/discussion into an action item; assign an owner;
  set a due date; carry action items *forward* to the next retro and show their
  status (done / not done / in progress). This carry-over loop is the single
  highest-leverage feature for making retros matter.
- **yapm-specific opportunity:** an action item should be able to become (or link to)
  a real yapm issue in the work graph — so "improve flaky-test rate" is a tracked
  issue whose completion is visible, not a sticky note that evaporates. This is
  directly "reality over ritual": the retro's decisions live in the same graph as
  the work, and next sprint's *gather data* phase can auto-surface whether last
  sprint's action items shipped.
- Source: Derby/Larsen "decide what to do"; Retrium five-phases (above).

### 3.6 Psychological safety — why anonymity + team-level framing matter
- **Psychological safety** (Amy Edmondson): "a belief that one will not be punished
  or humiliated for speaking up with ideas, questions, concerns, or mistakes."
  Edmondson's research links it to both group learning and group performance —
  safe teams learn and perform better. It is *not* lowering standards or removing
  accountability.
- Levers a tool/facilitator uses to build it: the **Prime Directive** (blameless
  framing, §1), **anonymous input**, **team-level (not individual) framing** of
  findings, working agreements, and modeling openness.
- **Team-level framing** matters for the same reason yapm forbids individual
  leaderboards (VISION #4): the moment a retro surfaces "whose fault" or ranks
  individuals, honesty collapses and people stop bringing real problems. Findings
  and any metrics shown in-retro should be about the *system and the team*, never a
  named person's output.
- Sources: Amy Edmondson (definition + performance link):
  https://amycedmondson.com/category/psychological-safety/ ; Retrium Ch.7
  "Psychological Safety":
  https://www.retrium.com/ultimate-guide-to-agile-retrospectives/psychological-safety
  ; TeamRetro (Prime Directive + anonymous input as safety tools, above);
  The Learner Lab (Edmondson: safety predicts learning & performance):
  https://thelearnerlab.com/a-guide-to-psychological-safety/

---

## 4. Anti-patterns to design against

1. **Blame instead of blameless.** Retros that hunt for who screwed up destroy
   safety and future candor. Counter with the Prime Directive, team-level framing,
   and (for low-trust teams) anonymity. A blame culture is *the* failure mode.
   (Kerth Prime Directive; Edmondson; Retrium/TeamRetro, above.)

2. **Action items that evaporate.** The most-cited practical failure: the team
   generates good actions, nobody owns them, nothing is tracked, and next retro
   surfaces the same complaints. Counter: few actions, explicit owners + due dates,
   and **carry-over with visible status** into the next retro. (Derby/Larsen "decide
   what to do"; widely reported. Primary-source strength: **secondary/practitioner
   consensus**.)

3. **Skipping the gather-data step (jumping to solutions).** Engineers' bias is to
   jump straight into fixing. Skipping *set the stage* and especially *gather data*
   means the team solves symptoms without a shared, factual picture — and quieter
   voices never get to add data. Counter: a phase-aware flow that makes gather-data
   a required, time-boxed step, ideally seeded with real metrics/events.
   (Retrium five-phases explicitly warns against skipping set-the-stage and frames
   gather-data as the phase teams undervalue, above.)

4. **Other common anti-patterns (secondary sources, worth designing for):**
   - **Same format every time → boredom / rote answers.** Rotate formats; support a
     library of templates. (Atlassian "won't bore your team to tears", above.)
   - **Facilitator dominates / HiPPO effect.** Silent independent writing + anonymous
     input + dot voting distribute influence away from the loudest/most-senior voice.
   - **Venting with no synthesis.** Emotion formats (Mad/Sad/Glad) without a
     generate-insights + decide phase become gripe sessions. Pair with an action
     phase.
   - **No time-box / running long.** Fatigue kills the decide/close phases. Per-phase
     timers.
   - **Metrics used to rank individuals.** Turns the retro into surveillance and
     ends honesty — aligns with yapm's explicit "metrics for teams, never
     surveillance" stance.

---

## 5. Distilled requirements checklist for a yapm retro feature

Must-support (table-stakes, all backed above):
- Phase-aware flow modeling Derby/Larsen's 5 phases (skippable for short retros),
  with per-phase timers.
- A **library of swappable format templates**: Start/Stop/Continue, Mad/Sad/Glad,
  4Ls, Sailboat/Speedboat, DAKI, What-went-well/didn't, KALM, Starfish — as column/
  quadrant configs over one board engine; ability to mix formats across phases.
- **Anonymous vs attributed** input, configurable (default anonymous for young teams).
- Silent independent writing (time-boxed) before reveal/discussion.
- **Grouping/clustering** of similar cards with named themes; vote on groups.
- **Dot / weighted voting** with a per-person budget; option to hide running tallies.
- **Action items** with owners + due dates; **carry-over with status** into the next
  retro.
- Safety scaffolding: Prime Directive surfaced at "set the stage"; team-level framing;
  no individual ranking.

yapm differentiators (reality over ritual):
- Auto-seed the **gather-data** phase from the native work graph — DORA four keys,
  PR review turnaround, PR size, CI health / flaky-test rate, MTTR, incidents this
  cycle — so data comes from git/CI/deploys, not memory. All **team-level**.
- Action items become/link to real yapm **issues**, so retro decisions are tracked in
  the same graph and their completion is visible next cycle (closes the
  "action items evaporate" gap structurally).
- Keyboard-first, fast board interactions consistent with "speed is the feature."

---

## 6. Source list (URLs)

- Derby & Larsen, *Agile Retrospectives* (PDF): https://agile.2ia.net/Agile%20Retrospectives.pdf
- Retrium — Five Phases: https://www.retrium.com/ultimate-guide-to-agile-retrospectives/five-phases-of-a-successful-retrospective
- Retrium — Psychological Safety (Ch.7): https://www.retrium.com/ultimate-guide-to-agile-retrospectives/psychological-safety
- Retrium — Dot Voting: https://www.retrium.com/blog/use-agile-dot-voting-to-prioritize-and-filter-a-list-of-topics
- Scrum.org — 5 Phases: https://www.scrum.org/forum/scrum-forum/49541/5-phases-retrospective
- MindTools — Sprint Retrospectives: https://www.mindtools.com/ao5tslk/sprint-retrospectives-in-agile-project-management/
- Atlassian — 9 retrospective techniques: https://www.atlassian.com/blog/teamwork/revitalize-retrospectives-fresh-techniques
- Kollabe — Retrospective Formats Compared: https://kollabe.com/posts/retrospective-formats-compared
- sessionplan.de — 5 Retrospective Formats That Actually Work: https://sessionplan.de/en/blog/retrospective-formats
- Echometer — 21 retrospective techniques: https://echometerapp.com/en/21-retrospective-techniques/
- goretro.ai — Agile Retrospective Formats: https://www.goretro.ai/post/agile-retrospective-formats
- easyretro.io — 17+ Popular Formats: https://easyretro.io/ideas/retrospective-formats/
- FunRetrospectives — KALM: https://www.funretrospectives.com/kalm-keep-add-more-less/
- TeamRetro — KALM template: https://www.teamretro.com/retrospective-templates/kalm-retrospective/
- Scatterspoke — KALM: https://www.scatterspoke.com/retrospective-library/kalm-retrospective/
- TeamRetro — Starfish template: https://www.teamretro.com/retrospective-templates/starfish-retrospective/
- Teleretro — Starfish: https://www.teleretro.com/retro-formats/starfish
- TeamRetro — Psychologically safe retrospective: https://www.teamretro.com/guides/scrum-masters-retrospective-guide/how-to-build-a-psychologically-safe-space/
- Amy Edmondson — Psychological Safety: https://amycedmondson.com/category/psychological-safety/
- The Learner Lab — Psychological Safety guide: https://thelearnerlab.com/a-guide-to-psychological-safety/
- Kerth Prime Directive (quote, secondary): https://docs.google.com/document/d/1lVOu9oxTP4BmB4WdB2L7p4ATU2PrOdLxQsMq10OgH3w/edit ; https://www.shortform.com/best-books/genre/best-scrum-books-of-all-time

### UNVERIFIED / low-confidence items
- **4Ls originator** (commonly credited to Mary Gorman & Ellen Gottesdiener) — no
  primary source confirmed here.
- **Starfish originator** (Pat Kua) — asserted by multiple secondary sources; no
  primary Kua source confirmed here.
- **Exact per-phase time allocations** — Retrium's example is one reasonable split,
  not a canonical standard; teams vary.
- Format-comparison "best fit" judgments draw on practitioner tool blogs
  (Kollabe, Atlassian, TeamRetro, etc.), i.e. **secondary/practitioner consensus**,
  not peer-reviewed research, except the psychological-safety claims (Edmondson).
