# ig-sync: backlog to enhance

Bugs and enhancements for ig-sync. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| OBS-3 | Platform chips promise TikTok and YT Shorts, but only Instagram is ingested | medium | bug | observed-bugs | open |
| PERF-1 | Sync run concurrency is not persisted on `sync_jobs`, so `/runs` cannot show which concurrency a run used | low | enhancement | sync-performance | open |
| PERF-2 | An item cap hit on page 1 has no request cursor to resume from, so a pathologically low cap can strand that page's own tail until a later full walk | low | bug | sync-performance | open |
| PERF-3 | The incremental walk's early "upToDate" stop defers deletion detection to the channel's next full walk, bounded by `syncMetricsFreshnessHours` (default 12 hours), instead of every sync | low | tradeoff | sync-performance | accepted |
| TEST-1 | Backfill blank view counts (feature 4) has no browse-e2e coverage: the Backfill button in `settings/sync-section.tsx` carries no `data-testid`, so E2E-03 cannot be scripted. Add `data-testid="settings-backfill-button"` to the button | low | test-coverage | 04-test-cases browse-e2e | open |
| BUG-1 | A pasted profile URL that is not a malformed handle (for example `https://www.instagram.com/creator/`) is not rejected inline. `normalizeHandle` accepts it as the plain handle "creator" and the add channel dialog sends it straight to the add-channel action, which surfaces the sidecar-down error instead of a typo-rejection message. Tracked count stayed at 13 (nothing was written), but the claim that the dialog names the bad input as a typo failed. See BEH-01. Fixed: the "By handle" tab now checks the raw input against `looksLikeInstagramUrl` (`src/lib/handle.ts`) before submitting and rejects it inline with "That looks like a URL. Enter just the handle." `normalizeHandle` itself is unchanged, since onboarding's paste-many-handles box and the sync engine's own URL parsing still want it to extract a handle from a pasted URL. See `src/lib/handle.test.ts` and `src/components/channels/add-channel-dialog.test.tsx` | medium | bug | 04-test-cases behavior BEH-01 | fixed |
