---
name: crowsnest-component
description: Use to take a crowsnest component from concept to shipped through five phases and four human gates, reusing the ship-* machinery instead of duplicating it. Trigger:/crowsnest-component
disable-model-invocation: true
---

# crowsnest-component

This is an orchestrator skill. It does not reimplement planning, execution, or verification.
It conducts a component through five phases, doing the crowsnest-specific research, design, and
doc-sync work itself, and delegating the plan-write, build, and verify steps to the ship-* skills
that already exist in this repo. Every phase that produces a doc holds itself to
`house-style.md`, the quality bar for the five-doc lego block under
`documents/architect/core-components/<name>/`. Applies to both a brand-new component and an
enhancement to an existing one; Phase 1 tells which case it is and adapts.

## Composition

| Phase step | Owned by | Skill called |
| --- | --- | --- |
| P1 research, P2 design, P5 doc-sync | new, this skill's own agents | none |
| Scaffold and wire the 5-doc block | reuse | `document-component` |
| P3 plan | reuse | `ship-writing-plans` |
| P4 build | reuse | `ship-subagent-driven-development` |
| P5 verify | reuse | `ship-verification-before-completion` |
| Open-item counts in P1 | reuse | `where-are-we` |

## Phase 1: research and concept. Human gate.

- If the component exists (enhancement): read its five docs, the real `src/` for that
  component, and run `where-are-we` (`scripts/plan-status.sh`) for open backlog items and active
  plans. Summarize what exists, what changes, what is affected.
- If new: research the concept, scan `src/` for a real seam, not a feature of an existing block,
  per the rule `document-component` owns. Propose the five-doc block using `document-component`
  to scaffold it.
- Gate: present name, slug, what it is and why, new versus enhancement, dependencies. Wait for a
  yes before Phase 2 starts.

## Phase 2: design, features-first. Human gate.

- 2a: a single agent writes or updates `03-feature-description.md` and ships it first, alone. It
  is the input both 2b tracks read, so architecture serves already-named features, not the other
  way around.
- 2b: parallel agents, each reading `03-feature-description.md` plus the code:
  - Architecture agent writes `02-architecture.md`: module-structure table (file, export, role),
    a drizzle ER diagram, data flow, key decisions, and DB-operation sequence diagrams, all in
    the notation defined in `references/drizzle-er-and-sequence.md`. Also the dependency map
    (upstream, downstream, external) and the "open, not verified" section, per `house-style.md`.
  - Test-case agents write `04-test-cases.md` across the four lenses defined in
    `references/test-cases-format.md`: behavior, route and action, browse-e2e, security-lite.
- Merge the test-case agents' output into one `04-test-cases.md`; refine `01-concept-brief.md`.
- Every doc this phase touches follows `house-style.md`.
- Gate: present design decisions, dependencies and integration points, risks. Wait for a yes
  before Phase 3 starts.

## Phase 3: implementation plan. Human gate.

- Call `ship-writing-plans`. The plan is written to
  `documents/planning/implementation-plan/`, following that skill's naming and frontmatter. It
  is never a sixth component doc.
- Before the gate, run two sweeps and show their outcome:
  - Cross-module reuse sweep. Read the Limitations and business-rules bullets across
    `01-concept-brief.md`, `02-architecture.md`, and `03-feature-description.md`. For every file
    or component they name, including ones outside the new component that are only reused,
    confirm a plan task exists. If a named gap is deliberately out of scope, say so in the plan's
    Risks.
  - Sidecar, env, migration, and launchd surface sweep, crowsnest-specific. Does the change touch
    `.env.local` keys, the drizzle schema or a migration, the launchd services, or the sidecar
    contract? State the answer per surface, add a plan task where the answer is yes, note
    deliberate skips in Risks.
- Gate: present the plan, file count, migrations or breaking changes, the two sweeps' outcomes,
  and the test-coverage plan. Wait for the human to say start before Phase 4 starts.

## Phase 4: implement. No gate.

- Call `ship-subagent-driven-development`. Use its independent-tasks parallel mode where the
  plan's tasks are independent; it is the parallel engine for this phase.
- Three test layers, crowsnest-native:
  - unit: `vitest`.
  - route and action: `vitest` against server actions, API routes, and drizzle, using a temp
    SQLite database.
  - e2e: browser journeys via the `browse` skill, driven by `data-testid`, per
    `references/browse-e2e-qa.md`.
- Run `verify:live` where a real sidecar or LLM path is exercised.
- No human gate here; the gate that closes this work is Phase 5's.

## Phase 5: verify and doc-sync. Human gate.

- Call `ship-verification-before-completion`.
- Two parallel doc-sync agents: one updates `02-architecture.md` to match the real implemented
  code; one extends each feature's entry in `03-feature-description.md` with user-guide detail,
  text only, no images, since `03-feature-description.md` feeds the mkdocs site directly. Both
  follow `house-style.md`.
- Update `05-backlog-to-enhance.md`: remove items just implemented, add new tech debt found.
- Confirm the mkdocs nav via `document-component`.
- Gate: present files changed, test results per layer, an e2e coverage reconciliation, meaning
  which `04-test-cases.md` browse-e2e journeys are covered at full depth and which are simplified
  and why, and any deviation from the plan. Wait for the human to confirm done.

## Error handling

- A gate rejection: revise on the feedback, re-present the same gate. Nothing downstream starts.
- An existing component: read first, enhance, never overwrite blindly.
- `browse` or `verify:live` unavailable: note it, fall back to `vitest` plus a manual check,
  never skip a test layer silently.
- One quality bar governs every doc this skill touches: `house-style.md`. One invariant owner
  for the five-doc block and the index or nav wiring: `document-component`.

## Quick reference

| Phase | Gate | Delegated skill | Key output |
| --- | --- | --- | --- |
| 1: research and concept | yes | none (this skill, plus `where-are-we`) | name, slug, scope, dependencies, agreed |
| 2: design, features-first | yes | none (this skill's own agents) | `01`, `02`, `03`, `04` drafted, per `house-style.md` |
| 3: implementation plan | yes | `ship-writing-plans` | plan in `documents/planning/implementation-plan/`, two sweeps shown |
| 4: implement | no | `ship-subagent-driven-development` | code, tests across three layers, committed |
| 5: verify and doc-sync | yes | `ship-verification-before-completion` | docs synced to reality, backlog updated, done confirmed |
