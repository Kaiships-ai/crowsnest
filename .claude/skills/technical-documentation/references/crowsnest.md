# Crowsnest documentation overlay

Use this reference for crowsnest docs work. It layers crowsnest-specific page types,
navigation, preservation, and validation rules on top of the general
technical-documentation skill.

## Docs facts

- Docs live in `documents/` and render as an mkdocs-material site (`mkdocs.yml`,
  `docs_dir: documents`). Preview with `mkdocs serve`.
- Two layers:
  - `business-requirement/`: what crowsnest is and must do.
  - `architect/`: how it is built, one folder per component under `core-components/` plus
    cross-cutting `shared/`.
- Each component under `architect/core-components/` carries exactly five docs (`01`..`05`,
  the lego block). Plans and specs go under `documents/planning/`, never a sixth doc.
  `documents/archive/` is frozen and must not be cited as current.
- `documents/index.md` is the index; navigation is wired in `mkdocs.yml` under Components.
- Full new or reworked components go through the `crowsnest-component` skill and its
  five-doc set; this skill is the lighter bar for everything smaller.

## Reader model

- Lead with the task the reader is trying to complete.
- Give one recommended path before alternatives.
- Keep main docs focused on the common path; move dense contracts and rare debugging
  detail to linked reference or troubleshooting sections.
- Explain production risks exactly where the reader can make the mistake.
- Link business-requirement docs, architecture docs, and shared docs so readers can
  continue without rereading.

## Page types

Choose the page type before writing or reviewing:

- Overview: route readers to the right product area or component.
- Quickstart: get a new user to a working result with the fewest safe steps.
- Component doc (the five-doc lego block): the `01`..`05` set for one component under
  `architect/core-components/`.
- Business-requirement page: state what crowsnest must do and why, under
  `business-requirement/`.
- Shared/cross-cutting page: explain a concern that spans components, under
  `architect/shared/`.
- Reference: define objects, options, and defaults exhaustively.
- Troubleshooting: map observable symptoms to checks, causes, and fixes.
- Governance file: keep agent/contributor policy concrete, scoped, and aligned with
  current repo behavior (`AGENTS.md`, `CLAUDE.md`).

## Component docs (the five-doc lego block)

Keep each component's `01`..`05` docs to their assigned role and do not add a sixth doc:

1. `01` overview: what the component is, what it owns, what it does not own.
2. `02` architecture: how it is built; this is the doc updated in the same PR as a code
   change per the standing docs rule.
3. `03` and `04`: the component's remaining assigned roles in the lego block.
4. `05` backlog: the bug/backlog rows (the auto-fix flow pulls the top open row).

Plans and specs never live inside the five-doc set; they go under `documents/planning/`.

## Docs IA and navigation

- Read `mkdocs.yml` before navigation changes; the `nav` tree is the published route map.
- Keep component docs and common workflows on the main reader path.
- Put exhaustive contracts and maintainer-only detail under a clearly scoped reference or
  shared page.
- Keep new pages reachable: every file under `documents/` that should be published must be
  wired into `mkdocs.yml` nav.
- For moved pages, include a keep/drop/move/destination matrix in the handoff.

## Source-backed content

- Commands and examples must match current behavior (`npm run build/test/lint/typecheck`,
  `mkdocs serve`, `mkdocs build`).
- Reference docs must include fields, defaults, enum values, constraints, and error and
  recovery guidance.
- Config docs must align exported types, schema/help output, and current docs.
- Dependency-backed behavior must be verified from upstream docs, source, or types before
  documenting defaults, timing, errors, or API behavior.
- Separate current behavior, shipped behavior, and planned behavior; planned work belongs
  in `documents/planning/`, not stated as current fact.

## Examples

- Prefer complete copy-pasteable commands and snippets.
- Use realistic variable names and values.
- Mark placeholders with angle-bracket names such as `<API_KEY>`.
- Show expected success output when it helps verification.
- Keep one conceptual unit per code block and use language-specific fences.
- Avoid examples that hide setup, auth, error handling, or cleanup.
- Never expose real secrets, live config, or credentials.

## Preservation reviews

For rewrites or splits:

- Identify source units before rewriting: headings, paragraphs, tables, examples,
  contracts, warnings, and troubleshooting facts.
- Map each retained unit to a destination page or section.
- Do not treat a broad "covered" row as proof for dense source material; use line- or
  claim-level evidence when the source unit is dense.
- For dropped content, state whether it is obsolete, duplicated elsewhere, unsupported, or
  moved to a reference/support page.
- Never cite `documents/archive/` as current; it is frozen.

## Validation

Choose the narrowest proof that covers the touched surface:

- `mkdocs build` (surfaces broken nav and bad references)
- `git diff --check`
- `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck` when docs ride
  alongside code changes
- a reference existence sweep for every path and command introduced
- behavior tests or command probes when docs claim runtime behavior

If proof is blocked, say exactly which command was not run and why.
