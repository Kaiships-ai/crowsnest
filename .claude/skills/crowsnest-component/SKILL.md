---
name: crowsnest-component
description: Use to take a crowsnest component from concept to shipped through five phases and four human gates, reusing the ship-* machinery instead of duplicating it. Trigger:/crowsnest-component
disable-model-invocation: true
---

# crowsnest-component

Orchestrator. Conduct a component through five phases. Do the crowsnest-specific research, design,
and doc-sync yourself; delegate plan, build, and verify to the ship-* skills. Every doc-producing
phase holds to `house-style.md`, the quality bar for the five-doc block under
`documents/architect/core-components/<name>/`. Works for a new component and for an enhancement;
Phase 1 decides which and adapts.

## Composition

| Phase step | Owned by | Skill called |
| --- | --- | --- |
| P1 research, P2 design, P5 doc-sync | new, this skill's own agents | none |
| Scaffold and wire the 5-doc block | reuse | `crowsnest-document-component` |
| P3 plan | reuse | `writing-plans` |
| P4 build | reuse | `subagent-driven-development` |
| P5 verify | reuse | `verification-before-completion` |
| Open-item counts in P1 | reuse | `crowsnest-status` |

## References to load

Load only what the phase needs. Every doc-reading or doc-writing phase loads `house-style.md` and
grounds with `references/gitnexus-grounding.md`. Beyond that:

| Phase | Also load |
| --- | --- |
| 2, architecture track | `references/drizzle-er-and-sequence.md` |
| 2, test-case track | `references/test-cases-format.md`, `references/browse-e2e-qa.md` |
| 1, 3, 5 | nothing extra (no test-case or diagram references) |

## Phase 1: research and concept. Human gate.

Establish what the component is and whether it is new or an enhancement.

- Ground with GitNexus first (`references/gitnexus-grounding.md`): bind `repo: "crowsnest"`, check index freshness, map the affected flow with `gitnexus-exploring` (`query`, `clusters`, `context`), then read only the files the graph points at. Any scout sub-agent gets this instruction and the reference path.
- Enhancement: read the five docs, the graph-narrowed `src/` for the component, and `crowsnest-status` (`scripts/plan-status.sh`) for open backlog and active plans. Summarize what exists, what changes, what is affected.
- New: research the concept, scan `src/` for a real seam (not a feature of an existing block, the rule `crowsnest-document-component` owns), and scaffold the five-doc block with `crowsnest-document-component`.

**Gate:** present name, slug, what it is and why, new versus enhancement, dependencies. Wait for a yes before Phase 2.

## Phase 2: design, features-first. Human gate.

Write the four design docs, features first so architecture serves named features.

- 2a: one agent writes or updates `03-feature-description.md` first and alone. It is the input both 2b tracks read.
- 2b architecture agent writes `02-architecture.md`: the module-structure table (file, export, role), a drizzle ER diagram, data flow, key decisions, and DB-operation sequence diagrams, in the notation of `references/drizzle-er-and-sequence.md`; plus the dependency map (upstream, downstream, external) and the "open, not verified" section per `house-style.md`. Build the table and dependency map from GitNexus (`context {name, repo: "crowsnest"}` for callers/callees/refs, `clusters`/`cypher` for grouping), and verify each row against source before asserting it.
- 2b test-case agents write `04-test-cases.md` across the four lenses in `references/test-cases-format.md`: behavior, route and action, browse-e2e, security-lite. See the browse-e2e rule below.
- Merge the test-case output into one `04-test-cases.md`; refine `01-concept-brief.md`.

Browse-e2e authoring: before writing rows, build a scratch feature-to-journey matrix from `03` (one row per `●`/`◐` feature, the nine corner-case types across the top). Write one happy-path journey per built feature (the floor), then corner rows until five distinct corner-case types are covered. The matrix does not ship. One happy-path journey per built feature, not per business rule (rules stay in the behavior lens). A journey may cover several features (`Feat: 2,4,5`), so breadth is distinct-`Feat` covered, not row count. Every browse-e2e row carries the `Feat`, `Type`, `Mode`, and `Script` columns.

**Gate:** present design decisions, dependencies and integration points, risks. Wait for a yes before Phase 3.

## Phase 3: implementation plan. Human gate.

Write the plan and run two coverage sweeps before the gate.

- Call `writing-plans`. The plan goes to `documents/planning/implementation-plan/`, following that skill's naming. It is never a sixth component doc.
- Cross-module reuse sweep: read the Limitations and business-rules bullets across `01`, `02`, `03`. For every file or component they name, including reused ones outside the new component, confirm a plan task exists; a deliberate gap goes in the plan's Risks. Run it as a GitNexus `impact {name, repo: "crowsnest"}` query, not a grep: each symbol's callers and blast radius must map to a plan task or an explicit Risks skip.
- Surface sweep (crowsnest-specific): does the change touch `.env.local` keys, the drizzle schema or a migration, the launchd services, or the sidecar contract? Answer per surface, add a plan task where yes, note deliberate skips in Risks.

**Gate:** present the plan, file count, migrations or breaking changes, both sweeps' outcomes, and the test-coverage plan. Wait for the human to say start before Phase 4.

## Phase 4: implement, then the mandatory test gate. No human gate.

Call `subagent-driven-development` in independent-tasks parallel mode where the plan's tasks are independent.

### 4a. Build

- Implement the plan's tasks.
- Each shipped feature adds or updates the `data-testid` values its browse-e2e cases name (`references/browse-e2e-qa.md`). A journey with no testid to target is an incomplete feature, not deferred testing.

### 4b. The test gate (mandatory, blocks Phase 5)

Select and diagnose the layers with `crowsnest-testing`, at the depth `crowsnest-route` set for this work (FAST is the smallest meaningful check, CAREFUL is full coverage). Author every new test through the `test-audit` gate. Run every layer and mark every shipped-mapped case in `04-test-cases.md` with a 🟢/🔴/🟡 marker before this phase ends. A shipped case left `not run` fails the gate.

| Layer | What runs |
| --- | --- |
| unit | `vitest`, the feature's unit cases pass |
| route and action | `vitest` against server actions, API routes, and drizzle on a temp SQLite database |
| browse-e2e | the `browse` skill, driven by `data-testid`, against the running dev server (see evidence rule below) |
| security-lite | the applicable secret, sidecar-token, and license cases |

Browse-e2e evidence: for each journey, capture a screenshot at the frame that proves Expected, save it to `documents/architect/core-components/<name>/test-shots/<id>.png`, read it back, and embed it in the Result cell with the marker. A browse-e2e case is never 🟢 without its screenshot. For a `Mode: live` row, drive the real sidecar, LLM, or Graph-token path, or mark it 🟡 with the named missing dependency.

| Marker | Meaning |
| --- | --- |
| 🟢 | ran and Expected held |
| 🔴 | ran and Expected did not. A 🔴 on a P1 case blocks the gate and is filed as a `05-backlog` row |
| 🟡 | a real dependency the sandbox lacks (no sidecar, credentials, or LLM key) stopped it, named, deferred to the release gate. Only for a genuinely un-runnable layer, never a shortcut, and never on a `Mode: offline` row |

The gate passes when every shipped case is 🟢, or 🟡 with a named blocker. A 🔴 P1 or a `not run` shipped case does not pass.

Coverage check, per component, all grep-able facts:

- (a) every `●`/`◐` feature `#` appears in at least one browse-e2e row's `Feat` column;
- (b) the rows cover at least five distinct corner-case types, or carry a named "not applicable" line per missing type;
- (c) no `Mode: offline` row is `not run` or 🟡;
- (d) every `Mode: offline` row names a `Script` path that exists under `scripts/e2e/`.

Emit a short coverage record:

```
Feature paths: 8 required, 8 covered
Corner types: empty, failure, boundary, network, repeat (5 distinct)
Offline: 8  Live: 2  Blocked: 1 (sidecar, release gate)
Unmarked shipped rows: 0   Missing screenshots: 0
Gate: pass
```

Run `scripts/e2e-coverage.sh <component>` (or `--all`) for the mechanical half. It reads `03` and `04`, prints this record, hard-fails on an offline row with `Script: none`, a missing script path, or a `not run` Result, and warns on an uncovered built feature or fewer than five corner types. Hard checks fire only on rows that exist, so a component mid-backfill is not failed for rows it has not written. The warnings need a human read (a gap may be a tracked `test-coverage` backlog row, or a corner type may carry a "not applicable" note); the hard fails do not.

Phase 5 does not start until 4b passes.

## Phase 5: verify and doc-sync. Human gate.

Verify the build, then rewrite the docs to the system that now exists. The doc-sync is the half that gets skipped, so run it every time, even if the branch already merged. Prefer to run it on the code's branch so the synced docs ride the same PR; if the branch merged first, run the sync as an immediate follow-up.

Phase 4's `subagent-driven-development` runs its own per-task reviews, a whole-branch review, and `finishing-a-development-branch`. None of that is Phase 5, and `verification-before-completion` is not the doc-sync.

### 5a. Verify

- Call `verification-before-completion`.
- Confirm 4b ran and its markers are in `04`: every shipped case 🟢 (with an embedded `test-shots/` screenshot per browser-run case), 🔴, or 🟡 with a named blocker, and none still `not run`. An unmarked shipped case means 4b did not finish; go back and run it.
- Reconcile the layers against `04`: which browse-e2e journeys ran at full depth (🟢 with evidence), which are 🟡 and why. A sandbox-un-runnable layer is a named 🟡 for the release gate, never a silent drop.

### 5b. Doc-sync to reality (mandatory, not a word-swap)

The docs describe the design as of Phase 2; rewrite them to the built system.

1. Get ground truth. Read the shipped diff (`git diff <plan-base>..<head>`, or the merged PR diff) and ground it with GitNexus: `detect_changes {repo: "crowsnest"}` for changed symbols and blast radius, `context {name, repo: "crowsnest"}` per changed symbol for callers and refs. Worktree caveat: for a branch under `.claude/worktrees/...`, pass `worktree: "<abs path>"` to `detect_changes` or it reports a false clean; when in doubt, drive from the real `git diff` and expand each hunk with the graph. List every deviation from the plan (new or renamed exports, changed signatures such as a now-async function, new files, a mechanism swapped for another, every deferred or parked review finding). This list drives the rewrite.
2. Dispatch the doc-sync agents in parallel, each with the shipped file paths, the deviation list, `house-style.md`, and `references/drizzle-er-and-sequence.md`:
   - Architecture agent updates `02` to the built system: the module-structure table for every new or changed export; the ER, data-flow, and DB-operation diagrams to the real flow; and every "open, not verified" / "not built" / "planned" line rewritten as fact or deleted for anything that shipped. A shipped feature is never described as unbuilt. Keep only genuinely open items.
   - Feature agent updates `03`: flip each status marker to its true built state (`○`/`◐` becomes `●` where it shipped), fix file references and the open-item column, and extend the user-guide prose to the shipped behavior. Text only, no images (`03` feeds the mkdocs site).
3. Update `05-backlog-to-enhance.md` yourself: mark implemented rows done and link the plan; file every deviation and every deferred or parked review finding as a new row.
4. Confirm the mkdocs nav and the five-doc invariant via `crowsnest-document-component`, then confirm the site builds (`mkdocs build`, or the project's nav check).

### 5c. Verify the docs match the code

Check it, and write down what you checked:

- For each new or changed symbol, export, or file in the diff, grep `02` and `03` and confirm it is described or deliberately out of scope. A shipped export absent from `02` is an unsynced doc.
- Grep the docs for stale-status language ("not built", "not yet", "open, not verified", "planned", "roadmap", a `◐`/`○` marker) and confirm none still applies to a shipped feature.
- Confirm every file path cited in `02`/`03` exists, and the mkdocs build is clean.

### 5d. Independent code review

Run `/code-review high` on the full branch diff, the code plus the docs 5b just synced. This is the first review to see code and docs together; Phase 4's build reviewed the code before 5b wrote the docs. Use `medium` only for a small enhancement; a new or reworked component gets `high`. If the work has a PR, `/code-review <PR#> --comment` posts findings inline. Do not use `--fix`; the gate presents findings for a human decision.

| Finding | Action |
| --- | --- |
| blocker or high | does not pass the gate. Fix, re-run 5a, re-review |
| medium or low | does not block. Present at the Gate; a class that repeats across components earns a 5e learnings row |
| clean | state it clean at the Gate, with the review's summary line |

This does not replace 4b or security-lite; it is the correctness and reuse/simplification/efficiency lens on the whole component at once. For a component that touches auth, tokens, or the sidecar, run `/security-review` alongside it; `/code-review` alone is not a security review.

### 5e. Append what the build taught

Add one row per real learning to `documents/learnings.md` for anything the build surfaced that the five docs do not carry: a seam that kept breaking, a test shape that passed against broken code, a corner case the plan missed. One line each; a learning that needs a paragraph belongs in `02-architecture.md`. Nothing to add is a valid outcome.

### Gate

Present: files changed, test results per layer, the 5a coverage reconciliation, the deviation list and how each is reflected in the docs, the 5c results, the 5d code-review verdict (clean, or the findings and how each was handled), and any deviation from the plan. Wait for the human to confirm done.

## If something goes wrong

| If | Do |
| --- | --- |
| a gate is rejected | revise on the feedback and re-present the same gate; nothing downstream starts |
| the component already exists | read first, enhance, never overwrite blindly |
| `browse` is unavailable, or a `Mode: live` service (sidecar, credentials, LLM key) is unreachable | mark the case 🟡 in `04` with the reason and the release gate it defers to, then fall back to `vitest` plus a manual check. Never skip a layer silently, and never mark 🟢 without driving the case and capturing its `test-shots/` screenshot |
| the build "feels done" after Phase 4 | it is not done until Phase 5's 5b and 5c have run and the gate is confirmed. `subagent-driven-development` reviews and `finishing-a-development-branch` do not satisfy Phase 5 |
| the branch merged before doc-sync | run 5b as an immediate follow-up branch; do not defer it |

`house-style.md` governs every doc this skill touches. `crowsnest-document-component` owns the five-doc block and the index or nav wiring.

## Quick reference

| Phase | Gate | Delegated skill | Key output |
| --- | --- | --- | --- |
| 1: research and concept | yes | none (this skill, plus `crowsnest-status`) | name, slug, scope, dependencies, agreed |
| 2: design, features-first | yes | none (this skill's own agents) | `01`, `02`, `03`, `04` drafted, per `house-style.md` |
| 3: implementation plan | yes | `writing-plans` | plan in `documents/planning/implementation-plan/`, two sweeps shown |
| 4: implement + test gate | no human gate, hard test gate | `subagent-driven-development` | code committed, then 4b runs every layer and marks each shipped case 🟢/🔴/🟡 in `04` with a `test-shots/` screenshot per browser-run case; a `not run` or 🔴 P1 blocks Phase 5 |
| 5: verify and doc-sync | yes | `verification-before-completion`, `/code-review` | verify (5a), doc-sync to reality (5b), docs-match-code check (5c), independent `/code-review` of code plus synced docs (5d, blocker/high blocks the gate), learnings appended (5e); backlog updated, done confirmed. SDD finishing does not satisfy this. |
