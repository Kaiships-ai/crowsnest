# Crowsnest enhancements spec, 2026-08-04

Source: the eight-aspect review and the approved before/after mockups (artifact 4af8d098). This spec turns those enhancements into implementable units. Each unit has a goal, today's behavior, the target, the concrete changes, and acceptance criteria you can test against.

Grouped into 5 milestones by dependency and value. The plan (written after you review this) will take one milestone at a time. File paths and line numbers come from the review reports and the surface map; anything marked "confirm" needs a look at the code during implementation, not a guess here.

Ground rules for every unit:
- No new problem over the lint baseline, tsc clean, tests green.
- Dev DB is push and bootstrap based. New schema goes through db:generate then apply the one migration file by hand, and record it in __drizzle_migrations (see M1-U1).
- Prose in any doc follows the humanizer rules. Code and identifiers are left as they are.

## Milestone 1, foundation and safety

Fast, low-risk, unblocks the rest. No user-facing layout change.

### M1-U1 Record the three hand-applied migrations
Goal: db:migrate runs clean on a fresh clone.
Today: migrations 0011 to 0013 were applied by hand, so __drizzle_migrations has 11 rows against 14 files. db:migrate replays from 0011 and dies on "table secrets already exists".
Changes:
- Compute the sha256 of each of the three migration files (the devex report lists the values, confirm by hashing the files).
- Insert the three rows into __drizzle_migrations with the correct hash and created_at.
- Update the project memory note that said the DB is not migration tracked.
Acceptance:
- On a fresh clone, npm run db:migrate exits 0 and reports up to date.
- The dev DB is untouched (verify on a copy first, never the live DB).
Out of scope: changing the migration workflow itself.

### M1-U2 Green lint on a clean checkout
Goal: npm run lint passes, so the pre-commit gate means something.
Today: 4 react-hooks/refs errors in channel-card.tsx:138-146 (the dnd-kit useSortable ref spread), plus errors from linting untracked scratch dirs.
Changes:
- Fix the ref handling in channel-card.tsx so the useSortable ref and the node ref compose without the rule violation (confirm the dnd-kit pattern).
- Scope eslint (eslint.config.mjs) to ignore the vendor and scratch dirs ("Crowsnest UI Mockups/", any generated bundles).
- Correct the stale typecheck baseline claim in the README (typecheck is clean).
Acceptance:
- npm run lint exits 0 on a clean checkout.
- npm run typecheck stays clean.

### M1-U3 Confine the frame-pass subprocess
Goal: the Claude child cannot read secrets.
Today: claude-task.ts:92 spawns `claude -p` with `--allowedTools Read` but inherits the Next server cwd, so it can read .env.local and data/crowsnest.db. The anti-fabrication guard at frame-pass.ts:79 only checks fromFramesSec is non-empty.
Changes:
- Launch the child with cwd set to the temp frame directory.
- Pass `--add-dir` for that temp dir only.
- Pass an explicit env allowlist to the child, with no IG_, token, or secret vars.
- Cap the length of each layout field value the child can return.
- Use the absolute claude binary path (the PATH one is a shim).
Acceptance:
- A test spawns the child against a temp dir and asserts it cannot read a file placed outside that dir (for example a fake .env.local one level up).
- The frame pass still produces a valid layout on a normal video.
Out of scope: prompt-level hardening (the fix is the sandbox, not the prompt).

### M1-U4 Stop a failed re-run deleting the good reading
Goal: a failed frame pass never erases an existing layout.
Today: frame-pass.ts:126 nulls layout, framesSampled, frameModel on the UPDATE path, and the runner calls it on every failure.
Changes:
- On the update path, write only framePassAt and framePassError. Never touch layout, framesSampled, frameModel.
Acceptance:
- New test: a row with a good layout, then a failing pass, keeps the layout and records the error.
- The existing fresh-insert behavior is unchanged.

### M1-U5 yt-dlp argument separator
Goal: a pasted URL cannot become a flag.
Today: ytdlp.ts:50 and exec.ts:63 pass the user URL as the last positional with no `--`.
Changes:
- Insert `--` before the URL argument.
Acceptance:
- A test passes a URL beginning with a dash and confirms it is treated as a URL, not a flag.

### M1-U6 Quiet the test logs and document the one-command up
Goal: a clean test run and a documented way to bring the stack up.
Today: a passing test run prints 481 lines of JSON log noise (fixable with one line in the test env setup, src/test/setup-env.ts per the devex report). The /crowsnest-up flow works but is not in the README.
Changes:
- Silence app logs during tests (one line in the test env setup, confirm the setup file).
- Add a short README section for the one-command up (/crowsnest-up: 9router, dev server, browser).
Acceptance:
- npm test runs without the log noise.
- The README explains bringing the stack up in one step.

## Milestone 2, frame pass end to end

The feature works but is nearly invisible and dead-ends on error. This makes it usable and safe to leave running.

### M2-U1 Surface the frame-pass entry point
Goal: any video with a downloaded file can start a pass.
Today: the Layout section and the Run frame pass button only mount when a video_analyses row exists (8 or 9 of ~449). On the rest, nothing mentions frame pass.
Decision needed from you: is the analyze-first gate deliberate. This unit assumes no, that the entry point should show on any downloaded video.
Changes:
- Render the frame-pass entry on any video that has a downloaded asset, in a "never run" state that states the anti-fabrication invariant (that copy already exists).
- If the video has no downloaded file, show the Download video action instead (see M2-U2).
- Confirm where the gate lives (layout-section.tsx around the video_analyses check).
Acceptance:
- A downloaded video with no analysis shows the Run frame pass entry.
- A video with no file shows Download video, not a broken pass.

### M2-U2 Frame-pass error recovery
Goal: a failure tells the user the one thing to do next.
Today: a failed pass offers only Retry, which re-fails. The message says "sync with downloads first" (env-only), and Download video sits elsewhere unconnected.
Changes:
- On a FRAME_NO_VIDEO_ASSET failure, show the Download video button inline, remove the dead Retry.
- Rewrite the message to name a control the user can reach.
- Add a progress signal during the run (the pass takes 20 to 60s), not just a disabled button. A step label or a spinner tied to the job status is enough.
Acceptance:
- A missing-asset failure shows Download video inline and no dead Retry.
- During a run the UI shows progress and does not block (confirmed: it already does not block).

### M2-U3 Video detail two-column layout
Goal: the reading leads, actions are always reachable.
Today: one long scroll, caption dump first, frame pass in a non-default tab, analyze and download scattered.
Changes:
- Two-column detail: left is the video and a stat header (outlier score, view count, posted date), right is the analysis in tabs (Layout, Transcript, Script).
- The frame-pass reading leads the Layout tab; the raw caption fragments collapse behind a toggle.
- A sticky action bar: Run frame pass, Analyze, Download.
- Single scroll fallback on narrow screens (confirm the mobile breakpoint approach).
Acceptance:
- The frame-pass reading is above the caption on load.
- The action bar stays reachable while scrolling.
- Layout holds at mobile width without horizontal scroll.
Open: tabs versus one scroll on mobile.

### M2-U4 Heartbeat reaper for the frame-pass lock
Goal: a killed pass recovers itself.
Today: a SIGKILL mid-pass wedges the global lock; heartbeat_at exists but nothing reads it.
Changes:
- On starting a pass and after extraction, write heartbeat_at (confirm both write points).
- A reaper frees a running row whose heartbeat_at is older than a threshold, marking it failed with a killed reason.
- Refresh heartbeat_at during the long model read so a slow-but-alive pass is not reaped.
- Pick the staleness threshold with margin over a real 60s pass (propose a value in the plan).
Acceptance:
- A test simulates a stale running row and asserts the reaper frees it.
- A running pass that exceeds the old worst case is not reaped while alive.
Note: this can ship as its own PR.

## Milestone 3, feed and dashboard

The two highest-traffic screens, and the two costs that grow with the library.

### M3-U1 Feed opens on the outlier view
Goal: the first screen is ranked, not the firehose.
Today: a saved view marked default (High Conviction) exists but a bare visit does not apply it.
Changes:
- Apply the default saved view on a bare /feed visit, with a one-tap show-all escape.
- Confirm which saved view is the intended default (this unit assumes High Conviction).
Acceptance:
- A bare /feed load shows the default view's results.
- Show-all clears it in one tap.
Open: is High Conviction the right default.

### M3-U2 Feed toolbar grouping
Goal: the filters read as groups, not four loose icons.
Today: two 2-state toggle groups render as one run of four icons with equal gaps.
Changes:
- Group the two toggles visually (spacing, a divider, or segmented controls). Confirm the toolbar component.
Acceptance:
- The two groups are visually distinct; selected state is unambiguous.

### M3-U3 Windowed feed list
Goal: the feed stays light as the library grows.
Today: load-more grows the limit while keeping offset 0, so the list re-mounts longer (measured no jank yet, but memory and DOM grow: 158 MB heap, ~12k nodes at 452 cards).
Changes:
- Windowed rendering or real pagination so the DOM node count stays bounded.
- Confirm the current load-more mechanism before changing it.
Acceptance:
- DOM node count stays roughly flat as the user pages deeper.
- No regression in scroll behavior.

### M3-U4 Dashboard server-side slice
Goal: the dashboard sends only the rows it draws.
Today: dashboard.ts:107 ships all 449 videos (~508 KB RSC) and re-ships ~492 KB on every navigation back, no caching.
Changes:
- Slice server-side (or paginate) so only the rendered rows cross the wire.
- Confirm which components consume the full list and cut them to the slice.
Acceptance:
- Dashboard RSC payload is a fraction of today's and does not grow with the library.
- The charts and top-outliers still render correctly.

### M3-U5 Index-friendly feed sort
Goal: the most-run query uses its index.
Today: feed.ts:204 (and the same in dashboard.ts:107) orders by `outlier_score IS NULL, outlier_score DESC`, forcing a full scan. Measured 241x slower on 20k rows.
Changes:
- Drop the `IS NULL` leading term, order by plain `outlier_score DESC`.
- Confirm null ordering still lands where you want (nulls last) and add or confirm the index.
Acceptance:
- The query plan shows the index in use.
- Feed ordering is unchanged for the user.

### M3-U6 Decodable dashboard charts
Goal: every chart is readable at a glance.
Today: the producer donut cycles 4 colors across 9 producers; the ranking bars clamp at 96px so 13.3x and 116.5x look identical.
Changes:
- A documented categorical chart palette with at least 9 distinct hues (or group the tail into "other").
- Scale the ranking bars to the real value range instead of clamping.
Acceptance:
- No two producers share a swatch (or the tail is grouped and labeled).
- The top ranking bars are visibly different in length.

### M3-U7 Dashboard what-changed strip
Goal: the dashboard earns a daily open.
Today: no summary of what moved since the last visit.
Changes:
- A strip at the top: new outliers and biggest movers since last visit.
- Define "since last visit" (confirm whether a last-seen timestamp is stored).
Acceptance:
- The strip shows new outliers and top movers on a return visit.
Open: which three numbers belong at the very top.

## Milestone 4, runs, vault, settings, first run, flows

### M4-U1 Complete run traces
Goal: a run trace shows every step.
Today: only 3 of 1,689 sync log events carry a run_id, so the trace is nearly empty and "Failed 1" has no reachable reason.
Changes:
- Thread run_id through every sync log-event call (confirm the log-event helper and the sync entry points).
Acceptance:
- Every event for a run carries its run_id.
- A failed run's trace includes the failing step and its error.

### M4-U2 Runs failure-first view and change-only SSE
Goal: open a run, land on why it failed, without redundant traffic.
Today: the trace opens at the top of a long log; the SSE resends 18.7 KB every 2s, all redundant after the first.
Changes:
- Land the run view on the failed step with its error.
- Send SSE only on change (confirm the current tick sender and the slice(0,50) cap).
Acceptance:
- Opening a failed run shows the failed step first.
- An idle run sends no repeat payloads.

### M4-U3 Vault titles, counts, delete, search
Goal: a vault you can prune and trust.
Today: a saved script's title can be the whole body; the Scripts tab header can read "0 saved posts" over real scripts; no delete for scripts.
Changes:
- Give a saved script a short real title at save time, in the generator (find where scripts are written, likely the remix Script stage or services/export.ts area).
- Correct the per-tab header counts and labels.
- Add delete for scripts and saved posts.
- Add search within the vault.
Acceptance:
- A newly saved script has a short title, not the body.
- Tab headers show the right count for the tab.
- A script and a saved post can be deleted.

### M4-U4 Settings accuracy and honest warnings
Goal: the nav is accurate, risky actions name their effect.
Today: the scrollspy can mark two sections active; regenerating the IG token silently desyncs a running sidecar.
Changes:
- Fix the scrollspy so one section is active.
- On IG token regenerate, warn that a running sidecar needs a restart, or restart it.
Acceptance:
- Exactly one settings section is active while scrolling.
- Regenerate shows the sidecar consequence.

### M4-U5 First-run has one action and an exit
Goal: first run points at the obvious next step and never traps.
Today: /first-run has no links and no exit.
Changes:
- One primary action (add your first channel) and a skip to the feed.
Acceptance:
- First run has a working primary action and an exit.
Open: what is the intended first action for a brand-new user.

### M4-U6 Add channel feedback
Goal: adding a channel shows it happen, or shows why not.
Today: Track gives no feedback, the board does not refresh, and a handle that fails to resolve is added anyway with the error only in /logs.
Changes:
- Pending and success states on Track.
- Refresh the board on add.
- Reject a handle that fails to resolve, with the reason shown in the UI, instead of adding it (confirm the resolve path and the channel.add.profile_failed event).
Acceptance:
- Track shows pending then success.
- The board updates without a manual refresh.
- A bad handle is rejected with a visible reason.

### M4-U7 Render the remix Style outline
Goal: every generative stage shows its output.
Today: the Style stage builds a 7-beat outline (stored in remix_sessions.outline) and renders none of it.
Changes:
- Render the Style stage outline, matching the Hook stage pattern.
- Optional: a stage progress rail.
Acceptance:
- The Style stage shows its outline before the user moves on.

### M4-U8 Stack health view
Goal: see the whole stack at a glance.
Today: sidecar, LLM proxy, last sync, and stuck jobs are checked in separate places (the dashboard already pings sidecar /health and the LLM proxy, measured fast).
Changes:
- One health view showing sidecar status, LLM proxy status, last sync time and result, and any stuck jobs.
- Reuse the existing pings; add the last-sync and stuck-job reads (confirm the sources).
Acceptance:
- The health view shows all four at once and flags anything down or stuck.

## Milestone 5, backend, data, and design tokens

### M5-U1 Enrichment as a visible setting with a backfill
Goal: enrichment is controllable in the app and reports itself.
Today: VIEW_COUNT_ENRICH_PER_CHANNEL is env-only, defaults to 0. A run does not report what it enriched. 281 rows are still blank.
Changes:
- A Sync setting for the per-channel count, with the recommended value (at least the scoring baseline window) shown inline.
- Persist an enriched-count on the run and show it.
- A paced, cancelable backfill job for the still-blank rows (reuse the sync_jobs pattern and the existing pacing and cancel and heartbeat work).
Acceptance:
- The per-channel count is set in the UI and takes effect on the next sync.
- A run reports how many it enriched.
- The backfill fills blank rows, respects cancel, and does not steal the sync lock.
Open: the default per-channel value to ship on.

### M5-U2 Secondary text token passes AA
Goal: the most-used secondary text is readable.
Today: rgb(127,124,117) at 13px fails WCAG AA (3.37 to 3.73:1).
Changes:
- Darken the secondary text token to pass AA in both themes (confirm the token name and both theme values).
Acceptance:
- The token passes AA at 13px on its surface in light and dark.

### M5-U3 One h1 per route and real titles
Goal: correct document structure and topbar titles.
Today: 4 of 8 routes render two h1s; /runs and /logs show "Crowsnest" because ROUTE_TITLES has no entry.
Changes:
- One h1 per route.
- Add ROUTE_TITLES entries for /runs and /logs (and any other missing route).
Acceptance:
- Each route has one h1.
- The topbar shows the route's real title.

### M5-U4 Component duplication audit
Goal: fewer forked components.
Today: two ReachByPostBars, two VAULT_ROW_GRID copies (from the health report).
Changes:
- Collapse the duplicates to one shared component each (confirm both call sites are compatible).
Acceptance:
- One implementation each, both call sites use it, no visual change.

### M5-U5 Chart palette and design tokens documented
Goal: the system is applied consistently.
Today: the design system is good but the chart palette and a few tokens are not written down.
Changes:
- Document the categorical and magnitude chart palettes (from M3-U6) as tokens.
- A short internal note or a code-level tokens file, whichever you prefer.
Acceptance:
- Charts pull from the documented palette, no ad hoc colors.

## Sequencing and open decisions

Suggested order: M1, then M2, then M3, then M4, then M5. M1 is fast and unblocks a clean baseline. M2 and M3 are the highest user value.

Decisions that gate specific units:
- M2-U1: is the frame-pass analyze-first gate deliberate or a bug.
- M3-U1: is High Conviction the right default feed view.
- M3-U7: is a last-visit timestamp already stored, or new.
- M5-U1: the default per-channel enrichment value.
- Sync-cancel and stale-lock test (from the review): run it against an isolated DB copy before M5-U1 ships the backfill.

## Not in this spec

- The reaper follow-up beyond M2-U4 (a general job supervisor).
- Any feature not in the approved before/after mockups.
- Deployment. This stays a local single-user tool; if that changes, the security model needs a separate spec.
