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

Empty at first. As each foundation document is written, add its load bearing facts here as one line bullets: numbers, defaults, rules, naming decisions. The shape of it:

- Thresholds and defaults: feed page size and load more step; follower band bounds; remix target length, variant count, transcript excerpt length; recently viewed cap; own posts limit. Fill in from the foundations once written.
- How variants are read: which record states exist for each object, and whether a state can change mid action.
- Naming decisions: video vs post vs run, and which "run" a document means.
- What each action commits and what dispatches it: cancel, stop, interrupt.
- Which features are unavailable in restricted states (no own channel, LLM proxy down, sidecar not running, Graph token invalid).
- Which document owns which states of the remix studio, once decided.

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
