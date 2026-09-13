---
name: crowsnest-auto-qa
description: Run a crowsnest-wide autonomous QA campaign across independent component lanes, with clean root-cause fixes, verified proof, and a resumable evidence ledger. Trigger:/crowsnest-auto-qa
disable-model-invocation: true
---

# crowsnest auto QA

Run a continuous, current-`main` crowsnest product campaign. Treat a reviewer
finding as a hypothesis, a passing test as evidence only for its actual head, and
a merge as complete only when a human lands it and the repository confirms it.
Always prefer a clean, appropriately scoped root-cause refactor over a quick fix
or a smaller diff. Repair the actual root cause in its canonical owner; a patch
is not acceptable when it leaves sibling paths, lifecycle invariants, or the
defective abstraction intact.

## References

Read the reference for the phase you are in; do not inline its detail here.

| File | Read it when |
| --- | --- |
| [references/subsystem-lanes.md](references/subsystem-lanes.md) | Splitting the product into lanes, assigning a component, or briefing a read-only reviewer. Lists the eleven core-component lanes and the reviewer prompt. |
| [references/live-proof-routing.md](references/live-proof-routing.md) | Before proving product behavior: seeded dev server, `seed-e2e.ts`, e2e journeys, `verify-live.sh`, migrations, and packaging proof. |
| [references/campaign-evidence.md](references/campaign-evidence.md) | Setting up or updating the report: campaign header, per-lane record, bug ledger fields, and long-running evidence. |
| [references/evidence-ledger.md](references/evidence-ledger.md) | Recording a candidate's state and the accepted-fix block; the counting rules. |

## Prefer clean refactors over quick fixes

- Identify the broken ownership boundary, abstraction, state transition, or data
  contract before choosing an implementation. Compare the canonical owner,
  callers, callees, and sibling paths; prefer the design that makes their shared
  invariant obvious and reliable.
- Consolidate decisions and authoritative state in their actual owner. Repair all
  affected siblings, and delete obsolete branches, duplicate policy, dead
  helpers, and stale abstractions when they are no longer needed.
- Reject symptom-masking guards, one-off exceptions, observed-example literals,
  parallel code paths, extra caches, fallback stacks, compatibility shims, and
  tests that merely make a narrow reproduction pass.
- Preserve shipped contracts. If the clean refactor would affect security,
  persistent state, a drizzle migration, an API route contract, the Instagram
  session or auth path, or public configuration, mark it for human review
  instead of substituting a tactical patch.
- During independent review, explicitly ask whether the change is the cleanest
  appropriately bounded root-cause solution. Green tests and a minimal diff are
  insufficient without that judgment.

## Set the campaign goal

- Default to a target of distinct, independently verified, PR-ready root-cause
  fixes unless the operator specifies a different target. Count broken
  invariants, not pull requests, symptoms, proposed patches, or passing tests.
- Crowsnest never self-merges. A fix is complete when it is reproduced,
  root-caused, covered by a regression, independently reviewed, and opened as a
  PR that a human lands. Do not count an unmerged PR as landed; report each PR to
  the operator with its URL and one or two sentences on the actual root cause.
- Exclude security, persistent-state, migration, API-contract, auth, or otherwise
  review-required work from the accepted count until the owner authorizes it.
- When the operator changes the target mid-campaign, update the report, ledger,
  denominator, and live status in place; preserve every verified finding.

## Start with the moving source

1. Read root `AGENTS.md`, `CLAUDE.md`, and the owning
   `documents/architect/core-components/<name>` docs for the lanes under
   inspection. Use the current specialized skill instead of reproducing stale
   instructions: `crowsnest-fix-backlog-item` (bug acceptance, blast-radius
   guardrail, branch-to-PR flow), `crowsnest-testing` (proportional test and CI
   selection), `crowsnest-qa-testing` (scenario journeys), `crowsnest-e2e`
   (Playwright and browse-e2e proof), `systematic-debugging`,
   `using-git-worktrees`, `verification-before-completion`, and `autoreview` or
   `/code-review` for fresh independent review.
2. Identify the actual canonical `main` checkout; a worktree can have a different
   `HEAD`. Record `git -C <checkout> rev-parse HEAD` and confirm a clean tree with
   `git -C <checkout> status --porcelain=v1`. When network access is authorized,
   refresh `origin/main`, record its full SHA, and prove the checkout matches.
   When offline, disclose that remote freshness is unverified. Never pull, rebase,
   or switch another agent's checkout.
3. Make one fresh worktree per implementation task; keep reviewer inspection
   read-only. Revalidate candidates against each new head without disturbing a
   sibling's active worktree.
4. Initialize or resume the requested Markdown report and numbered ledger. See
   [references/campaign-evidence.md](references/campaign-evidence.md) and
   [references/evidence-ledger.md](references/evidence-ledger.md).

## Keep independent lanes active

Split the product into the eleven component lanes in
[references/subsystem-lanes.md](references/subsystem-lanes.md) and keep several in
flight. Scale to the machine and operator-authorized load; a solo run defaults to
a few lanes plus one reviewer, not a large swarm. Replace completed, failed, or
stale lanes promptly. If independent workers are unavailable, inspect distinct
components sequentially and record the concurrency limitation honestly. Observe
CPU, memory, disk, open ports, and dev-server health between waves. Stop only
campaign-owned processes.

## Prove actual product behavior

Read [references/live-proof-routing.md](references/live-proof-routing.md) before
starting a dev server, seeding fixtures, running e2e, or invoking a live service.
The default proof is the seeded, mocked build on an isolated fixture database and
a free port, never the operator's real data or a live Instagram session.

## Turn findings into verified fixes

1. Deduplicate against the ledger, `origin/main`, and open and merged GitHub work.
   Count one broken invariant once, even when it produces multiple symptoms.
2. Independently reproduce the current-main user path. Map the entry point,
   canonical owner, callers, callees, siblings, state lifecycle, existing
   regressions, and shipped contracts. Identify why the current design fails.
3. Refactor the canonical owner in an isolated worktree. Repair all affected
   siblings in the same coherent change and carry authoritative facts through the
   existing lifecycle. Reject a guard, shim, extra cache, fallback, or narrowly
   passing test that leaves the defect behind.
4. Preserve public configuration, drizzle schema and migrations, API route
   contracts, the Instagram session and auth path, and persistent state. When a
   correct repair would change a sensitive contract, prepare it for review.
5. Add authentic regression coverage. Run scoped proof on the exact candidate
   head, following `crowsnest-testing`: `npm run typecheck`, `npm run lint`,
   focused `npm run test -- <path>`, `npm run build` when boundaries change, and
   the relevant e2e journey (`npm run e2e`, `npm run test:e2e`). Inspect actual
   exit status and outcomes.
6. Run a fresh independent review (`autoreview` or `/code-review`) on the final
   refactor. Require it to compare owner boundaries and siblings and reject
   quick-fix residue even when tests pass. Resolve verified findings.
7. Open a focused PR through the standard `gh` flow on `Kaiships-ai/crowsnest`
   with the canonical cause, user impact, frozen head, completed proof, and risk.
   Reuse and repair an existing candidate PR for the same cause. Never self-merge;
   a human lands it. See `crowsnest-pr` for the GitHub workflow. Mark security,
   migration, auth, API-contract, persistent-state, uncertain, or high-impact
   changes **review required** and keep them outside the accepted count.

## Maintain accurate campaign state

Update the report throughout, not only at the end, following
[references/campaign-evidence.md](references/campaign-evidence.md) and
[references/evidence-ledger.md](references/evidence-ledger.md). Separate
hypotheses, reproduced bugs, review-required PRs, validated fixes, open PRs, and
human-merged fixes. Never place credentials, real Instagram session data, or
personal information in an artifact. Stop the count at the actual number of
verified root-cause fixes; never round up toward the target.
