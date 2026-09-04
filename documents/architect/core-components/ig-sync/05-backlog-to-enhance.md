# ig-sync: backlog to enhance

Bugs and enhancements for ig-sync. One row per item.

| ID | Title | Severity | Type | Source | Status |
| --- | --- | --- | --- | --- | --- |
| OBS-3 | Platform chips promise TikTok and YT Shorts, but only Instagram is ingested | medium | bug | observed-bugs | open |
| PERF-1 | Sync run concurrency is not persisted on `sync_jobs`, so `/runs` cannot show which concurrency a run used | low | enhancement | sync-performance | open |
| PERF-2 | An item cap hit on page 1 has no request cursor to resume from, so a pathologically low cap can strand that page's own tail until a later full walk | low | bug | sync-performance | open |
| PERF-3 | The incremental walk's early "upToDate" stop defers deletion detection to the channel's next full walk, bounded by `syncMetricsFreshnessHours` (default 12 hours), instead of every sync | low | tradeoff | sync-performance | accepted |
