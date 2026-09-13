---
name: crowsnest-live-updater
description: Maintain a canonical live crowsnest main mirror, the managed Next server, and exact-head main CI, auto-repairing head-of-main failures through focused PRs. Trigger:/crowsnest-live-updater
disable-model-invocation: true
---

# crowsnest live updater

Keep one operator-selected canonical live checkout as a deployment mirror the agent treats as read-only: clean, standalone, full, on `main`, and fast-forwarded only. Make every repair in a separate controlling worktree, never in the mirror.

## Boundaries

- Report only in the controlling thread. Never send Slack, Discord, email, or other external messages.
- Never release, tag, bump versions, publish, cut a GitHub Release, rotate credentials, or weaken a gate.
- Escalate only irreversible or materially risky changes: security, auth, destructive migration or data loss, credential rotation, dependency overrides, or product choices.
- Diagnose ordinary update, runtime, CI, test, and build failures; fix them through a focused PR; prove exact head; land it.
- Never edit, stash, reset, clean, or create a branch in the live mirror.
- Never broad-kill the managed server (`pkill -f next-server` nukes unrelated servers and starts a restart loop). Stop it through its owner.

## Fast update and maintenance

1. Confirm the mirror invariants before touching it: one expected `origin`, a standalone full clone, single worktree, clean tree, on `main`. Fetch `origin/main`, recheck for concurrent changes, then merge `--ff-only`. Stop on any failed invariant; never repair the mirror destructively. Hold a checkout-scoped lock across update, build, and restart so a second heartbeat cannot start a concurrent build; a dead owner lock may be reclaimed, unreadable lock state fails closed.

   TODO: wire to a deterministic update helper (the crowsnest analog of a single-owner update/build/restart script) if one is added; until then run the steps below by hand under the lock.

2. If `main` moved, or build output is missing or stale, rebuild exact new `main` before any restart:
   - `npm ci` when `package-lock.json` or `node_modules` changed (frozen install; never `npm install` in the mirror path).
   - `npm run typecheck`, `npm run lint`, `npm test` must pass on the exact head.
   - `npm run build` (Next build) must complete against the post-merge SHA.
   - `npm run db:migrate` to bring the database to the checked-out schema before the server starts.
   Never run an old build against new source; if build or proof fails, leave the new head intact and retry on the next heartbeat.

3. Restart the managed server only after exact-SHA build proof, through its owner (`kai` for a Kit install / the `com.crowsnest.server` service; `npm run start` -> `tsx server.ts` for a plain deployment). Then verify: the server answers on its port, `kai status` (or the deployment's health check) is healthy, and the 9router proxy is reachable. A build or a healthy old process is not completion.

   Every external phase has a wall-clock budget (git fetch 5 min, merge 2 min, install 15 min, build 20 min, service control 60 s, probes 30 s). A timeout drains the task-owned process tree before rollback and lock release; if cleanup cannot prove the tree gone, retain the lock and report rather than restarting.

4. After every restart, inspect server logs from the restart window only, report warning summaries, and fail the pass on any error or fatal entry. Treat supervisor state alone as insufficient.

If no update, build repair, or exact-head failure exists, report a terse no-op with the SHA and the proof checked.

## Exact-head CI repair

1. Resolve exact current `origin/main`. Inspect only required checks and workflow jobs in `.github/workflows/ci.yml` (typecheck, lint, vitest, `scripts/testid-audit.sh`) whose head SHA equals it. Ignore skipped jobs and routine noise (docs-sync, labeler, advisory jobs, stale or cancelled runs superseded by a newer run for the same SHA).
2. For an attributable failure, leave the mirror untouched. In the controlling worktree, trace the failed surface, add focused proof (a failing test first), run the build gate (`npm run build`, `npm test`, `npm run lint`, `npm run typecheck`), open a focused PR, and land it. Never weaken or bypass the failing gate. After landing, begin again at step 1 so the mirror, server, and exact-head checks converge on new `main`.

## Release validation

Validation only, never release preparation or publication. Release is owned by `scripts/release-prep.sh <ver>` and `.github/workflows/release.yml`; the changelog is `packaging/CHANGELOG.md`. Confirm the current `main` passes the full CI gate and, when a release run exists for the exact head, that its jobs are green. Repair failures through the worktree-and-PR path above. Do not tag, bump, or publish.

## Failure discipline

- Recheck mirror invariants before every mutation and after every fetch.
- Attribute failures from exact SHA, job, logs, and current source. Infrastructure flakes need independent proof before any code edit.
- Keep the task branch focused. No `packaging/CHANGELOG.md` change from this skill.
- Finish with the mirror clean and on `main`, the worktree clean on its expected branch, and every public GitHub write linked in the controlling thread.
