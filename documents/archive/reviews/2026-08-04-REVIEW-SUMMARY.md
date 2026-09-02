# Crowsnest review backlog, 2026-08-04

From eight review passes on main at 8909788. Each line starts with the thing to do. Tags at the end: area, effort, file. Per-area detail is in the sibling files here.

First move: CN-04, insert 3 migration hashes, 30 minutes. Do it and db:migrate stops failing.

## Do now, blockers (4)

- [ ] CN-04 Insert the 3 missing migration hashes into __drizzle_migrations so db:migrate stops dying on "table secrets already exists". Hashes are in the devex report. devex, 30 min.
- [ ] CN-03 Fix the 4 react-hooks/refs errors in channel-card.tsx:138-146 and make eslint ignore the scratch and vendor dirs, so lint is green. Right now the pre-commit gate passes everything. devex, 1 hr.
- [ ] CN-02 Stop a failed frame-pass re-run from deleting the good reading. At frame-pass.ts:126, on update write only framePassAt and framePassError, never null the layout. Add the update-branch test. health, 1-2 hr.
- [ ] CN-01 Confine the frame-pass subprocess. Set its cwd to the temp frame dir, --add-dir that dir only, strip IG and token env vars, cap value length, test it cannot read outside. Today it reads .env.local and the secrets table. security, half a day. claude-task.ts:92.

## Do next, high (top 5)

- [ ] CN-05 Add `--` before the pasted URL in yt-dlp so a dash-leading URL cannot become a flag. security, 15 min. ytdlp.ts:50.
- [ ] CN-10 Drop the `outlier_score IS NULL` sort key at feed.ts:204 (and dashboard.ts:107), order by plain `outlier_score DESC`. 241x faster on 20k videos. perf, 1-2 hr.
- [ ] CN-06 Show frame pass on any video with a downloaded file, not just the 8-9 that already have a reading. First tell me: is that gate on purpose. qa/design/usability, half a day.
- [ ] CN-07 On a missing-asset frame-pass failure, show the Download video button inline instead of a Retry that re-fails, and fix the message. usability, 2-3 hr.
- [ ] CN-09 Stop the dashboard sending all 449 videos (~508 KB) every visit. Slice server-side or paginate. Biggest measured cost. perf, half a day. dashboard.ts:107.

## Do after, high (4 more)

- [ ] CN-08 Make Add channel show a pending and success state, refresh the board, and reject a handle that fails to resolve instead of adding it silently. usability, half a day.
- [ ] CN-11 Thread run_id through the sync log events so a run trace is complete. Today 3 of 1,689 events carry it. qa, half a day.
- [ ] CN-12 Give the producer donut 9 distinct colors and scale the ranking bars to the real range (they clamp at 96px, so 13.3x and 116.5x look identical). design, 2-3 hr.
- [ ] CN-13 Add a heartbeat reaper for frame pass: free a running row with a stale heartbeat_at, refresh the heartbeat during the model read. A SIGKILL mid-pass wedges the lock forever. reliability, half a day, own PR.

## Later, medium (5)

- [ ] Send the Runs SSE only on change. It resends 18.7 KB every 2s, all redundant. perf.
- [ ] Render the remix Style stage outline. It builds a 7-beat outline and shows none of it. usability.
- [ ] Darken the secondary text token rgb(127,124,117). At 13px it fails WCAG AA and it is everywhere. design.
- [ ] Fix wrong labels: feed "452 results" when 339 have no score, Vault "0 saved posts" over 7 scripts, a 14:41 sync reading Success against a 10:00 budget. qa.
- [ ] Add ROUTE_TITLES for /runs and /logs, drop the duplicate h1 on the 4 routes with two. design.

## Later, low

- [ ] One pass over the ~25 copy and spacing nits when you are next in those screens. Detail in the per-area files.

## Your call before code (2)

- [ ] CN-06: is the frame-pass analyze-first gate deliberate or a bug.
- [ ] Sync-cancel and stale-lock test: run it against an isolated DB copy, not the shared one (a stolen lock lets softDeleteMissing delete posts, already cost 8 @kallaway).

## Cleared, do not chase (3)

- Remix works end to end. The one failure was a transient empty stream from 9router.
- Dashboard network pings are fast (6ms, 10.5ms), render 14ms. Not a bottleneck.
- Feed load-more does not jank. 18 clicks, 452 cards, zero long tasks. Only memory grows.
