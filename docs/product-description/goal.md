# Goal: complete the Crowsnest core loop product description

You are working in the `docs/product-description/` directory of the Crowsnest repo. Read `README.md`, `glossary.md`, `foundations/interaction-model.md`, and `feed/save-to-vault.md` first. The README defines the purpose, the document template, the method, the structure, and the coverage table. The other files are the exemplars: match their depth, tone, and structure exactly. Your job is to write every document in the README's structure until the coverage table has no `not started` rows, then run a consistency pass.

## Source of truth

The Crowsnest source is this same repo, read from the working tree at commit `4f26fb9`. Describe the experience on the core loop routes under `src/app/(shell)` (feed, feed/[videoId], feed/[videoId]/remix, mine, mine/[postId]/studio), for a single local user in the default seeded configuration. First run onboarding, the agent run terminal internals, the settings and logs pages, and the routes outside the core loop are out of scope (see the README scope decisions).

For each document, read in this order before writing:

1. Where the interaction state lives for the feature: the server action in `src/server/actions`, the service in `src/server/services`, and the client component in `src/components` that holds React state.
2. The read side in `src/server/queries` and the tables in `src/server/db/schema.ts`.
3. The tests. Files in `src/server/services`, `src/server/queries`, and `src/server/actions` ending in `.test.ts` are close to executable specifications of edge cases. Component tests are under `src/components`.
4. Defaults and thresholds: `src/server/config.ts` and the per feature constants named in the map (feed page size 24, remix target length 45s, variant count 3, and so on).

Do not describe code. Describe what the user sees and does. Technical detail goes only in `> Technical note:` block quotes, and only when the mechanism changes what the user would expect.

## Writing rules

- Follow the eight section template in the README for every feature document. Foundations and cross-cutting documents may drop sections that do not apply (the data model has no while acting phase) but must still cover cancel and interrupt behavior wherever an interaction exists.
- Variants and cancel and interrupt go in tables, split into the two columns named in the README (set on arrival and changed while acting; before commit and while in flight). The seven interrupt rows and the order of the seven cross-cutting concerns are fixed in the README; do not add, drop, or reorder them in a single document.
- Use the glossary's words. If you need a term the glossary lacks, add it to `glossary.md` in the right section with a one paragraph definition, then use it.
- Sentence case for all headings. Direct, concrete language. No hedging, no marketing. Follow the repo humanizer rules: no em dashes or en dashes, straight quotes, no puffery.
- State surprising behavior plainly and say why if the reason is in the code or a comment. If it looks like a bug, say so in "Open questions" rather than smoothing it over.
- Cross reference other documents with relative links rather than repeating their content. `foundations/interaction-model.md` owns the cancel, stop, and interrupt definitions; `foundations/data-model.md` owns what each record and each state is; `foundations/background-jobs.md` owns the run statuses. Do not restate them; link.
- Every document ends with "## Open questions and verification" listing what was read from code but not confirmed by hand, followed by a line: Verified against this repo commit `{sha}` using the current `git rev-parse --short HEAD`.
- One Mermaid `stateDiagram-v2` per interaction, limited to the states the user passes through. Omit internal bookkeeping states.

## Things already established (do not re-derive, do not contradict)

Facts the foundations settled. Do not re-derive or contradict these.

Thresholds and defaults (from the map and config.ts):
- Feed page size 24, load more step 24.
- Follower bands: nano 0 to 10k, mid 100k to 1M, macro 1M and up. Feed navigation order cap 5000. Recently viewed cap 8.
- Remix: target length default 45s, variant count default 3, three fixed variant angles, transcript excerpt 500 chars, research and similar cap 5, six stages.
- My channel: own posts limit 100.
- Sync defaults (environment, not user settings): lookback 30 days, at most 200 items per sync, 3 retries, auto interval off by default (0).

Naming and records (data-model.md owns these):
- video = a scraped post from a tracked channel (photo, video, or carousel). post = a planned post (a dated intention on the own channel). own post = a measured published post, read only. script = saved text copied from a chosen variant. remix session = disposable working state, one per source video. create run = a cook; remix run = one generation attempt. When a document says run, it says which.
- Record states: video is analyzed or not, saved or not, present or removed. planned post state is draft or scheduled; missed is derived on read; published is set by hand. create run status is one of running, waiting, success, failed, canceled.

Actions (interaction-model.md owns these):
- Every server action returns {ok:true,...} or {ok:false,error,code}; nothing throws across the boundary. While an action runs the trigger is disabled (a React transition). After it settles the client shows a toast and, where display depends on server data, calls router.refresh().
- Commit is the durable step (a row). Cancel discards uncommitted work on purpose. Stop ends a running cook. Interrupt is anything unplanned that disturbs an action; the seven rows are fixed.
- Direct server reads (feed, video detail, calendar) cannot fail as actions; they render data or an empty state and change through the URL.

Restricted states (interaction-model.md):
- LLM proxy down: generation fails, everything else works. Sidecar off: no new videos, existing feed and all downstream actions work. Graph token invalid: my channel metrics unavailable, connect panel shown, planning and studio still work. No own channel set: my channel shows a picker.

Remix ownership: to be decided when the remix studio is read (Phase 2 step 2); record it here then.

## Order of work

1. Foundations first, in this order: `data-model.md`, `interaction-model.md`, `navigation-and-shell.md`, `background-jobs.md`. Everything else links to them.
2. The remix studio next, all seven documents. This is the hardest part and the bulk of the experience. Read every stage service function in `src/server/services/remix.ts` and every stage component in `src/components/remix` before starting any of them, because the stages hand off to each other and the documents must agree on where one ends and the next begins. Decide and record here which document owns which stage.
3. The remaining feed, mine, and studio documents, then the cross-cutting documents. These are independent of each other and can be drafted in parallel with subagents once the foundations and remix documents exist to link to. Give each subagent this file, the README, the glossary, the pilot, and the foundation document the feature depends on; review every result yourself for consistency with the glossary and the established facts before accepting it.
4. Consistency pass over the whole set: same term for the same thing everywhere, no two documents describing the same behavior differently, every relative link resolves (`python3 .claude/skills/product-description/references/check-links.py docs/product-description`), every document has a verification footer, every glossary term used is defined.
5. Update the coverage table in `README.md` as you go: `drafted` when written, `verified` only after a hand pass.

## Working rules

- Commit after each document or coherent group with a message of the form `docs: add {path}` or `docs: revise {path}`. This repo puts a Co-Authored-By and a Claude-Session trailer on commits; follow that convention.
- Do not modify anything outside `docs/product-description/`. The rest of the repo is read only reference material for this work.
- Do not add files outside the README's structure without updating the structure and coverage table to match.
- When a behavior cannot be determined from code and tests, write down what you could determine, put the rest in "Open questions", and move on. Do not guess and do not block.
- Depth bar: the pilot is roughly 150 to 200 lines for a small feature. The remix stage documents will be longer; foundations and cross-cutting documents vary. Completeness matters more than length. Every state, every variant, every cancel and interrupt row accounted for, even if the answer is "no effect".
- If the README's structure is wrong for something you discover (a document that should split, two that should merge), make the change, update the structure and coverage table, and note why in the commit message.

You are done when the coverage table has no `not started` rows, the consistency pass is complete, and everything is committed.
