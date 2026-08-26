# Crowsnest enhancement roadmap, 2026-08-04

Where the product should go, by aspect. Each aspect has three parts: where it is today, where it should get to, and the enhancements that close the gap. These are forward moves (new layout, new capability), not defect tickets. Bugs live in 2026-08-04-REVIEW-SUMMARY.md and are linked here only when one blocks an enhancement.

Size tags: S is under half a day, M is about a day, L is multi-day. This is a menu, not a commitment. Grounded in the eight review passes on main at 8909788.

## 1. Frontend, per screen

### Feed

Today: a card grid with view-count and outlier badges. Load-more grows the limit and re-mounts a longer list. A saved view marked "default" (High Conviction) exists but a plain visit does not apply it, so the first thing you see is the unfiltered firehose. The toolbar shows two 2-state toggle groups as one run of four icons.

Target: the feed opens on the view that matters (outliers first), and filtering feels like one control, not four loose icons.

Enhancements:
- E1 Apply the default saved view on a bare visit, with a one-tap "show all" escape. S. (relates to CN backlog: saved-view and result-count labels)
- E2 Redesign the toolbar so the two toggle groups read as two groups (spacing, a divider, or segmented controls). S.
- E3 Windowed or paginated feed so the list stays light as the library grows. M. (relates to backlog CN-09, CN-10)
- E4 A compact density toggle for power browsing (more cards per screen). S.

Open questions: is High Conviction the right default view for you, or a different saved filter.

### Video detail

Today: one long scroll. The Layout section leads with a raw caption dump, the frame-pass reading sits below it, frame pass is buried in the non-default "Hook & structure" tab, and the analyze and download actions are scattered down the page.

Target: a two-column detail. Left is the video and its stats, right is the analysis (layout reading, transcript, score) with one clear action bar that is always reachable.

Enhancements:
- E1 Two-column layout with a sticky action bar: Analyze, Run frame pass, Download. M. (relates to backlog CN-06, CN-07)
- E2 Put the frame-pass reading above the caption text and collapse the raw caption fragments behind a toggle. S.
- E3 One stat header (outlier score, view count, posted date) instead of the same numbers scattered inline. S.
- E4 Make frame pass a first-class panel, not a tab a user has to discover. S. (relates to backlog CN-06)

Open questions: tabs versus a single scroll on mobile.

### Dashboard

Today: producer donut, a ranking-bar chart, top outliers. It sends the whole library to render a handful of rows, and two of its charts cannot be read (the donut reuses colors, the bars clamp).

Target: a dashboard that loads a small slice and whose every chart is decodable at a glance.

Enhancements:
- E1 Server-side slice so the page ships only the rows it draws. M. (relates to backlog CN-09)
- E2 Rework the two charts: 9-color (or grouped) donut, real-range ranking bars. S. (relates to backlog CN-12)
- E3 Add a "what changed since last visit" strip (new outliers, biggest movers) so the dashboard earns a daily open. M.

Open questions: which three numbers belong at the very top.

### Runs and logs

Today: a run list with an SSE live stream, a calendar filter, and an SLA signal. Run traces are nearly empty because most log events carry no run_id, and the stream resends the same payload every 2 seconds.

Target: open a run, see every step it took and why it failed, updated live without redundant traffic.

Enhancements:
- E1 Complete run traces by threading run_id through every sync log event. M. (relates to backlog CN-11)
- E2 Change-only SSE so an idle run costs almost nothing. S. (relates to backlog: Runs SSE medium)
- E3 A failure-first view: land on the failed step with its error, not the top of a 1,600-line log. M.

Open questions: keep the SLA as both over-budget and stuck, or staleness only (open item from the logs spec).

### Vault

Today: saved posts and saved scripts as compact cards with detail dialogs. Script titles can be the whole body (clamped in the UI). The Scripts tab header can read "0 saved posts" over real scripts, and there is no way to delete a script.

Target: a vault you can prune and trust, where a script has a real title and a delete.

Enhancements:
- E1 Give a saved script a short real title at save time (fix at the generator, not the card). S. (relates to backlog: script.title data smell)
- E2 Add delete for scripts and saved posts. S.
- E3 Correct the per-tab header counts and labels. S.
- E4 Search and tag within the vault as it grows. M.

Open questions: do saved posts and scripts belong in one vault or two tabs long-term.

### Settings

Today: a scrollspy sidebar that can mark two sections active at once. IG token regenerate lives here (and desyncs from a running sidecar if regenerated after start).

Target: settings where the nav is accurate and the risky actions explain their blast radius.

Enhancements:
- E1 Fix the scrollspy to mark one section. S.
- E2 Warn on IG token regenerate that a running sidecar needs a restart, or trigger it. S. (relates to the ig-service-token-desync gotcha)

Open questions: none yet.

### First run

Today: a dead end. The first-run screen has no links and no exit (usability found this while chasing the "Finish setup" link).

Target: first run points at the obvious first action for the repo state and always has a way forward.

Enhancements:
- E1 Give first-run a single primary action (add your first channel) and an exit to the feed. S.

Open questions: what is the intended first action for a brand-new user.

## 2. UX and flows

### Add channel

Today: clicking Track channel gives no feedback and does not refresh the board, and a handle that fails to resolve is added anyway while the error goes only to /logs.

Target: add a channel and see it happen, or see exactly why it did not.

Enhancements:
- E1 Pending and success states, board refresh on add, reject-and-explain on a bad handle. M. (relates to backlog CN-08)

### Frame pass

Today: the entry point shows on about 2% of videos, and a failed pass dead-ends the user in a retry loop.

Target: any video with a file can run a pass, and a failure tells you the one thing to do next.

Enhancements:
- E1 Surface the entry point on any downloaded video. S. (backlog CN-06)
- E2 Inline recovery on failure (Download video button, honest message). S. (backlog CN-07)
- E3 A progress signal during the 20 to 60 second run, not just a disabled button. S.

### Remix and export

Today: the Hook stage shows its output, then the Style stage generates a 7-beat outline and shows none of it, which breaks the pattern the Hook stage taught.

Target: every generative stage shows what it produced before you move on.

Enhancements:
- E1 Render the Style stage outline. S. (relates to backlog: remix outline medium)
- E2 A stage progress rail so the user knows how many stages remain. S.

Open questions: should export offer more than the current format.

## 3. Design system

Today: a real system (Archivo and IBM Plex Mono, a warm neutral palette, one amber accent that encodes above or below 1.0x, no AI-slop patterns, focus-visible and reduced-motion honored). The drift is in a few tokens and charts, not the foundation.

Target: the same system, applied consistently, with charts and contrast that pass their own rules.

Enhancements:
- E1 A documented chart palette (categorical scale for producers, a scale for magnitude bars) so no chart reuses a swatch. S. (backlog CN-12)
- E2 Raise the most-used secondary text token to pass WCAG AA. S. (backlog: contrast medium)
- E3 One h1 per route and real ROUTE_TITLES entries. S. (backlog: two-h1 medium)
- E4 A small component audit to collapse duplicates (two ReachByPostBars, two VAULT_ROW_GRID copies). M.

Open questions: publish the system as a short internal style page, or keep it in code only.

## 4. Backend and data

Today: the sync engine works, scoring recomputes per run, the IG sidecar is paced and now returns real view counts. Enrichment is off by default. The dev DB is migration-tracked but three migrations were hand-applied and never recorded.

Target: a sync that is observable, resumable, and self-consistent, with a clean migration record.

Enhancements:
- E1 Record the three hand-applied migrations so db:migrate runs clean. S. (backlog CN-04)
- E2 Make enrichment a visible setting in the UI, not an env-only knob, with the recommended per-channel value inline. M.
- E3 Persist an enriched-count on the run so a sync reports what it enriched. S.
- E4 A backfill job for the 281 still-blank view counts, paced and cancelable. M.

Open questions: what per-channel enrichment default ships on (12 was the review suggestion).

## 5. Performance

Today: fast right now. The two real costs only bite as the library grows: the dashboard re-ships the whole library per navigation, and the feed's main query cannot use its index.

Target: cost stays flat as tracked videos go from hundreds to tens of thousands.

Enhancements:
- E1 Index-friendly feed sort. S. (backlog CN-10)
- E2 Server-side dashboard slice. M. (backlog CN-09)
- E3 A large-library check in the review loop (seed 20k rows, measure feed and dashboard) so growth regressions surface early. M.

Open questions: none, the two fixes above are measured wins.

## 6. Security

Today: sound for a local single-user tool, with one real hole: the frame-pass subprocess inherits the server cwd and can read secrets, plus a yt-dlp argument-injection gap.

Target: every subprocess and external input is confined to what it needs.

Enhancements:
- E1 Confine the frame-pass child (cwd, add-dir, env allowlist, value cap). S to M. (backlog CN-01)
- E2 yt-dlp `--` separator. S. (backlog CN-05)
- E3 A short threat-model note for the sidecar and subprocess surface, so the next feature that spawns a process starts confined. S.

Open questions: does Crowsnest ever leave this machine. If yes, secrets handling needs a rethink beyond these fixes.

## 7. Reliability and observability

Today: a SIGKILL mid-frame-pass wedges the global lock, and heartbeat_at exists but nothing reads it. Runs have logs but weak traces.

Target: a stuck job recovers itself, and every run is explainable after the fact.

Enhancements:
- E1 Heartbeat reaper for frame pass. M. (backlog CN-13)
- E2 Complete run traces (shared with Runs E1). M. (backlog CN-11)
- E3 A single health view (sidecar, LLM proxy, last sync, stuck jobs) so you can see the stack at a glance. M.

Open questions: none yet.

## 8. Developer experience

Today: a fresh checkout has two snags (lint red on main, db:migrate broken), the test suite is fast and good but noisy, and the README carries a stale typecheck baseline.

Target: clone, install, and every gate is green and honest.

Enhancements:
- E1 Green lint on a clean checkout. S. (backlog CN-03)
- E2 Recorded migrations so db:migrate works. S. (backlog CN-04)
- E3 Quiet the test logs (one line in the test env setup) and correct the stale README baselines. S.
- E4 A one-command up (the /crowsnest-up flow) documented in the README so a new machine gets the stack in one step. S.

Open questions: none yet.

## What I need from you

- Mark the aspects and enhancements you actually want, and cut the rest. This is deliberately more than one sprint.
- For each screen with an "open questions" line, a one-word answer moves it forward.
- Tell me if any "Today" line is wrong, since the enhancements hang off it.
