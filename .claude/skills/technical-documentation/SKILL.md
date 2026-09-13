---
name: technical-documentation
description: Build and review high-quality technical docs and agent instruction files in the crowsnest repo, for humans and agents. Trigger:/technical-documentation
---

# Technical documentation

> Crowsnest folds this writing bar into `crowsnest-component/house-style.md`.
The load-bearing rules are folded into `.claude/skills/crowsnest-component/house-style.md`; this skill is the full playbook behind that bar.
>
> This skill is the general doc-writing bar. For a crowsnest component's five-doc
> lego block, `crowsnest-document-component` and `crowsnest-component/house-style.md`
> are canonical. For refactoring an existing docs page, use `crowsnest-refactor-docs`,
> which builds on this skill.

## Purpose

Produce and review technical documentation that is clear, actionable, and maintainable for both humans and agents, including contributor and agent instruction files (`AGENTS.md`, `CLAUDE.md`).

## When to use

- Creating or overhauling docs in the existing codebase (brownfield).
- Building evergreen docs meant to stay accurate over time.
- Reviewing doc diffs for structure, clarity, and operational correctness.
- Running a docs audit across `documents/` plus the governance files (`AGENTS.md`, `CLAUDE.md`, README).
- Updating `AGENTS.md` or `CLAUDE.md` to keep agent and contributor workflows aligned with current repo practice.
- Diagnosing agent-file drift: missing files, broken commands, or policy conflicts.

## Crowsnest docs facts

- Docs live in `documents/` and render as an mkdocs-material site (`mkdocs.yml`, `docs_dir: documents`). Preview with `mkdocs serve`.
- Two layers: `business-requirement/` (what crowsnest is and must do) and `architect/` (how it is built): one folder per component under `core-components/` plus cross-cutting `shared/`.
- Each component carries exactly five docs (`01`..`05`, the lego block). Plans and specs go under `documents/planning/`, never a sixth doc. `documents/archive/` is frozen and must not be cited as current.
- `documents/index.md` is the index; navigation is wired in `mkdocs.yml` under Components.
- Build and test commands are npm: `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck`.

## Writing rule (non-negotiable)

- No em or en dashes. No curly quotes; straight quotes only.
- Sentence-case headings.
- Grounded to code: no invented facts. Verify a behavior before stating it.
- Evergreen: state the current system as fact. No `Date:` field, no dated "verified on" framing, no ticket IDs as inline citations.

## Workflow

1. Classify the task: `build` or `review`; context: `brownfield` (default in this repo) or `evergreen`.
2. Inventory the doc scope early: the `documents/` tree, `mkdocs.yml`, plus governance files (`AGENTS.md`, `CLAUDE.md`, README).
3. Read the principles below and apply them throughout.
4. For build tasks, follow the build playbook.
5. For review tasks, follow the review playbook, and proactively detect issues without waiting for repeated prompts.
6. For a full component (new or reworked), route through `crowsnest-component` and its five-doc set instead of hand-rolling. This skill is the lighter bar for everything smaller.
7. When available, use sub-agents for bounded parallel discovery or review, then merge outputs into one coherent deliverable.
8. In brownfield mode, prioritize compatibility with current docs IA, tooling, and release state. In evergreen mode, prioritize timeless wording, an update strategy, and durable structure.
9. Return deliverables plus validation notes and remaining gaps.

## Inputs

- Doc type (tutorial, how-to, reference, explanation) and audience.
- File scope or diff scope.
- Build or review mode, and brownfield or evergreen intent.
- Target agent and human compatibility intent.
- Remediation mode (`apply-fixes` by default, or `report-only` when requested).

## Outputs

- Updated draft or review findings with clear next actions.
- Validation notes (what was checked, what remains).
- Navigation and maintenance recommendations for long-term quality.
- Governance-doc alignment summary when `AGENTS.md` or `CLAUDE.md` were touched.
- Documentation-surface coverage map (what was reviewed under `documents/`, README, and `mkdocs.yml`).
- Autodetected issue list with applied fixes (or explicit report-only findings).

## Principles

### Write for humans, optimize for agents (Matt Palmer)

1. Write for humans, optimize for agents.
2. Start with a funnel: what and why, quickstart, next steps.
3. Use Diataxis (tutorial, how-to, reference, explanation) to scaffold content.
4. Write with AI, but structure for agents.
5. Offload routine docs operations to background agents.
6. Automate quality with CI.
7. Automate scaffolding and repetitive workflow tasks.
8. Make contribution easy and visible.

### What makes documentation good (OpenAI cookbook)

- Prefer specific, accurate terminology over niche jargon.
- Keep examples self-contained and minimize dependencies.
- Prioritize high-value topics over edge-case depth.
- Do not teach unsafe patterns (for example, exposed secrets).
- Open with context that helps readers orient quickly.
- Apply empathy and override a rigid rule when it clearly improves the outcome.

### Merge policy when rules conflict

1. Preserve reader task success first.
2. Preserve structural clarity second.
3. Preserve long-term maintainability third.
4. Add agent optimization only if it does not reduce human clarity.

## Build playbook

1. **Align with governance.** Read `AGENTS.md` and `CLAUDE.md` before writing. Capture required constraints: nested-agent rules, command and test requirements (`npm run build/test/lint/typecheck`), PR workflow, style checks. Use the same commands and validation expectations in your snippets and examples.
2. **Inventory surfaces.** For repo-wide builds, include `documents/**`, `mkdocs.yml`, root and module `README*`, and the governance files. Build a coverage map before drafting.
3. **Path mapping.** Resolve every referenced path relative to the file that declares it, not an assumed root. Treat filesystem paths and the mkdocs nav routes as separate maps: verify `mkdocs.yml` nav entries point at files that exist, and that new files are added to the nav. Record mismatches (`missing file`, `stale nav entry`).
4. **Define intent and success.** Audience, prerequisites, job to be done, expected reader outcome, doc type, and what must be true after publish.
5. **Structure before prose.** Follow the funnel: what and why, quickstart, next steps. Keep headings informative and scannable. Open each section with the takeaway sentence. Add decision points with concrete branch guidance. Keep task-critical config inline; link exhaustive defaults, enums, and schemas.
6. **Governance files intentionally.** Keep `AGENTS.md` and `CLAUDE.md` concrete: real commands, real paths, clear boundaries (`Always`, `Ask first`, `Never`). Prioritize setup and test commands, PR expectations, and review gates. Keep cross-file links accurate and non-circular. If a required entry file is missing, create a minimal actionable one in the same pass rather than adding a caveat-only note. TODO: wire to a crowsnest CONTRIBUTING file only if the repo adopts one; today `AGENTS.md` and `CLAUDE.md` are canonical.
7. **Keep agent context tight.** Author once, expose once: one shared policy core, no duplicated guidance across agent files. Move long runbooks into linked docs under `documents/`. Avoid unrelated historical detail that inflates future tool reads.
8. **Brownfield mode.** Match existing terminology, navigation, and component patterns. Preserve existing IA unless there is a documented migration plan. For rewrites, include a migration note from old to new paths. Prefer the smallest safe change set that improves utility.
9. **Evergreen mode.** Prefer stable concepts over release-tied narrative. Isolate volatile details under clearly marked version sections. Include maintenance signals (owners, refresh triggers, stale criteria) and lifecycle notes (deprecation, replacement).
10. **Writing constraints.** Precise language, short imperative instructions, copy-ready self-contained examples, common failure modes and safe defaults. No placeholder guidance that cannot be executed.
11. **Agent readiness.** Keep key facts in text, not image-only. Prefer structured lists and tables when choices matter. Add links and anchors for deterministic navigation. Note what CI can check.
12. **Validate.** Run `mkdocs build` (surfaces broken nav and bad references) and `git diff --check` on touched files. Run a reference existence sweep for every path and command you introduced. Run commands and examples from the page whenever feasible. TODO: wire to a docs link-check and mdx-style check if the repo adds one; today mkdocs build plus a manual link sweep is the floor.

## Review playbook

1. **Scope and classify.** Doc type, audience, brownfield vs evergreen, expected reader outcome. For full-repo reviews, include `documents/**`, `mkdocs.yml`, README trees, and the governance files.
2. **Investigate proactively.** Find issues and risks without waiting for repeated prompts. Continue past the first pass when there are signals of deeper problems. Default to `apply-fixes` for high-confidence defects unless `report-only` is requested. When no issues are found, say so and call out residual risks.
3. **Governance surfaces.** For `AGENTS.md` and `CLAUDE.md`: confirm scope and command boundaries are explicit (`Always`, `Ask first`, `Never` when expected), commands and paths are real, and the two files do not conflict with each other or with nested instructions. Flag oversized files that should split into linked docs. Check for broken referenced files, and for command drift (non-existent commands, wrong-scope commands).
4. **Product doc surfaces.** Verify IA coverage across README and the `documents/` tree. Check for stale commands, missing prerequisites, and broken cross-links. Confirm referenced paths and anchors exist. Confirm the five-doc invariant holds for each component (no sixth doc; plans live in `documents/planning/`). Flag docs that should split or merge for discoverability.
5. **Path mapping.** Verify `mkdocs.yml` nav entries resolve to real files and that new pages are in the nav. Flag drift explicitly (`missing file`, `stale nav entry`).
6. **Structure.** Funnel check (what and why, quickstart, next steps). Validate heading flow and navigation. Flag critical content trapped in images or buried sections. Check Diataxis alignment and split mixed-purpose sections.
7. **Writing quality.** Concise, scannable paragraphs. Remove ambiguous pronouns and undefined terms. Verify examples are executable and scoped. Verify tone is directive, technical, and non-hand-wavy. Enforce the writing rule above (no dashes, straight quotes, sentence-case headings, evergreen).
8. **Brownfield mode.** Verify compatibility with existing IA and conventions. Verify anchors and cross-doc links remain valid. Flag regressions in onboarding and task-completion paths. Ensure changed terminology is propagated.
9. **Evergreen mode.** Flag date-stamped or brittle wording without version scope. Check ownership and refresh signals. Ensure recommendations survive routine product evolution. Flag missing deprecation or migration guidance.
10. **Output format.** (1) Blocking issues, file plus required fix. (2) Non-blocking improvements. (3) Validation notes, done vs pending.
