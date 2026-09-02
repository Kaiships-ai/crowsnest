# Glossary

The vocabulary used across these documents. When a document uses one of these words, it means exactly this. When a document needs a word this file does not define, add it here in the right section with a full paragraph before using it. Do not coin a synonym for a term that already exists.

This glossary merges two sources: the live vocabulary drawn from the current code and behavior, and the earlier product glossary written before the schema existed (`CONTEXT.md`), which still carries the word choice guidance ("avoid") worth keeping. Where the two used different words for the same thing, the current, code grounded term is the entry and the older word appears as a note.

## The surface

**Core loop.** The path from an outlier in the feed, through a remix into a script, into a planned post, into a cook run in the studio, to publish. The subject of these documents. Routes outside it are out of scope.

**Shell.** The persistent frame around every core loop page: the sidebar, the topbar, the command menu. Rendered by the `(shell)` layout. It redirects to first run until setup is done, and it re-reads its counts on navigation.

**Feed.** The outlier feed page at `/feed`. A grid or list of videos from tracked channels, filtered and ordered, that the user browses to find something worth remixing.

**Studio.** The page at `/mine/{postId}/studio` where a planned post is turned into a rendered video by a cook run, then published. Not to be confused with the remix studio, which is the remix page; where ambiguity is possible, these documents say "the studio page" and "the remix studio".

## Accounts and identity

**Channel.** An account whose posts are tracked. A tracked channel is a competitor or reference account. Exactly one channel can be the user's own channel (`isOwn`), which is what the my channel page and the studio measure against. The earlier glossary called any such account a Channel too, and split it further into two kinds worth keeping distinct:

- **Tracked channel.** A channel the user does not own, read through the burner via instagrapi. Public numbers only. Avoid: competitor, watched channel.
- **Owned channel.** A channel the user controls, read through the Instagram Graph API with the user's own token. The only kind that has Graph API insights. Avoid: my channel, own account, connected account.

**Burner.** The throwaway Instagram account whose credentials drive instagrapi, the sidecar's scraping path. It never touches an owned channel. Avoid: scraper account, bot account.

**Fleet.** A named group of channels, used to scope the feed to one niche or cohort. Avoid: watchlist, list, folder.

## The objects

**Video.** One top level post scraped from a tracked channel, the outlier the feed shows. The table is named `videos` but a video can be a photo, a video, or a carousel (its `mediaType`). A video belongs to a channel and carries metrics (views, likes, comments) and an outlier score. Videos are written by the sidecar sync, not by the user. Avoid: post, reel, media, item.

**Planned post.** A dated intention to publish on the user's own channel, optionally carrying a script. The table is `plannedPosts`. Its `state` is draft or scheduled; missed is derived on read when a scheduled date has passed. A planned post is what the studio operates on. Do not confuse it with an own post. It lives only in this app and never touches Instagram: nothing schedules, nothing publishes, nothing reminds. The user marks one published by hand or it stays a plan. Avoid: scheduled post, queue item, calendar entry, campaign.

**Own post.** A post that has actually been published on the user's own channel and measured through the Graph API. The table is `ownPosts`. Read only in these documents; the metrics tabs on the my channel page show these.

**Script.** The text a remix produces, saved as a `scripts` row. A script can be attached to a planned post. Saving a script in the remix copies the chosen variant's text; it does not link live to the variant. Avoid: draft, content, copy.

**Vault item.** A reusable snippet the remix draws on, typed as a hook or a style (`vaultItems`). The style stage picks a style vault item; the research stage can pull hook and style items in as material. Also defined more broadly in the earlier glossary as a reusable hook or layout saved out of an analysis, or written by hand, kept for future remixes. Avoid: template, saved hook, swipe file entry.

**Saved post.** A video the user has saved for later, written by the save to vault dialog (`savedPosts`). One saved post can link back to the video it came from. Its score and stats are always read live off the video, never frozen at save time. Distinct from a vault item, which is a reusable hook or layout pulled out of a video, not the video itself. Avoid: bookmark, favorite, starred post.

## Study and reuse

**Transcript.** The spoken words of a video with timestamps, produced locally. Avoid: captions, subtitles, text.

**Analysis.** The stored breakdown of one video: its hook type, its story beats, its format and its visual layout, plus why it likely beat the baseline. Avoid: breakdown, insight, report.

**Hook.** The opening move of a video, the part that stops the scroll. Avoid: intro, opener, first three seconds.

**Layout.** What a video looks like rather than what it says: on screen text and where it sits, cut rhythm, framing, b-roll pattern. Read from frames, never from the transcript. Avoid: style, visual style, format, template.

**Remix.** Turning a studied video into a new script for the user's niche, staged as prompt, research, hook, style, script. Avoid: generation, rewrite, scriptwriting.

## Remix session and its parts

**Remix session.** A working session that turns one source video into a script through six stages. The table is `remixSessions`. It holds the topic, niche, target length, research notes, hook options and chosen hook, style vault item, outline, variants, and chosen variant. It is disposable working state; its durable outputs are a script and a planned post. There is one session per source video (get or create).

**Stage.** One of the six steps of a remix session, in order: prompt, research, hook, style, script, finish. The stepper shows them. The session's `stage` column records how far it has gone.

**Variant.** One of the candidate scripts the script stage generates. The default is three, generated against three fixed angles. The user picks one (the chosen variant) before saving.

**Remix run.** One generation attempt inside a remix session: a hook generation, an outline generation, a variant generation. Logged append only to `remixRuns`, on success and on failure. The run log on the remix page shows these. Distinct from a create run.

**Create run.** One cook pipeline execution in the studio: the pty process that cooks and renders a planned post into a video. Tracked in `createRuns` with a status. Distinct from a remix run. When this repo says "cook run" it means a create run.

## State words

**Draft.** A planned post with no scheduled date, or the general condition of unsaved working state. A draft planned post has `state` draft.

**Scheduled.** A planned post with a date in the future. `state` scheduled.

**Missed.** A scheduled planned post whose date has passed without being marked published. Derived on read, not stored.

**Published.** A planned post the user has marked as published, or an own post that exists on the channel.

**Analyzed.** A video that has a `videoAnalyses` row: hook type, structure segments, format and style tags, why it worked, a layout. A video with no analysis is unanalyzed, and the detail page shows a gate that offers to analyze it.

**Saved.** A video that has a `savedPosts` row. The save button on the detail page reflects this.

**Dirty.** A form or a stage that has been edited since it was last saved. What "saved" means is defined per feature; the remix autosaves, most dialogs commit on submit.

## Action ending words

The words every cancel and interrupt table relies on. Defined once here.

**Commit.** The durable step of an action: a database row written, a script saved, a planned post created, a render asset recorded. Until an action commits, leaving discards it.

**Cancel.** The user ending an action on purpose before it commits: Escape or a close on a dialog, a Cancel button. A cancel discards uncommitted work and returns the user to where they were.

**Stop.** Ending a running cook run on purpose. The Stop button injects into the pty and the run row moves to a stopped or failed status. What is left on disk depends on how far the run got.

**Interrupt.** Anything that ends or disturbs an action that the user did not do on purpose: navigating away, a reload, a service failing, the record changing underneath, a background job finishing on its own, a second action on the same record. The seven interrupt rows are the fixed list; each feature document fills every cell.

**Deep link.** A URL that carries an action or a seed into a page, for example a remix page opened with a stage or a quick remix seed in the query string. Deep links are how the feed and the detail page start a remix in a particular state.

## Generation and background work

**Generation.** A call to the language model through the LLM proxy that produces text: research notes, hooks, an outline, variants, an idea. Generation is not instant; the feature shows a pending state while it is in flight, and writes a remix run row when it settles.

**LLM proxy.** The local proxy the app calls for generation, a base URL override set by `LLM_BASE_URL` (a local router such as 9router). When it is set the model requests route through it; when it is down, generation fails and the feature says so. The feed, the detail page reads, and the calendar do not need it. The proxy is a separate thing from the Anthropic API key: generation needs both a key and, when configured, a reachable proxy.

**Anthropic API key.** The `ANTHROPIC_API_KEY` the app uses to reach the model. Generation and analysis need it. A stage with no key shows the same block panel as a down proxy, but for a different reason (no key configured, rather than the proxy unreachable). Transcription through the local whisper.cpp does not need it, so a keyless install can still transcribe.

**Sidecar sync.** The background engine that fetches posts from tracked channels and writes `videos`, and that measures own posts. The user does not trigger it per action; videos appear in the feed because the sidecar ran. When it is not running, the feed goes stale rather than erroring. The earlier glossary calls this a Sync: one run that pulls a channel's profile and recent posts, downloads their images, and recomputes outlier scores. Avoid: scrape, fetch, refresh, pull.

**Graph API.** The Instagram Graph API the my channel page uses to measure the user's own channel. Gated by a token whose validity the page checks. When the token is invalid, the my channel metrics are unavailable and the page shows a connect panel.

**Transcript provider.** A source the analysis step can pull a transcript from. The detail page lists the available providers. When none is reachable, analysis that needs a transcript cannot run.

**Lookback.** How far back in time a sync reaches. Avoid: window, date range, history depth.

**Cooldown.** The account wide pause after Instagram signals it has had enough. It applies to the burner, not to one channel. Avoid: rate limit, backoff, throttle.

## The interface

**Filter bar.** The row of controls on the feed that build the feed query: follower band, saved views, search, add video. Its state lives in the URL.

**Saved view.** A named set of feed filters (`savedFilters`). Two views are seeded and locked as built in: Balanced (a lower score threshold over a wider window) and High Conviction (a higher score threshold, a tighter window, a view floor). The user can add, rename, and delete their own views through the manage saved views dialog, but not the two built in ones.

**Run pill.** The small status indicator on the studio panel that shows a create run's state. The five statuses are running, waiting, success, failed, and canceled; the pill labels them in the user's words: cooking, waiting on you, done, failed, and canceled. An unrecognized status reads as canceled.

**Failure strip.** The banner in the shell that surfaces recent failures across the app, read by the layout on every navigation.

**Command menu.** The keyboard driven menu in the shell for jumping between pages and actions.

**Run log.** The list on the remix page, below each stage past prompt, of every generation attempt in the session, newest first. Each row is a remix run with a tone: Success, Partial (some variants of a set failed), or Failed. The studio infers the proxy is down from recent Failed rows.

**Toast.** A transient message in the corner that an action shows when it settles, success or error. Toasts are per action and disappear on their own. Some carry an Undo action (removing a saved post, for example) that reverses the action if clicked before the toast closes. Distinct from the failure strip, which is persistent and app wide.

**Generation blocked panel.** The surface a remix generation stage (hook, style, script) shows in place of its controls when generation is unavailable, for one of two reasons: no Anthropic API key configured, or the LLM proxy looking unreachable. Also called the block panel.

**Connect panel.** The surface the my channel page shows when the Graph token is invalid or missing, in place of live metrics. Historical numbers, if any were measured before, can still show with the connect panel stacked over them.

**Empty state.** What a list or a page shows when it has nothing to show yet: the feed with no matching videos, the calendar with no plans, the studio output before a cook. An empty state is a designed message, not an error.

## Studio and analysis

**Brief.** What the studio shows for a planned post: its title and video kind, the source video, the remix's hook and beats, the layout fields, and a score. The visible brief is composed from the plan, the source video, and the remix session. A separate `brief.md` is written into the cook run's workspace when a cook starts; this repo calls that the cook brief. The two are related but not identical; the on screen brief shows less than the cook brief carries.

**Frame pass.** A separate analysis step that reads a video's frames to produce its layout. It is distinct from the text analysis that produces hook type, tags, and structure. Re analyzing a video updates the text fields but preserves the frame pass result. The frame pass client is not wired up in this build, so the layout is usually absent.

**Render.** The video file a successful create run produces, stored as a render asset. Publish is gated on a render existing. Also called the render asset.

**Score badge.** The small badge on the studio brief showing the source video's outlier score, or a dash when there is none.

## Metrics and scoring

**Outlier score.** How far a video outperforms its own channel's baseline, shown as a multiplier (for example 38.0x). The feed ranks and bands on it. Computed by the scoring service, stored on the video. The earlier glossary phrases this as how many times a video beat its own channel's baseline. Avoid: multiplier, virality score, performance ratio.

**Outlier.** A video whose outlier score clears whatever threshold is being applied. Not a fixed number. Avoid: viral video, banger, top post.

**Reproducible outlier.** An outlier on a small channel, where the reach came from the post rather than from an existing audience: the kind of result a user can copy at their own size. Avoid: small account win, organic outlier.

**Follower band.** The size bracket of a channel by follower count, used to group and filter the feed: nano (0 to 10k), mid (100k to 1M), and macro (1M and up). Also called a band.

**Engagement rate.** Likes plus comments over views for a video, a computed metric shown on the detail page.

**Median baseline.** The channel's own median performance that an outlier score is measured against, shown on the detail page as the comparison that explains the score. The earlier glossary calls the same idea a Baseline: the middle view count across a channel's recent videos, what "normal" means for that channel. Avoid: average, median views, benchmark.

**Reach.** The measured reach of an own post, from the Graph API, shown on the my channel metrics tabs. Missing reach renders as a dash, never as zero.

**Insight.** A metric that exists only for an owned channel: reach, saves, shares, profile visits, follows from post, watch time. Avoid: analytics, stats, engagement data.

## Ideas and vault

**Idea.** A short concept generated from a video, written to the ideas inbox. Generating an idea is an exit from the core loop; the ideas inbox itself is out of scope for these documents. The table is `idea`, one active row per source video.

**Ideas inbox.** The list the generate idea action writes to. Out of scope here; named only as the destination of that action and the origin of a later remix session.

**Niche.** The user's content niche, a setting shown as a read only chip on the remix prompt stage and fed into every generation prompt. Read live from settings, so the chip and the prompt cannot drift.

**Facts box.** The one editable field on the remix research stage, where the user adds their own angle or stats. It autosaves on blur and feeds the hook, style, and script prompts.

**Recently viewed.** The list of the last videos the user opened, kept in app settings, most recent first, deduplicated, capped at eight. Feeds the dashboard.

**Similar outliers.** The reference list of tracked videos related to a source video by tag overlap, shown on the detail page and in remix research, capped at five.

## Calendar terms

**Dead air.** A run of several elapsed days on the calendar with nothing published, shown as a distinct cell shading.

**Reconciliation.** The calendar's prompt when a plan and a published own post share a date, offering to mark the plan published. Distinct from the plan simply being marked published by hand.

**Script detached.** A planned post whose carried script was deliberately removed, shown on the calendar with a note, distinct from a plan that never had a script.

## Runs and observability

Terms carried over from the earlier product glossary for background operations and their logging. Not all of these are wired into the current core loop views, but the words are the ones to use if and when they are.

**Run.** One execution of a background operation, with a lifecycle of running, success, partial, or failed. A sync is a run, and each remix stage is a run. Avoid: job, task, process, execution.

**Step.** A unit of work inside a run, such as one channel pulled during a sync or one image downloaded. A step is never a run on its own. Avoid: subtask, child job, phase.

**Heartbeat.** The periodic signal a running run sends to prove it is still alive. A run that stops sending one is treated as stuck. Avoid: ping, keepalive, liveness check.

**Log event.** One recorded line about what happened inside a run, tied to that run by its trace id and already redacted of secrets. Avoid: log line, log entry, message.

**Trace id.** The id that ties every log event to the run that emitted it. It rides inside a log event's fields as `jobId`. Avoid: correlation id, request id, span id.

**Notification.** A stored alert raised when a run fails, finishes, or breaches its SLA. It survives being missed, unlike a toast. Avoid: alert, toast, popup.

**SLA budget.** The wall clock time a run type is allowed before it counts as too slow. Avoid: timeout, deadline, limit.

**Breach.** A run either crossing its SLA budget (too slow) or going stale with no heartbeat (stuck). Avoid: violation, miss, failure.
