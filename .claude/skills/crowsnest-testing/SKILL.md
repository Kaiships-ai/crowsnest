---
name: crowsnest-testing
description: Choose proportional crowsnest tests and checks, diagnose failures, and route specialized or live proof to its owning skill. Trigger:/crowsnest-testing
---

# crowsnest testing

Prove the changed contract with the smallest meaningful check, complete the
required checks, then finish. Broaden or repeat only for new changes, failures,
or unresolved risks. Do not add tests that merely mirror reversible, low-impact
implementation changes; use `test-audit` when authoring or reviewing tests.

crowsnest is a Next.js breaking-changes fork. Read the relevant guide under
`node_modules/next/dist/docs/` before writing framework code, and follow the
touched subtree's `AGENTS.md`. Tests are vitest (`npm test`). Browser journeys
are the browse-driven e2e harness (`npm run e2e`); new Playwright browser suites
belong to `crowsnest-e2e` (planned).

## Risk track

Every change carries a FAST or CAREFUL track. The track comes from
`crowsnest-route` (planned; the `/kai` router assigns it today). FAST means a
low-blast-radius change proven by the smallest owner check. CAREFUL means a
change to a shared seam, a data path, a migration, or a public surface, and it
earns broader proof and human review before landing. Let the track set how far
you broaden, not habit.

## Select the proof

Trusted local checks (vitest, typecheck, lint, build) run in the worktree,
including broader suites when the contract warrants them. Load only the
specialized route you actually need.

| Change or question                              | Starting point                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Runtime defect                                  | Reproduce narrowly; rerun that proof after the repair, plus relevant siblings  |
| Trusted source diff                             | `npm run typecheck`, `npm run lint`, focused `npm test -- <path>`              |
| Build output, lazy imports, package boundaries  | Include `npm run build` (Next route sizes and first-load JS)                   |
| Workflow (GitHub Actions, scripts)              | `git diff --check`; read the changed `.github/workflows/*.yml` or `scripts/*`  |
| Documentation only                              | Relevant docs, link, and format sanity plus `git diff --check`; no runtime tests |

For specialized proof, hand off to the owning skill:

- Browser end to end: existing browse journeys via `npm run e2e`; new browser
  suites go to `crowsnest-e2e` (Playwright, planned). Seed with
  `scripts/seed-e2e.ts`; drive the real UI, never a fixture that bypasses it.
  State concrete live-proof gaps.
- Web performance (Lighthouse, Web Vitals, bundle size): `crowsnest-test-performance`.
- Scenario lab and QA campaigns across surfaces: `crowsnest-qa-testing`.
- Real Instagram session proof: `scripts/verify-live.sh` (a burner account and a
  running sidecar; see the script header).

A narrow green rerun does not by itself authorize release. Release identity is
owned by `scripts/release-prep.sh` and `.github/workflows/release.yml`.

## Source and state boundaries

Use isolated state and a free port. The e2e harness already does this: a fresh
fixture database at `CROWSNEST_DB_PATH=data/e2e.db` and the dev server on `:3001`.
Never restart, edit, or test against an operator's running dev server or their
real data (`data/crowsnest.db`, a live Instagram session) without explicit
per-task approval. Do not kill unrelated processes or reconcile a shared
dependency install while jobs use it.

## Local commands

```bash
npm run typecheck          # tsc --noEmit
npm run lint               # eslint
npm test                   # vitest run (full suite)
npm test -- <path-or-filter>
npm run test:watch         # vitest, for iteration
npm run build              # next build; prints route sizes and first-load JS
npm run e2e                # scripts/e2e/run.sh browse journeys
npm run db:migrate         # apply drizzle migrations when a schema change is in scope
```

The committing gate is `npm run build`, `npm test`, `npm run lint`,
`npm run typecheck`, all green with a clean tree (see `AGENTS.md`). Prefer the
`npm` scripts over raw `vitest`/`tsc`/`eslint` so config and routing stay
correct. For a worker-sensitive failure, isolate the suspect file with
`npm test -- <path>` before deciding the fix; do not make a forced environment
the repair.

## CI failures

CI is `.github/workflows/ci.yml` on every PR and push to `main`: typecheck,
lint, vitest, then `scripts/testid-audit.sh`, on ubuntu Node 22.

```bash
gh run list --branch <branch> --limit 10 --json databaseId,headSha,status,conclusion,url
gh run view <run-id> --json status,conclusion,headSha,url,jobs
gh run view <run-id> --job <failed-job-id> --log
```

Bind the diagnosis to the exact SHA and job. Check whether a cancellation means
a newer same-branch run superseded it. Fetch the failed log once and reuse it;
prefer exact run and job state over a stale PR rollup. Separate product,
harness, and infrastructure failures before choosing a retry.

For snapshot drift that passes locally on macOS but fails in CI's Linux Node,
reproduce in a Linux-equivalent environment before regenerating; a local pass
cannot override failing CI bytes. Fix related failures and rerun the affected
proof; route unrelated failures with evidence rather than broadening this task
automatically.
