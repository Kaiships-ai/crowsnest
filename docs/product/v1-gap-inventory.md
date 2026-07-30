# Crowsnest V1 gap inventory

Written 2026-07-31. Ground truth only: what the prototype shows against what the
app on disk actually does. No recommendations, no design opinions.

Prototype source: `Crowsnest UI Mockups/Crowsnest Prototype.dc.html`, sliced per
screen under the session scratchpad. App source: `src/app/`, `src/components/`,
`src/server/`. Where a row cites a line number it was read on disk, not inferred.

## Status values

- **BUILT**: exists in the app and works against real data.
- **PARTIAL**: exists but incomplete. The row says exactly what is missing.
- **MISSING**: in the prototype, absent from the app.
- **FABRICATED**: the app's UI offers this but no backend supports it. Per the V1
  brief these outrank every missing feature. There are seven of them and they are
  listed together in the last section as well as in place.

Every MISSING and FABRICATED row names the table, column, query or action the
work would need.

## What is already in the schema and unused or half used

Checked before claiming anything is absent. `src/server/db/schema.ts`:

| Table | State |
|---|---|
| `saved_filters` | Read only. `getSavedFilters` (queries/feed.ts:158) reads it, `bootstrap.ts:38` seeds two system rows. No create, update or delete path anywhere. A user can never save a view. |
| `video_snapshots` | Written by `sync-engine.ts:922`. Read by nothing. A per post view history exists on disk and no screen uses it. |
| `channel_snapshots` | Written by `sync-engine.ts:996`. Read only for `medianViews` (queries/channels.ts:40). The `follower_count` time series is never read, so no follower trend can be drawn although the data is there. |
| `video_children` | Written by sync, read by the carousel viewer. Fully used. |
| `videos.share_count` | Populated by sync. Rendered nowhere. Not in `feedItemColumns`. |
| `videos.raw_payload` | Written, never read outside debugging. |
| `channels.following_count`, `media_count`, `bio`, `is_verified`, `is_private` | Written by sync, rendered nowhere. |
| `remix_sessions.variants`, `research_notes` | Present. See the Remix section. |
| `app_settings` | Holds exactly three keys in practice: `niche_profile`, `niche_keywords`, `recently_viewed`. Nothing else is persisted as a setting. |

Nothing in the schema holds Instagram Insights. Grep across `src/` for reach,
saves, shares as an Insights metric, profile visits, follows, watch time,
retention and impressions returns no field, column, query or component. The only
hits are unrelated English prose. There is no Graph API client: `src/server/ig/client.ts`
is the instagrapi sidecar client, and the sidecar (`services/ig/crowsnest_ig/app.py`)
exposes health, login, challenge, two factor, login by session, logout, profile,
medias, resolve media and download. No insights endpoint and no write endpoint.

## Onboarding: welcome, signin, focus, connect, sources, firstsync

Prototype lines 74 to 311 of the original. None of it exists in the app. There is
no onboarding route, no first run flow, no setup wizard. Grep for onboarding,
welcome, firstrun, first-run and setup across `src/` returns nothing.

| Element | Status | What it would need |
|---|---|---|
| Left rail with the four step tracker (`authSteps`) | MISSING | Client state only. No backend. |
| Welcome screen, three numbered points, "Get started" | MISSING | Static copy. No backend. |
| Sign in / register: name, email, password, error line, toggle between sign in and register | MISSING | No user table, no auth of any kind in the app. The brief calls auth pointless for a local single user tool, so this is the one part of the flow that has an argument for staying out. |
| Focus step: subject picker (`nicheOpts`) | PARTIAL | The value exists. `app_settings.niche_profile` is written by `saveNicheSettingsAction` (settings-actions.ts:57) and surfaced in Settings, but only after the app is already running. No first run home. |
| Focus step: posting cadence picker (`cadenceOpts`) | MISSING | No column. Would need a new `app_settings` key. Nothing reads a cadence today. |
| Connect step: "Connect Instagram", authorising progress, connected result card showing handle, followers, posts found | PARTIAL | The login path exists in `ig-actions.ts` (status, login, challenge, two factor, logout) and is surfaced in Settings' Instagram section. The prototype frames this as Graph API for the user's own account; the app only has the burner sidecar. The "posts found" figure has no source until a sync runs. |
| Connect step: "Skip for now" | MISSING | Trivial once the flow exists. |
| Sources step: pick channels from a suggested list with follower counts and band labels | MISSING | The app can add a channel by handle (`addChannelAction`). There is no suggestion source at all: no seeded channel list, no discovery query, nothing that could populate `sourceRows`. Would need a seed table or a discovery call. |
| First sync step: seven named phases with per phase dots and notes | PARTIAL | The sync engine has real phases and `sync_jobs.phase` is polled live. The prototype's fixed list of seven (`resolve session`, `fetch profile`, `list reels`, `fetch reels`, `compute median`, `score outliers`, `write rows`) is a different vocabulary from the engine's. Nothing renders it as a first run checklist. |
| First sync results: three result figures then "Open Crowsnest" | MISSING | `sync_jobs` already holds `itemsSeen`, `itemsCreated`, `itemsUpdated`, `itemsFailed`, `channelsDone`, `channelsTotal`. The data is there; the screen is not. |

Size: the onboarding run is 100 percent missing. One of its six screens (focus)
has its underlying setting; one (connect) has its underlying action.

## Shell: sidebar, top bar, failure strip, sync strip, overlays

Prototype `shell.html` plus the overlay block at the end of `settings.html`.

| Element | Status | What it would need |
|---|---|---|
| Sidebar brand mark and wordmark | BUILT | |
| Rail collapse toggle with chevron flip | BUILT | `sidebar.tsx:118` `collapsed` state. |
| Nav group headings RESEARCH / CREATE / SOURCES / SYSTEM | BUILT | `nav-items.ts` groups. |
| Nav item Feed | BUILT | |
| Nav item Feed count badge | MISSING | The count exists: `getOutlierFeed` returns `total`. The sidebar never fetches it. Would need a small count query called from the shell layout. |
| Nav item Post (detail) | MISSING by design | `nav-items.ts:24` states it was left out because it is a nested route. |
| Nav item Remix | MISSING | Remix exists only at `/feed/[videoId]/remix`. There is no standing Remix entry and no "resume the current run" concept, although `remix_sessions` rows persist and could supply one. |
| Nav item Vault | BUILT | |
| Nav item Vault count badge | MISSING | Count is one `count(*)` over `vault_items`. Not fetched. |
| Nav item Channels | BUILT | |
| Nav item My channel | MISSING | See the My channel section. There is no route and no own channel concept. |
| Nav item Dashboard | BUILT | |
| Nav item Settings | BUILT | |
| Getting started checklist, four steps, progress "n/4", per step "show me where" | MISSING | Four booleans (`seenDetail`, `didAnalyse`, `didSave`, `didRemix`). Would need four `app_settings` keys or one JSON key. Nothing in the app tracks whether the user has ever opened a post, analysed one, saved one or run a remix. |
| Checklist hide control plus the Settings row that brings it back | MISSING | Same as above. |
| Guided tour ring and bubble driven off the checklist | MISSING | Pure client. No backend. |
| Six sync dots in the rail footer | PARTIAL | The rail shows one live status dot from `useSyncProgress`, not a per channel strip of six. A per channel strip would need the last N `sync_jobs` rows per channel, which the table already holds. |
| Rail sync button with disabled state and title text | BUILT | `startSyncAction`, `useSyncProgress`. |
| "Cmd K jump to anything" hint in the rail | MISSING | Hint text only. The palette itself exists. |
| Top bar with page title | BUILT | `topbar.tsx` ROUTE_TITLES. The prototype has no top bar; the app added one. Not a gap, noted for completeness. |
| Top bar context action slot | MISSING | `topbar.tsx:46` is an empty comment. No page ever injects a primary action. |
| Failure strip: five distinct states (rate limited, offline, session expired, local service down, partial recovered) each with title, code, one line explanation, facts line, action button | PARTIAL | The app surfaces errors as toasts and as per section alerts (`channel-header.tsx:164`, the Instagram section, the Settings sync section). There is no single global strip and no state machine covering all five. The underlying data exists: `sync_jobs.error_code`, `error_message`, `status`, `stop_reason`, `gaps`, and `channels.sync_error_code`. |
| Failure strip "what did not come back" detail panel listing each miss and why | PARTIAL | `sync_jobs.gaps` is a typed `SyncGap[]` and is read (channel header renders a gap alert). It is not rendered as the itemised list the prototype shows. |
| Failure strip retry countdown for rate limits | MISSING | Nothing stores a retry-after. Would need a column on `sync_jobs` or a settings key. |
| Failure strip dismiss | MISSING | |
| In page sync progress bar with phase label and "step n/7" | PARTIAL | `SyncProgressPanel` exists and polls `sync_jobs` for `phase`, `currentChannelHandle`, `channelsDone`, `channelsTotal`, `retries`. It reports channels done over channels total, not a fixed seven step count. The prototype's seven-phase model does not exist server side. |
| Command palette, Cmd K | PARTIAL | `command-menu.tsx` opens on Cmd K and lists the five nav routes. The prototype's palette also searches posts by caption and by channel handle and shows `SCORE, handle` as the meta line. There is no post search: `getOutlierFeed` has no `like` or FTS clause and takes no query param. Would need a `q` param on `FeedFilters` plus a `like` over `videos.caption` and `channels.handle`. |
| Palette empty state "Nothing matches" | BUILT | `CommandEmpty`. |
| Toast, single slot, auto dismiss, close button | BUILT | sonner, used in 18 components. |
| Toast Undo action | MISSING | No toast in the app passes an action. The prototype offers undo on dismiss, unwatch, unschedule, remove from vault and every settings change. |
| Confirm dialog with kicker, title, body, destructive confirm | PARTIAL | Dialogs exist (add channel, new fleet, edit fleets, save to vault, new template). There is no generic destructive confirm because there are no destructive actions wired. |
| Add channel dialog | BUILT | See Channels. |
| Prototype state dock | Not applicable | Prototype tooling. |
| Keyboard shortcut: Cmd K palette | BUILT | `command-menu.tsx:46`. |
| Keyboard shortcut: 1 to 8 jump to section | MISSING | No global key handler beyond Cmd K. |
| Keyboard shortcut: S run sync | MISSING | |
| Keyboard shortcut: F jump to feed | MISSING | |
| Keyboard shortcut: left and right step through posts on detail | MISSING | The detail page has no sibling list, so stepping would need the feed's ordering carried in the URL or recomputed. Arrow keys are bound inside `carousel-viewer.tsx:92` for carousel children only, which is a different thing. |
| Keyboard shortcut: Escape closes menus, palette, dock, tour | PARTIAL | Base UI dialogs close on Escape. There is no single handler clearing app state. |
| Menu keyboard navigation, arrow up and down inside a filter menu | BUILT | Base UI Select and DropdownMenu handle this. |
| Hover reveal actions on rows (`data-hover-action`) | MISSING | The prototype hides secondary row actions until hover or focus. The app renders row actions permanently or puts them behind a three dot menu. |
| Row hover background, media hover contrast lift, reduced motion honouring | PARTIAL | The app has hover backgrounds. The media contrast lift on card hover and the global `prefers-reduced-motion` override are prototype CSS with no app equivalent found. |
| Loading skeletons | PARTIAL | `feed/loading.tsx` renders 8 skeletons against a real page size of 24 and omits the follower band row. No other route has a loading file. |

The prototype's `support.js` is the generic DC template runtime (React based
template compiler) and `image-slot.js` is a generic drag and drop image
placeholder web component. Neither carries product behaviour. Every interaction
listed above lives in the prototype's own inline component class, which is why
the table above cites the prototype HTML rather than those two files.

## Dashboard ("Today")

Prototype `dashboard.html`. The app's `/` is a different screen with the same job.

| Element | Status | What it would need |
|---|---|---|
| H1 "Today" and a `todayLine` summary | PARTIAL | The app's title is "Dashboard", supplied by the top bar, and there is no summary line. |
| NEXT row: one sentence naming the next action plus a button that goes there | MISSING | Driven by the four checklist booleans. Same gap as the sidebar checklist: nothing tracks whether the user has opened, analysed, saved or remixed. Would need `app_settings` keys. |
| FIRST RUN notice explaining that medians are still settling | MISSING | Derivable from `channels.tracked_since` and post counts. Not built. |
| Empty state "No channels are being watched" with "Add a channel" | BUILT | `page.tsx:49`, gated on `stats.channelsTracked === 0`. |
| Hero: top post thumbnail, score at 52px, "vs" line, caption, meta, "Remix this", "Open post" | MISSING | The app has no hero. It has a horizontal scroll row of six compact cards ("Today's top outliers") from `getTopOutliersToday`. Every field the hero needs is already in `feedItemColumns`; the layout is absent. Note the app's row silently falls back to the all time top when the seven day window is empty (`dashboard.ts:114`), which the prototype does not do. |
| KPI tiles: channels tracked, new outliers 7d, vaulted this week, scripts drafted, each with delta and sparkline | BUILT | `getDashboardStats`, dashboard.ts:63 to 86. Not in the prototype; the app added them. "Scripts drafted" is all time while its neighbours are seven day, which is documented at dashboard.ts:48. |
| Donut "WHO PRODUCES THEM": share of outliers by channel, legend with handle and count, plus a line naming the top share | MISSING | One `group by channel_id` over `videos where outlier_score >= 2`. No query exists. |
| Scatter "REACH VS SCORE" with log x axis, median rule, clickable dots | MISSING | Needs `videos.view_count` against `videos.outlier_score`, both present. No query, no component. Note the prototype label says reach; the app only has view counts. |
| 28 day rolling timeline of days that produced an outlier | MISSING | One `group by date(posted_at)` over the outlier set. Not built. The `viewsSparkline` bucketing in dashboard.ts:19 is a different shape (90 days into 12 buckets, views not outlier days). |
| RANKING: full score distribution list with a bar, caption and handle per row, and a show all toggle | MISSING | This is the feed's own data ordered by score. No component. |
| COVERAGE: per channel bar showing sync coverage | MISSING | Would need posts seen against posts expected, or last sync completeness. `sync_jobs` holds `itemsSeen`, `itemsFailed`, `gaps`, `status` per run per channel, so the inputs exist. No query. |
| "Fleets with new spikes" | BUILT | `getFleetSpikes`, dashboard.ts:138. Not in the prototype; the app added it. |
| "Recently viewed" | BUILT | `getRecentlyViewed` over `app_settings.recently_viewed`. Not in the prototype. |

Size: the dashboard is roughly 70 percent missing against the prototype. Four of
the prototype's five data displays (donut, scatter, timeline, ranking, coverage)
have no query and no component. What the app does have instead (KPI tiles, fleet
spikes, recently viewed) is real and works, but it is a different screen.

## Feed ("Outliers")

Prototype `feed.html`. App `src/app/(shell)/feed/page.tsx` and `src/components/feed/`.

### Controls

| Element | Status | What it would need |
|---|---|---|
| Grid / List toggle | BUILT | `view` param, consumed client side by `feed-grid.tsx:13`. |
| Comfortable / Compact density toggle | MISSING | No density control anywhere. Prototype's `density` prop drives `gridCols` and `gridGap`. Client state plus a persisted `app_settings` key if it should survive reload. |
| Sync button in the page header | MISSING | Sync lives in the sidebar and Settings only. The action exists (`startSyncAction`). |
| Search box, "Search captions and channels" | MISSING | The single largest missing control on this screen. `getOutlierFeed` takes no query param and `feed.ts` has no `like` clause. Would need `FeedFilters.q` plus `like(videos.caption)` or `like(channels.handle)`. The Cmd K palette does not cover it either. |
| Clear filters | PARTIAL | Exists (`filter-bar.tsx:230`) but does not clear `sort` or `view`, and because leaving either behind flips the page's `isEmpty` check (page.tsx:35) the Balanced preset defaults are not restored. Clearing filters therefore changes the result set in a way the label does not describe. |
| Score filter menu: all / 1x / 2x / 5x / 10x | PARTIAL | The app offers any / 2 / 5 / 10 / 20 and honours it (`gte(videos.outlierScore)`, feed.ts:89). Two problems. First, the 1x option is missing and a 20x option was added. Second, on a bare `/feed` the backend applies `minScore: 5` from the seeded Balanced preset while the control displays "Any score" (page.tsx:38 and 43 against filter-bar.tsx:126). The number on screen does not describe the rows on screen. |
| Channel filter menu: all channels plus one entry per channel | MISSING | `FeedFilters.channelId` exists and has a live where clause (feed.ts:87) but is never exposed in the feed UI. Only `channels.ts:138` uses it. This one is a UI wiring job, not a backend job. |
| Time window menu: 7 / 30 / 90 / all time | PARTIAL | Options are 7 / 14 / 30 / 60 / 90 with no "all time". Worse, the control shows "Last 30d" by default but the backend only applies 30 days when the URL is completely bare (page.tsx:35). Set any other param, including the view toggle, and `sinceDays` becomes undefined and no date filter runs at all while the label still says "Last 30d". |
| Sort menu: highest score / most views / most recent | BUILT | feed.ts:115. |
| Follower band row: Any / Nano / Micro / Mid / Macro, always visible | BUILT | feed.ts:95, bounds at feed.ts:73. Locked as a first class control by the brief and it is one. |
| Per band result counts next to each band label | MISSING | One `count(*) group by band`. Not queried. |
| Feed summary line (result count) | BUILT | `{total}` from `count(*)`, page.tsx:109. |
| Platform chips: All / IG / TikTok / YT Shorts | **FABRICATED** | Confirmed. `filter-bar.tsx:23` offers four values. Sync writes `platform: "instagram"` for every video (`sync-engine.ts:682`) and every channel (:1225, :1275); `providers/ytdlp.ts:25` does the same; `addChannel`'s input type is `platform?: "instagram"` (:1193). Selecting TikTok or YT Shorts issues `eq(videos.platform, 'tiktok')`, returns zero rows, and drops the user in the "no post matches this slice" state. The Add Channel dialog already deleted its own platform picker for exactly this reason (`add-channel-dialog.tsx:22`). Note the prototype has no platform chips at all. |
| Saved views dropdown | PARTIAL, and one **FABRICATED** element | Reading works: two seeded rows from `bootstrap.ts:15`. But there is no create, update, rename or delete path for `saved_filters` anywhere in `src/`, so a user can never save a view. A dropdown labelled "Saved views" that can only ever show two rows the app shipped with is offering a capability that does not exist. It also only applies three keys (`minScore`, `minViews`, `sinceDays`, filter-bar.tsx:68) so a preset can never carry platform, fleet, band or sort. Would need `saveFilterAction` / `deleteFilterAction` over `saved_filters` and a wider criteria map. The prototype has no saved views control; the app added it. |
| Minimum views filter | BUILT | Not in the prototype; the app added it. Honoured at feed.ts:90. |
| Fleet filter | BUILT | Not in the prototype; the app added it. Honoured at feed.ts:100. |

### Card and row fields

| Element | Status | What it would need |
|---|---|---|
| Thumbnail, 9:16, grayscale treatment | BUILT | `videos.thumbnail_asset_id` through `/api/media/[assetId]`. |
| Hook line overlaid on the thumbnail | PARTIAL | The app overlays `videos.caption`. The prototype overlays a separate short `hook` string, one line, which is a different field from the caption. The nearest real column is `video_analyses.hook_type`, which is a type label not a verbatim hook. A verbatim hook would need a new column on `video_analyses` or reuse of the analysis payload. |
| Duration stamp | BUILT | `videos.duration_sec`. |
| Score, hero number, tier coloured | BUILT | `videos.outlier_score` and `heat.ts`. |
| "n views" | BUILT | |
| Engagement rate on the card, "4.1% eng" | PARTIAL | The app computes likes plus comments over views, but only in `metric-chips.tsx:18` on the detail page and the quick preview, not on the feed card. The card shows follower count instead. |
| Handle and age | BUILT | |
| "Removed from Instagram" label on a gone post | MISSING on the card | `videos.deleted_at` exists and the detail page renders an alert for it, but the feed unconditionally filters deleted posts out (`isNull(videos.deletedAt)`, feed.ts:85) so the state can never be seen in the feed. |
| "not for me" dismiss on hover | MISSING | No dismiss anywhere. Would need a `dismissed_videos` table or a column on `videos`, plus an action and a where clause. The prototype pairs it with an undo toast. |
| List view columns: score, post, channel, views, posted | BUILT | `feed-list-row.tsx`. |
| Empty state, no posts at all | BUILT | page.tsx:77. |
| Empty state, filter slice empty, with a hint and a clear button | BUILT | page.tsx:96. |
| Loading skeleton grid | PARTIAL | 8 skeletons against a page size of 24, and the follower band row is not skeletoned. |
| Pagination | PARTIAL | "Load more" bumps `limit` while `offset` stays hardcoded at 0 (page.tsx:49), so each click refetches an ever growing single page. |
| Bookmark icon on the card | **FABRICATED** | `outlier-card.tsx:152` renders a bookmark button whose tooltip reads "Save to Vault" but which is a plain `Link` to the video page. It saves nothing. Saving requires an analysis first (`video-detail.tsx:448`), so from the feed there is no save path at all. |
| Quick preview sheet | PARTIAL, contains one **FABRICATED** line | Real data through `getVideoPreviewAction`. But `quick-preview-sheet.tsx:107` prints "No transcript yet - transcription arrives with the phase-2A sync engine". Transcription is live today. The detail page's equivalent string says the opposite. |

Size: the feed is the closest screen to done. Roughly 70 percent built. Its
problems are concentrated: one fabricated control (platform), one fabricated
button (bookmark), one fabricated capability (saved views), two filters whose
displayed value does not match the query that ran, and no text search.

## Post detail

Prototype `detail.html`. App `src/app/(shell)/feed/[videoId]/page.tsx` and
`src/components/video/`.

| Element | Status | What it would need |
|---|---|---|
| "Back to Feed" | BUILT | |
| Post index label, "prev" and "next" buttons, and left/right keys | MISSING | There is no sibling ordering on the detail page. Would need the feed's filter state carried in the URL and a neighbour query, or a cached ordered id list. |
| Media well, 9:16, play affordance, duration | BUILT | Branches on `videos.media_type` into carousel, video player or static image. |
| "Removed from Instagram" banner | BUILT | `videos.deleted_at`, video-detail.tsx:268. |
| Score at 52px | BUILT | |
| "above {handle}'s own median" line | PARTIAL | The line renders. The median value itself is never fetched or shown on this page. `computeChannelMedian` exists (outlier-calc.ts:11) and `channel_snapshots.median_views` is stored, so the number is available; the page just does not ask for it. |
| Score bar with 0.2x to 12x scale and a 1.0x tick labelled with the median | MISSING | Same data as above plus layout. |
| "WHAT THAT MEDIAN IS MADE OF": sparkline of the posts behind the median, with clipped-bar markers, scale line, self line, span line and a confidence label | MISSING | This is the brief's "every own-channel figure carries its sample size" requirement made visible. The inputs exist: the channel's recent `videos.view_count` set, and `outlier-calc.ts` already computes the window. No query returns the sample, and nothing anywhere renders a sample size on a score. |
| Median confidence label | MISSING | `MIN_USABLE = 5` and `window = 20` exist in outlier-calc.ts. The channel detail page renders a progress bar toward 5 usable posts. The post detail page renders no confidence at all. |
| Metric row: views, duration, age, followers | BUILT | |
| Caption | BUILT | |
| Tabs: Transcript / Hook and structure / Why it worked | BUILT | `transcripts`, `video_analyses`. |
| Analysis gate with a single "analyse" button | BUILT | `analyzeVideoAction`, with honest alerts when no transcribe provider or no Claude key is configured. |
| Copy transcript | BUILT | |
| Transcript meta line | BUILT | `transcripts.source`. |
| Hook summary plus verbatim hook line in quotes | PARTIAL | `video_analyses.hook_type` gives the summary. There is no verbatim hook column, so the quoted line has no source. Would need a column on `video_analyses`. |
| Tag row with an "unverified" flag on tags the model guessed without frames | PARTIAL | `format_tags` and `style_tags` render. There is no verified/unverified distinction because there is no frame pass. |
| BEATS list with timecodes, name, description and a proportional bar | BUILT | `video_analyses.structure_segments`, bar width from real `span / durationSec` (video-detail.tsx:154). |
| LAYOUT block: on-screen text, text position, cut rhythm, framing | MISSING | Four fields with no column and no producer. |
| "Run frame pass" button | MISSING | No frame sampling exists anywhere in `src/server/`. Would need a frames service (ffmpeg sampling), a vision call, and columns on `video_analyses` for the four layout fields. This is what the prototype's `note` field ("Layout fields came from a frame pass on 14 sampled frames") is describing. |
| "Remix this" | BUILT | |
| "Save to vault" | PARTIAL | Works, but only after an analysis exists; otherwise disabled with a tooltip. The prototype allows saving any post. Note the app's vault stores hook and style templates, not the post itself. See the Vault section. |
| "Copy as prompt" | BUILT | `buildVideoPromptAction`. |
| Similar videos | BUILT | `similar.ts`, tag overlap scoring over `video_analyses`. Not in the prototype; the app added it. Honest empty state. |
| Download video | BUILT | `downloadVideoAction`, spinner with no fake progress. |
| Carousel prev/next with position | BUILT | `video_children`. |

Size: detail is roughly 65 percent built. The gap is concentrated in one place:
everything that explains the median (bar, sample sparkline, confidence, sample
size) and everything that comes from a frame pass (layout block, verbatim hook,
verified tags).

## Remix

Prototype `remix.html`. App `src/app/(shell)/feed/[videoId]/remix/page.tsx` and
`src/components/remix/`. The five stage model matches: prompt, research, hook,
style, script.

| Element | Status | What it would need |
|---|---|---|
| H1 "Remix" plus a run identifier line | PARTIAL | Title comes from the top bar as "Remix Studio". No run label. `remix_sessions.id` exists and could supply one. |
| Reference line: score plus caption | BUILT | |
| Run meta strip: STAGE n of 5, REFERENCES, TARGET, TOKENS, WRITTEN TO | PARTIAL | Stage and target are real. REFERENCES ("3 from vault") has no equivalent: the app's research stage pulls similar outliers, not vault picks. TOKENS is not tracked anywhere: no token counter on any LLM call. WRITTEN TO is not applicable, nothing writes run files. Token accounting would need a new column or table. |
| Stage chips with done / active / blocked / waiting states | BUILT | `stepper.tsx`, back navigation gated at the furthest stage reached. |
| Local model down block with "Start local model" | PARTIAL | The app checks for an Anthropic key and shows an alert when it is absent (`stage-prompt.tsx:120`). It is a cloud key, not a local proxy, and there is no "start it" action. |
| Stage list rows with number, text, and a per row action label | BUILT | Each stage renders its own list. |
| Per row compare toggle and side by side compare panel with "use this one" | MISSING | No compare anywhere. Pure client state over the option arrays that already exist (`hook_options`, `variants`). |
| Advance button and Restart | PARTIAL | Continue and Back exist. There is no Restart. `getOrCreateSession` always reuses the newest session for a video (`remix.ts:149`), so there is no way to start a fresh run. Would need a `resetSessionAction` or a "new run" insert. |
| RUN LOG: timestamped entries with state and elapsed | MISSING | Nothing records per stage timing or outcome. Would need a `remix_events` table, or JSON on `remix_sessions`. |
| Reference panel: thumbnail | BUILT | |
| Reference panel stats: SCORE, CHANNEL, VIEWS, MEDIAN, LENGTH | PARTIAL | Score, channel, views and length are available. MEDIAN is not fetched on this page, same gap as the detail screen. |
| Reference panel "why it worked" line | BUILT | `video_analyses.why_it_worked`. |
| Empty state "No reference to remix" | PARTIAL | The route is always entered from a video, so the state cannot occur. There is no standing Remix route that could show it. |
| Stage 1 topic input, niche display, target length | BUILT | Writes `topic` and `target_length_sec`. |
| Quick Remix (runs all stages) | BUILT | `quickRemixAction`. Not in the prototype; the app added it. |
| Stage 2 research: source analysis, transcript excerpt, editable facts, similar outliers | BUILT | Writes `research_notes`. Note it makes zero LLM calls; it assembles what is already stored. |
| Stage 3 hooks: generate five, pick one, seed from a vault hook, save one as a template | PARTIAL, one **FABRICATED** aspect | Generation, picking and save-as-template all work. But hook text edits are never persisted: `stage-hook.tsx:152` updates local state only and never calls `updateStageAction`, so an edited hook is silently lost on reload unless "Use this hook" is pressed. The textarea presents itself as editable and is not. |
| Stage 4 style: structure select, generate outline, editable beats | BUILT | Writes `style_vault_item_id` and `outline`. |
| Stage 5 script: variant tabs, per variant regenerate and retry, copy, save script, create prompt | BUILT | Writes `variants`; `saveScript` inserts into `scripts`. |
| Progress messages while variants generate | **FABRICATED** | `stage-script.tsx:31` cycles a fixed list of five strings ("Researching pacing", "Writing variant 1", "Writing variant 2", "Writing variant 3", "Polishing") on a 1200ms timer. `generateVariants` is one atomic `Promise.allSettled` with no incremental signal, so the line has no relationship to what is happening. It also hardcodes three variants regardless of the requested count. The code comment says so plainly. This is a progress indicator that reports state the app does not have. |
| `remix_sessions.niche` | Dead column | Typed in `StagePatch` and read into the session row, written by nothing. Generation reads `app_settings.niche_profile` instead. |
| `scripts.hook_vault_item_id` | Dead link | Always null from the remix path (`remix.ts:364`), so the vault script card's hook badge can never appear. |

Size: remix is roughly 75 percent built and is the most complete screen in the
app. Its gaps are compare, run log, restart, token accounting, and one fake
progress line.

## Channels

Prototype `channels.html`. App `src/app/(shell)/channels/page.tsx` and
`src/components/channels/`.

| Element | Status | What it would need |
|---|---|---|
| H1 "Channels" plus a summary line | BUILT | "N channels tracked, N never synced". |
| "Add channel" primary button and dialog | BUILT | `addChannelAction`. The dialog also has a paste-a-reel-URL tab (`importReelAction`) that the prototype does not have. |
| Add dialog: handle field, required | BUILT | |
| Add dialog: size band picker, optional | MISSING | Band is derived from `channels.follower_count` after the first sync, never set by hand. There is no column to hold a manual band. Would need one, or the control drops. |
| Add dialog: backfill depth picker, optional | MISSING | The app has one global `LOOKBACK_DAYS` env value. A per channel first sync depth would need a column on `channels` and a parameter through `startSyncAction` into the engine. |
| Add dialog: error line | BUILT | |
| Add dialog: "No median until the first sync" note | MISSING | Copy only. |
| Column CHANNEL: handle, health line, band label | BUILT | Health derived from `last_synced_at` and `sync_error`. |
| Health states: ok / partial / stale / never / own | PARTIAL | The app has failed, never synced, stale and synced. There is no "partial" health state on a channel row, although `sync_jobs.status` can be `partial`. There is no "own" state at all. |
| Thin-history note under a channel with too few posts | MISSING | The channel detail page has a progress bar toward 5 usable posts. The list row has no equivalent. Data is available. |
| Column FOLLOWERS | BUILT | |
| Column POSTS, shown as "posts, median" | PARTIAL | The app has separate "Median views" and "Outliers (30d)" columns instead. Post count is not a column on the list, only on the detail page. |
| Column LAST 8 RUNS: eight bars, tall for complete, short for partial, red for failed | MISSING | Every input exists in `sync_jobs` (`status`, `items_failed`, `stop_reason`, per channel, ordered by `started_at`). No query returns the last N runs per channel. This is a straightforward query plus a small component. |
| Per row Sync button | BUILT | Behind the three dot menu rather than a hover action. |
| Per row Unwatch with undo toast | **FABRICATED** | Two places offer it and neither works. `channel-table.tsx:203` shows "Untrack" and fires `toast.info("Untrack arrives in a later phase")`. `channel-header.tsx:153` renders a permanently disabled "Untrack" button. There is no delete or untrack action for a channel anywhere in `src/server/actions/`. A visible control that announces its own absence is still a visible control that does nothing. Would need a `removeChannelAction` and a decision on cascade (the schema cascades videos on channel delete). |
| Hatch treatment on a never synced row | PARTIAL | A warning icon and tooltip instead. |
| Fleet rail | BUILT | Not in the prototype; the app added it. `createFleetAction`, `setChannelFleetsAction`. |
| Search, sort, bulk select | MISSING | No search, no sort, no checkboxes. The channel list has no ORDER BY at all (`channels.ts:107`), so row order is whatever SQLite returns. The prototype does not have these either, but the unordered list is worth naming. |

Size: channels is roughly 70 percent built. The two real gaps are the eight-run
sparkline and a working untrack.

## Channel detail

Not a separate prototype screen. The app has one and it borrows heavily from the
prototype's `mine.html`, which is a different screen for a different channel.
Listed here so the borrowing is on the record.

| Element | Status | Note |
|---|---|---|
| Header: avatar, handle, platform, last synced, followers, post count, profile link | BUILT | Profile URL is string built from the handle; there is no stored URL column. |
| Sync now, scoped to this channel | BUILT | |
| Cancel a running channel sync | BUILT | |
| Untrack | **FABRICATED** | Permanently disabled button. Same finding as above. |
| Gap alert with retry | BUILT | `sync_jobs.gaps`. |
| Stat tiles: median views, best score, outliers 30d, posts tracked, each with sample size | BUILT | This is the one place in the app that honours the brief's "every own-channel figure carries its sample size" rule. |
| Score gate progress bar toward 5 usable posts | BUILT | Duplicates `MIN_USABLE = 5` and the window of 20 as display-only constants. |
| "Views by post" bars, last 8 | BUILT | Borrowed from `mine.html`'s reach bars, plotting `videos.view_count`. |
| Outlier history chart | BUILT | Hand rolled SVG. Hardcodes six hex colours (`outlier-history-chart.tsx:17`) while the rest of the app uses CSS variables. |
| Post calendar: month grid, posts list, metrics by weekday | PARTIAL | Borrowed from `mine.html`. The prototype's scheduled and missed cell states were deliberately dropped because scheduling does not exist, which is the correct call and is documented at `channel-post-calendar.tsx:10`. |
| Tabs: Recent Reels, Outliers Only, In Vault | BUILT | |

## My channel

Prototype `mine.html`. This screen does not exist. There is no `/mine` route, no
nav entry, and no way to mark a channel as the user's own. `channels` has no
`is_own` column and no equivalent. The only hits for the concept across `src/`
are prose comments pointing at the prototype file.

Every metric on this screen is an Instagram Insights metric, and nothing in the
schema holds one.

| Element | Status | What it would need |
|---|---|---|
| Header: own handle, "Graph API, synced Nh ago, N followers, N posts" | MISSING | A Graph API client (does not exist), a token store, and an `is_own` flag on `channels`. |
| Six hero stats: median reach, followers, posts published, total reach all time, best post, score with a "needs 30 posts" dash | MISSING | Reach is Insights. Followers and post count exist. The dash-until-30-posts behaviour is the sample size rule and has no home. |
| Progress bar "8 / 30 before a score appears" | MISSING | The app's equivalent on channel detail uses 5, not 30, and views, not reach. |
| "REACH BY POST" bars across all posts | MISSING as reach | The channel detail page has the same chart over view counts, mislabelled "Views by post". Reach itself needs Insights. |
| "LENGTH VS REACH" scatter | MISSING | `videos.duration_sec` exists; reach does not. |
| Calendar: month / agenda / rhythm views | PARTIAL | The three-view calendar exists on channel detail (month / posts / metrics) over view counts. |
| Calendar cell states: published, scheduled, slot missed, dead air, open | PARTIAL | Only published, open and dead air exist. Scheduled and missed require a scheduling table that does not exist. |
| Week column: reach total, post count, bar | PARTIAL | Exists over views. |
| Pipeline strip: saved in vault, remix in progress, cuts waiting on a date, scheduled ahead, published this month | MISSING | Two of five are computable today (`vault_items` count, `remix_sessions` at a non-final stage). The other three need a scheduling model: a table with a post, a date and a state. |
| Day selection panel with per day rows and actions (move, unschedule, reschedule, drop, schedule a cut here, copy the title) | MISSING | All of it is scheduling. Needs a `scheduled_posts` table (video or script id, target date, state) plus create, move and delete actions. |
| Post list: post, bar, reach, length, published | PARTIAL | Exists on channel detail over views. |

Size: my channel is around 90 percent missing, and the missing part splits in
two. Roughly half depends on Instagram Insights through the Graph API, which is
the brief's single biggest hole. The other half depends on a scheduling model
that does not exist in any form: no table, no action, no sidecar endpoint. The
sidecar has no write path to Instagram at all, so even a built scheduler could
only ever be a private calendar, not a publisher.

## Vault

Prototype `vault.html`. App `src/app/(shell)/vault/page.tsx`.

The prototype's Vault and the app's Vault are different things. The prototype
Vault is a list of **saved posts**: thumbnail, caption, handle, views, duration,
median, score, a "why kept" reason and remix and remove actions. The app's Vault
is a library of **extracted templates**: hooks, styles and scripts.

| Element | Status | What it would need |
|---|---|---|
| H1 "Vault" plus a summary line | PARTIAL | Title from the top bar, no summary line. |
| Sort control: recently saved / highest score / analysed first / why it was kept | MISSING | Both queries are hardcoded to `desc(createdAt)` with no sort parameter. |
| Table of saved posts: thumbnail, caption, handle, views, duration, "vs median", score, why kept, age | MISSING | There is no "saved post" concept. `vault_items.source_video_id` is a nullable back reference on a template, not a saved post row. Saving a post as a post would need either a new table or a third `vault_items.type`. Nothing stores a "why kept" reason. |
| Per row remix action | PARTIAL | `template-card.tsx:63` offers "Use in Remix". |
| Per row remove with undo | PARTIAL | Delete exists behind a confirm dialog. No undo. |
| Empty state with two calls to action | BUILT | |
| Hooks tab | BUILT | Not in the prototype. |
| Styles tab | BUILT | Not in the prototype. |
| Scripts tab | BUILT | Not in the prototype. |
| Create a template by hand | BUILT | `createVaultItemAction`. |
| Create a template from an analysis | BUILT | `save-to-vault-dialog.tsx`. |
| Edit a template | MISSING | `vault-actions.ts` exports only create and delete. Titles, text and tags cannot be changed after creation. |
| Tag filter or tag editing | MISSING | Tags render as read-only badges. |
| Search | MISSING | No search input and no query parameter. |
| Copy template text | MISSING | The script card has a "Create Prompt" copy; the template card has no copy at all. |
| Script status draft to final | MISSING | `scripts.status` renders as a read-only badge. Nothing ever writes "final". |
| Delete or rename a script | MISSING | No action exists. |
| "Use in Remix" on a manually created template | **FABRICATED** | `template-card.tsx:65` shows `toast.info("Press Cmd K and pick a video to remix, this template will be waiting in that stage.")`. The command palette lists five nav routes and cannot search or pick a video. The instruction cannot be followed. Would need video search in the palette, or a video picker dialog. |

Size: vault is roughly 50 percent built against the prototype, and the half that
exists answers a different question than the prototype asks. Whether the
prototype's saved-posts table or the app's template library is the right model is
a product decision, not a gap, but they are not the same feature and the app
currently has no way to save a post as a post.

## Settings

Prototype `settings.html` plus `settingsPages` at line 2165 of the original. The
prototype has seven tabs holding 40 rows, most of them editable segmented
controls. The app has five flat sections with exactly two writable fields.

| Prototype tab | Row | Status | What it would need |
|---|---|---|---|
| Connections | Burner session, read from a session file, with validity | PARTIAL | The Instagram section shows real sidecar state (connected, challenge, two factor, cooldown) and offers connect, disconnect and re-check. Vocabulary differs. |
| Connections | Graph token, scopes, expiry | MISSING | No Graph API anywhere. |
| Connections | Local service auto or manual start | MISSING | The sidecar URL is displayed; there is no start policy setting and no way to start it from the app. |
| Connections | Rate limit policy | PARTIAL | A cooldown is displayed when one is active. The policy itself is not configurable. |
| Sync | Cadence: manual / 6h / daily | MISSING | `SYNC_INTERVAL_MINUTES` is parsed and read by nothing but the display, which honestly says "no scheduler exists". Would need a scheduler. |
| Sync | Lookback window | PARTIAL | `LOOKBACK_DAYS` displayed, not editable in the app. Requires an `.env.local` edit and a restart. |
| Sync | First sync depth | MISSING | No per channel depth. |
| Sync | Batch size | MISSING | No such config. |
| Sync | Concurrency | MISSING | No such config. |
| Sync | Stagger | MISSING | No such config. |
| Sync | Last full pass | PARTIAL | A last job summary with seven counters and a stop reason is rendered, which is richer than the prototype's line. "Last pass with no failures across every tracked channel" is not computed. |
| Outlier scoring | Baseline: median / mean / trimmed mean | MISSING | `computeChannelMedian` is fixed to a median. Would need a settings key and a branch in `outlier-calc.ts`. |
| Outlier scoring | Baseline window: last 12 posts / last 30 days / all | MISSING | Hardcoded `window = 20` in `outlier-calc.ts:11`. |
| Outlier scoring | Minimum posts before a score | MISSING | Hardcoded `MIN_USABLE = 5`, duplicated as a display constant in the channel page. |
| Outlier scoring | Feed threshold the feed opens at | PARTIAL | The seeded Balanced saved filter does this implicitly, which is exactly why the feed's score control shows a value that does not match the query. Not a setting. |
| Outlier scoring | Default follower band | MISSING | |
| Outlier scoring | Views floor | MISSING | No floor exists; a 12-view post can score. |
| Outlier scoring | Missing baseline renders a dash | BUILT | `formatMultiplier` returns a dash for null. Not configurable, and should not be. |
| Analysis | Transcription engine and readiness | BUILT | `whisperAvailability()` and the local binaries section. |
| Analysis | Reasoning model and readiness | PARTIAL | The Anthropic key card has a live test button. It is a cloud key, not a local model on 11434 as the prototype says. |
| Analysis | Frame pass: off / ask / always | MISSING | No frame pass exists. |
| Analysis | Frames sampled per video | MISSING | Same. |
| Analysis | Auto analyse at a score threshold | MISSING | Analysis is manual only, one video at a time. |
| Analysis | Re-run policy | MISSING | |
| Analysis | Unverified tags shown greyed | MISSING | No verified / unverified distinction. |
| Storage | Database path and size | PARTIAL | `CROWSNEST_DB_PATH` exists in config, not displayed. |
| Storage | Media path and size | PARTIAL | `MEDIA_ROOT` displayed. Size is not computed. |
| Storage | Keep media for N days | **Half fabricated, honestly labelled** | `MEDIA_RETENTION_DAYS` is a real, range-checked config value that nothing reads. The Settings row overrides it with the string "nothing is deleted" and flags it as a warning, which is the right handling. The config key itself is the dead part. |
| Storage | On disk pressure policy | MISSING | |
| Storage | Transcripts and analyses kept forever, with counts | MISSING | Counts are two `count(*)` queries. |
| Storage | Export everything as JSON plus a media manifest | MISSING | The app's only export is a Markdown prompt string copied to the clipboard. There is no file download route, no `Content-Disposition`, no JSON or CSV, no manifest. |
| Interface | Theme light / dark | MISSING by design | The brief locks dark only. `<html className="dark">` is hardcoded. Note `ui/sonner.tsx` still reads `useTheme()`, which is dead code. |
| Interface | Feed density | MISSING | See Feed. |
| Interface | Getting started checklist show / hide | MISSING | No checklist. |
| Interface | Feed layout default | MISSING | The control exists on the feed but no default is persisted. |
| Interface | Default sort | MISSING | Same. |
| Interface | Sidebar expanded or collapsed default | MISSING | The toggle exists, the state is not persisted. |
| Interface | Shortcuts reference line | MISSING | Only Cmd K exists to list. |
| Interface | Motion setting | MISSING | |
| Danger zone | Discard all analyses | MISSING | Would need a delete over `video_analyses`. |
| Danger zone | Purge media | MISSING | Would need a delete over `media_assets` plus the files under `MEDIA_ROOT`. |
| Danger zone | Reset database | MISSING | |
| Danger zone | Forget session | PARTIAL | The Instagram section has Disconnect. |
| Danger zone | Sign out | Not applicable | No auth. |
| (app only) | Niche profile description | BUILT | `app_settings.niche_profile`, read by remix and export. |
| (app only) | Niche keywords | **FABRICATED** | Written to `app_settings.niche_keywords` and read back only to repopulate its own input. No consumer anywhere in `src/`. A field that presents itself as configuration and changes nothing. |
| (app only) | Groq key card, "Verified on first transcribe" | PARTIAL | Presence only. Nothing ever records a verification, so the hint describes a check that never writes a result. |

Size: settings is roughly 25 percent built against the prototype, counted by row.
Of the prototype's 40 rows, 22 are editable segmented controls; the app has two
writable fields in total. The important structural difference: every one of the
app's sync, storage and media values lives in `.env.local` and needs a server
restart, while the prototype presents all of them as in-app controls.

## Sync

Not a prototype screen of its own. The prototype shows sync as a rail button, an
in-page progress strip, and the failure strip. Recorded here because the app's
sync layer is substantially more capable than the prototype's, and that is worth
knowing before anything is redesigned.

BUILT and real: seven engine phases, live progress flushed at every page and
channel boundary, a determinate bar on channels done over channels total, an
honest indeterminate state while the channel list is still resolving, six
counters, elapsed time, retry count, error code, per channel gap list with
retry, stall detection at 90 seconds, cooperative cancel backed by a real
`cancel_requested` column, per channel and library-wide runs, a partial unique
index that makes the single-flight lock a database guarantee, and poll errors
rendered alongside the last good numbers rather than replacing them.

MISSING: any scheduler. `SYNC_INTERVAL_MINUTES` is parsed, range checked and
read by nothing but the Settings display, which says so. Two stale comments
(`sync-progress-view.ts:328`, `use-sync-progress.ts:6`) still refer to "the
scheduler".

MISSING: the prototype's per channel "last 8 runs" bars, and its five-state
global failure strip.

## The fabricated list

Every item here is the app promising something no backend supports. Per the V1
brief these outrank missing features.

1. **Feed platform chips, TikTok and YT Shorts.** `filter-bar.tsx:23`. Sync can
   only ever write `platform: "instagram"`. Selecting either issues a query that
   returns zero rows. The Add Channel dialog already deleted its own copy of this
   control for the same reason.
2. **Feed card bookmark button.** `outlier-card.tsx:152`. Tooltip says "Save to
   Vault"; the button is a link to the video page and saves nothing. There is no
   save path from the feed at all, because saving requires an analysis.
3. **"Saved views" dropdown.** `filter-bar.tsx:203`. Reads `saved_filters`, which
   only ever contains the two rows `bootstrap.ts` seeds. No create, update,
   rename or delete path exists anywhere in `src/`. A user can never save a view.
4. **Untrack a channel.** Two rows, one defect. `channel-table.tsx:203` fires a
   toast saying the feature arrives later; `channel-header.tsx:153` renders a
   permanently disabled button. No remove-channel action exists.
5. **Remix hook textareas.** `stage-hook.tsx:152`. The five generated hooks render
   in editable textareas whose edits are never sent to the server. The text is
   lost on reload unless "Use this hook" is pressed. An editable field that does
   not save is the same class of lie as a control that does nothing.
6. **Script generation progress messages.** `stage-script.tsx:31`. Five hardcoded
   strings cycled on a 1200ms timer against one atomic call with no incremental
   signal. It reports "Writing variant 2" while nothing of the kind is knowable,
   and hardcodes three variants regardless of the count requested.
7. **"Use in Remix" on a manually created template.** `template-card.tsx:65` tells
   the user to press Cmd K and pick a video. The command palette lists five nav
   routes and cannot search videos. The instruction is impossible to follow.
8. **Niche keywords field.** `niche-profile-section.tsx:57`. Persisted to
   `app_settings.niche_keywords` and read back only to repopulate its own input.
   No consumer exists. It presents as configuration and configures nothing.

One stale string that is not an offered capability but is still false:
`quick-preview-sheet.tsx:107` says transcription "arrives with the phase-2A sync
engine". Transcription is live, and the detail page says the opposite.

Two near misses handled correctly, named here so they are not re-opened as bugs:
the Settings sync section overrides `MEDIA_RETENTION_DAYS` and
`SYNC_INTERVAL_MINUTES` with the true strings "nothing is deleted" and "manual
only" and flags both as warnings, rather than printing the dead config values.
That is the right pattern to copy.

## Counts

Counted from the status cells in the tables above.

| Status | Rows |
|---|---|
| BUILT | 85 |
| PARTIAL | 54 |
| MISSING | 100 |
| FABRICATED | 10 |

Three of the 54 PARTIAL rows also carry a fabricated element (saved views, quick
preview, remix hooks), which is why the fabricated row count is 10 while the
distinct defect list above has 8 entries: the untrack defect occupies two rows.

Per screen, share of prototype elements that are absent or incomplete:

| Screen | Roughly missing |
|---|---|
| Onboarding, six screens | 100 percent |
| My channel | 90 percent |
| Settings | 75 percent |
| Dashboard | 70 percent |
| Vault | 50 percent, and a different model |
| Shell and overlays | 45 percent |
| Post detail | 35 percent |
| Channels | 30 percent |
| Feed | 30 percent |
| Remix | 25 percent |

## The five biggest holes

1. **Instagram Insights.** Reach, saves, shares, profile visits, follows, watch
   time and retention have no column, no query, no client. There is no Graph API
   integration at all, only the instagrapi burner sidecar, and that sidecar has
   no insights endpoint. This is the whole of the My channel screen and it recurs
   on the dashboard.
2. **The own-channel concept.** There is no `/mine` route, no nav entry, and no
   `is_own` flag on `channels`. Nothing in the app knows which channel is Kai's.
   Every own-channel figure the brief asks for depends on this existing first.
3. **Scheduling.** No table, no action, no state, no sidecar write path. Half the
   My channel screen (calendar cell states, pipeline strip, day actions) is
   scheduling. Even fully built it could only ever be a private calendar, because
   Instagram publishing is not reachable from here.
4. **Everything that explains a score.** The median bar, the sample sparkline,
   the confidence label and the sample size are missing from the post detail
   page, which is the one screen whose job is to explain a score. The channel
   detail page is the only place in the app that carries a sample size at all,
   and the brief says every own-channel figure must.
5. **Settings is 25 percent built and env-locked.** Baseline choice, baseline
   window, minimum posts, views floor, sync cadence, batch size, concurrency,
   retention policy, frame pass and every danger-zone action are absent. Of what
   does exist, only two fields are writable from the app; the rest requires
   editing `.env.local` and restarting the server.

A sixth worth naming because it is cheap: the feed has no text search, and the
command palette cannot search posts either. `getOutlierFeed` takes no query
param and `feed.ts` has no `like` clause. For a research tool that is a
conspicuous hole, and it is one where clause and one input.

