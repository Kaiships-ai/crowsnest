# The video detail page

## Summary

The video detail page is where the user studies one [video](../glossary.md) up close before deciding what to do with it. It lives at `/feed/{videoId}` and is reached by opening a card in the [feed](feed.md), by clicking a card in this page's own similar outliers row, or by any link that carries a video id (the recently viewed list, a channel grid, a vault card). It is a [direct server read](../foundations/interaction-model.md): the page queries the database as it renders and shows what it finds, so it has no action of its own to fail and no loading spinner for its own content. It works whether or not the LLM proxy, the Graph API, or the sidecar are running, because rendering the page needs none of them; only the actions launched from it (analyze, generate idea, download) touch those services, and each is documented on its own.

The page is a two column reading surface. The left column holds the media and everything measured about the post: the player or carousel, the outlier score, the raw numbers, the [engagement chips](#the-left-column), the [median baseline](#the-median-baseline), the caption, and the channel link. The right column holds the text: a summary, then tabs for the transcript, the hook and structure, why it worked, and the layout. A sticky action row at the bottom of the right column is the exit: Remix this, and beside it the smaller keep, save, copy, and generate actions. A header row above both columns carries the back link, the position in the feed, and the previous and next controls.

Several things on this page are their own documents and are only named here, not restated: the [keep this post button](keep-this-post.md), [analyzing the video](analysis.md) (the analysis gate, the transcript and hook and why and layout content, the reanalyze and frame pass buttons), and [generating an idea](generate-idea.md) from the video. This document owns the page as a whole: the media viewers, the metric chips, the median baseline, the arrow key navigation to the previous and next video in feed order, and recording the video as recently viewed.

## The simple case

The user clicks a card in the feed. The detail page opens with the media on the left, capped so the six numbers under it stay above the fold, the outlier score badged over the media and printed large under the baseline bar. The right column shows the transcript tab by default. The user reads the transcript, clicks through to Hook and structure and Layout, glances at how this post compares to the channel's own baseline, and then either presses the right arrow key to move to the next video in the same feed order without going back to the grid, or clicks Remix this to start working on it. Opening the page also quietly records the video in the recently viewed list.

## The interaction, event by event

```
stateDiagram-v2
    [*] --> viewing : page loads (server read, recorded as recently viewed)
    viewing --> viewing : switch tab, play or download media, page a carousel
    viewing --> adjacent : ArrowLeft or ArrowRight, or prev or next (loads the neighbour)
    adjacent --> viewing : the neighbour page loads
    viewing --> elsewhere : follow a link (Remix, channel, a similar card, Feed)
    viewing --> notFound : the video id does not resolve
```

### Arrive

The page reads everything it shows in one pass on the server: the video and its channel, the transcript and analysis if they exist, the carousel children, the similar outliers (capped at five, scored by tag overlap), the median baseline sample, whether any transcript provider is usable, whether a Claude key is present, whether this video already has a saved post, and the previous and next neighbours in feed order. If the video id does not resolve, the page renders a not found body.

> Technical note: the page and its metadata fetch the same video once; React's `cache()` dedupes them to a single database round trip. A missing video calls `notFound()`, which renders the correct not found content, but a code comment records that the HTTP status stays 200 here rather than 404, a known gap tied to an interaction between `generateMetadata` and `notFound()` in this Next version. The content is right; only the status code is wrong.

The transcript tab is selected on arrival. Nothing is focused for typing. The left column media renders per the video's media type: a carousel gets the [carousel viewer](#the-media), a video gets the [player](#the-media), and a photo gets its thumbnail behind an image icon. If the video was soft removed by a sync, a banner sits above both columns saying the post is no longer on the platform and that the media below is the last copy that was downloaded.

Opening the page also records the video as recently viewed. This is fire and forget: the page never waits on it, so a slow or failing write cannot delay the render.

> Technical note: `recordRecentlyViewed` writes a JSON array of video ids to `app_settings`, most recent first, deduped so re-viewing a video moves it to the front rather than adding a copy, capped at eight (`RECENTLY_VIEWED_MAX`). The dashboard reads only the front four, leaving headroom for ids whose videos are deleted before they are read. Any error is swallowed and logged at debug, never surfaced.

### Leave without acting

Reading the page, switching tabs, playing the video, or paging through a carousel commits nothing about the user's session beyond the recently viewed row already written on arrival. Leaving by any means (the Feed link, a sidebar link, browser back) records nothing further. The page holds no dirty state and does not register with the [navigation blocker](../foundations/navigation-and-shell.md), so leaving is always immediate. The tab the user was on, the carousel slide they had open, and the download state of the player are client only and are lost on leave.

### Begin acting

There is no single write that this page commits. Acting here means one of three things: moving to a neighbour (an arrow key or the prev and next controls, which load the adjacent video), following a link (Remix this, the channel, a similar card, View on platform, or Copy link), or launching one of the owned-elsewhere actions from a tab or the action row (analyze, download, frame pass, generate idea, keep, save to vault). Moving to a neighbour is a full navigation to `/feed/{neighbourId}` carrying the same filter query string, so the neighbour resolves against the same feed order.

### While acting

Moving to a neighbour navigates the whole page; the new video's server read replaces everything, including the recently viewed write for the new id. There is no in-page transition beyond the browser loading the next route. The player and carousel keep their own small in-place states while the page stays put: the player shows an idle download button, a spinner while a download is in flight, or the real error on a failed download; the carousel shows one slide at a time with a position indicator. Actions launched from the tabs or the action row show their own pending labels and are documented in their own files.

### Finish

The page itself finishes nothing durable except the recently viewed row it wrote on arrival. A neighbour move finishes as the next page load. A link finishes by landing the user on the target. The owned-elsewhere actions each commit their own row and refresh the page so the change appears; see their documents.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (video analyzed, saved, present or removed) | Decides what the right column shows: an analyzed video fills the summary and the hook, why, and layout tabs and enables the save to vault and generate idea actions; an unanalyzed one shows the [analysis gate](analysis.md) in those tabs. A saved video shows the button as Kept (see [keep this post](keep-this-post.md)). A removed video shows the removed banner but still renders from the last downloaded copy. | Changing the record (analyzing, keeping, downloading) refreshes the page so the new state appears. Moving to a neighbour loads a different record entirely. |
| Attached data present or absent (transcript, analysis) | A present transcript fills the transcript tab and shows its word count and source; absent, the tab points the user to the analysis gate. A present analysis fills the summary and the hook, why, and layout content; absent, those tabs show the gate. See [analysis](analysis.md). | A transcript or analysis produced by an owned action appears after the refresh that action triggers. |
| External service availability (LLM proxy, Graph, sidecar) | No effect on rendering the page; the read is local. Whether a transcript provider is usable is read on arrival and passed to the analysis gate. A Claude key's presence is read on arrival and decides which gate variant shows. The Graph API is not used by this page. | The sidecar can soft remove the underlying video, which shows on the next load as the removed banner. Proxy or key state only matters when an owned action is launched. |
| Keyboard shortcut in play | Left and right arrow keys page to the previous and next video in feed order. The handler is skipped while a text input, textarea, or contenteditable has focus, so typing is never eaten. | A carousel post claims the arrow keys for its own slide navigation while it is on screen and blocks the page-level move, including at the first and last slide, so the arrows page the carousel rather than the feed. |

## Cancel and interrupt

| Event | Before commit (viewing) | While in flight (a neighbour move or an owned action) |
| --- | --- | --- |
| Explicit cancel or stop | There is nothing to cancel; the page is a read. Escape does nothing at the page level. | A neighbour move cannot be cancelled once the arrow or button fires; the browser navigates. An owned action's cancel behavior is its own document's. |
| Navigate away mid action | Leaving is immediate; the page registers no blocker and holds no unsaved work. The recently viewed row for this video is already written. | Leaving during a player download or an owned action follows that feature's leave behavior; the page-level navigation still works. |
| Reload or tab or window closed | Client-only state (the open tab, the carousel slide, an in-progress download) is lost. The recently viewed row and any committed rows persist. | A reload during a neighbour move just lands on whichever URL won. An owned action in flight follows its own document. |
| A backing service fails mid action | Rendering needs no service, so the page still loads. If the video id no longer resolves, the page shows the not found body. | The player surfaces a download failure as an inline error with the button still present to retry; other actions surface failures as toasts, per their documents. |
| The target record changes underneath | The page reflects the database at load time. If a sync soft removes the video, the next load shows the removed banner and still renders the last downloaded copy. If the feed order changed, the position label and the prev and next hrefs are computed from the order at this load. | A neighbour move re-reads the order fresh, so it reflects any change since the current page loaded. |
| A background job finishes or fails on its own | A sync or a cook run finishing elsewhere has no in-page effect; its result shows on the next navigation or refresh. | No effect on a neighbour move. An owned action watching its own job is its document's concern. |
| A second tab or a double action on the same record | Two tabs on the same video read independently. Opening the same video in a second tab writes the recently viewed row again, which only bumps it to the front. | A double arrow press pages twice; each press is a full navigation. Double-launching an owned action is that document's concern. |

After any interrupt the user is either still on the page or on the page they navigated to. The only thing this page writes on its own, the recently viewed row, is idempotent per video and capped at eight, so nothing is left half written.

## Interactions with other systems

**Persistence and autosave.** The only thing the page persists on its own is the recently viewed list, written on arrival, deduped, capped at eight. It is not user-facing on this page; it feeds the dashboard's recently viewed row. The open tab, the carousel slide, and the player's download state are client only and not saved. See [persistence](../cross-cutting/persistence.md).

**History and undo.** Nothing this page does on its own can be undone, because the only write is the recently viewed bump, which has no user-facing undo. Browser back and forward move between videos and between filter states in the usual way; the prev and next controls and the arrow keys are ordinary navigations that back and forward reverse.

**Navigation and refresh.** The prev and next controls, the arrow keys, and the back link are navigations that carry the feed's filter query string forward, so a neighbour resolves against the same order the user was browsing. The order is computed on the server from the filter params on the URL, capped at five thousand posts (`FEED_ORDER_LIMIT`); a video that falls outside that slice, or outside the filtered set, gets no position label and no prev or next rather than a made-up number. A bare visit with no filter params resolves against the full library, so any real post has a real neighbour. Owned actions on the page use `router.refresh()` to show their result; see [navigation and shell](../foundations/navigation-and-shell.md).

> Technical note: `resolveFeedNav` runs the same feed query the feed page runs, finds this video's index, and hands back the neighbour hrefs and an "N of Total" label. Cosmetic params (density, view, limit) are stripped from the forwarded hrefs; the sort order is kept, because the neighbour must walk the same order. If the index is not found, all three come back null.

**Background jobs and the sidecar.** The sidecar sync writes and soft removes videos. A removed video still resolves here by id and shows the removed banner, unlike the feed, which hides it. Nothing else on this page touches background jobs directly; the cook run and the frame pass are launched from other surfaces or documented separately. See [background jobs](../foundations/background-jobs.md).

**External services.** Rendering the page needs no external service. The [LLM proxy](../cross-cutting/external-services.md) is needed only by the analyze and generate idea actions; the transcript providers only by analysis; the player's download only by the sidecar media fetch. The Graph API is not used here. When a service is down, the page still renders and only the dependent action reports the failure.

**Status and failures.** The page has no failure strip of its own; failures belong to the actions launched from it and surface as toasts or inline messages there. The removed banner and the empty states (no transcript, no analysis, no similar outliers, no channel data to measure against) are shown inline. See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** The median baseline reads `scoreMinUsablePosts` to decide whether the channel has enough posts to have a normal; below it, the baseline says how many posts exist and how many are needed rather than drawing a fake bar. The recently viewed cap is a fixed constant, not a setting. See [persistence](../cross-cutting/persistence.md).

## The left column

Under the media sit six numbers the page guarantees are visible without scrolling: view count, duration, posted time, and follower count in one mono row, then the metric chips below. The metric chips show likes, comments, and an engagement rate computed as likes plus comments over views, as a percentage to one decimal. A missing value renders as a dash, never a zero; the engagement rate is a dash unless views is above zero and both counts are present.

The outlier score is badged over the media and printed large again by the baseline. Below the numbers come the caption, a link to the channel page, a View on platform link that opens the original post in a new tab, and a Copy link button that writes the post URL to the clipboard and toasts, or toasts a permission error if the clipboard write is refused.

## The median baseline

The baseline block explains the score. It prints the multiplier large, colored to signal whether the post beat its channel's baseline (score at or above 1.0). Below it, a log-scaled bar from 0.2x to 12x places this post against a tick at 1.0x, and a histogram shows the sample the baseline was computed from, with this post's own bar picked out. The block states the method (median, mean, or trimmed mean), the window it was taken over, the sample size, and a confidence word (low, medium, high) derived from the sample size. When the channel has fewer than the required posts, the block says so with the real count instead of drawing a baseline. When the channel row itself is missing, it says there is no data to measure against.

## The media

A video post renders in the [player](#the-media). Videos are fetched on demand, so a video with no downloaded file yet is the normal state, not an error: the player shows the thumbnail dimmed behind a Download button, a spinner while the download runs, the real video once it lands (without waiting on the server refresh), or the real error with the button still present to retry.

A carousel post renders in the carousel viewer: children in position order, one visible at a time, with prev and next buttons, a "n / total" indicator, and left and right arrow keys that page the slides. Each child is an image or a video per its own media type, so a carousel can mix both. A video child with no downloaded file is labeled honestly rather than given a dead button, because only the top-level post has an on-demand download wired up. An empty carousel says it has no items.

## The similar outliers

Below both columns, a full-width row shows up to five other videos scored by tag overlap with this one, each a compact card that opens that video's detail page on click. When there are none, the row says to analyze more videos to see patterns.

## Edge cases

- A carousel on screen owns the left and right arrow keys outright, including at its first and last slide, so the keys never leak through to page the feed while a carousel is open. This is by design: the carousel's key listener runs before the page's and marks the event handled.
- The arrow keys are ignored while a text input has focus, so a search box or any future field on the page keeps its keystrokes.
- The position label and the prev and next controls are absent, not wrong, when the video falls outside the resolved feed slice or past the five thousand post cap. A made-up position is treated as worse than none.
- The recently viewed write happening on every load means opening the same video twice does not grow the list; it just moves the id to the front.
- A soft removed video is reachable here by id and shows its last downloaded media, while the same video is gone from the feed and from the similar outliers of other videos.
- The not found body renders with a 200 status rather than 404, a known gap noted in the code; the user still sees a correct not found page.
- The Copy as prompt action in the bottom row builds a structured prompt from whatever the video has and copies it, degrading section by section when analysis is missing, so it works regardless of analysis state. The Save to Vault dialog next to the keep button is disabled with a tooltip until the video is analyzed, because it lifts hook and style templates out of the analysis.

## Open questions and verification

- Whether the recently viewed write reliably lands when the page is opened and immediately navigated away from was read from the code (it is fire and forget and not awaited) but not confirmed by hand.
- Whether a neighbour move during a player download in flight lets the download complete server-side, and whether the new page reflects it, was read from the code but not confirmed by hand.
- Which document owns the Save to Vault dialog (the hook and style template action) was not settled by the map; it lives on this page, is analysis-gated, and is only named here. It may belong with [analysis](analysis.md) or need its own entry.
- The exact behavior of `notFound()` returning a 200 rather than a 404 on this route was read from the code comment but not chased to a root cause.

Verified against this repo commit `4f26fb9`.
