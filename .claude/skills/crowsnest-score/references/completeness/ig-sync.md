# ig-sync completeness

Use this rubric when scoring Completeness for the `ig-sync` surface: the localhost Python
sidecar that holds one authenticated Instagram session and syncs tracked channels into
the app's own storage. It is the only writer of the videos table.

## Category scope

- Session auth: login, two-factor, and challenge handling against one long-lived session
  behind a process-global lock.
- Shared-secret boundary: every sidecar call authenticated with the shared token; a
  missing or wrong token refused.
- Sync run: profile plus posts over the lookback window, capped per run, working channels
  through a bounded worker pool while serializing real Instagram calls.
- Media storage: thumbnails and on-demand video downloaded into local storage, carousels
  stored as one row with child rows, no expiring Instagram URLs rendered.
- Resume and soft-delete: an interrupted crawl persists where it stopped and resumes; a
  post gone from source is soft-marked deleted, not removed.
- Failure surfacing: rate limit, challenge, ban, or session-invalidated states surfaced
  as distinct, recoverable conditions.

## Completeness questions

- Can a burner account log in through the sidecar, including the two-factor and challenge
  branches, and hold one warm session?
- Is every sidecar call gated on the shared token, with a missing or wrong token refused?
- Does a run cover profile and posts over the lookback window, honor the per-run cap, and
  keep all real Instagram traffic serialized behind the lock even with concurrency raised?
- Are media assets stored locally (thumbnails, on-demand video, carousels as child rows)
  so no expiring URL is ever rendered?
- Does an interrupted or cancelled crawl resume from where it stopped rather than
  restarting?
- Is a post removed at source soft-marked deleted so dependents degrade gracefully?
- Are rate-limit, challenge, ban, and invalidated-session failures distinguished and
  recoverable, and is multi-account handling defined where it applies?
- Is the buyer-install path unblocked, given the onboarding empty-password bug the docs
  flag?

## Evidence

- Workflow: `ig-sync/01-concept-brief.md`, `ig-sync/03-feature-description.md`;
  `documents/architect/shared/multi-account.md`, `shared/status-and-failures.md`.
- Known gaps: `ig-sync/05-backlog-to-enhance.md`; the `01` status line flags the empty
  `IG_PASSWORD` onboarding bug blocking buyer installs.
- Coverage: `ig-sync/04-test-cases.md`, vitest, `scripts/verify-live.sh` (burner account
  plus running sidecar), `scripts/e2e-coverage.sh`.
