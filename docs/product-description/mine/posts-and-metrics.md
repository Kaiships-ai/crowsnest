# The posts and metrics tabs

## Summary

The Posts and Metrics tabs on the [my channel page](mine-overview.md) read out the user's published, measured posts. Posts is a flat list of every [own post](../foundations/data-model.md) the Graph API has recorded, newest first, with reach, length, and when it went up. Metrics is a bar chart of average reach by weekday. A third display, reach by post, sits above the tabs in the overview area rather than inside a tab, and this document covers it too because it reads the same data. All three are read only. They show measured numbers and nothing on them writes a row, opens a dialog, or starts a generation. The only thing a user can do is switch between tabs and click a post open on Instagram.

They live in the my channel page at `/mine`, which [mine-overview.md](mine-overview.md) owns as a whole. This document owns three of the things that page renders: the Posts tab, the Metrics tab, and the reach by post bars in the overview strip. All three read one server load of the user's own posts (limit 100, newest first) that the page fetches once and hands to each display.

Availability splits along a seam worth stating up front. The reach by post bars only appear once the channel has ever been measured; before that the whole overview strip is replaced by a connect panel and there are no bars. The Posts and Metrics tabs render no matter what, because they sit outside that gate; when nothing has been measured they show their own empty state instead. None of the three needs the LLM proxy or the sidecar. They need past Graph measurements, and when the Graph token is invalid they show whatever was measured before and nothing newer. See [external services](../cross-cutting/external-services.md) for the token states.

## The simple case

The user opens `/mine`. If the channel has been measured, the overview strip shows the reach by post bars: one bar per post, oldest on the left, the real reach printed above each bar. Below the strip is a row of three tabs, Month, Posts, and Metrics, with Month selected. The user clicks Posts and sees a table of their published posts, each row a caption, a reach number with a small bar, a length, and how long ago it went up. Clicking a row opens that post on Instagram in a new tab. The user clicks Metrics and sees seven bars, one per weekday, each the average reach of the posts published on that day, with a count underneath. Switching tabs is instant and changes nothing on the server.

## The interaction, event by event

```
stateDiagram-v2
    [*] --> monthTab : arrive at /mine
    monthTab --> postsTab : click Posts
    monthTab --> metricsTab : click Metrics
    postsTab --> metricsTab : click Metrics
    postsTab --> monthTab : click Month
    metricsTab --> postsTab : click Posts
    metricsTab --> monthTab : click Month
    postsTab --> instagram : click a post row (new browser tab)
    instagram --> postsTab : the page is unchanged
    monthTab --> [*] : leave the page
    postsTab --> [*] : leave the page
    metricsTab --> [*] : leave the page
```

### Arrive

The page loads all of the user's own posts in one server read, newest first, capped at 100, and hands the same list to the reach by post bars, the Posts list, and the Metrics chart. Nothing is fetched per tab. The tab row starts on Month, so the Posts and Metrics content is present in the page but not shown until the user clicks its tab. The reach by post bars render immediately if the channel has ever been measured; otherwise the connect panel stands in their place.

The bars read oldest first, left to right. Each measured post gets a bar with a visible floor height so a reach of 9 next to a reach of 400 is still a bar and not an invisible sliver, and the number printed above the bar is always the real figure, never the floored one. A post with no measured reach gets no bar, only a dashed baseline and a dash for its number, and the caption line under the chart counts how many of the posts have a reach and how many do not.

### Leave without acting

Nothing is recorded. There is no saved tab, no scroll position, no filter. Leaving and returning starts on the Month tab again. Which tab was open is client only state that a navigation or reload discards.

### Begin acting

There is no acting to begin. These are displays. The nearest thing to an action is clicking a tab, which swaps the visible panel in the browser with no server call, and clicking a post row in the Posts list, which opens that post's Instagram permalink in a new browser tab and leaves the my channel page exactly as it was.

### While acting

Nothing is in flight. A tab switch is immediate. Opening a post hands off to the browser and the my channel tab does not change.

### Finish

Nothing is committed, because nothing was started. The numbers on screen are as fresh as the last measurement the page loaded. They do not update while the user watches; a new measurement appears only on the next navigation or refresh of the page. See [navigation and refresh](../foundations/navigation-and-shell.md) for how a server rendered page stays current.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (own post measured or not) | Decides what each display shows. A post with a measured reach gets a bar and a number; a post with none gets a dashed baseline in the bars, a dash in the list, and is left out of the weekday averages. With no measured posts at all, the bars are absent (the connect panel stands in), the Posts list shows "No posts synced from Instagram yet.", and Metrics shows "No measured posts yet to read a weekday rhythm from." | No effect. The list is a snapshot from page load and does not change as measurements land elsewhere. A new or updated measurement shows only after the page is navigated or refreshed. |
| Attached data present or absent (caption, duration, reach) | A missing caption renders as "Untitled post". A missing duration renders as a dash in the Length column. A missing reach is treated as not measured, distinct from a real reach of zero, and is drawn as a dash rather than a zero height bar. | No effect. |
| External service availability (LLM proxy, Graph, sidecar) | The LLM proxy and the sidecar are irrelevant here. The Graph API decides the data: these displays show past Graph measurements. When the token is invalid, the reach by post bars still show earlier measurements if the channel was ever measured, with a connect panel stacked above them, while the Posts and Metrics tabs render their snapshot regardless. When the channel was never measured, the bars are gone and both tabs show their empty state. | No effect within a page visit. A token going invalid mid visit changes nothing on screen until the page is reloaded. |
| Keyboard shortcut in play | The tab row is keyboard reachable: arrow keys move between Month, Posts, and Metrics when the tab list has focus, and Enter or Space activates a tab. No other key does anything here. | No effect. There is no shortcut that changes what a display shows. |

There is no modifier that changes what any of these displays present. The only inputs are which tab is active and, in the list, which post row is clicked.

## Cancel and interrupt

These are read only displays, so most interrupts have nothing to disturb. The table is filled for completeness; most cells are "no effect" because there is no uncommitted work and nothing in flight.

| Event | Before commit (viewing) | While in flight (nothing is) |
| --- | --- | --- |
| Explicit cancel or stop | Nothing to cancel. Switching away from a tab discards nothing, because a tab holds no unsaved state. | No effect. Nothing runs to stop. |
| Navigate away mid action | Leaving the page drops the client tab selection and returns to Month on the next visit. No data is lost because none was held. | No effect. |
| Reload or tab or window closed | The active tab resets to Month on reload. The displays re-render from a fresh server read, which may include measurements that landed since the last load. | No effect. |
| A backing service fails mid action | No service is called while viewing. If the Graph token was already invalid at page load, the displays show the last measurements taken before it failed, and the connect panel names the problem above the bars. A service failing after load changes nothing until reload. | No effect. |
| The target record changes underneath | A measure run writing new own post rows or new insights does not touch the open page; the current tab keeps showing the numbers from the last load until a navigation or refresh. | No effect. |
| A background job finishes or fails on its own | A measure run finishing while the user is on the Posts or Metrics tab does not update the numbers in place. The freshened figures appear on the next navigation or refresh. See [background jobs](../foundations/background-jobs.md). | No effect. |
| A second tab or a double action on the same record | Opening the same post in the list twice opens two Instagram browser tabs. Two my channel tabs open at once each hold their own tab selection and their own snapshot; neither writes anything, so they cannot conflict. | No effect. |

After any of these the user stays on the my channel page. Nothing here can be left half done, because nothing here commits.

## Interactions with other systems

**Persistence and autosave.** Nothing is saved. The active tab is transient client state, discarded on navigation or reload. There is no per user preference for a default tab; the page always opens on Month. The underlying own post and insight rows are durable, but they are written by the measure run, not by anything on these tabs. See [persistence](../cross-cutting/persistence.md).

**History and undo.** There is nothing to undo. No action on these displays changes any record.

**Navigation and refresh.** The displays are server rendered from one read at page load and stay fixed until the page is navigated or refreshed. Switching tabs is client only and does not re-read the server. Clicking a post row opens its Instagram permalink in a new browser tab and leaves the page untouched. The refresh model is owned by [navigation and shell](../foundations/navigation-and-shell.md).

**Background jobs and the sidecar.** The measure run that writes own posts and their insights is a background job; these tabs only read what it has already written. A run finishing while the page is open does not update the numbers until the next load. See [background jobs](../foundations/background-jobs.md).

**External services.** Only the Graph API matters, and only indirectly: these displays show measurements it took in the past, never a live call. When its token is invalid the reach by post bars still show earlier numbers if any exist, with a connect panel above them; the Posts and Metrics tabs render their snapshot either way. See [external services](../cross-cutting/external-services.md).

**Status and failures.** There is no failure surface on these displays themselves. A per post insight that failed to measure is carried as a missing reach and rendered as a dash, not an error. The connection problem, when there is one, is named by the connect panel in the overview strip, which [mine-overview.md](mine-overview.md) owns. See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** `scoreMinUsablePosts` sets how many measured posts are needed before a median reach exists, which drives the overview progress line and the median that [mine-overview.md](mine-overview.md) owns. It does not change what these three displays show; the list, the bars, and the weekday chart render every measured post regardless of the median floor.

## Edge cases

- The reach by post bars and the two tabs come from the same 100 post load, but the bars are gated on the channel having ever been measured while the tabs are not. So a channel that was measured before but whose token is now invalid shows the bars with historical numbers and a connect panel on top; a channel never measured shows no bars but still shows the Posts and Metrics tabs with their empty states.
- Only the newest 100 own posts are loaded. A channel with more than 100 measured posts shows the 100 most recent everywhere; the total count in the overview reflects all of them, but the list, the bars, and the weekday averages are computed over the loaded 100.
- The list orders newest first; the reach by post bars order oldest first, left to right, to match the calendar's reading direction. The same posts appear in opposite order in the two places on purpose.
- A missing reach is not a zero. In every display a post with no measurement reads as a dash and is left out of averages, so a real reach of zero and an unmeasured post never look the same.
- The weekday chart warns in its own caption that with only a handful of measured posts spread across seven days, most weekdays carry one post or none, and it should be read as a reading rather than a rhythm. A weekday with no measured posts shows a dash and a near flat bar.
- The bars use a floor height so a tiny reach is still visible, but the floor is purely visual. The printed number above a bar is always the true reach, so nothing makes a small number look larger than it is.
- The list computes a reach against median index for each post but does not display it. Only reach, length, and published date appear in the list; the index is carried in the data and shown nowhere on these tabs.

## Open questions and verification

- The exact keyboard behavior of the tab list (arrow keys to move, Enter or Space to activate) was read from the shared tabs component's contract, not confirmed by hand on this page.
- Whether a caption that is present but only whitespace renders as "Untitled post" or as an empty cell was not confirmed; the list falls back to "Untitled post" only when the caption is absent, so a whitespace caption may render blank.
- Whether the reach by post bars and the tabs can visibly disagree in practice (for example own post rows present with no account snapshot, so the tabs show posts while the bars are gated off) was reasoned from the page's two separate gates but not reproduced.

Verified against this repo commit `4f26fb9`.
</content>
</invoke>
