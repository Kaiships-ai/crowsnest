---
status: approved
date: 2026-09-02
kind: spec
slug: crowsnest-component-workflow
supersedes: none
related:
  - .claude/skills/document-component/SKILL.md
  - .claude/skills/ship-brainstorming/SKILL.md
  - .claude/skills/ship-writing-plans/SKILL.md
  - documents/architect/core-components/ig-sync/
---

# Crowsnest component workflow: spec

One orchestrator skill that takes a crowsnest component from concept to shipped, reusing the
machinery already in this repo instead of duplicating it. This spec covers two coupled pieces:
the skill (A) and the doc house-style it produces (B). A third piece, a business/BRD skill, is
deferred to its own later spec.

## 1. Goal and motivation

The ultimate goal is a production repository that speeds development: parallel work, faster bug
fixing and releases, and higher product quality. Today crowsnest has nine components documented
under `documents/architect/core-components/`, but the docs vary in depth and there is no repeatable
workflow that carries a component from an idea through design, planning, building, testing, and
documentation on one quality bar.

Two reference bodies of work are the input, to learn the mindset from, not to copy:

- `core-component-impl` (funflow) is an end-to-end component lifecycle: research, concept gate,
  features-first, parallel design agents (architecture plus product-owner, API, e2e, and security
  test cases), an implementation plan, layered testing, and post-implementation doc sync.
- The funflow `documents/architect/core-components/` set is the doc house-style to match: a status
  header, a key-concepts table, an upstream/downstream/external dependency map, an ER diagram, a
  module-structure table, and DB-operation sequence diagrams.

The funflow machinery does not transfer. Crowsnest is Next.js plus SQLite/drizzle plus a Python
Instagram sidecar plus Claude, a single-user desktop app with no multi-tenancy, no roles, no
Mongoose, no BullMQ, no gitnexus, no MCP tool layer, and no separate public docs site. The workflow
adapts to that reality.

## 2. Decisions (locked with the human)

| # | Decision | Choice |
| --- | --- | --- |
| D1 | Session scope | Skill (A) plus doc house-style (B). Business/BRD skill (C) deferred. |
| D2 | Adaptation depth | Keep the mindset, phases, and gates. Build the small missing machinery. Drop the funflow-specific parts. |
| D3 | Relationship to ship-* | Orchestrator that calls the existing ship-* skills, no duplication. |
| D4 | Existing 9 doc sets | Define the house-style, apply to one exemplar now, retrofit the other eight later. |
| D5 | Skill shape | One skill, five phases, four human gates. |
| D6 | 5-doc invariant | Kept. The implementation plan lives in `documents/planning/`, never a sixth component doc. |
| D7 | Writing rule | Keep the existing rule: no em or en dashes, straight quotes, sentence-case headings. |
| D8 | Exemplar | `ig-sync`. |
| D9 | Spec and plan paths | Specs in `documents/planning/spec/`. Implementation plans in `documents/planning/implementation-plan/`. |

## 3. Scope

### 3.1 In scope (this spec, this workstream)

1. A new skill `.claude/skills/crowsnest-component/SKILL.md`: the five-phase orchestrator.
2. `.claude/skills/crowsnest-component/house-style.md`: the doc quality bar (B).
3. Three reference docs under `.claude/skills/crowsnest-component/references/`:
   - `drizzle-er-and-sequence.md`
   - `browse-e2e-qa.md`
   - `test-cases-format.md`
4. Apply the house-style to the `ig-sync` component (its five docs), as the reference example.
5. Update `.claude/skills/document-component/SKILL.md` to reference `house-style.md` as the quality
   bar. It stays the owner of the five-doc invariant and the index/mkdocs wiring.
6. Path-convention updates (small):
   - `ship-brainstorming`: architectural specs are written to `documents/planning/spec/`, not to a
     component `01-concept-brief.md`.
   - `ship-writing-plans`: implementation plans are written to
     `documents/planning/implementation-plan/`, not the flat `documents/planning/`.

### 3.2 Out of scope (named, not forgotten)

- The business/BRD skill (C), modeled on datahub `industry-usecase-analyze`. Its own later spec.
- Retrofitting the other eight components (kit, onboarding, feed, analyze, remix, studio, mine,
  llm) to the new house-style. A separate follow-up plan, parallelizable, run through this very
  skill once it exists.
- Any Playwright suite, gitnexus indexing, MCP tool layer, roles/permission-delegation surface, or
  a separate public docs site. None apply to crowsnest.

## 4. The skill: `crowsnest-component`

A component-scoped orchestrator. Only Phase 1 (research), Phase 2 (design), and the Phase 5 doc-sync
are new work. Phases 3, 4, and 5-verify delegate to skills that already exist. The skill is the
conductor.

### 4.1 Composition

| Phase step | Owned by | Skill called |
| --- | --- | --- |
| P1 research, P2 design, P5 doc-sync | new | none (its own agents) |
| Scaffold and wire the 5-doc block | reuse | `document-component` |
| P3 plan | reuse | `ship-writing-plans` |
| P4 build | reuse | `ship-subagent-driven-development` |
| P5 verify | reuse | `ship-verification-before-completion` |
| Open-item counts in P1 | reuse | `where-are-we` |

### 4.2 The five phases

**Phase 1: research and concept. Human gate.**
- If the component exists (enhancement): read its five docs, the real `src/` for that component, and
  run `where-are-we` for open items. Summarize what exists, what changes, what is affected.
- If new: research the concept, scan `src/` for a real seam (not a feature of an existing block, per
  the `document-component` rule), propose the five-doc block.
- Gate: present name, slug, what it is and why, new-versus-enhancement, dependencies. Wait for a yes.

**Phase 2: design, features-first. Human gate.**
- 2a: a single agent writes or updates `03-feature-description.md` and ships it first, alone. It is
  the input both 2b tracks read, so architecture serves already-named features.
- 2b: parallel agents, each reading `03-feature-description.md` plus the code:
  - Architecture agent writes `02-architecture.md`: module-structure table (file, export, role),
    a drizzle ER diagram, data flow, key decisions, DB-operation sequence diagrams (house-style),
    and the dependency map (upstream, downstream, external).
  - Test-case agents write `04-test-cases.md` across the four lenses (see section 6).
- Merge the test outputs into `04-test-cases.md`; refine `01-concept-brief.md`.
- Gate: present design decisions, dependencies and integration points, risks. Wait for a yes.

**Phase 3: implementation plan. Human gate.**
- Call `ship-writing-plans`. The plan is written to `documents/planning/implementation-plan/`
  following that skill's naming and frontmatter. It is never a sixth component doc.
- Before the gate, run two sweeps and show their outcome:
  - Cross-module reuse sweep. Read the Limitations and business-rules bullets across
    `01-concept-brief.md`, `02-architecture.md`, and `03-feature-description.md`. For every file or
    component they name, including ones outside the new component that are only reused, confirm a
    plan task exists. If a named gap is deliberately out of scope, say so in Risks.
  - Sidecar, env, migration, and launchd surface sweep (crowsnest-specific, replaces funflow's
    permission-delegation sweep). Does the change touch `.env.local` keys, the drizzle schema or a
    migration, the launchd services, or the sidecar contract? Each is a real cross-cutting seam
    here. State the answer per surface, add plan tasks where yes, note deliberate skips in Risks.
- Gate: present the plan, file count, migrations or breaking changes, the two sweeps' outcomes, and
  the test-coverage plan. Wait for the human to say start.

**Phase 4: implement. No gate.**
- Call `ship-subagent-driven-development`. Use its independent-tasks parallel mode where the plan's
  tasks are independent; this is the parallel engine.
- Three test layers, crowsnest-native:
  - unit: `vitest`.
  - route and action: `vitest` against server actions, API routes, and drizzle, using a temp SQLite
    database.
  - e2e: browser journeys via the `browse` skill, driven by `data-testid` (see section 6.2).
- Run `verify:live` where a real sidecar or LLM path is exercised.

**Phase 5: verify and doc-sync. Human gate.**
- Call `ship-verification-before-completion`.
- Two parallel doc-sync agents: one updates `02-architecture.md` to the real implemented code; one
  extends each feature's entry in `03-feature-description.md` with user-guide detail (text only, no
  images; `03` feeds the mkdocs site directly). Update `05-backlog-to-enhance.md`: remove items just
  implemented, add new tech debt found. Confirm the mkdocs nav via `document-component`.
- Gate: present files changed, test results per layer, an e2e coverage reconciliation (which
  `04-test-cases.md` e2e journeys are covered at full depth, which are simplified and why), and any
  deviation from the plan. Wait for the human to confirm done.

### 4.3 Error handling

- A gate rejection: revise on the feedback, re-present. Nothing downstream starts.
- An existing component: read first, enhance, never overwrite blindly.
- `browse` or `verify:live` unavailable: note it, fall back to `vitest` plus a manual check, never
  skip a layer silently.
- One quality bar is `house-style.md`; one invariant owner is `document-component`.

## 5. The doc house-style (B)

`house-style.md` states what each of the five docs must contain, at funflow-grade quality, adapted
to crowsnest. It does not add a sixth doc and does not change the writing rule.

| Doc | Must contain |
| --- | --- |
| `01-concept-brief.md` | Status header (Status only, no date field per the evergreen rule). What it is. Why it exists. Key-concepts table. How it fits in the system. Dependency map: upstream, downstream, external. |
| `02-architecture.md` | Module-structure table (file, export, role). Drizzle ER diagram (mermaid). Indexes. Data flow. Key decisions. DB-operation sequence diagrams in the house-style notation. An "open, not verified" section where a claim is not proven live. |
| `03-feature-description.md` | Numbered feature list. Per feature: who uses it, what it does, how to access, business rules, limitations. After implementation, a user-guide subsection per feature (text only). This doc feeds the mkdocs site. |
| `04-test-cases.md` | The four lenses (section 6), each a table of cases. |
| `05-backlog-to-enhance.md` | One table: ID, Title, Severity, Type, Source, Status. `open` rows are the live board (`scripts/plan-status.sh` counts them). |

Evergreen rule, carried from funflow and consistent with the repo: these docs state the current
system as fact. No dated "verified on" evidence framing, no `Date:` header field, no ticket IDs as
inline citations. Verify live, then write the result as plain fact.

Applied to `ig-sync` this session as the worked example.

## 6. The four test lenses (`test-cases-format.md`)

Funflow's product-owner, API, e2e, and security lenses, re-cut for a single-user desktop app.

1. **behavior**: what the user sees and does, product-owner style. Arrive, act, finish; the visible
   states. Sourced from `03-feature-description.md`.
2. **route and action**: server actions, API routes, and drizzle reads and writes, tested with
   `vitest` against a temp SQLite database.
3. **browse-e2e**: real browser journeys through the shipped UI via the `browse` skill.
4. **security-lite**: a local-desktop threat model, not OWASP multi-tenant. Secret handling in
   `.env.local`, the license gate, the sidecar shared token, and the guarantee that no buyer data
   leaves the machine.

### 6.1 Drizzle ER and sequence house-style (`drizzle-er-and-sequence.md`)

Adapts funflow's Mongoose ER and DB-operation sequence-diagram convention to SQLite and drizzle:
tables and relations read from the real `src/server/db/schema.ts`, indexes listed, and sequence
diagrams that name the table per query step. Carries the mermaid rendering gotchas funflow learned
(no unquoted semicolons in message text, no HTML entities or literal comparison operators in
condition labels, every message has an explicit arrow, single-line messages). One small worked
example against a real crowsnest table.

### 6.2 Browse e2e QA convention (`browse-e2e-qa.md`)

Browser-driven QA via the `browse` skill instead of a Playwright suite. Keeps the `data-testid`
discipline (every element a journey interacts with carries a stable `data-testid`; text and role
selectors are the exception, because they collide silently). Journeys come from the browse-e2e lens
in `04-test-cases.md`. One small worked example.

## 7. Deliverables and file layout

```
.claude/skills/crowsnest-component/
  SKILL.md
  house-style.md
  references/
    drizzle-er-and-sequence.md
    browse-e2e-qa.md
    test-cases-format.md

documents/architect/core-components/ig-sync/   (5 docs upgraded to house-style)

.claude/skills/document-component/SKILL.md      (updated: references house-style.md)
.claude/skills/ship-brainstorming/SKILL.md      (updated: spec path)
.claude/skills/ship-writing-plans/SKILL.md      (updated: plan path)

documents/planning/spec/                        (specs; this file is the first)
documents/planning/implementation-plan/         (plans go here going forward)
```

## 8. Acceptance criteria

1. `crowsnest-component/SKILL.md` exists, describes the five phases and four gates, and delegates
   Phases 3, 4, and 5-verify to the named ship-* skills without duplicating them.
2. `house-style.md` and the three reference docs exist, each with at least one worked example
   grounded in real crowsnest code.
3. The `ig-sync` five docs are upgraded to the house-style: a real drizzle ER diagram, a dependency
   map, DB-operation sequence diagrams that render, and the four-lens test cases. No sixth doc.
4. `document-component` references `house-style.md` and still owns the five-doc invariant and wiring.
5. `ship-brainstorming` writes architectural specs to `documents/planning/spec/`; `ship-writing-plans`
   writes plans to `documents/planning/implementation-plan/`.
6. Every doc follows the writing rule: no em or en dashes, straight quotes, sentence-case headings,
   grounded to code.

## 9. Open items

- The name `crowsnest-component` is the working name; a shorter trigger (for example `cn-component`)
  can be chosen at implementation time without changing this design.
- The retrofit of the remaining eight components is a follow-up plan, run through this skill once it
  ships. Not part of this spec.
- The business/BRD skill (C) is a separate later spec.
