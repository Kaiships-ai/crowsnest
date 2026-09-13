---
name: crowsnest-refactor-docs
description: Refactor an existing crowsnest docs page with source-audited preservation, restructuring, and verification against the documents/ five-doc lego. Trigger:/crowsnest-refactor-docs
---

# crowsnest refactor docs

## Overview

Use this skill when the user gives a target crowsnest docs page under `documents/` and
asks to rewrite, refactor, reorganize, split, shorten, or improve it.

This skill builds on `technical-documentation`: use that skill for style, the writing
rule, structure, examples, and verification. This skill adds the rewrite workflow needed
to avoid losing accurate behavior during a major docs refactor. It respects the crowsnest
five-doc lego: a component under `documents/architect/core-components/<name>/` carries
exactly five docs (`01`..`05`), plans and specs live under `documents/planning/`, and the
mkdocs nav is wired through `crowsnest-document-component`.

## Inputs

Required:

- A target docs page path, such as `documents/architect/core-components/feed/02-architecture.md`
  or a `documents/shared/*` doc.

Optional:

- Specific goals, such as shorter main page, move dense detail to `shared/`, or align with
  current code.
- Related source files, schemas, commands, tests, specs, or PRs.

If the target page is missing or ambiguous, ask one concise question before editing.
Otherwise, proceed.

## Working contract

Refactor the target page to be more useful, concise, and comprehensive within its stated
scope.

Do not treat a rewrite as permission to discard behavior facts. Preserve, verify, move, or
explicitly retire existing material. Incorrect docs are worse than verbose docs.

The five-doc lego is the shape. Do not invent a sixth doc to hold overflow. When a
component doc mixes concerns, route each part to its correct home:

- What it is, why it exists, boundaries, dependency map: `01-concept-brief.md`.
- Key files, data flow, ER and sequence diagrams, decisions: `02-architecture.md`.
- User-facing behavior and the user guide: `03-feature-description.md`.
- What proves it works, end to end: `04-test-cases.md`.
- Bugs and enhancements, one table: `05-backlog-to-enhance.md`.
- Cross-cutting contracts shared by several components: the matching `documents/shared/*` doc.
- Plans, specs, migration writeups: `documents/planning/`, never a component doc.

## Workflow

### 1. Load the doc standard

Read `technical-documentation/SKILL.md` first. Apply its writing rule, structure, and
verification guidance throughout. Read `crowsnest-component/house-style.md` for what each of
the five docs must contain, and `crowsnest-document-component/SKILL.md` for the five-doc
invariant and mkdocs wiring.

Read only the target page and the likely neighbors (its sibling `01`..`05`, the relevant
`shared/*` doc, `documents/index.md`, and the code it describes).

### 2. Classify the page

Decide the intended role from the five-doc lego (or, for a `shared/` doc, its single
cross-cutting topic). If the page mixes roles, choose its main role and plan where the other
material belongs among the destinations listed in the working contract.

### 3. Preserve and audit existing facts

Create a working inventory from the old page before rewriting. Include:

- Config fields, flags, commands, npm scripts, env vars, defaults, enums, nullable values,
  and constraints.
- Precedence rules, fallback behavior, caps, limits, timeouts, lifecycle states, queueing
  behavior, and compatibility rules.
- Auth, permission, approval, safety, privacy, and destructive-action behavior.
- Setup requirements, supported versions, dependencies, and account requirements.
- Error messages, troubleshooting symptoms, diagnostics, and recovery steps.
- Examples, expected output, routing tables, and cross-links.

For each fact, choose one outcome:

- Keep it in the refactored target page.
- Move it to a specific sibling doc or `shared/` doc.
- Move it to `documents/planning/` if it is a plan or spec, not evergreen behavior.
- Delete it because current source proves it is obsolete or out of scope.

Do not infer defaults, permissions, policy, timeout behavior, or safety posture from names
or intent. Verify them.

### 4. Find source of truth

Use the nearest authoritative source for each behavior-sensitive claim:

- Exported types, `src/server/db/schema.ts`, and drizzle config for data model and fields.
- CLI and command handlers, `package.json` scripts, and their tests for commands and flags.
- Runtime source and tests for lifecycle, queueing, permission, fallback, timeout, and
  provider behavior.
- MCP tool definitions and contract tests for tool surfaces.
- Existing docs only as secondary evidence unless the target is purely conceptual.
- Prefer graph tools (GitNexus `query`, `context`, `impact`) over grep for callers,
  dependencies, and execution flow, per the repo rules.

If a page promises a reference (a module-structure table, an ER diagram, an index list),
compare it against the real schema, exported types, and file layout. Missing fields,
defaults, precedence rules, caps, or side effects are correctness bugs.

### 5. Plan moved material

When moving detail out of the target page, record the destination before editing:

- Sibling or `shared/` doc: name the doc and section.
- New component: it goes through `crowsnest-document-component`, which scaffolds the five
  docs and wires `documents/index.md` and the `mkdocs.yml` nav. Do not hand-create a new
  component folder.
- Target page: keep a short summary and link from the point where readers need the deeper
  detail.

Avoid duplicate truth. If the same contract appears in multiple places, choose one canonical
page (usually a `shared/*` doc) and link to it.

### 6. Rewrite

Rewrite in this order:

1. Make the first screen answer what the reader can do and why this page exists.
2. Put the recommended path before alternatives.
3. Keep only decision-making and common operational detail in the main flow.
4. Move exhaustive tables and rare details to the planned destination.
5. Preserve concise routing tables when they help readers choose commands, config paths, or
   references.
6. Add troubleshooting from observable symptoms, not internal guesses.
7. Link related concepts, references, and adjacent docs.

Follow the crowsnest writing rule: no em or en dashes, straight quotes, sentence-case
headings, evergreen (no `Date:` field, no dated "verified on" framing, no ticket IDs as
inline citations), grounded to code. Keep top-level `##` sections numbered per doc where the
house style requires it.

Do not leave placeholders such as "TODO", "TBD", or "see docs" in a shipped doc unless the
user explicitly asks for a draft.

### 7. Compare old and new

After editing, compare the old and new page:

- Confirm all behavior-sensitive facts were kept, moved, or intentionally deleted with a
  source-backed reason.
- Check that the main page still covers the common scenario end to end.
- Check that destination docs remain correct and non-duplicative.
- Check that links from the target page reach the moved details.
- Check that headings are stable, searchable, and action-oriented.

If the refactor deliberately removes relevant material, say where it went or why in the
final report.

### 8. Verify

Run the smallest reliable checks for the touched surface:

- `mkdocs build` (surfaces broken nav entries and references; `mkdocs serve` to preview).
- `git diff --check` on the touched files.
- A manual link and anchor sweep for changed cross-links.
- If the page describes runtime behavior, confirm it against source or a passing test; the
  relevant `npm run test`, `npm run lint`, or `npm run typecheck` when code was touched
  alongside docs.

TODO: wire to a docs link-check and mdx/markdown-style check if the repo adds one; today
`mkdocs build` plus a manual link sweep is the floor.

Run commands and examples from the page whenever feasible. If you cannot verify a
behavior-sensitive claim, either remove the claim, mark the uncertainty in the report, or
ask for the missing source.

## Final report

Report:

- What changed in the target page.
- What details moved and their destination docs.
- What source-of-truth checks backed behavior-sensitive claims.
- What validation ran and what failed for unrelated reasons.

Do not include a long rewrite diary. Lead with remaining risks only if there are any.
