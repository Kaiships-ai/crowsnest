---
name: crowsnest-auto-qa
description: Run a crowsnest-wide autonomous QA campaign across independent surface lanes, with clean root-cause fixes, verified proof, and a resumable evidence ledger. Trigger:/crowsnest-auto-qa
disable-model-invocation: true
---

# crowsnest auto QA

Run a continuous, current-`main` crowsnest product campaign. Treat a reviewer
finding as a hypothesis, a passing test as evidence only for its actual head, and
a merge as complete only when the canonical repository confirms it. Always prefer
a clean, appropriately scoped root-cause refactor over a quick fix or a smaller
diff. Repair the actual root cause in its canonical owner; a patch is not
acceptable when it leaves sibling paths, lifecycle invariants, or the defective
abstraction intact.

## Prefer clean refactors over quick fixes

- Identify the broken ownership boundary, abstraction, state transition, or data
  contract before choosing an implementation. Compare the canonical owner,
  callers, callees, and sibling paths; prefer the design that makes their shared
  invariant obvious and reliable.
- Consolidate decisions and authoritative state in their actual owner. Propagate
  prepared facts through existing lifecycles, repair all affected siblings, and
  delete obsolete branches, duplicate policy, dead helpers, and stale
  abstractions when they are no longer needed.
- Reject symptom-masking guards, one-off exceptions, observed-example literals,
  parallel code paths, extra caches, fallback stacks, compatibility shims, and
  tests that merely make a narrow reproduction pass. A smaller change is not
  safer when it preserves the cause or makes the architecture harder to
  understand.
- Preserve shipped contracts and ownership boundaries. If the clean refactor
  would affect security, persistent state, a drizzle migration, an API route
  contract, the Instagram session or auth path, or public configuration, mark it
  for human review instead of substituting a tactical patch.
- During independent review, explicitly ask whether the change is the cleanest
  appropriately bounded root-cause solution. Green tests, a minimal diff, and a
  plausible local fix are insufficient without that architectural judgment.

## Set the campaign goal

- Default to a target of distinct, independently verified, PR-ready root-cause
  fixes unless the operator specifies a different target. Count broken
  invariants, not pull requests, symptoms, proposed patches, skill updates, or
  merely passing tests.
- crowsnest never self-merges. A fix is complete when it is reproduced,
  root-caused, covered by a regression, independently reviewed, and opened as a
  PR that a human lands. Autonomous merge is out of scope; do not count an
  unmerged PR as landed, and report each PR to the operator with its URL and one
  or two sentences on the actual root cause.
- Exclude security, persistent-state, migration, API-contract, auth, or
  otherwise review-required work from the accepted count until the owner
  explicitly authorizes it.
- When the operator changes the target mid-campaign, update the report, ledger,
  denominator, and live status in place. Preserve every previously verified
  finding; never reset the investigation.

## Start with the moving source

1. Read root `AGENTS.md` and each scoped guide for the lanes under inspection.
   Use the current specialized skill instead of reproducing stale instructions:
   - `crowsnest-fix-backlog-item` for bug acceptance, the blast-radius guardrail,
     and the branch-to-PR flow.
   - `crowsnest-testing` for proportional test and CI selection.
   - `crowsnest-qa-testing` for scenario journeys across surfaces.
   - `crowsnest-e2e` (planned) for new Playwright browser proof; the existing
     browse-e2e journeys run via `npm run e2e`.
   - `ship:systematic-debugging` for reproduction and root-cause discipline.
   - `ship:using-git-worktrees` for isolated fix worktrees.
   - `ship:verification-before-completion` before opening a PR.
   - `caveman:cavecrew-reviewer` or `/code-review` for fresh independent review.
2. Identify the actual canonical `main` checkout; a worktree can have a different
   `HEAD`. Record `git -C <checkout> rev-parse HEAD` and confirm a clean tree with
   `git -C <checkout> status --porcelain=v1`. When network access is authorized,
   refresh `origin/main`, record its full SHA, and prove the checkout matches
   before inspecting source. When offline, disclose that remote freshness is
   unverified. Never pull, rebase, or switch another agent's checkout.
3. Make one fresh worktree per implementation task; keep reviewer inspection
   read-only. Revalidate candidates against each new head without disturbing a
   sibling's active worktree.
4. Initialize or resume the requested Markdown report and numbered ledger (see
   Evidence ledger below). If the operator raises the target, update the active
   denominator without erasing historical progress.

## Keep independent lanes active

Split the product into materially different surface lanes and keep several in
flight. Scale to the machine and the operator-authorized load rather than
mechanically fanning out; a solo run defaults to a few lanes plus one reviewer,
not a large swarm. Replace completed, failed, or stale lanes promptly. If
independent workers are unavailable, inspect distinct surfaces sequentially and
record the concurrency limitation honestly; never represent a finished, planned,
or discarded worker as running.

crowsnest surface and subsystem lanes (discovery starting points, not a claim a
file still exists):

1. **Feed:** `src/app/(shell)/feed`, filters, scoring bar, card to detail, remix
   entry, empty and error states.
2. **Mine:** `src/app/(shell)/(loaded)/mine`, calendar tabs, planning a post,
   own-channel state, grid rendering.
3. **Settings:** `src/app/(shell)/(loaded)/settings`, Instagram connect, 2FA and
   challenge handling, persisted config.
4. **Channels:** `channels`, `channels/discover`, `channels/[channelId]`, follow
   and discovery flows.
5. **Runs and jobs:** `src/app/(shell)/(loaded)/runs`, run streaming
   (`api/runs/stream`), lifecycle, cancellation.
6. **Ideas, persona, vault, logs:** the remaining loaded surfaces and their data.
7. **Instagram sync:** the sidecar and sync path, session auth, rate handling,
   `scripts/verify-live.sh` proof.
8. **Data layer:** drizzle schema, migrations (`npm run db:migrate`), backups,
   query correctness.
9. **API routes:** `src/app/api/*` request and error contracts, streaming.
10. **First run and shell:** onboarding (`first-run`), the app shell, navigation,
    loading and error boundaries.

Give each read-only reviewer a narrow prompt: at frozen main `<sha>`, audit one
ownership surface for real current-main correctness regressions; read the
complete root and scoped guides, the module, entry point, callers, callees,
sibling paths, state lifecycle, tests, and direct dependency source; do not
modify files, run heavy tests, print secrets, touch an operator's dev server or
real data, or assume another reviewer's conclusion; return only concrete defects
with repo-root paths, a user-path reproduction, the canonical root cause, all
affected siblings, a coherent owner-boundary refactor, an authentic regression,
duplicates, and a low-risk versus review-required classification; count a shared
invariant once; return no verified bug if the evidence is insufficient.

Observe CPU, memory, disk, open ports, and dev-server health between waves.
Reduce concurrency under sustained memory pressure or an operator limit. Use
bounded retries and timeouts. Stop only campaign-owned processes.

## Prove actual product behavior

- Use isolated campaign state and a free localhost port for dev servers, the way
  the e2e harness does: a fixture database at `CROWSNEST_DB_PATH=data/e2e.db`
  seeded by `scripts/seed-e2e.ts`, and the dev server on `:3001`. Never stop,
  restart, reconfigure, or bind the operator's running dev server, their real
  database (`data/crowsnest.db`), or a live Instagram session.
- Inspect the actual rendered surface, not a fixture that bypasses the UI. A
  screenshot, a successful navigation, or a 200 response is not passing proof
  when the page shows an error, a blank surface, or the wrong result. Preserve
  only screenshots that show the requested working surface.
- Derive scenarios from the surface's `04-test-cases.md` and the browse-e2e
  journeys; run them via `crowsnest-qa-testing` and `npm run e2e`. Count a
  scenario only when the run reports the expected user-visible outcome, not just
  that a page loaded.
- For Instagram or sync claims, use `scripts/verify-live.sh` with a burner
  account and a running sidecar. A mocked sync, a skipped step, or an earlier
  head is not live proof. Keep credentials out of the repo, logs, PRs, and
  screenshots; redact handles unless the operator asks for local debugging.
- For a data or migration claim, run the real path (`npm run db:migrate`,
  `npm run db:backup`) against isolated state; unit tests alone do not prove a
  migration.

## Turn findings into verified fixes

1. Deduplicate against the ledger, `origin/main`, open and merged GitHub work,
   and sibling root causes. Count one broken invariant once, even when it
   produces multiple route, surface, or state symptoms.
2. Independently reproduce the current-main user path. Map the entry point,
   canonical owner, callers, callees, sibling implementations, state lifecycle,
   existing regressions, shipped contracts, and relevant dependency source.
   Identify why the current design fails before proposing a repair.
3. Refactor the canonical owner in an isolated worktree. Repair all affected
   siblings in the same coherent change, simplify or remove the defective
   abstraction, and carry authoritative facts through the existing lifecycle.
   Reject a guard, special case, extra cache, fallback, shim, or narrowly passing
   test that leaves the defect behind.
4. Preserve public configuration, drizzle schema and migrations, API route
   contracts, the Instagram session and auth path, and persistent state. When a
   correct root-cause repair would change a sensitive contract or needs a product
   decision, prepare it for review; do not disguise that risk as a small fix.
5. Add authentic regression coverage for the original reproduction, affected
   siblings, and unchanged legitimate behavior. Run appropriately scoped proof on
   the exact candidate head, following `crowsnest-testing`: `npm run typecheck`,
   `npm run lint`, focused `npm test -- <path>`, `npm run build` when boundaries
   change, and the relevant e2e journey. Inspect actual exit status and outcomes.
6. Run a fresh independent review (`caveman:cavecrew-reviewer` or `/code-review`)
   on the complete final refactor. Require it to compare owner boundaries and
   siblings, confirm this is the best clean root-cause solution, and reject
   quick-fix residue even when tests pass. Resolve verified findings and
   re-review substantive changes.
7. Open a focused PR with the repository's template, the canonical cause, user
   impact, frozen head, completed proof, and risk, through the standard `gh`
   flow. Reuse and repair an existing candidate PR for the same cause. Never
   self-merge; a human lands it. Mark security, migration, auth, API-contract,
   persistent-state, uncertain, or high-impact changes **review required** and
   keep them outside the accepted count.

## Evidence ledger

Maintain one Markdown ledger in the requested report; resume its numbering, never
reset it. Record campaign-wide facts: the requested target, the exact
`origin/main` SHA and refresh time, the active lanes, owned dev-server ports and
isolated state, live-sync proof, and resource use.

For each candidate use one explicit state:

- **Hypothesis:** a lane reported a potential issue; no independent reproduction.
- **Reproduced:** a failing current-main user path or focused regression exists.
- **Fix validated:** the canonical-owner refactor passes the user path, sibling
  regressions, independent review, and required exact-head checks.
- **Review required:** sensitive, uncertain, or contract-affecting work; link the
  PR without counting it.
- **PR open:** a focused PR is open on the exact reviewed head, awaiting a human
  landing.
- **Merged:** a human landed it and canonical `main` contains the merge SHA.
- **Rejected or duplicate:** record the actual reason and canonical root cause.

For every accepted fix record:

```text
<number>/<target>: <distinct user-visible bug>
surface: <canonical owner and affected user surface>
main baseline: <full SHA>
root cause: <repo-root source paths and current behavior>
canonical refactor: <owner, shared invariant, affected callers and siblings>
before: <actual failing user repro or regression>
after: <exact passing product path and focused regression>
proof: <e2e journey, scenario outcome, or verify-live evidence>
review: <fresh independent review on final head>
CI: <exact head and successful required run or check>
PR: <GitHub pull request URL>
status: PR open (human to land) | merged <verified SHA>
risk: low | review required
```

Do not accept a symptom-only guard, a compatibility shim, a duplicate count, a
mocked or bypassed proof, a screenshot of an error state, a skipped check, or a
green summary with zero real scenarios. Stop the count at the actual number of
verified root-cause fixes; never round up toward the target.

## Maintain accurate campaign state

Update the report throughout, not only at the end. Separate hypotheses,
reproduced bugs, review-required PRs, validated fixes, open PRs, and human-merged
fixes. Report the frozen main SHA, lanes, resource use, live-sync proof, actual
failures, independent review, CI run IDs, and PR links. Never place credentials,
raw authenticated requests, real Instagram session data, or personal information
in an artifact.
