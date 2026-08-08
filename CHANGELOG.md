# Changelog

## 1.0.0 (2026-08-08)


### Features

* **ai:** BYO-key AI foundation — provider-agnostic gateway, work-graph agents, team-internal cycle digest ([#6](https://github.com/thettwe/yapm/issues/6)) ([dc1f425](https://github.com/thettwe/yapm/commit/dc1f42544bd801c7043438a3010389e4fc1bdc7e))
* **ai:** retention, the disclosure audit view, and a link-only ready email ([#24](https://github.com/thettwe/yapm/issues/24)) ([8593f55](https://github.com/thettwe/yapm/commit/8593f552c77a7e18bf6fcd5885da429225fcc7ff))
* **ai:** the PM disclosure boundary — audited, default-off, review-gated ([#22](https://github.com/thettwe/yapm/issues/22)) ([b3f4176](https://github.com/thettwe/yapm/commit/b3f417621729133c85c90b2e7bfdd812bea11c06))
* **attachments:** provider-neutral storage with permission-scoped serving ([#16](https://github.com/thettwe/yapm/issues/16)) ([e1c11bc](https://github.com/thettwe/yapm/commit/e1c11bc1a8a02a7c0bfe63a88b1fc19e7c524504))
* **auth:** add in-process better-auth with workspace membership and Zero sync gate ([0009698](https://github.com/thettwe/yapm/commit/0009698d481712e22f4089476f9158deb5a74d88))
* **auth:** add role-scoped Zero queries and mutators for workspace permissions ([f5e149b](https://github.com/thettwe/yapm/commit/f5e149b1a02cfbfa8e77283244ac7a418c7889b9))
* **board:** keyboard-first kanban board with dnd-kit + fractional ordering ([#1](https://github.com/thettwe/yapm/issues/1)) ([3514af3](https://github.com/thettwe/yapm/commit/3514af3c55603dd3d6fd263e07f222a8f150a205))
* **connectors:** first-party connector framework + GitHub connector — reality strip lights up ([#5](https://github.com/thettwe/yapm/issues/5)) ([01b2d2c](https://github.com/thettwe/yapm/commit/01b2d2cfb82051fe314aabf169b39de0d33a28f3))
* **connectors:** opt-in automatic status transitions driven by PR state ([#15](https://github.com/thettwe/yapm/issues/15)) ([d32e9c2](https://github.com/thettwe/yapm/commit/d32e9c274290535d64e51b5be55f5d3a47ec10f7))
* **connectors:** yapm-computed change areas from PR file paths ([#19](https://github.com/thettwe/yapm/issues/19)) ([fcc65e1](https://github.com/thettwe/yapm/commit/fcc65e18efb4cbd74756f65c7ac60bb154236484))
* **cycles:** time-boxed iterations with auto-rollover of unfinished issues ([#2](https://github.com/thettwe/yapm/issues/2)) ([82973e4](https://github.com/thettwe/yapm/commit/82973e4925a5c7350eac0366d4bd717a1c8a7ba4))
* **delivery:** the flow metrics get a home — a team-level Delivery view ([#29](https://github.com/thettwe/yapm/issues/29)) ([e297cc4](https://github.com/thettwe/yapm/commit/e297cc437ae0ada0bc331f1c766397462cd0bf55))
* **delivery:** the journalism cut — annotated timeline, distributions, and one binding rule ([#36](https://github.com/thettwe/yapm/issues/36)) ([31de6e0](https://github.com/thettwe/yapm/commit/31de6e0fc97a1f864ba3255ef7c17d379bfb29ea))
* **deploy:** self-host compose stack and one-command dev loop ([bc82bda](https://github.com/thettwe/yapm/commit/bc82bda8fd68fcf8eb0f4941d64ed1b6153d6a28))
* **editor:** images, tables, code blocks and a slash menu ([#18](https://github.com/thettwe/yapm/issues/18)) ([b33ecf4](https://github.com/thettwe/yapm/commit/b33ecf4aba0b92664d085fa9f0f005ddb4586b53))
* **frame:** three bands — the deck, the masthead, the statusline ([#33](https://github.com/thettwe/yapm/issues/33)) ([f57a61b](https://github.com/thettwe/yapm/commit/f57a61b4310d97d85750a9c420b4a40ae4632381))
* **issues:** issue detail panel with rich-text, comments, and deep-link ([11dbcd4](https://github.com/thettwe/yapm/commit/11dbcd4791c7a41615a959baa72a8b5ed2152357))
* **issues:** team issue list, keyboard model, and command palette ([7c349a5](https://github.com/thettwe/yapm/commit/7c349a5ca56fdbfeecc5221deff35918791cb27a))
* **issues:** the daylight list — phrases at rest, tracks, and a quiet filter bar ([#34](https://github.com/thettwe/yapm/issues/34)) ([9384cda](https://github.com/thettwe/yapm/commit/9384cda31be05b20379d90a836c77b6f0cb7b925))
* **issue:** two registers and a delivery rail — the issue detail ([#35](https://github.com/thettwe/yapm/issues/35)) ([b03b1ec](https://github.com/thettwe/yapm/commit/b03b1ecfe037955e737fab5077110afccb0a858e))
* **mentions:** @-mentions with durable issue subscriptions ([#10](https://github.com/thettwe/yapm/issues/10)) ([6171e41](https://github.com/thettwe/yapm/commit/6171e4104cdff620329b9d586e5a44247ef9834c))
* **monorepo:** scaffold pnpm workspace, Turborepo, and shared config ([077ec0e](https://github.com/thettwe/yapm/commit/077ec0e9db885055b801bb223142b5e7d471a2ea))
* **notifications:** in-app inbox and actionable email over a provider-neutral mailer ([#9](https://github.com/thettwe/yapm/issues/9)) ([6da1ae4](https://github.com/thettwe/yapm/commit/6da1ae4cab6778c135984f897f31a172ff2bb1d1))
* **process:** add a docs/spec-only change flow ([189acd0](https://github.com/thettwe/yapm/commit/189acd0b8ff878702dd25e0bea294fe8dfb15985))
* **process:** let change-build-flow resume a partly-built change ([dcad64a](https://github.com/thettwe/yapm/commit/dcad64a2d63685b29354b328ddb958159d5aa316))
* **projects:** lightweight projects with computed progress and a roadmap timeline ([#4](https://github.com/thettwe/yapm/issues/4)) ([e4c7bdf](https://github.com/thettwe/yapm/commit/e4c7bdf513fcd7da3c2552e9c747a68678765008))
* **retro:** AI proposes, the team disposes — ratification, verdicts and the loop closing ([#21](https://github.com/thettwe/yapm/issues/21)) ([e467947](https://github.com/thettwe/yapm/commit/e46794781368d4ecd7b937070cc57c8d73e54bec))
* **retro:** AI-drafted blameless findings, generated lazily at the phase advance ([#20](https://github.com/thettwe/yapm/issues/20)) ([46b8aff](https://github.com/thettwe/yapm/commit/46b8aff5820699bb4a03e993b8de17850ac02b46))
* **retro:** data-seeded retrospective board with server-enforced phases and the action-to-issue loop ([#8](https://github.com/thettwe/yapm/issues/8)) ([1089904](https://github.com/thettwe/yapm/commit/10899042a130177acb1c96689520550928395483))
* **retro:** did last cycle's improvements ship? — the fact that makes the retro compound ([#23](https://github.com/thettwe/yapm/issues/23)) ([373aa15](https://github.com/thettwe/yapm/commit/373aa15a001977a91286f65c5c4b922ca2967a4a))
* **schema:** add workspace, membership, team, and invite schema ([485c0d4](https://github.com/thettwe/yapm/commit/485c0d47907c796a633f0408ae5da2674dc570f0))
* **schema:** issue-core tables, queries, mutators, and drift coverage ([6f908b7](https://github.com/thettwe/yapm/commit/6f908b726f31d8f1a78c210dbf62e29e329ec5c6))
* **search:** instant-then-complete hybrid search across issues and comments ([#12](https://github.com/thettwe/yapm/issues/12)) ([c910b05](https://github.com/thettwe/yapm/commit/c910b05903d166b5262df298ec12da61a70fa9b2))
* **server:** boot Hono server with validated env, migrations, and health probes ([d357a6b](https://github.com/thettwe/yapm/commit/d357a6bf45e838d8d208ab5a0aa72c3bbe229f5a))
* **sync:** add Zero local-first sync walking skeleton ([af81453](https://github.com/thettwe/yapm/commit/af814532ecfc5e5f18462294d99daac8198992c0))
* **team-home:** the team page becomes the morning digest ([#31](https://github.com/thettwe/yapm/issues/31)) ([2d75a8a](https://github.com/thettwe/yapm/commit/2d75a8a7ab69fbce71c6ea6277803809c4fe731f))
* **theme:** add accent customization and synced per-user theme preference ([02dd06d](https://github.com/thettwe/yapm/commit/02dd06d3b2fde92320b1cdb2234656dba2dee17b))
* **triage:** per-team triage inbox with keyboard accept/decline/route ([#3](https://github.com/thettwe/yapm/issues/3)) ([29b2fde](https://github.com/thettwe/yapm/commit/29b2fde7b291fb83da07feb415cdd73e7e0984de))
* **ui:** add tokenized core components and themed showcase ([6860667](https://github.com/thettwe/yapm/commit/68606675acaa35695e481f6a213d781198f8e507))
* **ui:** tokenized three-preset theme system with AA-safe contrast ([c066c5d](https://github.com/thettwe/yapm/commit/c066c5d4ec23294f77f8e7610dca504346743d02))
* **web:** add Vite SPA, shadcn/Base UI package, and Ladle workbench ([30ae283](https://github.com/thettwe/yapm/commit/30ae2839eac29e33de4ff6bbbb69321064171675))
* **web:** add workspace auth UI with role-gated surfaces and invites ([676652a](https://github.com/thettwe/yapm/commit/676652a0fd08bee93e43c407b0e674177c98bf5d))
* **work-graph:** a durable deploy fact, and the PR→deployment edge ([#28](https://github.com/thettwe/yapm/issues/28)) ([2bcde7b](https://github.com/thettwe/yapm/commit/2bcde7b948ca3967bf971b7e91c6f4e06a792f48))


### Bug Fixes

* **auth:** admin-only SSO configuration, and a login button that tells the truth ([#27](https://github.com/thettwe/yapm/issues/27)) ([127e1e2](https://github.com/thettwe/yapm/commit/127e1e248cbd5f144ca1f790952a76a3c4f492e9))
* **deploy:** make the documented self-host path actually work and actually be secure ([#26](https://github.com/thettwe/yapm/issues/26)) ([6e8340a](https://github.com/thettwe/yapm/commit/6e8340a8a82ed8ea9f3c18dea07b2c7761c38aee))
* **design:** four corrections from reading the built pages ([#38](https://github.com/thettwe/yapm/issues/38)) ([6ed758d](https://github.com/thettwe/yapm/commit/6ed758d4de5152b89eb5f191467475afdeceed01))
* **issue:** the title input no longer clips at ~20 characters ([#37](https://github.com/thettwe/yapm/issues/37)) ([60dd998](https://github.com/thettwe/yapm/commit/60dd9982d5b58bd58c7cd9ec85e55eb512940830))
* **mentions:** the three review-fix rounds that missed the PR [#10](https://github.com/thettwe/yapm/issues/10) merge ([#11](https://github.com/thettwe/yapm/issues/11)) ([2b48421](https://github.com/thettwe/yapm/commit/2b48421c25fe5042acc15f1f1e77f787521da307))
* **process:** fail at the phase that actually died, not the next one ([635b27d](https://github.com/thettwe/yapm/commit/635b27d4ef2adfc0d9d95b056671064f5a81ecfa))
* **process:** salvage work from an agent that died after writing ([dc3e782](https://github.com/thettwe/yapm/commit/dc3e78217cbd5d5fe6c607bf919fc29dbd573cbb))
* **process:** stop the Sync phase merging the PR out from under review ([8471721](https://github.com/thettwe/yapm/commit/8471721bb0ce2a0adccbe3e7fccd8affc90b79fc))
* **search:** the final review-fix round that missed the PR [#12](https://github.com/thettwe/yapm/issues/12) merge ([#14](https://github.com/thettwe/yapm/issues/14)) ([9c4cf03](https://github.com/thettwe/yapm/commit/9c4cf03fa78d97fa80945f9b74d961836b420f4c))
* **sync:** recover from Zero error/disconnected states instead of looping on a dead connection ([#7](https://github.com/thettwe/yapm/issues/7)) ([f1987f5](https://github.com/thettwe/yapm/commit/f1987f5cb8bac8e72927f5e989a06c88b04b39cd))


### Performance Improvements

* **process:** restructure the build flow around continuous CI ([3a2efb0](https://github.com/thettwe/yapm/commit/3a2efb0db938b3ba54e73e72cbb32654077675aa))
