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
| P3 plan | reuse | `ship:writing-plans` |
| P4 build | reuse | `ship:subagent-driven-development` |
| P5 verify | reuse | `ship:verification-before-completion` |
| Open-item counts in P1 | reuse | `where-are-we` |

## Phase 1: research and concept. Human gate.

- Ground with GitNexus first (see `references/gitnexus-grounding.md`): bind `repo: "crowsnest"`,
  check index freshness, and map the affected flow with `gitnexus-exploring` (`query`, `clusters`,
  `context`) instead of a wide Grep sweep. Then read only the specific files the graph points at.
  Any scout or research sub-agent you dispatch gets this instruction and the reference path.
- If the component exists (enhancement): read its five docs, the real `src/` for that
  component (narrowed by the graph), and run `where-are-we` (`scripts/plan-status.sh`) for open
  backlog items and active plans. Summarize what exists, what changes, what is affected.
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
    Build the module-structure table and dependency map from GitNexus (see
    `references/gitnexus-grounding.md`): `context {name, repo: "crowsnest"}` gives a symbol's
    callers, callees, and refs, and `clusters`/`cypher` give the functional grouping, so the table
    comes from the graph rather than from reading every file. Verify each row against source before
    asserting it.
  - Test-case agents write `04-test-cases.md` across the four lenses defined in
    `references/test-cases-format.md`: behavior, route and action, browse-e2e, security-lite.
- Merge the test-case agents' output into one `04-test-cases.md`; refine `01-concept-brief.md`.
- Every doc this phase touches follows `house-style.md`.
- Gate: present design decisions, dependencies and integration points, risks. Wait for a yes
  before Phase 3 starts.

## Phase 3: implementation plan. Human gate.

- Call `ship:writing-plans`. The plan is written to
  `documents/planning/implementation-plan/`, following that skill's naming and frontmatter. It
  is never a sixth component doc.
- Before the gate, run two sweeps and show their outcome:
  - Cross-module reuse sweep. Read the Limitations and business-rules bullets across
    `01-concept-brief.md`, `02-architecture.md`, and `03-feature-description.md`. For every file
    or component they name, including ones outside the new component that are only reused,
    confirm a plan task exists. If a named gap is deliberately out of scope, say so in the plan's
    Risks. Run this sweep as a GitNexus impact query, not a manual grep (see
    `references/gitnexus-grounding.md` and `gitnexus-impact-analysis`): `impact {name, repo:
    "crowsnest"}` on each symbol the change touches returns the callers and blast radius that must
    each map to a plan task or an explicit Risks skip.
  - Sidecar, env, migration, and launchd surface sweep, crowsnest-specific. Does the change touch
    `.env.local` keys, the drizzle schema or a migration, the launchd services, or the sidecar
    contract? State the answer per surface, add a plan task where the answer is yes, note
    deliberate skips in Risks.
- Gate: present the plan, file count, migrations or breaking changes, the two sweeps' outcomes,
  and the test-coverage plan. Wait for the human to say start before Phase 4 starts.

## Phase 4: implement. No gate.

- Call `ship:subagent-driven-development`. Use its independent-tasks parallel mode where the
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

Phase 5 is mandatory and has two halves: verification, then a doc-sync-to-reality pass. Neither
is optional, and the second is the one that gets skipped, so guard it.

Read this first: Phase 4 delegates the build to `ship:subagent-driven-development`, which runs
its own per-task reviews, a final whole-branch review, and `ship:finishing-a-development-branch`.
None of that is Phase 5. `ship:verification-before-completion` is not the doc-sync. When the build
returns, you always come back here and run the doc-sync-to-reality pass before this component is
done, even if the branch already merged. If it merged before the docs were synced, the doc-sync is
a mandatory immediate follow-up, not a nicety. Prefer to run doc-sync on the same branch as the
code so the synced docs ride the same PR.

### 5a. Verify

- Call `ship:verification-before-completion`.
- Reconcile the three test layers against `04-test-cases.md`: which browse-e2e journeys ran at full
  depth, which were simplified or could not run (no sidecar, no real credentials, no LLM), and why.
  A layer that could not run in the sandbox is named for the release gate, never silently dropped.

### 5b. Doc-sync to reality (mandatory, not a word-swap)

The build almost never matches the plan verbatim: rulings, review fixes, and deviations change what
shipped. The docs describe the design as of Phase 2; this pass rewrites them to describe the system
that now exists. Drive it like this, not as a vague "update the docs":

1. Get the ground truth. Read the actual shipped diff for this component's work
   (`git diff <plan-base>..<head>`, or the merged PR's diff), and ground it with GitNexus (see
   `references/gitnexus-grounding.md`): `detect_changes {repo: "crowsnest"}` returns the changed
   symbols and their blast radius, so you learn what the diff touched without reading all of `src/`,
   and `context {name, repo: "crowsnest"}` on each changed symbol gives its callers and refs.
   Worktree caveat: if the branch lives under `.claude/worktrees/...`, pass
   `worktree: "<abs path>"` to `detect_changes` or it reports zero changes (false clean); when in
   doubt, drive from the real `git diff` and use the graph to expand each hunk. List every deviation
   from the plan: new or renamed exports, changed signatures (for example a function that became
   async), new files, a mechanism swapped for another (the plan said X, the code did Y), and every
   deferred or parked review finding. This list is the input to the rewrite.
2. Dispatch the doc-sync agents in parallel, each with the shipped-code file paths, the deviation
   list, `house-style.md`, and `references/drizzle-er-and-sequence.md`:
   - Architecture agent updates `02-architecture.md` to the built system. Update the
     module-structure table for every new or changed export. Update the ER diagram, data-flow, and
     DB-operation sequence diagrams to the real flow. Delete or rewrite as fact every "open, not
     verified" / "not built" / "planned" statement for anything that shipped: a shipped feature
     must not be described as unbuilt anywhere in the doc. Keep only the items that are genuinely
     still open.
   - Feature agent updates `03-feature-description.md`: flip each feature's status marker to its
     true built state (`○`/`◐` becomes `●` where it shipped), fix the file references and the open-
     item column, and extend the user-guide prose to the shipped behavior. Text only, no images,
     since `03` feeds the mkdocs site directly.
3. Update `05-backlog-to-enhance.md` yourself: mark implemented rows done and link the plan; file
   every deviation and every deferred or parked review finding as a new row so nothing is lost.
4. Confirm the mkdocs nav and the five-doc invariant via `document-component`, then confirm the
   site builds (`mkdocs build`, or the project's nav check) so a broken link or missing nav entry
   is caught here, not by a reader.

### 5c. Verify the docs actually match the code

Do not trust "the agent said it synced." Check it, and write down what you checked:

- For each new or changed symbol, export, or file the shipped diff introduced, grep `02` and `03`
  and confirm it is described (or deliberately out of scope). A shipped export absent from `02` is
  an unsynced doc.
- Grep the component's docs for stale-status language ("not built", "not yet", "open, not
  verified", "planned", "roadmap", a `◐`/`○` marker) and confirm none of it still applies to a
  feature that shipped.
- Confirm every file path cited in `02`/`03` exists, and the mkdocs build is clean.

### Gate

Present: files changed, test results per layer, the e2e coverage reconciliation from 5a, the
deviation list and how each is now reflected in the docs, the 5c check results, and any deviation
from the plan. Wait for the human to confirm done.

## Error handling

- A gate rejection: revise on the feedback, re-present the same gate. Nothing downstream starts.
- An existing component: read first, enhance, never overwrite blindly.
- `browse` or `verify:live` unavailable: note it, fall back to `vitest` plus a manual check,
  never skip a test layer silently.
- One quality bar governs every doc this skill touches: `house-style.md`. One invariant owner
  for the five-doc block and the index or nav wiring: `document-component`.
- Phase 4 was delegated to `ship:subagent-driven-development`: its reviews and its
  `ship:finishing-a-development-branch` do not satisfy Phase 5. Returning to Phase 5's doc-sync is
  the step that gets dropped when the build "feels done". It is not done until 5b and 5c have run
  and the gate is confirmed. If the branch merged before doc-sync, run the sync as an immediate
  follow-up branch, do not defer it.

## Quick reference

| Phase | Gate | Delegated skill | Key output |
| --- | --- | --- | --- |
| 1: research and concept | yes | none (this skill, plus `where-are-we`) | name, slug, scope, dependencies, agreed |
| 2: design, features-first | yes | none (this skill's own agents) | `01`, `02`, `03`, `04` drafted, per `house-style.md` |
| 3: implementation plan | yes | `ship:writing-plans` | plan in `documents/planning/implementation-plan/`, two sweeps shown |
| 4: implement | no | `ship:subagent-driven-development` | code, tests across three layers, committed |
| 5: verify and doc-sync | yes | `ship:verification-before-completion` | verify (5a), then the mandatory doc-sync-to-reality pass (5b) driven by the shipped diff, then the docs-match-code check (5c); backlog updated, done confirmed. SDD finishing does not satisfy this. |
