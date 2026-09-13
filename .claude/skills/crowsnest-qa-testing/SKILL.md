---
name: crowsnest-qa-testing
description: Run, watch, debug, extend, or explain crowsnest scenario journeys across the app surfaces, and score each surface's QA maturity. Trigger:/crowsnest-qa-testing
---

# crowsnest QA testing

Use this skill for scenario-lab work: the browse-e2e journeys that walk real
crowsnest surfaces end to end, plus the maturity scorecard that says how well
each surface is actually covered. Repo-local QA only. It complements
`crowsnest-testing` (proportional proof selection) and hands new Playwright
browser suites to `crowsnest-e2e` (planned).

A scenario is a single journey through the real UI: arrive at a surface, act,
and see the expected result, driven by the browse CLI from a shell script and
seeded by a fixture database. There is deliberately no assertion DSL or
page-object layer.

## Read first

- The touched component's five docs under
  `documents/architect/core-components/<component>/`, especially
  `04-test-cases.md` (its browse-e2e scenario table).
- `scripts/e2e/run.sh` (the runner) and `scripts/e2e/lib.sh` (the journey helpers).
- `scripts/seed-e2e.ts` (the fixture database contents).
- `scripts/e2e-coverage.sh` (the mechanical coverage gate).
- Existing journeys `scripts/e2e/<component>-e2e-<id>.sh` for the shape.

## Surfaces

Scenarios cover the app shell surfaces, not chat channels. The main surfaces are
`feed`, `mine`, and `settings`, plus `channels`, `runs`, `ideas`, `persona`,
`vault`, `logs`, and `first-run`. Map a scenario to the surface's route (for
example `/feed`, `/mine`, `/settings`) and to the `data-testid` selectors named
in that component's `04-test-cases.md`.

## Lane

Decide the lane before running:

- Seeded and mocked: the default. `npm run e2e` seeds a fresh fixture SQLite
  database at `CROWSNEST_DB_PATH=data/e2e.db`, starts the dev server on `:3001`,
  and runs every `scripts/e2e/*-e2e-*.sh` journey against it. No real accounts,
  no network to Instagram.
- Live: real Instagram session proof through `scripts/verify-live.sh`, which
  requires a burner account and a running sidecar (see the script header). Use it
  only when the scenario genuinely needs a real sync, and keep credentials out
  of the repo, logs, PRs, and screenshots.

## Default workflow

1. Read the scenario table in the surface's `04-test-cases.md` and the matching
   journey scripts.
2. Run the seeded lane:

   ```bash
   npm run e2e
   ```

   Run a single surface's journey directly while iterating (the runner starts its
   own server; point a manual run at a server you already have on `:3001`):

   ```bash
   BASE_URL=http://localhost:3001 bash scripts/e2e/feed-e2e-01.sh
   ```

3. Watch outputs: each journey prints its steps and fails loudly on a missing
   `assert_text` or selector. If you want to watch the UI, open the dev server
   URL the runner reports.
4. If a scenario fails, fix the product or harness root cause, then rerun the
   full lane. Do not weaken an assertion to make a real failure pass.

## Maturity scorecard

Score each surface on three axes, then act on the lowest. This is the QA view of
whether a surface is trustworthy, not a vanity number.

| Axis          | Question                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| Quality       | Do the existing journeys assert real, user-visible outcomes (not just that a page loaded)? Do they catch a credible regression? |
| Completeness  | Does every built feature in `03-feature-description.md` have at least one journey, and are the corner cases in `04-test-cases.md` covered? |
| Coverage      | Do the `data-testid` selectors the journeys need actually exist in `src/`? Run `scripts/e2e-coverage.sh <surface>` and `scripts/testid-audit.sh`. |

`scripts/e2e-coverage.sh <surface>` is the mechanical half: it hard-fails an
offline journey row whose script is missing or whose result is blank, and warns
on a built feature with no journey or fewer than five corner-case types. Treat a
warn as a backlog row, not a pass. Record the three scores and the single next
action per surface.

## Adding scenarios

- Add or update the scenario row in the surface's `04-test-cases.md`, matching
  the existing table format; keep it grounded in real `data-testid` selectors.
- Write the journey as `scripts/e2e/<surface>-e2e-<id>.sh`, sourcing
  `scripts/e2e/lib.sh`, arriving at the real route, acting, and asserting a
  user-visible outcome.
- Seed whatever fixture state the journey needs in `scripts/seed-e2e.ts`; keep
  the fixture minimal and deterministic.
- If the journey needs a `data-testid` that does not exist yet, file it as an
  `05-backlog-to-enhance.md` row; `scripts/testid-audit.sh` reports the gap.
- Prefer end-to-end assertions over checks that a page merely rendered.

## Common failure patterns

- Journey too brittle: assert stable user-visible text or a stable selector, not
  a transient state.
- Selector not found: the `data-testid` is documented but not built yet; check
  `scripts/testid-audit.sh` and file the backlog row rather than faking it.
- Wrong default state: a surface's default filter or tab can land on an empty
  state (for example `/feed` defaults to a high-conviction bar); arrive, then set
  the state the scenario needs.
- Rebuild delay: a dirty tree can trigger a build before the server answers;
  expect that before ports appear.

## What done looks like

- The requested lane is green end to end.
- The user gets: pass and fail counts, the surface's three maturity scores, the
  artifact or log paths, and a concise note on what was fixed or added.
