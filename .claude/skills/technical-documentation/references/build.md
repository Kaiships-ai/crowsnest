# Build docs playbook

Read `principles.md` first, then follow this execution flow.

## 1. Detect and align governance instructions

- Use `references/agent-and-contributing.md` as the source of truth for inventory,
  canonical/alias mapping, and precedence/conflict handling. In crowsnest, `AGENTS.md`
  is canonical and `CLAUDE.md` is the alias that includes it (`@AGENTS.md`).
- Long-running and extensive build investigations are acceptable when needed to resolve
  ambiguous or conflicting documentation sources.
- When available, use sub-agents for bounded parallel inventory/cross-check tasks and
  merge results into one canonical decision set.
- Capture required constraints before writing:
  - nested-agent rules, command/test requirements, PR workflow, and style checks.
- Use the same command and validation expectations in proposed snippets and examples:
  `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck`.

## 2. Inventory product documentation surfaces (not governance only)

- For repo-wide builds, include docs content surfaces in addition to `AGENTS.md` and
  `CLAUDE.md`.
- Inventory the docs tree and its config: the `documents/**` tree, `mkdocs.yml`
  (`docs_dir: documents`), root and module `README*`, and the governance files.
- Build a coverage map before drafting so governance and product docs are both
  represented.
- If scope is ambiguous, default to broader docs discovery first, then narrow
  intentionally.

## 3. Framework config and path mapping rules

- The docs stack is mkdocs-material. Read `mkdocs.yml` first: `docs_dir` is `documents`,
  and the `nav` tree is the published route map.
- Resolve every referenced path relative to the file/config that declares it, not an
  assumed repo root.
- Treat filesystem paths and the mkdocs nav routes as separate mappings; do not infer one
  from the other without config evidence.
- Validate both layers:
  - `mkdocs.yml` nav -> file exists on disk under `documents/`
  - new files under `documents/` -> added to the nav so they are reachable
- Record path-mapping assumptions and mismatches in handoff (`missing file`,
  `stale nav entry`, `wrong base path`).

## 4. Define intent and success

- Audience, prerequisites, and job-to-be-done.
- Expected reader outcome immediately after completion.
- Doc type: tutorial, how-to, reference, explanation.
- Success criteria: what must be true after publish.

## 5. Build structure before prose

- Follow the funnel: what/why, quickstart, next steps.
- Keep headings informative and scannable, and sentence-case.
- Open each section with the takeaway sentence.
- Add decision points with concrete branch guidance.
- For crowsnest docs work, pick a page type from `references/crowsnest.md` before drafting.
- Keep task-critical crowsnest configuration inline; link exhaustive defaults, enums,
  schemas, and rare debugging workflows.

## 6. Build AGENTS.md and CLAUDE.md intentionally

- Keep `AGENTS.md` concrete:
  - state persona scope and explicit instruction boundaries: `Always`, `Ask first`,
    `Never`.
  - include real commands and representative examples that run in this repo.
- Keep `CLAUDE.md` aligned with `AGENTS.md`: `CLAUDE.md` opens with `@AGENTS.md`, so do
  not duplicate the shared policy core in both files. Add only Claude-specific guidance on
  top.
- Prioritize setup/test commands, PR expectations, and review gates.
- Keep cross-file links accurate and non-circular.
- If `AGENTS.md` or `CLAUDE.md` grows too large, move detailed runbooks into linked docs
  under `documents/` and keep the top-level file a concise entry point.
- If a required canonical entry file is missing, create a minimal actionable one in the
  same pass instead of adding a caveat-only note: purpose, prerequisites, concrete run
  commands, and pointers to deeper docs.
- TODO: wire to a crowsnest `CONTRIBUTING.md` only if the repo adopts one; today
  `AGENTS.md` and `CLAUDE.md` are canonical and there is no separate contributor guide.

## 7. Keep agent context tight

- Author once, expose once: keep one shared policy core (`AGENTS.md`) and avoid
  duplicating guidance across agent files.
- Move detailed runbooks into linked docs under `documents/`.
- Avoid adding unrelated historical or process detail that inflates context during future
  tool reads.

## 8. Brownfield build mode (default in this repo)

- Match existing terminology, navigation, and component patterns.
- Preserve existing IA unless there is a documented migration plan.
- For rewrites, include a migration note from old to new paths.
- Prefer the smallest safe change set that improves utility.

## 9. Evergreen build mode

- Prefer stable concepts over release-tied narrative.
- Isolate volatile details under clearly marked version sections.
- Include maintenance signals: owners, refresh triggers, stale criteria.
- Include lifecycle notes: deprecation and replacement paths.

## 10. Writing constraints

- Use precise language and short, imperative instructions.
- Keep code examples copy-ready and self-contained.
- Include common failure modes and safe defaults.
- Avoid placeholder guidance that cannot be executed.
- Enforce the crowsnest writing rule: no em or en dashes, straight quotes only,
  sentence-case headings, evergreen framing.

## 11. Agent and automation readiness

- Keep key facts in text (not image-only).
- Prefer structured lists/tables when choices matter.
- Add links and anchors that allow deterministic navigation.
- Document what CI can check.

## 12. Build validation

- Run `mkdocs build` (surfaces broken nav and bad references) and `git diff --check` on
  touched files.
- Run a reference existence sweep for every path/command you introduced.
- Run the page's commands and examples whenever feasible.
- Run `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck` when doc
  changes ride alongside code changes.
- TODO: wire to a docs link-check if the repo adds one; today `mkdocs build` plus a manual
  link sweep is the floor.

## 13. Multilingual parity mode (when applicable)

- Pick one source-of-truth language for technical accuracy and release timing.
- Define parity target: full parity, staged parity, or intentional divergence per section.
- Keep structure aligned across locales (headings, anchors, section order) when possible.
- Preserve command/code correctness first; localize explanatory text second.
- If parity is not feasible, add a visible note with missing scope and expected sync
  window.
- Run a locale parity check for changed sections (added/removed steps, warnings,
  prerequisites).
- Record unresolved checks explicitly in handoff.
