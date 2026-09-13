# Review docs playbook

Read `principles.md` first, then apply this checklist.

## 1. Scope and classification

- Identify doc type and target audience.
- Confirm brownfield vs evergreen intent.
- Confirm expected outcome for the reader.
- For full-repo reviews, explicitly include both governance surfaces (`AGENTS.md`,
  `CLAUDE.md`) and product-doc surfaces (`documents/**`, `mkdocs.yml`, README trees).
- For crowsnest docs reviews, apply `references/crowsnest.md` for page type, docs IA,
  the five-doc invariant, preservation, examples, and validation checks.

## 2. Investigation behavior

- Proactively find issues and risks without waiting for repeated prompts.
- If there are signals of deeper problems, continue investigation beyond the first pass.
- Long-running and extensive investigations are acceptable when needed for confidence and
  correctness.
- When available, use sub-agents for bounded parallel discovery (for example
  file-inventory, command validation, or cross-doc consistency checks), then merge to one
  final issue set.
- When no issues are found, state that explicitly and call out residual risks or
  validation gaps.
- Default to `apply-fixes` for high-confidence documentation defects unless the user
  explicitly requests `report-only`.
- Do not stop at governance checks when the task is documentation-wide; continue into
  docs-content and docs-framework surfaces.

## 3. Governance surface review

Use `references/agent-and-contributing.md` as the source of truth for inventory,
canonical/alias mapping, and precedence/conflict handling.

For `AGENTS.md`:

- confirm persona intent, scope, and command/tool boundaries are explicit.
- ensure `Always`, `Ask first`, and `Never` boundaries are present when expected.
- require concrete command examples and repo-specific paths to avoid ambiguity.

For `CLAUDE.md`:

- verify it opens with `@AGENTS.md` and does not restate or contradict the shared policy
  core.
- ensure any Claude-specific guidance is additive, not duplicated.
- verify setup, lint/test commands, and review criteria are accurate.
- ensure governance does not conflict with nested agent instructions or skill files.

For agent-platform awareness:

- confirm both surfaces represent the same shared policy core (commands, boundaries, and
  precedence), not divergent guidance.
- check for context bloat from duplicated policy statements across agent files.
- check for conflicting rules, skills, and agent instructions.
- check for conflicting information in agent instructions vs codebase.
- check for broken or missing referenced files (for example a `README`/index file named
  as a canonical entry point).
- check for setup/command drift (for example non-existent commands, root-level commands
  that should be module-scoped, or `pnpm` commands that should be `npm`).

## 4. Product documentation surface review

- Verify docs IA coverage across root/module `README*` files and the `documents/**` tree.
- Review the mkdocs-material source of truth (`mkdocs.yml` nav and `documents/`) and
  ensure guidance matches the actual files.
- Check `.md` pages for stale commands, missing prerequisites, and broken cross-links.
- Confirm referenced doc paths and anchors exist.
- Confirm the five-doc invariant holds for each component under
  `architect/core-components/` (`01`..`05`, no sixth doc; plans live in
  `documents/planning/`, archive in `documents/archive/` is frozen and not cited as
  current).
- Flag docs that should be split/merged to improve discoverability and maintenance.
- For rewrites or page splits, require source-backed keep/drop/move/destination coverage
  for important claims, warnings, examples, commands, fields, and troubleshooting facts.

## 5. Framework config and path mapping checks

- Read `mkdocs.yml` first (`docs_dir: documents`, plus the `nav` tree).
- Resolve path references relative to the declaring file/config.
- Treat filesystem paths and published nav routes as separate maps; verify both.
- Flag path-map drift explicitly (`missing file`, `stale nav entry`, `wrong base path`).

## 6. Structural review

- Funnel check: what/why, quickstart, next steps.
- Validate heading flow and navigation discoverability.
- Flag critical content trapped in images or buried sections.
- Check Diataxis alignment and split mixed-purpose sections.
- For crowsnest docs, confirm the content matches an explicit page type from
  `references/crowsnest.md` and the correct IA layer (`business-requirement/` vs
  `architect/`).

## 7. Writing quality review

- Check for concise, scannable paragraphs.
- Remove ambiguous pronouns and undefined terms.
- Verify examples are executable and scoped correctly.
- Verify tone is directive, technical, and non-hand-wavy.
- Enforce the crowsnest writing rule: no em or en dashes, straight quotes only,
  sentence-case headings, evergreen framing.

## 8. Brownfield review mode

- Verify compatibility with existing docs IA and conventions.
- Verify anchors and cross-doc links remain valid.
- Flag regressions in onboarding and task completion paths.
- Ensure changed terminology is intentionally propagated.

## 9. Evergreen review mode

- Flag date-stamped or brittle wording without version scope.
- Check ownership and refresh signals are present.
- Ensure recommendations remain valid after routine product evolution.
- Flag missing deprecation/migration guidance.

## 10. Tooling and platform review

Read `tooling.md` if platform fit is uncertain.

- Check whether content uses mkdocs-material primitives effectively (admonitions, tabs,
  code fences, nav).
- Flag structure that fights the docs platform.
- Recommend targeted platform-aware improvements only when they reduce cognitive load.

## 11. Multilingual parity review (when applicable)

- Confirm declared source-of-truth language and expected parity policy.
- Compare changed sections across locales for step/order/warning drift.
- Flag missing updates to prerequisites, version notes, limits, and safety guidance.
- Allow intentional divergence only when rationale is explicit and user-impact is low.
- Require a reader-visible status note when locale parity is partial.

## 12. Output format

1. Blocking issues (file + required fix)
2. Non-blocking improvements
3. Validation notes (done vs pending)
