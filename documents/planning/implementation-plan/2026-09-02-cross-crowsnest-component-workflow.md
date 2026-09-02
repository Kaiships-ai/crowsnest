---
status: shipped
components: [shared, ig-sync]
backlog: none
owner: session-2026-09-02
shipped: 2026-09-02 94e4883
---

# Crowsnest component workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use ship-subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is authored for the independent-tasks PARALLEL mode: see the Parallelization section below.

**Goal:** Build the `crowsnest-component` orchestrator skill and its doc house-style, and apply the house-style to the `ig-sync` component as the worked example.

**Architecture:** A single five-phase skill that delegates planning, building, and verifying to the existing ship-* skills and scaffolding to `document-component`. Alongside it, a quality-bar doc (`house-style.md`) and three reference docs (drizzle ER and sequences, browse-driven e2e, the four-lens test-case format). All deliverables are markdown; there is no runtime code, so each task verifies with structure and lint checks, not vitest.

**Tech Stack:** Markdown skills and docs. Verification uses `grep`, `scripts/plan-status.sh`, and a mermaid render check (kroki). No new dependencies.

**Spec:** `documents/planning/spec/2026-09-02-crowsnest-component-workflow.md`

## Global Constraints

- Writing rule, every deliverable: no em or en dashes, no curly quotes, sentence-case headings, grounded to real code, no invented facts. (Copied from spec D7.)
- The five-doc invariant holds: a component folder has exactly `01`..`05`, never a sixth. Plans live in `documents/planning/implementation-plan/`. (Spec D6.)
- `document-component` stays the owner of the five-doc invariant and the index/mkdocs wiring. The new skill calls it, does not replace it. (Spec 3.1.5.)
- The skill is an orchestrator: Phases 3, 4, and 5-verify delegate to `ship-writing-plans`, `ship-subagent-driven-development`, and `ship-verification-before-completion`. Do not duplicate their content. (Spec D3.)
- Working name is `crowsnest-component`. Do not rename in this plan. (Spec 9.)
- Evergreen doc rule: state the current system as fact, no dated evidence framing, no `Date:` header field, no ticket ids as inline citations. (Spec 5.)

---

## Parallelization

Two waves. Every task writes distinct files, so tasks within a wave have no write conflicts and run concurrently under ship-subagent-driven-development independent-tasks mode.

- **Wave 1 (parallel): Tasks 1, 2, 3, 4, 8.** Foundation docs and the path-convention edits. None reads another Wave 1 output.
- **Wave 2 (parallel): Tasks 5, 6, 7.** Each reads Wave 1 outputs (the house-style and the three references) but writes its own distinct files.

Dependency summary: 5, 6, 7 depend on 1 (house-style) and, for 6, on 2, 3, 4. 8 is fully independent. Run Wave 1 to completion, then Wave 2.

Shared verification helpers used by several tasks:

- Dash and curly-quote scan on a file `F`:
  `grep -nP '[\x{2013}\x{2014}\x{2018}\x{2019}\x{201C}\x{201D}]' F` -> expect no output.
- Mermaid render check on a diagram saved to `d.mmd`:
  `curl -sS -X POST https://kroki.io/mermaid/svg -H "Content-Type: text/plain" --data-binary @d.mmd -o /dev/null -w "%{http_code}\n"` -> expect `200`. If kroki is unreachable, open the block in any mermaid viewer and note it; do not skip silently.

---

### Task 1: `house-style.md` (the quality bar, B)

**Files:**
- Create: `.claude/skills/crowsnest-component/house-style.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the section contract every one of the five component docs must satisfy. Tasks 5, 6, 7 reference this file by path.

**Read first:** `documents/planning/spec/2026-09-02-crowsnest-component-workflow.md` section 5; the funflow reference `/Users/kienbeovl/Desktop/JITS/sun-phuquoc-airway/funflow-v2-aio/documents/architect/core-components/pats/01-concept-brief.md` and `.../pats/02-architecture.md` (structure to match); the existing `.claude/skills/document-component/SKILL.md` (the invariant to respect).

- [ ] **Step 1: Write the file with these exact sections**

Header: `# Component doc house style`, one line of intent. Then one section per doc, each stating required parts:

- `## 01-concept-brief.md`: Status header (Status only, no Date field). What it is. Why it exists. Key-concepts table. How it fits in the system. Dependency map with three tables: upstream, downstream, external.
- `## 02-architecture.md`: Module-structure table (file, export, role). Drizzle ER diagram (mermaid, points at `references/drizzle-er-and-sequence.md`). Indexes table. Data flow. Key decisions. DB-operation sequence diagrams (points at the same reference). An "open, not verified" section.
- `## 03-feature-description.md`: Numbered feature list; per feature who/what/how-to-access/business-rules/limitations; after implementation a text-only user-guide subsection per feature. Note it feeds the mkdocs site.
- `## 04-test-cases.md`: the four lenses, points at `references/test-cases-format.md`.
- `## 05-backlog-to-enhance.md`: one table (ID, Title, Severity, Type, Source, Status); `open` rows are the live board.
- `## Writing rule`: restate the Global Constraints writing rule and the evergreen rule.

- [ ] **Step 2: Verify structure**

Run: `grep -cE '^## (01|02|03|04|05)-' .claude/skills/crowsnest-component/house-style.md` -> expect `5`.

- [ ] **Step 3: Verify no dashes or curly quotes**

Run the dash-and-curly-quote scan on the file -> expect no output.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/crowsnest-component/house-style.md
git commit -m "docs: add crowsnest-component doc house-style"
```

---

### Task 2: reference `drizzle-er-and-sequence.md`

**Files:**
- Create: `.claude/skills/crowsnest-component/references/drizzle-er-and-sequence.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the ER-from-drizzle and DB-operation sequence-diagram conventions. Tasks 5 and 6 reference it.

**Read first:** the DB-op sequence-diagram and mermaid-gotchas sections of `/Users/kienbeovl/Desktop/JITS/sun-phuquoc-airway/funflow-v2-aio/.claude/skills/core-component-impl/SKILL.md` (the notation and the render gotchas); the real crowsnest schema `src/server/db/schema.ts`.

- [ ] **Step 1: Write the file**

Sections: `# Drizzle ER and sequence house style`; `## ER from the drizzle schema` (how to read tables and relations out of `src/server/db/schema.ts`, list indexes, mermaid `erDiagram` shape); `## DB-operation sequence diagrams` (name the table per query step; final response line convention; no-input validation steps as self-calls); `## Mermaid render gotchas` (no unquoted semicolons in message text, no HTML entities or literal `<`/`>` in condition labels, every message has an explicit arrow, single-line messages, verify by rendering); `## Worked example` (one small `erDiagram` plus one small `sequenceDiagram` built from a real crowsnest table such as a channels or videos table in `schema.ts`).

- [ ] **Step 2: Verify the worked-example diagrams render**

Extract each mermaid block in the file to a temp `.mmd` and run the mermaid render check -> expect `200` for each.

- [ ] **Step 3: Verify no dashes or curly quotes**

Run the dash-and-curly-quote scan -> expect no output.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/crowsnest-component/references/drizzle-er-and-sequence.md
git commit -m "docs: add drizzle ER and sequence reference"
```

---

### Task 3: reference `browse-e2e-qa.md`

**Files:**
- Create: `.claude/skills/crowsnest-component/references/browse-e2e-qa.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the browser-driven e2e QA convention. Tasks 5 and 6 reference it.

**Read first:** the `data-testid` discipline in `/Users/kienbeovl/Desktop/JITS/sun-phuquoc-airway/funflow-v2-aio/.claude/skills/core-component-impl/SKILL.md` (Phase 4a testid rules); the `browse` skill entry available in this session; a real crowsnest UI route such as `src/app/(shell)/channels` for a concrete journey.

- [ ] **Step 1: Write the file**

Sections: `# Browser e2e QA via the browse skill`; `## Why browse, not Playwright` (crowsnest has vitest and the browse skill, no Playwright suite); `## data-testid discipline` (every element a journey touches carries a stable `data-testid`; text and role selectors are the exception because they collide silently; a shared testid is fine for counting but not for targeting one row); `## Writing a journey` (source journeys from the browse-e2e lens in `04-test-cases.md`; arrive, act, assert visible state); `## Worked example` (one short journey against a real crowsnest screen, naming the `data-testid`s it would use).

- [ ] **Step 2: Verify structure**

Run: `grep -c 'data-testid' .claude/skills/crowsnest-component/references/browse-e2e-qa.md` -> expect at least `3`.

- [ ] **Step 3: Verify no dashes or curly quotes**

Run the dash-and-curly-quote scan -> expect no output.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/crowsnest-component/references/browse-e2e-qa.md
git commit -m "docs: add browse e2e QA reference"
```

---

### Task 4: reference `test-cases-format.md`

**Files:**
- Create: `.claude/skills/crowsnest-component/references/test-cases-format.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the four-lens format for `04-test-cases.md`. Tasks 5 and 6 reference it.

**Read first:** spec section 6; an existing real crowsnest `04-test-cases.md` for the current table shape, `documents/architect/core-components/feed/04-test-cases.md`.

- [ ] **Step 1: Write the file**

Sections: `# The four test lenses`; one subsection per lens: `## behavior` (user-visible, product-owner style, sourced from `03-feature-description.md`), `## route and action` (server actions, API routes, drizzle against a temp SQLite db, run with vitest), `## browse-e2e` (real browser journeys via the browse skill, points at `browse-e2e-qa.md`), `## security-lite` (local-desktop threat model: `.env.local` secret handling, license gate, sidecar shared token, no buyer data leaving the box; explicitly not OWASP multi-tenant). Each lens shows the case-table columns to use.

- [ ] **Step 2: Verify structure**

Run: `grep -cE '^## (behavior|route and action|browse-e2e|security-lite)' .claude/skills/crowsnest-component/references/test-cases-format.md` -> expect `4`.

- [ ] **Step 3: Verify no dashes or curly quotes**

Run the dash-and-curly-quote scan -> expect no output.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/crowsnest-component/references/test-cases-format.md
git commit -m "docs: add four-lens test-cases format reference"
```

---

### Task 5: `SKILL.md` (the orchestrator)

**Files:**
- Create: `.claude/skills/crowsnest-component/SKILL.md`

**Interfaces:**
- Consumes: `house-style.md` (Task 1) and the three references (Tasks 2, 3, 4), by path.
- Produces: the runnable skill. Nothing depends on it inside this plan.

**Read first:** all of `documents/planning/spec/2026-09-02-crowsnest-component-workflow.md` (sections 4 and 4.2 are the phase content); `.claude/skills/ship-writing-plans/SKILL.md`, `.claude/skills/ship-subagent-driven-development/SKILL.md`, `.claude/skills/ship-verification-before-completion/SKILL.md`, `.claude/skills/document-component/SKILL.md`, and the `where-are-we` skill, so the delegation is described accurately.

- [ ] **Step 1: Write the frontmatter and body**

Frontmatter: `name: crowsnest-component`; a `description` that says it takes a crowsnest component from concept to shipped through five phases and four gates, and names the trigger `/crowsnest-component`; `disable-model-invocation: true` (match `document-component`, this is a user-triggered workflow).

Body sections: `# crowsnest-component`; a one-paragraph overview naming it an orchestrator; `## Composition` (the delegation table from spec 4.1); `## Phase 1: research and concept` through `## Phase 5: verify and doc-sync`, each with its human-gate note and its delegated skill, copied faithfully from spec 4.2; `## Error handling` (spec 4.3); `## Quick reference` (a five-row phase table: phase, gate yes/no, delegated skill, key output). Every phase that produces a doc points at `house-style.md`; Phase 2 points at `references/drizzle-er-and-sequence.md` and `references/test-cases-format.md`; Phase 4 points at `references/browse-e2e-qa.md`.

- [ ] **Step 2: Verify the five phases and the delegations are present**

Run: `grep -cE '^## Phase [1-5]:' .claude/skills/crowsnest-component/SKILL.md` -> expect `5`.
Run: `grep -oE 'ship-writing-plans|ship-subagent-driven-development|ship-verification-before-completion|document-component' .claude/skills/crowsnest-component/SKILL.md | sort -u | wc -l` -> expect `4`.

- [ ] **Step 3: Verify no dashes or curly quotes**

Run the dash-and-curly-quote scan -> expect no output.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/crowsnest-component/SKILL.md
git commit -m "feat: add crowsnest-component orchestrator skill"
```

---

### Task 6: apply the house-style to `ig-sync` (the exemplar)

**Files:**
- Modify: `documents/architect/core-components/ig-sync/01-concept-brief.md`
- Modify: `documents/architect/core-components/ig-sync/02-architecture.md`
- Modify: `documents/architect/core-components/ig-sync/03-feature-description.md`
- Modify: `documents/architect/core-components/ig-sync/04-test-cases.md`
- Modify: `documents/architect/core-components/ig-sync/05-backlog-to-enhance.md`

**Interfaces:**
- Consumes: `house-style.md` (Task 1), all three references (Tasks 2, 3, 4).
- Produces: the reference example the other eight components are retrofitted against later.

**Read first:** the current five `ig-sync` docs (they were filled earlier this session); the real code the ER and sequences must match: `src/server/db/schema.ts`, `src/server/services/sync-engine.ts`, `src/server/ig/client.ts`, `src/server/actions/sync-actions.ts`, `services/ig/` (the Python sidecar); `documents/architect/shared/external-services.md` and `background-jobs.md`.

- [ ] **Step 1: Upgrade `01-concept-brief.md`**

Restructure onto the house-style: Status header, what it is, why it exists, a key-concepts table (session, sidecar, shared token, outlier score input, lookback window), how it fits, and the three dependency-map tables (upstream, downstream, external). Keep every fact grounded in the code read above.

- [ ] **Step 2: Upgrade `02-architecture.md`**

Add: a module-structure table (file, export, role) covering the Node side and the Python sidecar; a drizzle `erDiagram` for the channels and videos and view-count tables read from `src/server/db/schema.ts`, per `references/drizzle-er-and-sequence.md`; an indexes table; a data-flow section; a DB-operation `sequenceDiagram` for one sync pass, per the same reference; the key decisions; and an "open, not verified" section carrying the empty-`IG_PASSWORD` sidecar dependency.

- [ ] **Step 3: Verify the ig-sync diagrams render**

Extract each mermaid block in `02-architecture.md` to a temp `.mmd` and run the mermaid render check -> expect `200` for each.

- [ ] **Step 4: Upgrade `04-test-cases.md` to the four lenses**

Reorganize into behavior, route and action, security-lite, and browse-e2e sections per `references/test-cases-format.md`. Keep the existing confirmed cases (for example the sidecar-will-not-start case) and place them in the right lens.

- [ ] **Step 5: Reconcile `03` and `05` to the house-style**

Ensure `03-feature-description.md` has the numbered-feature shape with per-feature business rules and limitations; ensure `05-backlog-to-enhance.md` is the single table with the six columns and `open` rows.

- [ ] **Step 6: Verify the invariant and the board still parse**

Run: `ls documents/architect/core-components/ig-sync | grep -cE '^0[1-5]-'` -> expect `5` (no sixth file).
Run: `bash scripts/plan-status.sh` -> expect it to run without error and count ig-sync's open rows.

- [ ] **Step 7: Verify no dashes or curly quotes across all five**

Run the dash-and-curly-quote scan on each of the five files -> expect no output.

- [ ] **Step 8: Commit**

```bash
git add documents/architect/core-components/ig-sync
git commit -m "docs: upgrade ig-sync docs to the component house-style"
```

---

### Task 7: point `document-component` at the house-style

**Files:**
- Modify: `.claude/skills/document-component/SKILL.md`

**Interfaces:**
- Consumes: `house-style.md` (Task 1).
- Produces: nothing downstream in this plan.

**Read first:** the current `.claude/skills/document-component/SKILL.md`.

- [ ] **Step 1: Add a quality-bar reference**

Add a short section that points at `.claude/skills/crowsnest-component/house-style.md` as the quality bar for what each of the five docs must contain, while keeping this skill the owner of the five-doc invariant and the index and mkdocs wiring. Do not move the invariant text and do not add a sixth doc.

- [ ] **Step 2: Verify the reference is present and the invariant text is intact**

Run: `grep -c 'house-style.md' .claude/skills/document-component/SKILL.md` -> expect at least `1`.
Run: `grep -c 'EXACTLY five' .claude/skills/document-component/SKILL.md` -> expect `1` (the invariant line is untouched).

- [ ] **Step 3: Verify no dashes or curly quotes**

Run the dash-and-curly-quote scan -> expect no output.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/document-component/SKILL.md
git commit -m "docs: point document-component at the house-style quality bar"
```

---

### Task 8: path conventions in the ship-* skills

**Files:**
- Modify: `.claude/skills/ship-brainstorming/SKILL.md`
- Modify: `.claude/skills/ship-writing-plans/SKILL.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing downstream in this plan. Fully independent, runs in Wave 1.

**Read first:** both target skills, to find the exact lines that state the current spec and plan locations.

- [ ] **Step 1: Update `ship-brainstorming` spec location**

In the architectural path, change the "Write design doc" location from `documents/architect/core-components/<component>/01-concept-brief.md` to `documents/planning/spec/` (a spec is written there, filename `YYYY-MM-DD-<slug>.md`). Keep the rest of that step. Add one line: a component's durable design still folds into its `02-architecture.md` on ship, the spec is the design record.

- [ ] **Step 2: Update `ship-writing-plans` plan location**

Change the "Save plans to" path and the deterministic placement block from `documents/planning/YYYY-MM-DD-...` to `documents/planning/implementation-plan/YYYY-MM-DD-...`. Update the "lego board is generated" and any other references to the flat planning path accordingly. Leave the frontmatter block and naming logic otherwise unchanged.

- [ ] **Step 3: Verify both edits landed**

Run: `grep -c 'documents/planning/spec' .claude/skills/ship-brainstorming/SKILL.md` -> expect at least `1`.
Run: `grep -c 'documents/planning/implementation-plan' .claude/skills/ship-writing-plans/SKILL.md` -> expect at least `1`.

- [ ] **Step 4: Verify no dashes or curly quotes**

Run the dash-and-curly-quote scan on both files -> expect no output (these skills may already contain dashes; if a pre-existing dash is outside your edited lines, leave it and note it, do not rewrite unrelated prose).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/ship-brainstorming/SKILL.md .claude/skills/ship-writing-plans/SKILL.md
git commit -m "docs: move spec and plan paths to planning/spec and planning/implementation-plan"
```

---

## Self-review

**Spec coverage.** Spec section 3.1 items 1-6 map to tasks: item 1 (SKILL) -> Task 5; item 2 (house-style) -> Task 1; item 3 (three references) -> Tasks 2, 3, 4; item 4 (ig-sync exemplar) -> Task 6; item 5 (document-component) -> Task 7; item 6 (path conventions) -> Task 8. Acceptance criteria 1-6 (spec section 8) each trace to a task's verify steps. Out-of-scope items (business skill, the other eight retrofits) are correctly absent.

**Placeholder scan.** No "TBD", "TODO", or "handle edge cases". Each task names exact files, exact sections, and exact verify commands. Doc content is specified as a concrete section contract plus the exact source files to read, which is the honest altitude for a doc-authoring plan (the deliverable is prose derived from the code, not code).

**Type consistency.** File paths are consistent across tasks: `house-style.md` and the three `references/*.md` names are identical everywhere they appear (Tasks 1-6). The four lens names (behavior, route and action, browse-e2e, security-lite) match between Task 4 and Task 6. The trigger name `crowsnest-component` matches the spec working name.

**One risk flagged for Wave 2:** Task 6 renders ig-sync diagrams via kroki; if kroki is unreachable in the execution environment, the executor validates in a local mermaid viewer and notes it, per the shared helper, rather than skipping.
