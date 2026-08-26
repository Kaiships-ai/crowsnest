# Glossary

The vocabulary used across these documents. When a document uses one of these words, it means exactly this. When a document needs a word this file does not define, add it here in the right section with a full paragraph before using it. Do not coin a synonym for a term that already exists.

## The surface

**Core loop.** The path from an outlier in the feed, through a remix into a script, into a planned post, into a cook run in the studio, to publish. The subject of this repo. Routes outside it are out of scope.

**Shell.** The persistent frame around every core loop page: the sidebar, the topbar, the command menu. Rendered by the `(shell)` layout. It redirects to first run until setup is done, and it re-reads its counts on navigation.

**Feed.** The outlier feed page at `/feed`. A grid or list of videos from tracked channels, filtered and ordered, that the user browses to find something worth remixing.

**Studio.** The page at `/mine/{postId}/studio` where a planned post is turned into a rendered video by a cook run, then published. Not to be confused with the remix studio, which is the remix page; where ambiguity is possible, this repo says "the studio page" and "the remix studio".

## The objects

**Video.** One top level post scraped from a tracked channel, the outlier the feed shows. The table is named `videos` but a video can be a photo, a video, or a carousel (its `mediaType`). A video belongs to a channel and carries metrics (views, likes, comments) and an outlier score. Videos are written by the sidecar sync, not by the user.

**Channel.** An account whose posts are tracked. A tracked channel is a competitor or reference account. Exactly one channel can be the user's own channel (`isOwn`), which is what the my channel page and the studio measure against.

**Planned post.** A dated intention to publish on the user's own channel, optionally carrying a script. The table is `plannedPosts`. Its `state` is draft or scheduled; missed is derived on read when a scheduled date has passed. A planned post is what the studio operates on. Do not confuse it with an own post.

**Own post.** A post that has actually been published on the user's own channel and measured through the Graph API. The table is `ownPosts`. Read only in this repo; the metrics tabs on the my channel page show these.

**Script.** The text a remix produces, saved as a `scripts` row. A script can be attached to a planned post. Saving a script in the remix copies the chosen variant's text; it does not link live to the variant.

**Vault item.** A reusable snippet the remix draws on, typed as a hook or a style (`vaultItems`). The style stage picks a style vault item; the research stage can pull hook and style items in as material.

**Saved post.** A video the user has saved for later, written by the save to vault dialog (`savedPosts`). One saved post can link back to the video it came from.

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

**Interrupt.** Anything that ends or disturbs an action that the user did not do on purpose: navigating away, a reload, a service failing, the record changing underneath, a background job finishing on its own, a second action on the same record. The seven interrupt rows are the fixed list; each document fills every cell.

**Deep link.** A URL that carries an action or a seed into a page, for example a remix page opened with a stage or a quick remix seed in the query string. Deep links are how the feed and the detail page start a remix in a particular state.

## Generation and background work

**Generation.** A call to the language model through the LLM proxy that produces text: research notes, hooks, an outline, variants, an idea. Generation is not instant; the feature shows a pending state while it is in flight, and writes a remix run row when it settles.

**LLM proxy.** The local proxy the app calls for generation, configured by `LLM_PROXY_URL`. When it is down, generation fails and the feature says so. The feed, the detail page reads, and the calendar do not need it.

**Sidecar sync.** The background engine that fetches posts from tracked channels and writes `videos`, and that measures own posts. The user does not trigger it per action; videos appear in the feed because the sidecar ran. When it is not running, the feed goes stale rather than erroring.

**Graph API.** The Instagram Graph API the my channel page uses to measure the user's own channel. Gated by a token whose validity the page checks. When the token is invalid, the my channel metrics are unavailable and the page shows a connect panel.

**Transcript provider.** A source the analysis step can pull a transcript from. The detail page lists the available providers. When none is reachable, analysis that needs a transcript cannot run.

## The interface

**Filter bar.** The row of controls on the feed that build the feed query: follower band, saved views, search, add video. Its state lives in the URL.

**Saved view.** A named set of feed filters (`savedFilters`). The default seeded view is High Conviction. Managed through the manage saved views dialog.

**Run pill.** The small status indicator on the studio panel that shows a create run's state: running, waiting, success, failed.

**Failure strip.** The banner in the shell that surfaces recent failures across the app, read by the layout on every navigation.

**Command menu.** The keyboard driven menu in the shell for jumping between pages and actions.
