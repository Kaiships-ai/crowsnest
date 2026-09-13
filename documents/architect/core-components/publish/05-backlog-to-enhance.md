# publish: backlog to enhance

Bugs and enhancements for publish. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| PUB-01 | No instagrapi real-account fallback when the Graph API path is unavailable | low | enhancement | plan-deferred | open |
| PUB-02 | The in-process scheduler has no launchd-level hardening (restart, health check) beyond the reentrancy guard in `startPublishScheduler` | low | enhancement | plan-deferred | open |
| PUB-03 | Only an S3-compatible provider exists for the public-URL seam; no non-S3 provider has been built | low | enhancement | plan-deferred | open |
| PUB-04 | A process killed between the scheduler's atomic claim and `publishPlannedPost`'s terminal write leaves the row stuck in `publishing` with nothing that re-claims it | medium | bug | plan-deferred | in-review |
| PUB-05 | `MAX_PUBLISH_ATTEMPTS` in `mine-calendar.tsx` is a hardcoded duplicate of `DEFAULT_MAX_ATTEMPTS` in `publish-scheduler.ts`, so the two can silently drift apart | low | enhancement | bug-triage | open |
| PUB-06 | Live publish needs an S3 or R2 bucket that no local credential exists for yet. Kai's action: create an R2 S3 API token for a bucket and set `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `S3_PUBLIC_BASE`, then run the live dry-run on the main tree (`scripts/publish-evidence.ts`). Graph auth is already proven live (`evidence/publish/graph-auth-live.md`) | medium | setup | evidence-gap | open |
| PUB-07 | `publishNowAction` has no publish-through test (its tests cover the guard paths only); the claim-token wiring that makes a claimed row actually publish is proven in `publish-post.test.ts`, but a mock-backed action-level success test would guard the seam directly | low | test | review-deferred | open |
| PUB-08 | The publish dialog's caption character-count element in `publish-dialog.tsx` is a bare `<span>` with no `data-testid`, so browse-e2e E2E-08 must read the "/ 2200" ceiling via `assert_text` instead of a stable id; add `data-testid="publish-dialog-caption-count"` to target it directly | low | test-coverage | browse-e2e-backfill | open |
