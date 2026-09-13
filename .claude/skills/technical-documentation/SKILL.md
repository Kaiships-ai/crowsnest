---
name: technical-documentation
description: Build and review high-quality technical docs and agent instruction files in the crowsnest repo, for humans and agents. Trigger:/technical-documentation
---

# Technical documentation

> Crowsnest folds this writing bar into `.claude/skills/crowsnest-component/house-style.md`.
> The load-bearing rules live there; this skill is the full playbook behind that bar.
>
> For a component's five-doc lego block, `crowsnest-document-component` and
> `crowsnest-component/house-style.md` are canonical. For refactoring an existing docs
> page, use `crowsnest-refactor-docs`, which builds on this skill.

## Purpose

Produce and review technical documentation that is clear, actionable, and maintainable for
both humans and agents, including the governance files (`AGENTS.md`, `CLAUDE.md`).

## When to use

- Creating or overhauling docs in the existing codebase (brownfield).
- Building evergreen docs meant to stay accurate over time.
- Reviewing doc diffs for structure, clarity, and operational correctness.
- Running a docs audit across `documents/` plus the governance files and README.
- Updating `AGENTS.md` or `CLAUDE.md` to keep agent and contributor workflows aligned with
  current repo practice.
- Diagnosing agent-file drift: missing files, broken commands, or policy conflicts.

## Crowsnest facts (the short version)

- Docs live in `documents/` and render as an mkdocs-material site (`mkdocs.yml`,
  `docs_dir: documents`). Preview with `mkdocs serve`.
- Two layers: `business-requirement/` and `architect/` (one folder per component under
  `core-components/` plus cross-cutting `shared/`).
- Each component carries exactly five docs (`01`..`05`); plans and specs go under
  `documents/planning/`, never a sixth doc. `documents/archive/` is frozen.
- Commands are npm: `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck`.
- Writing rule: no em or en dashes, straight quotes only, sentence-case headings, grounded
  to code, evergreen framing. See `references/principles.md` for the full rule.

## Workflow

1. Classify the task: `build` or `review`; context: `brownfield` (default) or `evergreen`.
2. Inventory the doc scope early: the `documents/` tree, `mkdocs.yml`, and governance
   files (`AGENTS.md`, `CLAUDE.md`, README).
3. Read `references/principles.md` and apply it throughout.
4. For crowsnest docs work, read `references/crowsnest.md` before the build/review playbook.
5. For build tasks, follow `references/build.md`.
6. For review tasks, follow `references/review.md`, and detect issues proactively.
7. For a full component (new or reworked), route through `crowsnest-component` and its
   five-doc set instead of hand-rolling. This skill is the lighter bar for everything
   smaller.
8. When available, use the sub-agents below for bounded parallel discovery or review, then
   merge outputs into one coherent deliverable.
9. Return deliverables plus validation notes and remaining gaps.

## References (read on demand)

| File | Read it when |
| --- | --- |
| `references/principles.md` | Always. The governing ruleset (Matt Palmer, OpenAI cookbook), the merge policy, and the crowsnest writing rule. |
| `references/crowsnest.md` | Any crowsnest docs work. Page types, the two-layer IA, the five-doc lego block, preservation, and mkdocs validation. |
| `references/build.md` | Build tasks. Step-by-step build flow: governance alignment, surface inventory, path mapping, structure, validation. |
| `references/review.md` | Review tasks. The review checklist: governance, product-doc, path-map, structure, and writing-quality passes. |
| `references/agent-and-contributing.md` | Editing or auditing `AGENTS.md` / `CLAUDE.md`. Canonical/alias precedence, boundaries, conflict handling. |
| `references/tooling.md` | Platform fit is uncertain. mkdocs-material selection and review implications. |

## Sub-agents (use when the scope is broad)

Use these by default for repo-wide, multi-surface, or high-conflict work. Each is a
bounded role prompt; merge their outputs with the synthesis agent.

| Agent | Read it when |
| --- | --- |
| `agents/inventory-agent.md` | File/config discovery, coverage map, missing-path checks. |
| `agents/governance-agent.md` | `AGENTS.md`/`CLAUDE.md` precedence, conflicts, policy drift. |
| `agents/docs-framework-agent.md` | mkdocs config, path base, and nav-vs-file mapping checks. |
| `agents/synthesis-agent.md` | Merge sub-agent outputs into one prioritized fix plan. |

## Inputs

- Doc type (tutorial, how-to, reference, explanation) and audience.
- File scope or diff scope.
- Build or review mode, and brownfield or evergreen intent.
- Remediation mode (`apply-fixes` by default, or `report-only` when requested).

## Outputs

- Updated draft or review findings with clear next actions.
- Validation notes (what was checked, what remains).
- Navigation and maintenance recommendations.
- Governance-doc alignment summary when `AGENTS.md` or `CLAUDE.md` were touched.
- Documentation-surface coverage map (`documents/`, README, `mkdocs.yml`).
- Autodetected issue list with applied fixes (or explicit report-only findings).
