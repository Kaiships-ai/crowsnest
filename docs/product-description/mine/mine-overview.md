# The my channel page

## Summary

The my channel page at `/mine` is the home for the user's own channel: the header naming it, a band of metrics measured through the Graph API, a progress bar toward a usable median, and a tab strip that switches between the planner calendar, the own post list, and the metrics view. This document owns the page frame and everything that decides what the frame can show. It does not own the tab contents: the [calendar](calendar.md) owns the Month tab, and [posts and metrics](posts-and-metrics.md) owns the Posts and Metrics tabs.

The page lives at `/mine` in the [shell](../foundations/navigation-and-shell.md) and is reached from the sidebar. Two gates decide what it renders, and neither is faked when its data is missing. The first gate is whether any tracked channel is marked as the user's own. If none is, the whole page becomes an own channel picker instead of the dashboard. The second gate is the [Graph API](../foundations/background-jobs.md) token: the page checks it on load, and when the token is not usable the metrics band is replaced or topped by a connect panel that says what is missing. The planner (the tab strip below) depends on neither gate and renders in every state. So the page is available in restricted states: with no own channel it shows the picker, with an invalid Graph token it shows the connect panel over whatever real numbers exist, and the tabs render regardless of the [LLM proxy](../foundations/background-jobs.md) or the [sidecar sync](../foundations/background-jobs.md), neither of which this page needs.

The record definitions this page reads live in [the data model](../foundations/data-model.md): the [own channel](../foundations/data-model.md#channel), the [own post](../foundations/data-model.md#own-post), and the [planned post](../foundations/data-model.md#planned-post). This document links to them rather than restating them.

## The simple case

The user opens `/mine`. A channel is already marked as theirs and the Graph token is valid and has measured the account before, so the page shows the dashboard: the channel handle as a header with a "Graph API, synced" line under it, six stat tiles (followers, reach, saves, shares, median reach, posts measured), a thin progress bar with a caption about the median, and a row of reach bars. Below a divider, a tab strip offers Month, Posts, and Metrics, opening on Month, which shows the [calendar](calendar.md). The user clicks Posts to see the [own post list](posts-and-metrics.md), then Metrics to see the weekday rhythm, then back to Month. Switching tabs is instant and touches no server.

On a fresh machine the same page opens differently. If no channel is marked as the user's own, the page is a picker: a short explanation and a list of every tracked channel with a "This is me" button. If a channel is marked but the Graph token is not configured, the header and the tab strip are there, but where the metrics would be is a connect panel naming what to set and what connecting would produce.

## The interaction, event by event

```
stateDiagram-v2
    [*] --> picker : no own channel set
    picker --> routing : This is me (own channel set, refresh)
    [*] --> routing : own channel already set

    state routing {
        [*] --> connectOnly : token unconfigured, or invalid and never measured
        [*] --> stacked : token invalid but measured before
        [*] --> dashboard : token ok and measured
        connectOnly --> dashboard : Check connection ok then Measure now
        stacked --> dashboard : Check connection ok
    }

    routing --> tabs : tab strip always renders below
    state tabs {
        month --> posts : click Posts
        posts --> metrics : click Metrics
        metrics --> month : click Month
    }
```

### Arrive

The page reads the own channel first. If there is none, it stops there and renders the picker, having done no other work. If there is one, it runs six reads at once: the Graph token check, the own channel overview, the own posts (up to 100), the saved scripts (for the calendar's plan dialog), the `scoreMinUsablePosts` setting, and the calendar for the month in the URL.

From those reads the page decides three things. Whether the account was ever measured is true once an own account snapshot exists. Whether the page is connected is true only when the token check came back ok and the account was ever measured. The progress toward a usable median is the total own post count over `scoreMinUsablePosts` (default 5), capped at 100 percent.

The header shows the channel handle (a heading one level below the topbar's own "My channel" title). Under it a mono line reads "Graph API, synced" with a relative time when the account has been measured, or "Graph API, not yet measured" when it has not, followed by the tracked follower count when the channel carries one. Nothing is focused; there is no form on arrival.

Which metrics surface renders is the gate this document turns on:

- Token not configured at all, or invalid and never measured: only the connect panel renders where the metrics would be. No stat tiles, no progress bar, no reach bars.
- Token invalid but the account was measured before: the connect panel renders on top of the real numbers. The stat tiles, progress bar, and reach bars still show the last measured figures, with the connection problem named above them.
- Token ok and measured: the metrics band renders with no connect panel.

> Technical note: the two states stack rather than replace because a token that fails a live check now and a channel that was measured before are different facts. Hiding real historical figures because the check failed just now would be its own dishonesty, so real numbers show whenever they exist and the connection problem is named on top of them when there is one.

The tab strip renders below a divider in every one of these cases, opening on Month.

### Leave without acting

Backing out of the page records nothing. The page frame is a [direct server read](../foundations/interaction-model.md); there is no action to leave half done. The tab the user was on is not remembered: it is client only state, so returning to the page opens on Month again. The month shown in the calendar is in the URL, so a link back to a specific month reopens that month.

### Begin acting

There are three ways to begin acting on this frame, and each is a small action rather than a long one.

Choosing an own channel in the picker starts a write the moment "This is me" is clicked. The clicked row's button disables and relabels to "Setting", so a second row cannot be started at the same time.

Checking or measuring the Graph connection begins when the connect panel's "Check connection" or "Measure now" is clicked. Each disables its own button while it runs.

Switching tabs is not a server action at all. It is instant client state with no pending phase.

### While acting

Setting an own channel shows "Setting" on the one button and leaves the rest of the picker in place. Checking the connection shows "Checking" on that button; measuring shows "Measuring" on its button. Nothing else on the page changes until the action settles, because the metrics and header are server rendered and only a refresh brings the new values in.

### Finish

Setting an own channel, on success, shows a toast "{handle} is now your own channel" and [refreshes](../foundations/navigation-and-shell.md) the page, which now passes the first gate and renders the dashboard or the connect panel. On failure it shows the error as a toast and leaves the picker as it was.

Checking the connection updates the panel's state text in place; if the token now reads ok, the page refreshes so the metrics can appear. Measuring, on success, shows a toast counting the posts measured and refreshes so the stat tiles fill in. On failure each shows the reason as a toast and leaves the panel where it was. Switching tabs finishes the instant it is clicked, with the chosen tab's content in view and nothing committed.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (own channel and its measurement) | Decides the whole page. No own channel: the picker. Own channel with an unconfigured or never measured token: the connect panel only. Own channel measured before but token invalid now: the connect panel over the real numbers. Own channel connected and measured: the full dashboard. | Setting an own channel in the picker flips the page from picker to one of the metrics states after the refresh. A successful measure flips a connected but unmeasured account to the dashboard. |
| Attached data present or absent (own posts, account snapshot) | Whether an account snapshot exists sets the header line ("synced" versus "not yet measured") and the Followers tile sample ("latest snapshot" versus "never measured"). Whether own posts exist sets the progress caption and fills or empties the reach bars and the Posts and Metrics tabs. | A measure run writes an account snapshot and own posts, so the header, tiles, progress, and reach bars all fill in on the refresh that follows. |
| External service availability (LLM proxy, Graph, sidecar) | The Graph token is the gate for the metrics band, described above. The LLM proxy and the sidecar have no effect on this page: the frame, the header, and the tab strip render whether or not they run. | Rechecking the Graph token can move it from invalid to ok and unlock the metrics after a refresh. The LLM proxy and sidecar still have no effect. The sidecar writes tracked videos, not own posts, so its state never changes this page. |
| Keyboard shortcut in play | The tab strip takes keyboard focus. With a tab focused, the left and right arrow keys move between Month, Posts, and Metrics, and Enter or Space activates one. There is no dialog and no arrow key navigation of records on this frame. | Same. The arrow keys move the tab selection at any time the tab strip is focused. |

## Cancel and interrupt

| Event | Before commit | While in flight |
| --- | --- | --- |
| Explicit cancel or stop | There is no dialog to cancel on this frame and no cook run to stop. The picker and the connect panel have no cancel button; the user simply does not click. | The set, check, and measure buttons disable while they run, so there is no cancel; each runs to completion. |
| Navigate away mid action | Leaving the page records nothing. The tab selection is discarded; the calendar month stays in the URL. | A sidebar link still navigates. The server write (setting the channel, or a measure) may land, but the refresh that would show it does not; the next visit reads the true state. |
| Reload or tab or window closed | The tab selection resets to Month on the next load. Nothing else is held in the page. | The set, check, or measure may or may not have completed. On next load the page reflects whatever the database holds. |
| A backing service fails mid action | The Graph token being invalid is not a failure here, it is the gate: the page renders the connect panel rather than erroring. The token check never throws; a token that is absent is a successful "not configured" answer. | A measure that cannot reach or is rejected by the Graph API shows the reason as a toast and leaves the connect panel in place. Setting an own channel touches no external service. |
| The target record changes underneath | If a sync soft removes the channel that was marked own between page reads, the own channel read returns none and the page falls back to the picker. In the picker, a candidate channel removed underneath returns "That channel no longer exists" when its "This is me" is clicked. | Same. A measure writes new own posts and a snapshot; the values the user sees update only on the refresh that follows. |
| A background job finishes or fails on its own | A sync that runs while the page is open does not push into it; the header and tiles are current as of the last read. A measure is a foreground action here, not a background job. | No effect. Nothing on this frame watches a live run. |
| A second tab or a double action on the same record | Two tabs both on the picker: the first "This is me" wins and marks its channel; the setter unmarks whatever previously held own and marks the new one, so the second tab's later choice simply switches which channel is own. | A double click on set, check, or measure is blocked by the disabled button. |

After any interrupt the user stays on `/mine`. The own channel flag either changed or it did not; a measurement either wrote its rows or it did not. Nothing is left half written on this frame.

## Interactions with other systems

**Persistence and autosave.** Nothing on this frame autosaves. The tab selection is ephemeral client state that resets to Month on reload. The calendar month is carried in the URL, not stored. The own channel choice is durable once set (the channel's `isOwn` flag). A measurement writes durable own account snapshots and own posts. See [persistence](../cross-cutting/persistence.md).

**History and undo.** Setting an own channel is not given an undo on this page. There is no unset control in the picker or the header, so switching back means marking a different channel or clearing the flag elsewhere. A measurement cannot be undone; it appends snapshots and insights rather than replacing them.

> Technical note: an action to clear the own channel without assigning it elsewhere exists (`unsetOwnChannelAction`), but this page does not call it. Reaching the picker again means no channel is marked own, which this page's UI provides no button to cause.

**Navigation and refresh.** This page renders on the server and re reads on navigation or an explicit [refresh](../foundations/navigation-and-shell.md). Setting an own channel, rechecking a now valid token, and measuring each call a refresh so the server rendered header, tiles, and metrics reflect the change without a manual reload. The calendar month is a deep link (`?month=YYYY-MM`); the tab selection is not, so it does not survive a navigation.

**Background jobs and the sidecar.** The [sidecar sync](../foundations/background-jobs.md) writes tracked videos, not own posts, so it never changes this page. Own posts come from a Graph measurement, which the connect panel triggers as a foreground action. The calendar's published cells depend on own posts having been measured; see [the calendar](calendar.md).

**External services.** The [Graph API](../foundations/background-jobs.md) is the one external service this page depends on, and only for the metrics band. When the token is missing or rejected the page degrades to the connect panel and keeps its header and tabs. See [external services](../cross-cutting/external-services.md) for the token states.

**Status and failures.** The picker and the connect panel surface success and failure as toasts. The connect panel also carries its own status copy for each token state (not configured, rejected, rate limited, unreachable, unknown, connected but never measured) and a "last checked" timestamp. The header's "not yet measured" line is a status of its own. Beyond these, failures surface in the shell's [failure strip](../cross-cutting/status-and-failures.md).

**Configuration and settings.** The `scoreMinUsablePosts` setting (default 5) sets the progress bar target and the point at which a median reach appears. The measurement window (30 days by default) labels the reach, saves, shares, and posts measured tiles. Neither is changed from this page.

## Edge cases

- The tab strip renders even when the metrics are gated off. With no Graph connection, Month still shows the planner, and Posts and Metrics show empty own post views rather than an error, because the planner and the own post list do not need the Graph token to render, only data the token would have produced.
- The connect panel appears in two shapes. When the account was never measured it fills the metrics area alone; when the account was measured before but the token now fails, it sits above the real numbers instead of hiding them.
- When the token is ok but nothing has been measured yet, the connect panel reads "Connected, nothing measured yet" and offers a "Measure now" button. That button appears only in this exact state.
- The follower count in the header comes from the tracked channel's own snapshot, while the Followers stat tile comes from the Graph account snapshot. The two can disagree when the Graph measurement is older or newer than the channel tracking, since they are separate sources.
- Three metrics have no tile at all (profile visits, follows from post, watch time), because the Graph client does not request them. A tile for a number the app cannot produce would be a control that does nothing.
- The picker lists every tracked channel that is not already own. On a machine with nothing tracked it shows a message pointing the user to add their Instagram account as a channel first, with no rows to pick.
- The median reach caption changes with the data: below the usable post floor it counts posts remaining ("N / 5 posts before a median reach appears"); once a median exists it names the sample it was built from.

## Open questions and verification

- Whether switching tabs while the calendar's month is changed keeps the selected month was read from the code (the month is in the URL, the tab selection is client state) but not confirmed by hand; a URL change re reads the page and resets the tab to Month, which needs a live check.
- Whether a measure that partially fails (posts measured, comments not) shows a distinct toast on this page, versus the plain success count, was read from the action but not confirmed in the running product.
- The exact relative time wording in the header's "synced" line was read from the format helper name, not rendered and read by hand.
- Whether the header follower count and the Followers tile visibly disagree in practice, and how often, was inferred from their two sources and not observed.

Verified against this repo commit `4f26fb9`.
