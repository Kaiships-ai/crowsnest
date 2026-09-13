---
name: crowsnest-score
description: Grade crowsnest surface maturity on Quality, Completeness, and Coverage from docs, source, tests, and QA evidence. Trigger:/crowsnest-score
---

# crowsnest score

Use this skill to audit or refresh the crowsnest surface maturity scorecard. It
grades each surface (a component under `documents/architect/core-components/`,
plus cross-cutting `shared/` concerns) on three axes: Quality, Completeness, and
Coverage. This is an advisory read-and-report workflow; it proposes score edits
backed by evidence, it does not mutate GitHub or land anything.

## Covered surfaces

Completeness rubrics live under `references/completeness/`, one per real crowsnest
component (progressive disclosure: load only the surface you are scoring, and the
`README.md` for the rubric shape and the three axes). The eleven covered surfaces are:
`analyze`, `discover`, `feed`, `ig-sync`, `kit`, `llm`, `mcp`, `mine`, `onboarding`,
`publish`, `remix`. A surface with no rubric file yet is scored with the default process
below against its five-doc set; add a rubric when you score it.

## Source model

- The surface list and category scope come from the component docs under
  `documents/architect/` (each component's `01`..`05` five-doc set) and the
  business requirements under `documents/business-requirement/`. Keep categories
  and feature names unique, product-shaped, and broader than raw implementation
  fragments.
- Coverage evidence is deterministic release/QA validation. Prefer executed proof
  from `scripts/e2e-coverage.sh`, the `scripts/e2e` suite, and vitest results over
  hand assertions. A per-run evidence artifact is the source of truth for
  Coverage.
- Quality and Completeness are the reviewed aggregate. Record them where the
  scorecard data lives (TODO: wire the committed score file, e.g.
  `documents/architect/shared/maturity-scores.yaml`; crowsnest has none yet, so
  until then keep scores in the surface's own doc and flag the missing store).
- Generated public scorecard docs (TODO: wire a renderer/check workflow; not yet
  present in crowsnest). Until one exists, do not hand-maintain a generated
  Markdown table as if it were rendered; keep manual prose in the current docs and
  score data in the score store.

Keep private or maintainer-only facts out of the repo. If a score needs private
evidence, use a redacted evidence artifact shape, not committed inventory.

## Commands

Run from the repo root. Validate after source edits:

```bash
npm run typecheck
npm run lint
npm run test
```

Regenerate coverage evidence when changing coverage claims or QA scope:

```bash
bash scripts/e2e-coverage.sh
```

Check docs when touching docs prose (mkdocs-material site; `mkdocs.yml`,
`docs_dir: documents`):

```bash
mkdocs build --strict
```

## Scoring workflow

When asked to score or refresh a surface:

1. Read the surface's five-doc set under `documents/architect/`.
2. Read the completeness rubric for that surface under `references/completeness/`
   (`<surface>.md`, plus `references/completeness/README.md` for the rubric shape and how
   the three axes are scored). Surface-specific questions and guidance there override the
   default process below.
3. Gather public repo evidence from docs, source, tests, and QA scenario
   metadata.
4. Prefer existing coverage-evidence artifacts for executed proof.
5. Update the score store only for Quality, Completeness, and review state backed
   by public or redacted artifact evidence.
6. Run the validation commands above; run coverage and `mkdocs build --strict`
   when coverage IDs or docs prose changed.

For subjective score changes, make the smallest defensible edit and leave the
evidence path in the PR or task summary.

## Default completeness process

Completeness is scored against the intended operator-visible workflow for each
category, not against test breadth (Coverage) or implementation quality
(Quality). It measures how fully crowsnest exposes the intended surface
capability set to its user, operator, author, or maintainer persona, across
setup, normal use, status or inspection, recovery, and important platform,
provider, channel, security, or lifecycle variants where they apply.

Treat any surface-specific scoring questions and guidance in the docs as
higher-priority instructions; when they narrow or intentionally conflict with the
defaults here, follow them and make the rationale reflect that. Otherwise, for
each category ask:

- Can the intended user or operator complete the category workflow end to end?
- Are the taxonomy features present as supported capabilities rather than isolated
  implementation fragments?
- Are the important lifecycle stages represented: setup, normal operation,
  status/inspection, recovery, and upgrade or removal where relevant?
- Are the important environment, provider, platform, channel, or security
  branches present for this surface?
- Do the known gaps leave major user-visible capability branches missing?

Default guidance:

- Favor higher Completeness when the category supports the full operator-visible
  workflow described by the docs and category evidence.
- Lower Completeness when only the happy path exists, when important variants are
  undocumented or unimplemented, or when recovery/status paths are missing.
- Do not lower Completeness because tests are thin; that is Coverage.
- Do not lower Completeness because implementation quality is fragile; that is
  Quality.

## Score semantics

- Coverage: deterministic validation coverage derived from release/QA evidence
  (`scripts/e2e-coverage.sh` and the e2e/vitest fulfillment data).
- Quality: reliability, maintainability, operator safety, and regression
  confidence for the category.
- Completeness: how much of the intended operator-visible workflow exists. Use the
  default completeness process plus any surface-specific variation before changing
  this score.

Bands (apply to each axis):

- `Clawesome` (95-100): complete across expected workflows, variants, and recovery
  branches, with only minor polish gaps.
- `Stable` (80-95): the expected workflow set is broadly present, with only bounded
  missing branches.
- `Beta` (70-80): the main workflow exists, but meaningful branches or recovery
  paths are still absent.
- `Alpha` (50-70): only a partial capability set is present; users can complete
  some core tasks but not the full expected workflow.
- `Experimental` (0-50): the category exposes only fragments of the intended
  capability.

## Reporting

Present the scorecard as a per-surface table (surface, category, Quality,
Completeness, Coverage, band) with the evidence path behind each subjective
score. Evidence-enriched outputs belong in short-lived artifacts, not committed
generated docs, until a renderer/check workflow is wired.
