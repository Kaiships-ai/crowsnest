# Crowsnest UI gap review: prototype vs shipped app

Date: 2026-07-31
Method: read the prototype source (`Crowsnest UI Mockups/Crowsnest Prototype.dc.html` plus per-screen slices) and loaded the running app at localhost:3000 screen by screen with a real browser, comparing what each one actually renders.

## Known, deliberate differences (context, not findings)

These six are settled decisions. They show up below as background, not as gaps.

1. Multi-platform is cut on purpose. The prototype has no platform filter either.
2. The signin step of onboarding is cut on purpose. Four steps run, not five.
3. The app dashboard is a smaller, stat-tile page by design. The prototype dashboard is a denser analytics page, and most of its panels never had a real query behind them.
4. Video layout reads are impossible right now because no vision model is configured.
5. Own-channel insights are impossible right now because no Graph API token is set.
6. The vault differs on purpose. The prototype shows a flat saved-post list; the app has that list plus a tabbed template library (Scripts, Hooks, Styles).

## Summary table

| Screen | Prototype shows | App shows | Gap | Verdict |
|---|---|---|---|---|
| Dashboard | Dense analytics page: hero top post, donut of who produces outliers, reach-vs-score scatter, 28-day rolling bar timeline, full ranking list, per-channel coverage bars | Four stat tiles (channels tracked, new outliers, vaulted this week, scripts drafted), one "today's top outlier" card, "fleets with new spikes," a "recently viewed" rail | Expected, see context item 3. App version is materially thinner but internally consistent | PARTIAL |
| Feed | Search, four dropdown filters (score/channel/time/sort), band chips, grid/list toggle, comfortable/compact toggle | Search, score/views/time dropdowns, follower-band chips, saved views, grid/list toggle | Layout matches closely, but the default filter state is mislabeled and hides most posts (see finding 1 below) | PARTIAL |
| Video Detail | Hero thumbnail, score, median bar, per-post spark chart, transcript/hook/why tabs, Remix/Save/Copy actions | Same score, median bar, and spark chart; same three tabs; four action buttons instead of three; hero shows a "video not downloaded yet" placeholder instead of a frame | Placeholder hero and a possibly-duplicate save action (findings 2 and 5) | CLOSE |
| Remix (Remix Studio) | Five-stage flow (Prompt, Research, Hook, Style, Script), reference panel, run log, a designed "local model is down" state | Same five stages, same reference panel and run log, and the same kind of "local model is down" state, with a more specific message | Style and Script stages could not be exercised because the local model proxy is not running in this environment; this mirrors context item 4, not a new gap | CLOSE |
| Channels | Table with followers, posts, an 8-run sync-health sparkline per channel, sync/unwatch actions | Table with followers, median views, a 30-day outlier count, sync status as text, plus a "Fleets" grouping sidebar not in the prototype | Sync-health sparkline replaced by plain text (finding 4); fleets grouping is a net-new addition | CLOSE |
| My channel (mine) | Six stat tiles, reach-by-post bars, length-vs-reach scatter, month/agenda/rhythm calendar, post list | "Instagram isn't connected here" state with clear setup instructions, plus a working month calendar with planned-post support | Expected, see context item 5. Could not confirm the Posts/Metrics tab content on this pass | CLOSE |
| Vault | Flat list of saved posts: thumbnail, caption, score, why-kept, posted date | Same flat list, plus Scripts/Hooks/Styles tabs and a "New template" action | Expected, see context item 6 | MATCH |
| Settings | Tabbed nav (Account, Scoring, Sync, Vault, Danger) down the left side | One long scrolling page: niche profile, Instagram connection, Graph API, API keys, local binaries, scoring, feed defaults, sync, danger zone | Structure differs a lot, and one section contains a direct contradiction with real feed behavior (finding 1) | PARTIAL |
| Onboarding | Five steps (signin, focus incl. cadence, connect, suggested channels by niche, first sync) | Four steps (focus without cadence, connect, manual channel entry, first sync) | Cadence question dropped (finding 3); suggested-channel picker replaced by blank text entry (finding 2) | CLOSE |

Verdict counts: MATCH 1, CLOSE 5, PARTIAL 3, ABSENT 0.

## The three gaps that cost the most in daily use

1. **The feed's default filter lies about itself.** A bare visit to `/feed` silently applies a system "Balanced" filter (minimum score 5, last 30 days) underneath the hood, but the score dropdown reads "Any score" and the Settings page states outright that "the feed always opens unfiltered, regardless of this number." In the current dataset this hides 7 of 8 scored posts behind a UI that insists nothing is filtered. This is the screen Kai opens every day to find what to remix, and it is quietly showing him the least amount of what is actually there while telling him it is showing everything.
2. **Onboarding lost its suggested-channel picker.** The prototype's channels step shows a niche-matched list of channels to check off with one click. The app's equivalent step is a bare "@handle" text box: nothing is suggested, and continuing requires already knowing exact handles to type. This raises the cost of finishing setup for any first-time user and removes the personalization that step 1 (pick your niche) was supposed to feed into.
3. **The Video Detail hero shows a placeholder instead of the frame it already has.** The same post's thumbnail renders fine on the Feed grid one click earlier, but opening the post swaps it for a gray "video not downloaded yet" hatch pattern with a download button. This is the screen used to actually judge every candidate post before deciding whether to remix it, and it now opens with less visual information than the card that led to it, on every single open.

Lower-cost gaps worth fixing eventually but not urgent: the sidebar's "Post" quick-nav item and the persistent "GET STARTED" checklist from the prototype are both absent from the app shell; the channels table's per-run sync-health sparkline is now plain text; the Focus onboarding step dropped its posting-cadence question; and Video Detail carries two bookmark-style buttons ("Keep this post" and "Save to Vault") whose difference was not obvious from the UI alone.

## Screen-by-screen detail

### Dashboard
Prototype: a dense single page with a hero top outlier, a donut chart of which watched channel produces outliers, a reach-vs-score scatter, a 28-day rolling outlier timeline, a full ranking list of every scored post, and per-channel coverage bars.
App: a partial-sync banner, four stat tiles (channels tracked, new outliers, vaulted this week, scripts drafted), a single "today's top outlier" card with a "view all in feed" link, a "fleets with new spikes" section (empty in this data), and a "recently viewed" thumbnail rail.
This gap is expected per context item 3. The app version reads correctly for what it shows; it is just a smaller surface than the prototype's, and most of the removed prototype panels never had a real query behind them anyway.

### Feed (Outlier Feed)
Prototype: search box, four filter dropdowns (score, channel, time window, sort), band-count chips, grid/list toggle, comfortable/compact density toggle, per-card "not for me" dismiss on hover.
App: search box, score/views/time dropdowns, "Saved views" menu, follower-band chips with live counts, grid/list toggle. Layout and visual language match closely.
The one real problem: on a bare visit, a system-level "Balanced" saved filter (minimum score 5, last 30 days) applies automatically, but the score dropdown displays "Any score" because it only reads the URL's query string, which is empty on a bare visit. The result: of 8 scored posts for the one synced channel, only 1 shows, with no visible indication that a filter is active. See gap 1 above.

### Video Detail
Prototype: grayscale hero thumbnail with duration and score badge, large score number, median bar with a spark chart of the last 12 posts, three tabs (Transcript, Hook & structure, Why it worked), and three actions (Remix this, Save, Copy as prompt).
App: same score number, median bar, and spark chart, rendered accurately against real data (10.1x, "above @kallaway's own median . over its last 12 posts", low-confidence label). Same three tabs, though transcript/hook/why content requires running Transcribe & Analyze first, which needs the local model. Four action buttons: Remix this, Keep this post, Save to Vault, Copy as prompt.
Two gaps: the hero shows a "video not downloaded yet" placeholder with a Download video button rather than the frame already displayed one screen earlier in the Feed grid; and the "Keep this post" / "Save to Vault" pair reads as two versions of the same action where the prototype has one.

### Remix (Remix Studio)
Prototype: five-stage pipeline (Prompt, Research, Hook, Style, Script) with a reference panel, per-stage item lists, a compare view, and a run log; a designed "proxy down" state with a "Start local model" button.
App: same five stages, shown as a numbered progress rail (Prompt, Research checked off; Hook current; Style, Script locked). Reference panel with score, handle, caption, and a "view full transcript" link matches. When the local model proxy is unreachable, the app shows "Hook generation is blocked . nothing answered at http://localhost:20128" with the exact command to fix it, and a run log showing the failed attempts. This is at least as clear as the prototype's designed-for state.
Style and Script stages could not be exercised in this pass because the local proxy is not running here; this is the same category as context item 4 (no model configured), not a new finding.

### Channels
Prototype: table of channel, followers, post count, an 8-run sync-health sparkline (tall = complete, short = partial, red = failed), and Sync/unwatch actions per row.
App: table of channel, followers, median views, and a 30-day outlier count, plus a "Fleets" sidebar (All channels, AI Niche, Craft References, New fleet) that groups channels into named sets. Per-channel status is plain text ("Synced 3d ago" or "Never synced" with a warning glyph) instead of the sparkline.
Net difference: the app trades a visual sync-health history for a channel-grouping feature the prototype never had. Reasonable trade, but the at-a-glance "is this channel healthy" signal from the sparkline is gone.

### My channel (mine)
Prototype: six stat tiles, a reach-by-post bar chart, a length-vs-reach scatter, and a month/agenda/rhythm calendar with a post list below it.
App: an "Instagram isn't connected here" panel explaining exactly what env vars to set and what connecting would unlock, followed by a working month calendar (July 2026, today marked) with "New planned post" support (title, date, note, script link, stale-after-30-days flag). This calendar and its planning modal exceed what the prototype specified in that area.
Expected per context item 5. Did not confirm what the Posts and Metrics tabs next to Month show in this pass.

### Vault
Prototype: flat list of saved posts with thumbnail, caption, score, "why kept," and posted date; sort controls.
App: the same flat list (thumbnail, caption, score, remix/remove actions, posted date) plus Scripts, Hooks, and Styles tabs and a "New template" action.
Matches by design per context item 6.

### Settings
Prototype: left-hand tab navigation (Account, Scoring, Sync, Vault, Danger zone) with a form panel per tab.
App: one long scrolling page covering niche profile, Instagram connection status (with a live check against the local sidecar), Instagram Graph API status, API keys (Anthropic configured, Groq not set), local binary checks (yt-dlp, whisper-cli), scoring rules (baseline statistic, baseline window, minimum usable posts, views floor), feed defaults, sync configuration, and presumably a danger zone further down.
Structurally very different from the prototype's tabbed layout, but far more informative: it shows live, real system state (service running or not, keys configured or not) rather than static copy. The one serious problem is the "Feed defaults" section, which states "Not read yet. The feed always opens unfiltered, regardless of this number" next to Default minimum score, a claim directly contradicted by the feed's actual behavior (see gap 1).

### Onboarding
Prototype: five steps down a left rail (Account/signin, Focus, Connect, Sources, First sync), the Focus step asking both "what do you make" and "how often you post," the Sources step showing a niche-matched suggested channel list with checkboxes.
App: four steps (Focus, Instagram, Channels, First sync), matching the prototype's welcome copy and left-panel text almost verbatim, and correctly reflecting the signin cut ("4 steps . about a minute"). The Focus step asks only "what do you make" (the cadence question is gone). The Channels step is a bare handle text box with no suggestions. The Instagram step correctly detects and reports that the local Instagram sidecar isn't running, with the exact command to start it. The First sync step reports real numbers read off the actual sync run (channels synced, posts seen against the 200-post cap, created/updated/failed/deleted counts) rather than a simulated progress bar.
Two gaps: the dropped cadence question (low cost, one-time) and the missing suggested-channel picker (higher cost, see gap 2 above).
