# Runs observability browser test plan

For a browser agent (gstack sidebar Claude) to QA the feat/logs-observability branch. Test in the browser, do not edit code. Report PASS or FAIL per track with screenshots.

Rules:
- Browse http://localhost:3000 only, never 127.0.0.1 (Next 16 blocks Server Actions cross origin).
- Report bugs, do not fix them.

## Precheck

1. Open http://localhost:3000/runs. A 404 means the /runs route is not live (dev server may be on the wrong branch), stop and report that.
2. Confirm the left sidebar has a "Runs" entry under the System group.

## Track 1: run list and realtime

1. On /runs, rows render for real runs, each with a status dot, type tag (sync/remix/download), started time, duration, and progress bar where relevant.
2. Start a sync from the sidebar sync control at the bottom of the left rail.
3. Watch /runs without reloading. A running row appears or updates on its own within a few seconds (dot pulsing, progress moving). That is the SSE live update. FAIL if a reload is needed.

## Track 2: trace (run detail)

1. Click a run row, it navigates to /runs/<id> with a header (status, run id, timing, item-count tiles) above a log timeline.
2. The timeline shows log lines for that run only. Click a line to expand its fields JSON.
3. With a sync running, open its detail and confirm the timeline tails live (new lines without reload).

## Track 3: executable (cancel and retry)

1. While a sync runs, click Cancel on its row or detail page. The run moves to a cancelled or partial state.
2. Find a failed or partial run and click Retry. A new run starts.

## Track 4: notifications

1. Note the bell in the top bar and its unread count.
2. Trigger a failure: start a sync while the Instagram sidecar is not running or unauthorized (Settings, Instagram shows its state). Within a few seconds a new notification appears in the bell, kind run_failed, and the unread count rises.
3. On first interaction the page asks for browser notification permission. Allow it, trigger another failure, confirm an OS level notification fires.
4. Click a notification: it marks read and, if it has a run, opens that run's detail. Try Mark all read and confirm the count clears.

## Track 5: SLA

1. Settings, section Runs and alerts. Set Sync SLA budget to 1 minute, save.
2. Start a library sync and let it run past 1 minute.
3. The run shows an over-budget SLA chip on list and detail, and an sla_breach notification appears. It must NOT auto cancel the run.
4. Set the budget back to 10 when done.

## Track 6: dark and light

1. Settings, Appearance, toggle Dark and Light.
2. Visit /runs, a run detail, the bell panel, and Settings Runs and alerts in both themes. Text contrast reads, borders visible, dots and chips read in both. FAIL any screen that reads poorly.

## Report format

- One line per track: PASS or FAIL plus reason.
- Screenshots of /runs, a run detail, the bell panel open, and Settings Runs and alerts.
- Any console errors (open devtools).
