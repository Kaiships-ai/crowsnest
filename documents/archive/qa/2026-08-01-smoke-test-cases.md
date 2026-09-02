# Smoke test cases, 2026-08-01

Manual checklist for a walkthrough of every page and route. Browse at
`http://localhost:3001` (not `127.0.0.1`). Real state at write time: Instagram
connected as kaiships.ai.support, 2 channels tracked, 31 videos synced, 33 media
assets on disk (thumbnails and avatars only, no video files yet).

Each case is a box to tick. Cases marked **[side effect]** change real state
(kick off a sync, spawn a process, write a secret) and are not read-only -
run those only when you mean to.

## Dashboard (/)

- [ ] Open `/`. Page loads with no console errors, sidebar and topbar render, h1 reads "Dashboard".
- [ ] The dependency status panel at the top shows the sidecar as connected and the LLM key as configured, both green/positive, not a red or unreachable state.
- [ ] Four stat tiles show real numbers: channels tracked (2), new outliers, vaulted this week, scripts drafted. None read as blank or "NaN".
- [ ] "Today's top outliers" row shows video cards, or, if none rank as an outlier today, the row shows the "Analyze more videos to see patterns here" line instead of an empty gap.
- [ ] "Fleets with new spikes" section shows rows or the "No new spikes this week" line.
- [ ] "Recently viewed" section is empty ("Videos you open will show up here") on a fresh browser session, then after visiting a video detail page and returning to `/`, that video appears here.
- [ ] Scroll down: producer donut chart, reach-vs-score scatter, 28-day timeline, score ranking list, and channel coverage list all render with real data (31 synced posts is enough to plot).
- [ ] Click "View all in Feed" next to top outliers. Lands on `/feed`.

## Channels (/channels)

- [ ] Open `/channels`. h1 "Channels" from the topbar, page shows a fleet rail on the left and a channel table on the right.
- [ ] Summary line above the table reads "2 channels tracked" (adjust if a channel was added or removed since).
- [ ] Channel table lists both tracked channels with handle, follower count, and median views columns filled in, not dashes, given 31 synced posts.
- [ ] Click "Add channel" button. A dialog opens with a field to enter a handle. Close without submitting - no channel added.
- [ ] Click a fleet in the left rail. URL gets a `?fleet=` param and the table narrows to that fleet's channels only.
- [ ] Click a channel row. Navigates to `/channels/[channelId]`.

## Channel detail (/channels/[channelId])

- [ ] From `/channels`, click into a channel. Page shows "← Channels" back link, channel header (avatar, handle, follower count), and four stat tiles (median views, best score, outliers 30d, posts tracked).
- [ ] Stat tile values are real numbers, not placeholders - median views should show a number given more than the minimum usable posts.
- [ ] A thin horizontal progress bar below the stats shows either "score active, based on the last N posts" or an "N / M posts before a score appears" count.
- [ ] Reach-by-post bar chart and the post calendar both render below the stats.
- [ ] "Outlier history" chart renders under its own heading.
- [ ] Three tabs - Recent Reels, Outliers Only, In Vault - all switch content without a page reload. Outliers Only shows only videos scoring 2x or higher; In Vault shows only videos with a saved template, or "No templates saved from this channel yet." if none.
- [ ] Click "← Channels". Returns to `/channels`.
- [ ] Navigate to `/channels/does-not-exist`. Page shows a not-found page, not a crash.

## Feed (/feed)

- [ ] Open `/feed` with no query params. Topbar h1 "Outlier Feed", filter bar at top, a grid of video cards below.
- [ ] Result count line above the grid ("N results") matches the number of cards actually shown.
- [ ] Filter bar: fleet picker, platform picker, score/views/timeframe filters, and a search box are all present and clickable.
- [ ] Pick a saved filter (e.g. "Balanced") from the filter bar. Grid updates and the URL reflects the filter.
- [ ] Type a search term that matches nothing (e.g. "zzzzznomatch"). Page shows "No post matches" copy with a "Clear search" button, not a blank grid.
- [ ] Clear the search. Grid returns to the prior result set.
- [ ] Set a filter combination that yields zero results without a search term (e.g. an extreme minimum score). Page shows "No post matches this slice" with a "Clear filters" button.
- [ ] If more than 24 results are available, a "Load more" button appears at the bottom. Click it. More cards append (URL `limit` bumps by 24) with no full page reload.
- [ ] Click a video card. Navigates to `/feed/[videoId]`.
- [ ] Hard-refresh `/feed` and watch for the loading state. A skeleton grid (gray card placeholders) appears briefly, not a spinner or blank white page.

## Video detail (/feed/[videoId])

- [ ] From `/feed`, click a video card. Page shows the video, caption, stats, and an action row.
- [ ] Tabs are present: at minimum a transcript tab alongside the analysis tabs (Hook & structure, Why it worked, or similar).
- [ ] If the video has no transcript yet and transcription is possible (a transcript provider available), a live "Transcribe & Analyze" button shows. **[side effect]** Clicking it kicks off real transcription and analysis - only run this if you want to spend the time/quota.
- [ ] If a transcript already exists, the Transcript tab shows the text and a "Copy" button that copies it to clipboard.
- [ ] "Similar outliers" section renders a row of related videos, or "Analyze more videos to see patterns" if none qualify.
- [ ] Save action (star icon) toggles saved state without a page reload; toast confirms.
- [ ] "Remix this" button is visible and navigates to `/feed/[videoId]/remix`.
- [ ] Prev/next navigation (if present from feed context) moves between adjacent videos in the current feed order, with an index label like "3 of 24".
- [ ] Browser tab title updates to include the video's caption (or "Video") plus "Crowsnest".
- [ ] Navigate to `/feed/not-a-real-id`. Page renders a proper not-found state (content matches a 404 even though the status code is known to stay 200 - see the code comment in `feed/[videoId]/page.tsx` for why that's a known, accepted gap).

## Remix studio (/feed/[videoId]/remix)

- [ ] From a video detail page, click "Remix this". Lands on `/feed/[videoId]/remix` with a stepper showing five stages: Prompt, Research, Hook, Style, Script.
- [ ] Prompt stage shows a topic field, pre-filled or empty depending on prior sessions.
- [ ] Research stage shows reference material pulled from the Vault (saved posts) and similar outliers.
- [ ] Stepper only allows jumping to a stage already reached - clicking ahead of the furthest stage does nothing.
- [ ] **[side effect]** Advancing through a stage that generates content (hook options, outline, script) calls the LLM for real. Only run this if you intend to spend LLM quota; otherwise just confirm the stage UI renders without triggering generation.
- [ ] A run log section appears once past the Prompt stage, showing past generation attempts (empty on a first-ever session for this video).
- [ ] Reload the page mid-session. Stage and prior answers persist (session is saved server-side, not just in memory).
- [ ] Navigate to `/feed/not-a-real-id/remix`. Page renders a proper not-found state.

## My channel (/mine)

- [ ] Open `/mine`. If no channel is marked as "own" yet, the page shows a channel picker instead of stats - pick a candidate channel to see the rest render.
- [ ] Once an own channel is set: page shows the channel handle as h1, and a Graph API connection status line.
- [ ] Given the real state (no `IG_GRAPH_TOKEN` configured), the Graph connect panel shows a plain "not connected" / "what connecting would produce" message, never fabricated zeros or a spinner stuck forever.
- [ ] Three tabs below - Month, Posts, Metrics. Month shows a calendar for the current month; switch to a different month via the calendar's own navigation and confirm the URL `month` param updates.
- [ ] Posts tab lists own posts (empty state if none measured yet, given no Graph token).
- [ ] Metrics tab shows a weekday-rhythm chart (empty state if no measured posts).
- [ ] Planner/calendar entries (if any planned posts exist) show regardless of Graph connection state - this part does not require the Graph API.

## Settings (/settings)

- [ ] Open `/settings`. Left nav lists: Niche profile, Instagram, Graph API, API keys, Local binaries, Scoring, Feed defaults, Sync, Onboarding. Clicking each nav item scrolls to its section (anchor jump, no page reload).
- [ ] Niche profile section shows the current niche and keyword list, editable.
- [ ] Instagram section shows the sidecar control block above the connection panel.
  - [ ] Sidecar control shows "Sidecar: Running" (given the sidecar is expected to be up) with Check and Stop buttons enabled, Start disabled.
  - [ ] Click "Check". Button shows a brief loading spin, then re-settles on Running/Not running - no error.
  - [ ] **[side effect]** Click "Stop". Sidecar process is torn down for real; control updates to "Not running" and Start becomes enabled. Only do this if you are prepared to also test Start afterward, since sync and Instagram login will fail while stopped.
  - [ ] **[side effect]** Click "Start" (after a Stop, or if it was already down). Spawns the sidecar process for real; control updates to "Running" once health check succeeds.
- [ ] Instagram connection panel shows "Connected as @kaiships.ai.support" given the real current state, with instagrapi version, session-file status, and service URL listed.
  - [ ] "Session ID" sign-in field is present above the status panel with a masked password input and a "Connect" button, even while already connected.
  - [ ] **[side effect]** Do not submit a real session ID unless intentionally re-authenticating - this replaces the active session.
  - [ ] Click "Re-check". Status re-reads live from the sidecar; panel content stays consistent (still "Connected") if nothing changed.
  - [ ] **[side effect]** "Disconnect" button logs the account out for real. Only run this if you plan to reconnect afterward.
- [ ] Graph API section shows current token status (expected: not configured, given no `IG_GRAPH_TOKEN`).
- [ ] API keys / secrets section shows three groups - LLM, Instagram sidecar, Graph API - each listing its secrets with a "Configured" or "Not set" badge.
  - [ ] All 8 secrets appear: Anthropic API key, Groq API key, Service token, Username, Password, Session ID, Graph token, Graph user ID.
  - [ ] A configured secret shows its source ("from .env.local" or "set here") next to the badge; no secret ever shows its actual value anywhere on the page.
  - [ ] Click "Test" next to the Anthropic key. Shows "Testing…" then a toast with the connection result (OK, given the 9router proxy is live), without a page reload.
  - [ ] **[side effect]** Click "Set" (or "Replace") on any secret, type a value, click Save. Toast confirms save, badge flips to "Configured · set here", input clears. Then click "Clear" to remove it and confirm the badge reverts. Use a throwaway value, not a real credential, when testing this.
  - [ ] **[side effect]** Click "Regenerate" on the service token. Toast confirms regeneration; this invalidates the old token the sidecar was using; only run this if you are prepared to also restart or reconnect the sidecar afterward.
- [ ] Local binaries section shows yt-dlp and whisper-cli availability with a real found/not-found status per binary.
- [ ] Scoring, Feed defaults, and Sync sections all show their current values in editable fields, and Sync shows the last sync job's result (status, timestamp) if one has run.
- [ ] Onboarding section shows a control to reset first-run state.

## Logs (/logs)

- [ ] Open `/logs`. h1 "Logs". By default only warn and error levels are checked, and the "Show everything" switch is off.
- [ ] Table shows rows with Time, Level, Source, Event columns. Level text color differs by level (info muted, warn plain, error in the destructive/red tone).
- [ ] Toggle "Show everything" on. All three level checkboxes (info, warn, error) become checked and the table includes info-level rows; the URL gains a `levels=` param.
- [ ] Toggle a single level checkbox off (e.g. uncheck error while others stay checked). Table updates immediately to exclude error rows, no page reload needed.
- [ ] Pick a source from the Source dropdown (backend, frontend, sidecar). Table filters to that source only.
- [ ] Type a value in "Event prefix" and press Enter (or click Refresh). Table filters to matching events.
- [ ] Type a value in the free-text search box and press Enter. Table filters by that text across event and fields.
- [ ] Click a row. Row expands in place to show the full JSON fields payload below the event name; click again to collapse.
- [ ] Set filters that match nothing (e.g. an event prefix that does not exist). Table shows "No log events match this filter." instead of an empty table with headers only.
- [ ] With every level unchecked (uncheck info, warn, and error), the table shows zero rows and the URL carries an explicit empty `levels=` param, confirmed distinct from a bare `/logs` visit (which defaults to warn+error, not empty).

## Vault (/vault)

- [ ] Open `/vault`. h1 "Vault" with a count line ("N saved posts" or "Nothing saved yet.").
- [ ] Four tabs: Saved posts, Scripts, Hooks, Styles.
- [ ] Saved posts tab: rows show a thumbnail, score, why-kept reason, and posted date column, sortable via the sort control (Recent, Score, Analyzed).
- [ ] If saved posts is empty, an empty state shows with a link into the Feed (pointing at today's top outlier if one exists).
- [ ] Scripts tab shows script cards or "No scripts yet. Write one in the Remix Studio." if none exist.
- [ ] Hooks and Styles tabs each show template cards, or the appropriate empty copy (a full "Nothing saved yet." with a Browse the Feed link only when both tabs are empty; a lighter "No hooks/styles saved yet." when the other tab has content).
- [ ] Click "New template" (or equivalent add action). A dialog opens for creating a template.
- [ ] Visit `/vault?tab=scripts`. Page loads with the Scripts tab active on first paint, not Saved posts.

## First run (/first-run)

- [ ] Given first-run is already completed on this install, navigating to `/first-run` directly redirects straight back to `/` rather than showing the onboarding flow.
- [ ] To actually see this screen, first go to Settings → Onboarding and use the control there to reset first-run state (**[side effect]**, changes real app_settings), then reload `/first-run`.
- [ ] Onboarding flow shows steps for niche profile and Instagram connection, using the same sidecar status as Settings.
- [ ] Completing (or skipping) the flow redirects into the normal shell at `/`.

## API: /api/logs/ingest

- [ ] This endpoint accepts POST only and has no browsable page - do not open it directly in a browser (a GET will 404/405).
- [ ] Confirm indirectly: trigger an app action that logs an event (e.g. load a page, or click something in Settings), then check `/logs` a moment later and see a corresponding new row - this confirms ingest is working end to end without calling the API by hand.
- [ ] **[side effect, optional/advanced]** A manual POST with curl using a `source: "sidecar"` body and no `X-IG-Token` header should get a 401. This is an engineering-level check, not needed for a standard walkthrough.

## API: /api/media/[assetId]

- [ ] This endpoint has no browsable page of its own - it is hit indirectly whenever a thumbnail or avatar image loads anywhere in the app (Feed grid, Channel detail, Vault cards, Dashboard charts).
- [ ] Confirm indirectly: open `/feed` and check that video thumbnails and channel avatars actually render as images, not broken-image icons - that is this endpoint serving correctly.
- [ ] Open a known image URL directly, e.g. `http://localhost:3001/api/media/<a real asset id from the DB>`. Image loads in the browser tab.
- [ ] Open `/api/media/not-a-real-asset-id` directly. Browser shows a plain 404, not an error page or a broken layout.
- [ ] No video files are on disk yet in this install, so any post's own video playback (if the UI attempts to embed the source video) is expected to show a missing-media state rather than actually play - that is correct given current sync state, not a bug.

## Cross-cutting checks

- [ ] Sidebar's "get started" checklist (visible on every shell page) reflects real state: setup done, a channel watched, and other items ticked or not based on actual data, not stuck on stale defaults.
- [ ] Command menu (if bound to a keyboard shortcut, commonly Cmd+K) opens from any shell page and can jump to Channels, Feed, Vault, Settings, Logs.
- [ ] Topbar's failure strip (if any sync or job has failed recently) shows on every shell page consistently, not just on the Dashboard.
- [ ] Navigating shell-to-shell (Dashboard to Channels to Feed to Vault to Settings to Logs and back) never shows a full white-page flash - only the content pane should reload.
