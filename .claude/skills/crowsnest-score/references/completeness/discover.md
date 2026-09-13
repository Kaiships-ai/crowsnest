# discover completeness

Use this rubric when scoring Completeness for the `discover` surface: a curated directory
of Instagram creators to follow, plus the first-run seed picker.

## Category scope

- Seed data: curated real handles, one file per niche, loaded into the seeds table by the
  bootstrap step.
- Discover page: niche-tabbed directory with one card per creator (handle, niche badge, a
  one-line reason).
- Follow action: a card's Follow adds the handle as a tracked channel and queues a sync,
  reusing the existing add-channel and start-sync path.
- First-run seed picker: the same seeds offered as a capped multi-select in the first-run
  sources step.

## Completeness questions

- Does the bootstrap step load every seed file into the seeds table, and does the page
  read them all?
- Are creators grouped under working niche tabs, and does each card carry handle, niche,
  and reason?
- Does Follow reuse the real add-channel and start-sync path rather than a second write
  pipeline?
- Does the first-run seed picker offer the same seeds as a capped multi-select and follow
  the selected set?
- Is there a clear state for an already-followed creator or an empty or failed seed load?
- Is the seed list current and non-empty for each advertised niche?

## Evidence

- Workflow: `discover/01-concept-brief.md`, `discover/03-feature-description.md`.
- Known gaps: `discover/05-backlog-to-enhance.md`.
- Coverage: `discover/04-test-cases.md`, vitest, browse journeys, `scripts/e2e-coverage.sh`.
