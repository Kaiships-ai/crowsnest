---
status: shipped
components: [feed, analyze, remix, studio, mine, ig-sync, llm, kit, onboarding, shared]
backlog: none
owner: session-docs-restructure
shipped: 2026-09-02 df430f0
---
# Migrate product-description content into the documents tree

> **For agentic workers:** REQUIRED SUB-SKILL: Use ship-subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the live behavior-spec prose in `docs/product-description/` (42 files) and a few archived briefs into the new `documents/` tree, filling each component's 03-feature-description and 04-test-cases, the shared technical docs, and business-requirement, then retire the old locations.

**Architecture:** This is content migration, not code. The product-description prose is already clean behavior spec, so each task is move-and-reshape: copy the source into the target doc, fit it to the doc's heading, and drop the "Open questions and verification" sections (those already became each component's 05-backlog in a prior commit). Verification is structural: target files are non-empty, the old tree is gone, and `mkdocs build` still succeeds.

**Tech Stack:** Markdown, mkdocs-material (build check only), git.

**Spec:** This plan is its own spec. The source-to-target map came from an exploration pass and is inlined per task. The target structure is defined in `documents/index.md` and the doc-restructure plan at `/Users/kienbeovl/.claude/plans/harmonic-rolling-nebula.md`.

## Execution mode: parallel write, review gate, sequential consolidate

Tasks 1 through 8 are independent (each writes a different component's files), so they run in
parallel: one sonnet agent per task, dispatched together. Task 9 (retire old locations) runs last,
alone, after everything is migrated.

Rules for every parallel agent (they prevent the only contention points):
- Write only your task's target files. Do NOT edit `mkdocs.yml`. Do NOT run any git command.
- Reshape as you move: drop each source's "Open questions and verification" section, fit headings to
  the target doc, no em or en dashes, straight quotes, no invented facts.

After the agents return, a review agent gates each output (structure matches the spec, non-empty,
sourced from product-description, no AI-writing tells). Findings go back to the owning agent to fix.

Only after the review gate passes does the controller consolidate, sequentially: update the
`mkdocs.yml` nav, run `mkdocs build`, remove the migrated sources, `git mv docs/archive-do-not-read
documents/archive`, and commit. Commits happen in the controller session only, never in a parallel
agent.

## Global Constraints

- Prose follows the repo writing rules: no em or en dashes, straight quotes, sentence-case headings, no invented facts. The humanizer doc-check (global) blocks a `.md` write containing an em dash, so reshape dashes in the source as you move it.
- Every component keeps EXACTLY five docs. Do not add a sixth file to any `core-components/<name>/`.
- Do not touch application code (`src/`, `services/`, `packaging/`). This plan only moves docs.
- Drop each source file's "Open questions and verification" section on migration; that content is already in the component's 05-backlog.
- Use `git mv` where a file moves wholesale so history follows; use copy-and-reshape where several sources merge into one target.

---

## Task 1: business-requirement

Follow the datahub BRD shape: one product folder under `brd/` with two numbered docs, plus a
product roadmap. Reference for headings and depth:
`/Users/kienbeovl/Desktop/JITS/datahub-wallet/datahub/documents/business-requirement/brd/tmds-digital-marketing/{01-concept-research.md,02-use-case.md}`.

Two hard constraints on the BRD docs:
1. `01-concept-research.md` and `02-use-case.md` must match the section structure of the two
   reference files (same top-level headings and the same kind of subsections: document control,
   index, executive summary, problem, personas, actor model, process flows, regulatory/market for
   01; use cases at a glance, scope, actor registry, shared reference tables, use case flows with
   main/alternate/error for 02). Same shape, crowsnest content.
2. After writing each of the two docs, run the `/deliverable-house-style` skill on it and apply its
   rewrite, so the prose carries no AI-writing tells. A BRD doc is not done until it has passed that
   pass.

The precise source of truth is `docs/product-description/` (the live behavior spec), not the older
archived briefs. Use the archived briefs (`V1-BRIEF.md`, `v1-scope.md`, `WAVE2-BRIEF.md`) only for
scope framing, and do not invent facts the product-description does not support.

**Files:**

- Modify: `documents/business-requirement/product-document.md`
- Create: `documents/business-requirement/brd/crowsnest/01-concept-research.md`
- Create: `documents/business-requirement/brd/crowsnest/02-use-case.md`
- Create: `documents/business-requirement/roadmap.md`
- Sources (precise): all of `docs/product-description/` (goal.md, README.md, foundations/, feed/,  
  remix/, studio/, mine/, cross-cutting/, glossary.md). Persona: `git show HEAD:character-spec.md`.

- [ ] Step 1: Read the two datahub reference files for structure, then read `docs/product-description/`
  end to end to ground every claim.
- [ ] Step 2: Write `brd/crowsnest/01-concept-research.md`: executive summary, the problem (a solo
  creator tracking Instagram outliers by hand), who it serves (the persona, from character-spec),
  the actor model (the buyer, the app, the IG sidecar, the LLM), the core loop, and market context.
  Derive it from product-description, not from imagination.
- [ ] Step 3: Write `brd/crowsnest/02-use-case.md`: use cases at a glance, scope (v0.2 shipped vs
  later), actor registry, shared reference tables, then use case flows for the core loop (track a
  channel, sync, analyze an outlier, remix, publish) with main, alternate, and error flows. Pull the
  flows from the feature-description prose in product-description.
- [ ] Step 4: Run `/deliverable-house-style` on `brd/crowsnest/01-concept-research.md` and
  `02-use-case.md`, apply the rewrite. Confirm each still matches the reference section structure
  after the pass.
- [ ] Step 5: Write `roadmap.md`: what shipped (v0.2, the Kit and packaging), what is planned (v0.3,
  the onboarding redesign and the bug board from the component 05-backlogs), and later (Intel,
  Windows, Linux, TikTok/YT ingestion). Reference the component backlogs rather than duplicating them.
- [ ] Step 6: Keep `product-document.md` as the short "what crowsnest is" at the business-requirement
  root (buyer, the $99 promise, one-paragraph core loop). Fold in the persona intent from character-spec.
- [ ] Step 7: Add the three new files to `mkdocs.yml` nav. Verify `mkdocs build` succeeds and each
  new file is non-empty. Commit.

Proof: `brd/crowsnest/01-concept-research.md` and `02-use-case.md` exist with the datahub-shaped
sections; `roadmap.md` lists shipped, planned, and later; `mkdocs build` succeeds; every claim traces
to `docs/product-description/`.

## Task 2: architect/shared

**Files:**

- Modify: `documents/architect/shared/{data-contracts,external-services,persistence,glossary}.md`
- Create: `documents/architect/shared/navigation-and-shell.md`, `documents/architect/shared/background-jobs.md`, `documents/architect/shared/interaction-model.md`, `documents/architect/shared/data-model.md`, `documents/architect/shared/status-and-failures.md`
- Sources: `docs/product-description/foundations/{navigation-and-shell,data-model,interaction-model,background-jobs}.md`, `docs/product-description/cross-cutting/{external-services,persistence,status-and-failures}.md`, `docs/product-description/glossary.md` + `git show HEAD:CONTEXT.md`, `docs/archive-do-not-read/product/v1-data-contracts.md`

- [ ] Step 1: `git mv` the four foundations files into `shared/` (they are already the right shape).
- [ ] Step 2: Move `cross-cutting/persistence.md` and `status-and-failures.md` into `shared/`. Merge `cross-cutting/external-services.md` into `shared/external-services.md` (it seeds ig-sync and llm too; leave the full text here, reference it from those components later).
- [ ] Step 3: Merge `product-description/glossary.md` and `git show HEAD:CONTEXT.md` into `shared/glossary.md`.
- [ ] Step 4: Move `archive-do-not-read/product/v1-data-contracts.md` content into `shared/data-contracts.md`.
- [ ] Step 5: Add each new shared file to the nav in `mkdocs.yml`. Verify `mkdocs build` succeeds. Commit.

Proof: `shared/` holds the moved files; `mkdocs build` succeeds with the new nav entries.

## Task 3: feed (03 + 04)

**Files:**

- Modify: `documents/architect/core-components/feed/03-feature-description.md`, `.../feed/04-test-cases.md`
- Sources 03: `docs/product-description/feed/{feed,filters-and-saved-views,quick-preview,keep-this-post,save-to-vault,video-detail}.md`
- Source 04: `docs/product-description/verification/feed.md`

- [ ] Step 1: Compose `feed/03-feature-description.md` from the six feed prose files, one section each, in reading order (feed overview first). Drop each file's open-questions section.
- [ ] Step 2: Move `verification/feed.md` content into `feed/04-test-cases.md`.
- [ ] Step 3: Verify both are non-empty and mention the outlier card and filters. Commit.

Proof: `feed/03` covers the card, filters, saved views, quick preview, keep, save; `feed/04` lists the feed checks.

## Task 4: analyze (03 + 04)

**Files:**

- Modify: `documents/architect/core-components/analyze/03-feature-description.md`
- Sources: `docs/product-description/feed/{analysis,generate-idea}.md`

- [ ] Step 1: Compose `analyze/03` from `analysis.md` and `generate-idea.md`.
- [ ] Step 2: If `verification/` has analyze-specific checks, move them into `analyze/04`; otherwise leave the 04 stub with a note.
- [ ] Step 3: Verify non-empty, mentions analysis and idea generation. Commit.

Proof: `analyze/03` describes analyzing an outlier and generating an idea.

## Task 5: remix (03 + 04)

**Files:**

- Modify: `documents/architect/core-components/remix/{03-feature-description,04-test-cases}.md`
- Sources 03: `docs/product-description/remix/*` (remix-overview + the stage files)
- Source 04: `docs/product-description/verification/remix.md`

- [ ] Step 1: Compose `remix/03` from the overview then each stage (research, style, hook, prompt, script) in pipeline order.
- [ ] Step 2: Move `verification/remix.md` into `remix/04`.
- [ ] Step 3: Verify both non-empty and cover all stages. Commit.

Proof: `remix/03` walks the full pipeline; `remix/04` lists the remix checks.

## Task 6: studio (03 + 04)

**Files:**

- Modify: `documents/architect/core-components/studio/{03-feature-description,04-test-cases}.md`
- Sources 03: `docs/product-description/studio/{studio-overview,cook-run,publish}.md`
- Source 04: `docs/product-description/verification/studio.md`

- [ ] Step 1: Compose `studio/03` from overview, cook-run, publish.
- [ ] Step 2: Move `verification/studio.md` into `studio/04`.
- [ ] Step 3: Verify and commit.

Proof: `studio/03` covers cooking to a render and publishing; `studio/04` lists the studio checks.

## Task 7: mine (03 + 04)

**Files:**

- Modify: `documents/architect/core-components/mine/{03-feature-description,04-test-cases}.md`
- Sources 03: `docs/product-description/mine/{mine-overview,posts-and-metrics,calendar,plan-dialog}.md`
- Source 04: `docs/product-description/verification/mine.md`

- [ ] Step 1: Compose `mine/03` from the four mine files.
- [ ] Step 2: Move `verification/mine.md` into `mine/04`.
- [ ] Step 3: Verify and commit.

Proof: `mine/03` covers posts, metrics, calendar, plans; `mine/04` lists the mine checks.

## Task 8: shared verification + the four thin components

**Files:**

- Modify: `documents/architect/shared/` (a cross-cutting test-cases doc), and `kit`, `onboarding`, `ig-sync`, `llm` 01/02 stubs
- Sources: `docs/product-description/verification/{foundations,cross-cutting}.md`; `docs/archive-do-not-read/superpowers/plans/kit-distribution.md` (kit); `docs/archive-do-not-read/design/ux-flows/01-coldstart-channels.md` (onboarding); `git show HEAD:goal.md` + `docs/archive-do-not-read/instagram-sync-brief.md` (ig-sync); the llm slice of `shared/external-services.md` (llm)

- [ ] Step 1: Move `verification/{foundations,cross-cutting}.md` into a shared test-cases doc (or into `highlevel-architecture.md` as a verification section).
- [ ] Step 2: Fill `kit/01` and `kit/02` from the kit-distribution plan and packaging-and-release.md (kit is real and shipped, so it deserves real content).
- [ ] Step 3: Fill `onboarding/01` from the coldstart-channels ux-flow; leave `03` a stub with a pointer to the onboarding redesign in its 05-backlog.
- [ ] Step 4: Fill `ig-sync/01` from goal.md + instagram-sync-brief; `llm/01` from the llm part of external-services.
- [ ] Step 5: Verify each has real (not stub) 01 where a source existed. Commit.

Proof: `kit/01`, `kit/02`, `onboarding/01`, `ig-sync/01`, `llm/01` are no longer the one-line stubs.

## Task 9: retire the old locations

**Files:**

- Delete: `docs/product-description/` (after all prose is migrated)
- Move: `docs/archive-do-not-read/` -&gt; `documents/archive/`

- [ ] Step 1: Confirm every `docs/product-description/` file has been migrated (grep the tree for any file not yet moved).
- [ ] Step 2: `git rm -r docs/product-description` (its content now lives in components and shared).
- [ ] Step 3: `git mv docs/archive-do-not-read documents/archive`.
- [ ] Step 4: Update `documents/index.md` if it references any old path. Run `mkdocs build` a final time. Commit.

Proof: `docs/product-description` and `docs/archive-do-not-read` no longer exist; `documents/archive` holds the old one-offs; `mkdocs build` succeeds; `ls docs/` is empty or gone.

## Self-review notes

- Coverage: every one of the 42 product-description files maps to a task (feed 6, analyze 2, remix 7, studio 3, mine 4, foundations 4, cross-cutting 3, verification 7, glossary 1, plus goal/README/AGENTS/CLAUDE meta to archive). bug-triage.md is already split (prior commit); its file goes to archive in Task 9.
- The thin components (onboarding, llm) will have short docs; that is expected and noted, not a gap to fill with invented content.
- Each task is independently reviewable and commits on its own, so this can run one task per subagent.

