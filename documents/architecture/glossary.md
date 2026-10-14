# Glossary

The vocabulary used across the docs and the UI. When a doc uses one of these words it means exactly this. Do not coin a synonym for a term defined here. "Avoid" lists the words not to use for the same thing.

## The surface

**Core loop.** The path from an outlier in the feed, through a remix into a script, into a planned post, then publish.

**Shell.** The persistent frame around every core page: sidebar, topbar, command menu, failure strip. Rendered by the `(shell)` layout, which redirects to first run until setup is done and re-reads its counts on navigation.

**Feed.** The outlier page at `/feed`: a grid or list of videos from tracked channels, filtered and ordered.

**Filter bar.** The controls on the feed that build the feed query: follower band, saved views, search, add video. Its state lives in the URL.

**Remix studio.** The page at `/feed/{id}/remix` where a source video becomes a script through the six stages. "The studio" where unambiguous.

**Command menu.** The keyboard menu in the shell for jumping between pages and actions.

## Accounts and identity

**Tracked channel.** A channel the user does not own, read through the sidecar. Public numbers only. Avoid: competitor, watched channel.

**Owned channel (own channel).** The one channel marked `isOwn`. Measured through the Graph API with the user's own token, and the only kind with insights. Avoid: my account, connected account.

**Burner.** The throwaway Instagram account whose credentials drive the sidecar. It never touches the owned channel. Avoid: scraper account, bot account.

**Fleet.** A named group of channels used to scope the feed to a niche or cohort. Avoid: watchlist, folder.

**Instagram account.** An identity the sidecar can log in as (`ig_accounts`). Exactly one is the default; a channel is pinned to one, or to the default when unset. See [data](data.md).

## The objects

**Video.** One top-level post scraped from a tracked channel. The table is `videos`, but a video can be a photo, a video or a carousel (`mediaType`). Written by sync, never by the user. Avoid: reel, media, item.

**Planned post.** A dated intention to publish on the user's own channel, optionally carrying a script and an mp4. States are draft, scheduled, publishing, published and failed; missed is derived on read. Not an own post.

**Own post.** A post published on the owned channel and measured through the Graph API (`ownPosts`). Read only; the metrics tabs show these.

**Script.** The text a remix produces, saved as a `scripts` row. Saving copies the chosen variant's text and does not stay linked to it. Avoid: draft, copy.

**Vault item.** A reusable hook or style snippet the remix draws on (`vaultItems`). Avoid: template, swipe file.

**Saved post.** A video the user kept for later (`savedPosts`, one per video, with an optional note). Its score and stats are always read live off the video. Distinct from a vault item. Avoid: bookmark, favorite.

**Content artifact.** Agent-authored output persisted through MCP (`contentArtifacts`): angles, an outlier library, an idea bank, a monthly plan or a brief, with provenance.

**Idea.** A short concept with an angle, in the ideas inbox, one active per source video (`idea`).

**Persona.** The single settings row of audience, voice and do and don't lists that grounds idea and script generation.

## Study and reuse

**Transcript.** The spoken words of a video, produced locally or by a provider. Avoid: captions, subtitles.

**Analysis.** The stored breakdown of one video: hook type, story beats, format and style tags, why it likely beat the baseline, and optionally a layout. Written by the external agent through MCP. Avoid: breakdown, report.

**Hook.** The opening move of a video, the part that stops the scroll. Avoid: intro, opener.

**Layout.** What a video looks like rather than what it says: on-screen text, cut rhythm, framing. Read from frames, never from the transcript. Written by the frame pass.

**Frame pass.** The job that samples frames of one video and has a read-only local Claude Code subprocess describe the layout.

**Remix.** Turning a studied video into a script for the user's niche, in stages.

**Niche.** The user's content niche, a setting fed into every generation prompt and shown as a read-only chip on the prompt stage.

**Facts box.** The one editable field on the research stage, where the user adds their own angle or stats. Autosaves on blur.

**Recently viewed.** The last videos opened, kept in app settings, most recent first, capped at 8. Feeds the dashboard.

**Similar outliers.** Tracked videos related to a source video by tag overlap, capped at five.

## Remix session and its parts

**Remix session.** The working state that turns one source video into a script (`remixSessions`). One per video, get or create. Disposable in intent; its durable outputs are a script and a planned post.

**Stage.** One of the six steps of a session, in order: prompt, research, hook, style, script, finish. The `stage` column records the furthest reached.

**Variant.** One candidate script from the script stage, three by default against three fixed angles. The user picks one before saving.

**Remix run.** One generation attempt in a session (hooks, outline or variants), logged append-only to `remixRuns` on success and failure.

**Run log.** The list on the remix page of every remix run, newest first, each with a tone: Success, Partial or Failed.

**Quick Remix.** The end-to-end shortcut action that runs a remix without stepping through the stages (`quickRemixAction`).

**Deep link.** A URL that carries an action or a seed into a page, for example the remix page opened at a stage.

## State words

**Draft.** A planned post with no date, or unsaved working state.

**Scheduled.** A planned post with a date and time the scheduler will publish at.

**Missed.** A scheduled planned post whose date passed without being published. Derived on read, not stored.

**Published.** A planned post that went out (by the scheduler or marked by hand), or an own post that exists on the channel.

**Analyzed.** A video with a `videoAnalyses` row. Otherwise it is unanalyzed.

**Saved.** A video with a `savedPosts` row.

## Metrics and scoring

**Outlier score.** How far a video outperforms its own channel's baseline, shown as a multiplier (for example 38.0x). Computed by the scoring service and stored on the video. Avoid: virality score, performance ratio.

**Outlier.** A video whose score clears the threshold being applied. Not a fixed number. Avoid: viral video, banger.

**Median baseline.** The channel's own median performance that a score is measured against. Settings choose the method (median, mean, trimmed mean) and window. Fewer than `scoreMinUsablePosts` usable posts yields no score. Avoid: average, benchmark.

**Follower band.** The size bracket of a channel by followers, used to filter the feed: nano (0 to 10k), mid (100k to 1M), macro (1M and up).

**Engagement rate.** Likes plus comments over views for a video. Null when views are null or zero.

**Reach.** The measured reach of an own post from the Graph API. Missing reach renders as a dash, never zero.

**Insight.** A metric that exists only for the owned channel: reach, saves, shares, profile visits, follows, watch time. Avoid: analytics.

## Sync and background work

**Sidecar.** The local Python service (`services/ig`) that logs in to Instagram and fetches posts. Reached over loopback with a shared token.

**Sync.** One run that pulls a tracked channel's profile and recent posts, downloads their images, and recomputes outlier scores. Avoid: scrape, refresh, pull.

**Lookback.** How far back in time a sync reaches. Avoid: window, history depth.

**Cooldown.** The account-wide pause after Instagram signals it has had enough. It applies to the burner connection, not to one channel. Avoid: rate limit, throttle.

**Run.** One execution of a background operation with a status of running, success, partial, failed or canceled. A sync and a remix attempt both appear on the Runs screens.

**Heartbeat.** The periodic signal a running job writes to prove it is alive. A run silent past the stall threshold is treated as stuck and reaped.

**SLA budget.** The wall-clock time a run type may take before it counts as too slow (`syncSlaMinutes`). A breach never cancels the run.

**Notification.** A stored alert raised when a run fails, finishes or breaches its SLA. It survives being missed, unlike a toast.

**Generation.** A call to a language model that produces text: research notes, hooks, an outline, variants, an idea.

**LLM proxy.** The optional local router set by `LLM_BASE_URL` (for example 9router) that the in-app model client routes through. Separate from the Anthropic API key.

**Graph API.** The Instagram Graph API used to measure and publish to the owned channel, gated by a token.

## Feedback surfaces

**Saved view.** A named set of feed filters (`savedFilters`). Two are seeded and locked: Balanced and High Conviction.

**Failure strip.** The shell banner that reports the most recent sync's verdict. See [jobs-and-failures](jobs-and-failures.md).

**Toast.** A transient message that an action shows when it settles. Some carry an Undo. Distinct from a notification.

**Generation blocked panel.** What a generation stage shows in place of its controls when no Anthropic key is set or the proxy looks unreachable. Also the block panel.

**Connect panel.** What the own-channel pages show when the Graph token is missing or invalid, in place of live metrics. Historical numbers can still show under it.

**Empty state.** The designed message a list or page shows when it has nothing to show. Not an error.

## Calendar and planning

**Dead air.** A run of elapsed days on the calendar with nothing published, shown as a distinct cell shading.

**Reconciliation.** The calendar prompt offered when a plan and a published own post share a date, to mark the plan published.

**Script detached.** A planned post whose carried script was deliberately removed, shown with a note, distinct from a plan that never had one.

**Brief.** A planned post's brief: title and video kind, source video, the remix's hook and beats, layout fields and a score. Read back through MCP as the Reel Factory handoff.
