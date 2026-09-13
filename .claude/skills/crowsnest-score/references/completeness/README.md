# Completeness rubrics

One rubric per crowsnest surface. A rubric tells you what "done" means for that
surface so a Completeness score is grounded in the intended operator-visible workflow,
not in a gut read. Read the surface's rubric here after its five-doc set and before you
write a score.

## What a rubric contains

Each `<component>.md` in this directory holds three parts:

1. Category scope. The named capabilities that make up the surface, grouped into a few
   product-shaped categories (setup, normal use, status or inspection, recovery,
   variants). This is the checklist the surface is scored against. It comes from the
   component's `01-concept-brief.md` and `03-feature-description.md`, so keep categories
   product-shaped and broader than a single function or file.
2. Completeness questions. Five to ten concrete "is X done" questions specific to that
   surface, each answerable yes, no, or partial from the docs and the code. A question
   names a user-visible capability or a known branch (an empty state, a failure code, a
   recovery path), not an implementation detail.
3. Evidence pointers. Where the answer lives: the doc that describes the intended
   workflow, and the proof that it works (a vitest suite, a browse journey, a coverage
   row).

## The three axes

Score every surface on three separate axes. Do not let one bleed into another.

- Completeness: how much of the intended operator-visible workflow exists. Answer the
  rubric's questions. A surface where only the happy path exists, or where a documented
  branch (a failure code, an empty state, a recovery path) is missing, scores lower even
  if what exists is well tested and solid. Evidence: the five-doc set, chiefly
  `01-concept-brief.md` (what it is, why it exists) and `03-feature-description.md` (the
  full interaction), plus `05-backlog-to-enhance.md` for the known gaps.
- Quality: reliability, maintainability, operator safety, and regression confidence for
  what does exist. A capability can be complete but fragile. Evidence:
  `02-architecture.md`, `04-test-cases.md`, and the component's own known-bug notes in
  its `01` status line and `05-backlog-to-enhance.md`.
- Coverage: deterministic validation coverage. How much of the surface is actually
  proven by executed tests. Evidence: vitest results (`npm run test`), the browse e2e
  journeys (`scripts/e2e/run.sh` via `npm run e2e`), and `scripts/e2e-coverage.sh`
  fulfillment data. Coverage is executed proof, not a claim in a doc.

## Scoring process

For the surface under review:

1. Read its five-doc set under `documents/architect/core-components/<component>/`.
2. Read its rubric in this directory. Surface-specific questions and guidance override
   the default process in the parent `SKILL.md`; make the rationale reflect that.
3. Answer each Completeness question yes, no, or partial from the docs and code. A "no"
   or "partial" on a documented capability lowers Completeness; note which one.
4. Judge Quality from the architecture and test docs and the known-bug notes.
5. Judge Coverage from executed proof, not from the docs' claims. Where a doc says a path
   is unproven end to end (several `01` status lines say exactly this), Coverage cannot
   be full for that path.
6. Place each axis in a band and record the evidence path behind each score.

## Bands (apply to each axis)

- `Clawesome` (95-100): complete across expected workflows, variants, and recovery
  branches, with only minor polish gaps.
- `Stable` (80-95): the expected workflow set is broadly present, with only bounded
  missing branches.
- `Beta` (70-80): the main workflow exists, but meaningful branches or recovery paths are
  still absent.
- `Alpha` (50-70): only a partial capability set is present; users can complete some core
  tasks but not the full expected workflow.
- `Experimental` (0-50): the surface exposes only fragments of the intended capability.

## Grounding rule

Every question and category in these rubrics is derived from a component's own five-doc
set. Where a detail is uncertain, the question is phrased generally rather than naming a
file or symbol that may not exist. Do not invent a capability a surface does not claim,
and do not score a path complete that its own docs flag as unproven.
