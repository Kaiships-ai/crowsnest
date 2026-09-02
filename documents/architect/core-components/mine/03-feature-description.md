# mine: feature description

## The my channel page

### Summary

The my channel page at `/mine` is the home for the user's own channel: the header naming it, a band of metrics measured through the Graph API, a progress bar toward a usable median, and a tab strip that switches between the planner calendar, the own post list, and the metrics view. This section owns the page frame and everything that decides what the frame can show. It does not own the tab contents: the calendar (below) owns the Month tab, and posts and metrics (below) owns the Posts and Metrics tabs.

The page lives at `/mine` in the shell and is reached from the sidebar. Two gates decide what it renders, and neither is faked when its data is missing. The first gate is whether any tracked channel is marked as the user's own. If none is, the whole page becomes an own channel picker instead of the dashboard. The second gate is the Graph API token: the page checks it on load, and when the token is not usable the metrics band is replaced or topped by a connect panel that says what is missing. The planner (the tab strip below) depends on neither gate and renders in every state. So the page is available in restricted states: with no own channel it shows the picker, with an invalid Graph token it shows the connect panel over whatever real numbers exist, and the tabs render regardless of the LLM proxy or the sidecar sync, neither of which this page needs.

The record definitions this page reads are the own channel, the own post, and the planned post, defined in the shared data model. This section links to them by name rather than restating them.

### The simple case

The user opens `/mine`. A channel is already marked as theirs and the Graph token is valid and has measured the account before, so the page shows the dashboard: the channel handle as a header with a "Graph API, synced" line under it, six stat tiles (followers, reach, saves, shares, median reach, posts measured), a thin progress bar with a caption about the median, and a row of reach bars. Below a divider, a tab strip offers Month, Posts, and Metrics, opening on Month, which shows the calendar. The user clicks Posts to see the own post list, then Metrics to see the weekday rhythm, then back to Month. Switching tabs is instant and touches no server.

On a fresh machine the same page opens differently. If no channel is marked as the user's own, the page is a picker: a short explanation and a list of every tracked channel with a "This is me" button. If a channel is marked but the Graph token is not configured, the header and the tab strip are there, but where the metrics would be is a connect panel naming what to set and what connecting would produce.

### The interaction, event by event

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

#### Arrive

The page reads the own channel first. If there is none, it stops there and renders the picker, having done no other work. If there is one, it runs six reads at once: the Graph token check, the own channel overview, the own posts (up to 100), the saved scripts (for the calendar's plan dialog), the `scoreMinUsablePosts` setting, and the calendar for the month in the URL.

From those reads the page decides three things. Whether the account was ever measured is true once an own account snapshot exists. Whether the page is connected is true only when the token check came back ok and the account was ever measured. The progress toward a usable median is the total own post count over `scoreMinUsablePosts` (default 5), capped at 100 percent.

The header shows the channel handle (a heading one level below the topbar's own "My channel" title). Under it a mono line reads "Graph API, synced" with a relative time when the account has been measured, or "Graph API, not yet measured" when it has not, followed by the tracked follower count when the channel carries one. Nothing is focused; there is no form on arrival.

Which metrics surface renders is the gate this section turns on:

- Token not configured at all, or invalid and never measured: only the connect panel renders where the metrics would be. No stat tiles, no progress bar, no reach bars.
- Token invalid but the account was measured before: the connect panel renders on top of the real numbers. The stat tiles, progress bar, and reach bars still show the last measured figures, with the connection problem named above them.
- Token ok and measured: the metrics band renders with no connect panel.

The two states stack rather than replace because a token that fails a live check now and a channel that was measured before are different facts. Hiding real historical figures because the check failed just now would be its own dishonesty, so real numbers show whenever they exist and the connection problem is named on top of them when there is one.

The tab strip renders below a divider in every one of these cases, opening on Month.

#### Leave without acting

Backing out of the page records nothing. The page frame is a direct server read; there is no action to leave half done. The tab the user was on is not remembered: it is client only state, so returning to the page opens on Month again. The month shown in the calendar is in the URL, so a link back to a specific month reopens that month.

#### Begin acting

There are three ways to begin acting on this frame, and each is a small action rather than a long one.

Choosing an own channel in the picker starts a write the moment "This is me" is clicked. The clicked row's button disables and relabels to "Setting", so a second row cannot be started at the same time.

Checking or measuring the Graph connection begins when the connect panel's "Check connection" or "Measure now" is clicked. Each disables its own button while it runs.

Switching tabs is not a server action at all. It is instant client state with no pending phase.

#### While acting

Setting an own channel shows "Setting" on the one button and leaves the rest of the picker in place. Checking the connection shows "Checking" on that button; measuring shows "Measuring" on its button. Nothing else on the page changes until the action settles, because the metrics and header are server rendered and only a refresh brings the new values in.

#### Finish

Setting an own channel, on success, shows a toast "{handle} is now your own channel" and refreshes the page, which now passes the first gate and renders the dashboard or the connect panel. On failure it shows the error as a toast and leaves the picker as it was.

Checking the connection updates the panel's state text in place; if the token now reads ok, the page refreshes so the metrics can appear. Measuring, on success, shows a toast counting the posts measured and refreshes so the stat tiles fill in. On failure each shows the reason as a toast and leaves the panel where it was. Switching tabs finishes the instant it is clicked, with the chosen tab's content in view and nothing committed.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (own channel and its measurement) | Decides the whole page. No own channel: the picker. Own channel with an unconfigured or never measured token: the connect panel only. Own channel measured before but token invalid now: the connect panel over the real numbers. Own channel connected and measured: the full dashboard. | Setting an own channel in the picker flips the page from picker to one of the metrics states after the refresh. A successful measure flips a connected but unmeasured account to the dashboard. |
| Attached data present or absent (own posts, account snapshot) | Whether an account snapshot exists sets the header line ("synced" versus "not yet measured") and the Followers tile sample ("latest snapshot" versus "never measured"). Whether own posts exist sets the progress caption and fills or empties the reach bars and the Posts and Metrics tabs. | A measure run writes an account snapshot and own posts, so the header, tiles, progress, and reach bars all fill in on the refresh that follows. |
| External service availability (LLM proxy, Graph, sidecar) | The Graph token is the gate for the metrics band, described above. The LLM proxy and the sidecar have no effect on this page: the frame, the header, and the tab strip render whether or not they run. | Rechecking the Graph token can move it from invalid to ok and unlock the metrics after a refresh. The LLM proxy and sidecar still have no effect. The sidecar writes tracked videos, not own posts, so its state never changes this page. |
| Keyboard shortcut in play | The tab strip takes keyboard focus. With a tab focused, the left and right arrow keys move between Month, Posts, and Metrics, and Enter or Space activates one. There is no dialog and no arrow key navigation of records on this frame. | Same. The arrow keys move the tab selection at any time the tab strip is focused. |

### Cancel and interrupt

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

### Interactions with other systems

**Persistence and autosave.** Nothing on this frame autosaves. The tab selection is ephemeral client state that resets to Month on reload. The calendar month is carried in the URL, not stored. The own channel choice is durable once set (the channel's `isOwn` flag). A measurement writes durable own account snapshots and own posts.

**History and undo.** Setting an own channel is not given an undo on this page. There is no unset control in the picker or the header, so switching back means marking a different channel or clearing the flag elsewhere. A measurement cannot be undone; it appends snapshots and insights rather than replacing them.

An action to clear the own channel without assigning it elsewhere exists (`unsetOwnChannelAction`), but this page does not call it. Reaching the picker again means no channel is marked own, which this page's UI provides no button to cause.

**Navigation and refresh.** This page renders on the server and re reads on navigation or an explicit refresh. Setting an own channel, rechecking a now valid token, and measuring each call a refresh so the server rendered header, tiles, and metrics reflect the change without a manual reload. The calendar month is a deep link (`?month=YYYY-MM`); the tab selection is not, so it does not survive a navigation.

**Background jobs and the sidecar.** The sidecar sync writes tracked videos, not own posts, so it never changes this page. Own posts come from a Graph measurement, which the connect panel triggers as a foreground action. The calendar's published cells depend on own posts having been measured; see the calendar (below).

**External services.** The Graph API is the one external service this page depends on, and only for the metrics band. When the token is missing or rejected the page degrades to the connect panel and keeps its header and tabs.

**Status and failures.** The picker and the connect panel surface success and failure as toasts. The connect panel also carries its own status copy for each token state (not configured, rejected, rate limited, unreachable, unknown, connected but never measured) and a "last checked" timestamp. The header's "not yet measured" line is a status of its own. Beyond these, failures surface in the shell's failure strip.

**Configuration and settings.** The `scoreMinUsablePosts` setting (default 5) sets the progress bar target and the point at which a median reach appears. The measurement window (30 days by default) labels the reach, saves, shares, and posts measured tiles. Neither is changed from this page.

### Edge cases

- The tab strip renders even when the metrics are gated off. With no Graph connection, Month still shows the planner, and Posts and Metrics show empty own post views rather than an error, because the planner and the own post list do not need the Graph token to render, only data the token would have produced.
- The connect panel appears in two shapes. When the account was never measured it fills the metrics area alone; when the account was measured before but the token now fails, it sits above the real numbers instead of hiding them.
- When the token is ok but nothing has been measured yet, the connect panel reads "Connected, nothing measured yet" and offers a "Measure now" button. That button appears only in this exact state.
- The follower count in the header comes from the tracked channel's own snapshot, while the Followers stat tile comes from the Graph account snapshot. The two can disagree when the Graph measurement is older or newer than the channel tracking, since they are separate sources.
- Three metrics have no tile at all (profile visits, follows from post, watch time), because the Graph client does not request them. A tile for a number the app cannot produce would be a control that does nothing.
- The picker lists every tracked channel that is not already own. On a machine with nothing tracked it shows a message pointing the user to add their Instagram account as a channel first, with no rows to pick.
- The median reach caption changes with the data: below the usable post floor it counts posts remaining ("N / 5 posts before a median reach appears"); once a median exists it names the sample it was built from.

## The posts and metrics tabs

### Summary

The Posts and Metrics tabs on the my channel page (above) read out the user's published, measured posts. Posts is a flat list of every own post the Graph API has recorded, newest first, with reach, length, and when it went up. Metrics is a bar chart of average reach by weekday. A third display, reach by post, sits above the tabs in the overview area rather than inside a tab, and this section covers it too because it reads the same data. All three are read only. They show measured numbers and nothing on them writes a row, opens a dialog, or starts a generation. The only thing a user can do is switch between tabs and click a post open on Instagram.

They live in the my channel page at `/mine`, which the section above owns as a whole. This section owns three of the things that page renders: the Posts tab, the Metrics tab, and the reach by post bars in the overview strip. All three read one server load of the user's own posts (limit 100, newest first) that the page fetches once and hands to each display.

Availability splits along a seam worth stating up front. The reach by post bars only appear once the channel has ever been measured; before that the whole overview strip is replaced by a connect panel and there are no bars. The Posts and Metrics tabs render no matter what, because they sit outside that gate; when nothing has been measured they show their own empty state instead. None of the three needs the LLM proxy or the sidecar. They need past Graph measurements, and when the Graph token is invalid they show whatever was measured before and nothing newer.

### The simple case

The user opens `/mine`. If the channel has been measured, the overview strip shows the reach by post bars: one bar per post, oldest on the left, the real reach printed above each bar. Below the strip is a row of three tabs, Month, Posts, and Metrics, with Month selected. The user clicks Posts and sees a table of their published posts, each row a caption, a reach number with a small bar, a length, and how long ago it went up. Clicking a row opens that post on Instagram in a new tab. The user clicks Metrics and sees seven bars, one per weekday, each the average reach of the posts published on that day, with a count underneath. Switching tabs is instant and changes nothing on the server.

### The interaction, event by event

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

#### Arrive

The page loads all of the user's own posts in one server read, newest first, capped at 100, and hands the same list to the reach by post bars, the Posts list, and the Metrics chart. Nothing is fetched per tab. The tab row starts on Month, so the Posts and Metrics content is present in the page but not shown until the user clicks its tab. The reach by post bars render immediately if the channel has ever been measured; otherwise the connect panel stands in their place.

The bars read oldest first, left to right. Each measured post gets a bar with a visible floor height so a reach of 9 next to a reach of 400 is still a bar and not an invisible sliver, and the number printed above the bar is always the real figure, never the floored one. A post with no measured reach gets no bar, only a dashed baseline and a dash for its number, and the caption line under the chart counts how many of the posts have a reach and how many do not.

#### Leave without acting

Nothing is recorded. There is no saved tab, no scroll position, no filter. Leaving and returning starts on the Month tab again. Which tab was open is client only state that a navigation or reload discards.

#### Begin acting

There is no acting to begin. These are displays. The nearest thing to an action is clicking a tab, which swaps the visible panel in the browser with no server call, and clicking a post row in the Posts list, which opens that post's Instagram permalink in a new browser tab and leaves the my channel page exactly as it was.

#### While acting

Nothing is in flight. A tab switch is immediate. Opening a post hands off to the browser and the my channel tab does not change.

#### Finish

Nothing is committed, because nothing was started. The numbers on screen are as fresh as the last measurement the page loaded. They do not update while the user watches; a new measurement appears only on the next navigation or refresh of the page.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (own post measured or not) | Decides what each display shows. A post with a measured reach gets a bar and a number; a post with none gets a dashed baseline in the bars, a dash in the list, and is left out of the weekday averages. With no measured posts at all, the bars are absent (the connect panel stands in), the Posts list shows "No posts synced from Instagram yet.", and Metrics shows "No measured posts yet to read a weekday rhythm from." | No effect. The list is a snapshot from page load and does not change as measurements land elsewhere. A new or updated measurement shows only after the page is navigated or refreshed. |
| Attached data present or absent (caption, duration, reach) | A missing caption renders as "Untitled post". A missing duration renders as a dash in the Length column. A missing reach is treated as not measured, distinct from a real reach of zero, and is drawn as a dash rather than a zero height bar. | No effect. |
| External service availability (LLM proxy, Graph, sidecar) | The LLM proxy and the sidecar are irrelevant here. The Graph API decides the data: these displays show past Graph measurements. When the token is invalid, the reach by post bars still show earlier measurements if the channel was ever measured, with a connect panel stacked above them, while the Posts and Metrics tabs render their snapshot regardless. When the channel was never measured, the bars are gone and both tabs show their empty state. | No effect within a page visit. A token going invalid mid visit changes nothing on screen until the page is reloaded. |
| Keyboard shortcut in play | The tab row is keyboard reachable: arrow keys move between Month, Posts, and Metrics when the tab list has focus, and Enter or Space activates a tab. No other key does anything here. | No effect. There is no shortcut that changes what a display shows. |

There is no modifier that changes what any of these displays present. The only inputs are which tab is active and, in the list, which post row is clicked.

### Cancel and interrupt

These are read only displays, so most interrupts have nothing to disturb. The table is filled for completeness; most cells are "no effect" because there is no uncommitted work and nothing in flight.

| Event | Before commit (viewing) | While in flight (nothing is) |
| --- | --- | --- |
| Explicit cancel or stop | Nothing to cancel. Switching away from a tab discards nothing, because a tab holds no unsaved state. | No effect. Nothing runs to stop. |
| Navigate away mid action | Leaving the page drops the client tab selection and returns to Month on the next visit. No data is lost because none was held. | No effect. |
| Reload or tab or window closed | The active tab resets to Month on reload. The displays re-render from a fresh server read, which may include measurements that landed since the last load. | No effect. |
| A backing service fails mid action | No service is called while viewing. If the Graph token was already invalid at page load, the displays show the last measurements taken before it failed, and the connect panel names the problem above the bars. A service failing after load changes nothing until reload. | No effect. |
| The target record changes underneath | A measure run writing new own post rows or new insights does not touch the open page; the current tab keeps showing the numbers from the last load until a navigation or refresh. | No effect. |
| A background job finishes or fails on its own | A measure run finishing while the user is on the Posts or Metrics tab does not update the numbers in place. The freshened figures appear on the next navigation or refresh. | No effect. |
| A second tab or a double action on the same record | Opening the same post in the list twice opens two Instagram browser tabs. Two my channel tabs open at once each hold their own tab selection and their own snapshot; neither writes anything, so they cannot conflict. | No effect. |

After any of these the user stays on the my channel page. Nothing here can be left half done, because nothing here commits.

### Interactions with other systems

**Persistence and autosave.** Nothing is saved. The active tab is transient client state, discarded on navigation or reload. There is no per user preference for a default tab; the page always opens on Month. The underlying own post and insight rows are durable, but they are written by the measure run, not by anything on these tabs.

**History and undo.** There is nothing to undo. No action on these displays changes any record.

**Navigation and refresh.** The displays are server rendered from one read at page load and stay fixed until the page is navigated or refreshed. Switching tabs is client only and does not re-read the server. Clicking a post row opens its Instagram permalink in a new browser tab and leaves the page untouched.

**Background jobs and the sidecar.** The measure run that writes own posts and their insights is a background job; these tabs only read what it has already written. A run finishing while the page is open does not update the numbers until the next load.

**External services.** Only the Graph API matters, and only indirectly: these displays show measurements it took in the past, never a live call. When its token is invalid the reach by post bars still show earlier numbers if any exist, with a connect panel above them; the Posts and Metrics tabs render their snapshot either way.

**Status and failures.** There is no failure surface on these displays themselves. A per post insight that failed to measure is carried as a missing reach and rendered as a dash, not an error. The connection problem, when there is one, is named by the connect panel in the overview strip, which the section above owns.

**Configuration and settings.** `scoreMinUsablePosts` sets how many measured posts are needed before a median reach exists, which drives the overview progress line and the median that the section above owns. It does not change what these three displays show; the list, the bars, and the weekday chart render every measured post regardless of the median floor.

### Edge cases

- The reach by post bars and the two tabs come from the same 100 post load, but the bars are gated on the channel having ever been measured while the tabs are not. So a channel that was measured before but whose token is now invalid shows the bars with historical numbers and a connect panel on top; a channel never measured shows no bars but still shows the Posts and Metrics tabs with their empty states.
- Only the newest 100 own posts are loaded. A channel with more than 100 measured posts shows the 100 most recent everywhere; the total count in the overview reflects all of them, but the list, the bars, and the weekday averages are computed over the loaded 100.
- The list orders newest first; the reach by post bars order oldest first, left to right, to match the calendar's reading direction. The same posts appear in opposite order in the two places on purpose.
- A missing reach is not a zero. In every display a post with no measurement reads as a dash and is left out of averages, so a real reach of zero and an unmeasured post never look the same.
- The weekday chart warns in its own caption that with only a handful of measured posts spread across seven days, most weekdays carry one post or none, and it should be read as a reading rather than a rhythm. A weekday with no measured posts shows a dash and a near flat bar.
- The bars use a floor height so a tiny reach is still visible, but the floor is purely visual. The printed number above a bar is always the true reach, so nothing makes a small number look larger than it is.
- The list computes a reach against median index for each post but does not display it. Only reach, length, and published date appear in the list; the index is carried in the data and shown nowhere on these tabs.

## The month calendar

### Summary

The month calendar is the planner's main view: a seven column grid, Monday through Sunday, of the current month, where each day cell shows what is planned or what published on that date. It is the Month tab of the my channel page (above), which is where it lives and how it is reached, and it is the default tab, so it is what the user sees when they land on `/mine`. The tab is active when the Month trigger is selected and the grid is on screen.

The calendar reads two things: planned posts, which need no external service, and published cells drawn from own channel measurements, which need the Graph API. Because of that split it is available in every restricted state. With no own channel set the my channel page shows a picker and the calendar does not render at all. With the Graph token invalid or the channel never measured, the grid still renders every plan; only the published and dead air cells stay off, and a line says so. The LLM proxy and the sidecar have no part in this tab.

Rescheduling a plan is an edit in the plan dialog (below), not a drag. There is no drag anywhere in this tab. A day cell is a button that opens the day detail; every change to a plan's date is made through the dialog.

The drag move logic in `src/lib/kanban-moves.ts` belongs to the Channels board (`src/components/channels/kanban-board.tsx`), a different screen outside the core loop. It never touches the calendar. `mine-calendar.tsx` renders cells as plain buttons with no drag handlers.

### The simple case

The user opens the my channel page. The Month tab shows the current month. Days with nothing planned are empty outlines. A day with a scheduled plan shows the word "scheduled" and the plan's title. A scheduled day whose date has already passed shows "missed" in red instead. If the own channel has been measured, days that published show the reach number, and long runs with nothing published are shaded as dead air.

The user clicks a day. A panel slides in from the right (or up from the bottom on a narrow screen) showing that day's detail: the date, the plan's title, its state, its note, and its script if it carries one. From the panel the user can open the plan for editing, mark it published, or delete it. To plan a new post the user clicks "New planned post" at the top, or clicks an empty day and then "Plan something for this day". Both open the plan dialog (below). The arrows beside the month name move to the previous or next month; "Today" jumps back to the current one.

### The interaction, event by event

```
stateDiagram-v2
    [*] --> monthGrid
    monthGrid --> monthGrid : prev / next / Today (reloads the month)
    monthGrid --> daySelected : click a day cell
    daySelected --> monthGrid : Escape, click outside (nothing written)
    daySelected --> planDialog : New, edit / reschedule, or Plan something
    daySelected --> marking : Yes that's it, or mark published no link
    daySelected --> deleting : delete
    marking --> monthGrid : success (refresh, toast)
    deleting --> monthGrid : success (refresh, undo toast)
    planDialog --> monthGrid : saved (refresh)
```

The plan dialog (below) owns the create and edit flow; this section stops at the point the calendar hands off to it and picks up when it returns.

#### Arrive

The month is decided by the `?month=YYYY-MM` query parameter, defaulting to the current month when it is absent or malformed. The page reads the whole month in one server call: the plans that fall in it, the undated drafts (which belong to no month and appear under every one), the published cells from own posts, the dead air runs, and whether any measurement exists at all. The grid is built from that. Nothing is focused and no panel is open. Today's cell is labelled "today". Cells for days spilling in from the neighbouring months are dimmed but still clickable.

#### Leave without acting

Switching to another tab, navigating away, or reloading records nothing. The selected day and the open detail panel are client state only; there is no draft of a plan sitting in the calendar. The only durable state is what already lives in the database.

#### Begin acting

Clicking a day cell selects it and opens the day detail panel. This is the calendar's "begin acting": it commits nothing, it just reveals what that day holds and the actions available on it. From here the real work is one of four things, and three of them leave the calendar. Opening the plan dialog (New, edit, reschedule, or Plan something) hands off to the plan dialog (below). The two the calendar owns are marking a plan published and deleting a plan.

#### While acting

The plan dialog manages its own in flight state. For the two calendar owned writes, marking published and deleting, the action runs as a server call and the panel stays as it is until it settles. There is no progress indicator on the cell itself; the grid does not change until the page re-reads.

#### Finish

Marking a plan published writes `publishedOwnPostId` on it and shows a toast ("Marked published" when reconciled against a matching own post, "Marked published, no post linked" otherwise), then re-reads the month. The cell then carries a small filled marker in its corner. Deleting a plan removes the row, closes the panel, re-reads, and shows a "Planned post deleted" toast with an Undo action. A new plan created or an existing one edited or rescheduled commits inside the plan dialog (below); on return the page re-reads and the cell reflects the change.

Missed is not a finish state anyone reaches by acting. A scheduled plan whose date has passed reads as missed on the next read, with nothing written and no click involved.

"Missed" is computed on every read in `getCalendarMonth`/`getPlannedPosts` from today's date against the plan's `plannedDate`. The stored `state` column is only ever draft or scheduled. There is no code path in this tab that writes missed, by design: a stored missed would become a lie the moment the plan was rescheduled.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (plan draft, scheduled, missed, published) | Decides the cell. An undated draft shows only in the undated drafts list below the grid, not in any day cell. A scheduled plan shows "scheduled" and its title; if its date has passed it shows "missed" in red. A day with an own post shows as published with its reach. A plan marked published carries a filled corner marker. | The user changes state by marking published (from the panel) or by rescheduling in the plan dialog. Missed changes to scheduled only by giving the plan a future date. |
| Attached data present or absent (script) | A plan with a script shows its script title in the detail and a link to the source outlier when it has one. A plan whose script was detached shows the detach note in red, distinct from a plan that never had a script ("no script yet"). | Attaching or detaching a script happens in the plan dialog, not here; the panel reflects it after the re-read. |
| External service availability (Graph, LLM proxy, sidecar) | The Graph API gates the published and dead air cells and the legend entries for them. With no measurement the grid shows plans only and a line explains the rest is unavailable. The LLM proxy and sidecar have no effect. | No effect. None of these is called by a calendar action. |
| Keyboard shortcut in play | None on the grid itself; the cells are ordinary buttons reached by Tab. | Escape closes the open day detail panel. There is no keyboard shortcut to move months or to select a day. |

### Cancel and interrupt

The in flight window here is short: a single server action (mark published or delete) inside a React transition, followed by a page re-read. The calendar does not run generations or background jobs of its own.

| Event | Before commit (panel open, or dialog handed off) | While in flight (marking or deleting) |
| --- | --- | --- |
| Explicit cancel or stop | Escape or a click outside closes the day detail and writes nothing. Cancelling the plan dialog is that flow's concern. | There is no cancel for a mark or a delete once clicked; the write runs to completion. |
| Navigate away mid action | Leaving abandons the open panel; nothing is saved. | A navigation still leaves. The server write may land, but the re-read that flips the cell does not; the next visit shows the true state. |
| Reload or tab or window closed | The open panel and selected day are lost. Nothing was pending to save. | The write may or may not have completed. On next load the grid reflects whatever the database holds. |
| A backing service fails mid action | The published and dead air cells depend on the Graph measurement; when it is absent they simply do not render and a line says so. Nothing errors. | A delete or a mark that hits a database error returns a message and a toast; the panel stays open. Marking published against an own post that no longer exists returns "That own-channel post doesn't exist." |
| The target record changes underneath | A plan edited or deleted in another tab is not reflected until this page re-reads. The panel holds the copy the last read handed it. A source video removed by a sync leaves the plan in place with its source link gone null (the "source outlier" link disappears). | A delete of an already deleted row is treated as success. A mark against a plan another tab already deleted returns "That planned post no longer exists." |
| A background job finishes or fails on its own | The sidecar can write new own posts or a measurement between reads; the calendar shows them only after a re-read. No cook run or render touches this tab. | No effect. |
| A second tab or a double action on the same record | Two tabs can each open the same day; each holds its own copy. | A double delete is a no-op success the second time. A double mark published just rewrites the same value. Undo after a delete re-creates the plan (see edge cases). |

### Interactions with other systems

**Persistence and autosave.** Nothing in the calendar autosaves. The selected day and the open panel are transient client state. A plan is durable only once the plan dialog, a mark published, or a delete has committed it. The month in the URL persists across a reload because it is in the query string.

**History and undo.** Deleting a plan offers an Undo in its toast, which re-creates the plan. The re-create carries the title, note, date, and script but not the plan's original id, its remix session link, its source video link, its video kind, its time, its target length, or its published mark; so an undone delete is a similar plan, not the identical record. There is no undo for marking published, for an edit, or for a reschedule; those are reversed by editing again. There is no global undo stack.

**Navigation and refresh.** Moving between months is navigation, not client state: the previous, next, and Today controls are links that change the `?month` query parameter and reload the page for the new month. After a mark published or a delete the page calls a refresh so the grid re-reads without a manual reload.

**Background jobs and the sidecar.** The sidecar sync writes own posts and account measurements, which feed the published cells, the reach numbers, the dead air runs, and the reconciliation prompt. The calendar reads them; it never triggers the sidecar. No cook run or render is started or shown here.

**External services.** The Graph API measurement gates half the grid: published cells, dead air shading, reach numbers, and the "you posted something on this date" reconciliation prompt all need it. Plans need nothing external. The LLM proxy and transcript providers have no part in this tab.

**Status and failures.** Success and failure of a mark or a delete surface as toasts. The missing measurement is not an error; it is stated plainly as a line above the grid and by the absence of the published and dead air legend entries. There is no inline error inside the day panel.

**Configuration and settings.** The dead air threshold (three or more elapsed days with nothing published) is a fixed constant, not a user setting. Nothing on the settings page changes this tab's behavior.

### Edge cases

- Days from the neighbouring months fill the first and last rows so weeks are whole. They are dimmed but clickable, and a plan or a published post on such a day still shows and still opens.
- Cell kind has a fixed precedence: published wins over missed, missed over scheduled, scheduled over dead air, dead air over open. A day that both published and had a plan reads as published.
- A published cell whose measurement carries no reach number shows a dash rather than a zero. The same dash stands in for a missing title in the day panel.
- Dead air never extends into the future: a run of empty days is truncated at today, since a day that has not happened cannot be a missed day yet.
- The undated drafts list under the grid holds every plan with no date, on every month. "Give it a date" opens the plan dialog to schedule it; deleting one offers the same Undo as a dated plan.
- The reconciliation prompt is a suggestion, never an automatic confirm. A same date match between a plan and an own post is a strong hint, not proof (two different videos can post on one day), so the calendar asks "mark this plan published against it?" and waits for the click. Once a plan is marked published by hand the prompt stops appearing.

## The plan dialog

### Summary

The plan dialog creates a new planned post or edits an existing one. A planned post is a dated intention to publish on the user's own channel, optionally carrying a script. This one dialog is where the user names it, dates it, attaches or detaches a script, and sets a video kind. It is a single modal, not a page. It is reached from the calendar (above): clicking an empty day, or the "add" control, opens it in create mode with the day prefilled; clicking an existing plan opens it in edit mode with that plan's fields loaded. Its own header says what it is doing, "New planned post" or "Edit planned post", and its description states the one thing it does not do: "Nothing here publishes or reminds. This is a dated intention, nothing more, until you mark it published by hand."

The dialog writes only to the `plannedPosts` table through the planned post actions. It needs no external service, so it works whole whether or not the LLM proxy, the Graph API, or the sidecar are running. There is no automatic publish path anywhere in this feature: a plan becomes published only when the user marks it so by hand, and that control lives on the calendar and the studio, not in this dialog.

The calendar mounts the dialog only while it is open and unmounts it on close (`dialogState` goes null). Every open therefore starts from a fresh copy of the plan or the preset date; nothing typed into one open survives into the next.

### The simple case

To plan a post, the user clicks a day on the calendar. The dialog opens with that date filled in. They type a title, optionally a note, optionally pick a script and a video kind, and click "Create plan". The dialog closes, a toast says "Planned" (or "Saved as a draft" if they cleared the date), and the new plan appears on the calendar.

To change a plan, the user clicks it on the calendar. The dialog opens with its title, note, date, script, and video kind already loaded. They edit any of these and click "Save changes". The dialog closes, a toast says "Plan updated", and the calendar reflects the change. From edit mode the user can also click "Create in Studio", which leaves the dialog and opens the studio for that plan.

A plan with no script is allowed, but the user has to say so on purpose. If no script is selected the dialog shows a checkbox, "I don't have a script yet", and Save stays disabled until it is ticked. This is the one rule the dialog exists to enforce: a title should not turn into a note with a date by accident.

### The interaction, event by event

```
stateDiagram-v2
    [*] --> closed
    closed --> createOpen : click an empty day or add
    closed --> editOpen : click an existing plan
    createOpen --> createOpen : edit fields (title, date, note, script, kind)
    editOpen --> editOpen : edit fields
    createOpen --> saving : click Create plan (Save enabled)
    editOpen --> saving : click Save changes (Save enabled)
    saving --> closed : success (toast, refresh)
    saving --> editOpen : a write in the sequence failed (inline error, dialog stays)
    saving --> createOpen : create failed (inline error, dialog stays)
    createOpen --> closed : Cancel, Escape, click outside (discard)
    editOpen --> closed : Cancel, Escape, click outside (discard)
    editOpen --> [*] : Create in Studio (navigate to /mine/{id}/studio)
```

#### Arrive

In create mode the dialog opens empty except for the date, which is prefilled from the calendar cell that was clicked (the preset date). Title, note, script, and video kind start blank. The no-script checkbox starts unticked, so Save is disabled until a title is typed and the checkbox is ticked (or a script is chosen).

In edit mode every field is loaded from the plan: its title, note, planned date, attached script, and video kind. If the plan already had no script and no remix session, the no-script checkbox arrives already ticked, so an existing scriptless plan does not force the user to re-acknowledge it just to change the title.

The date field is a native date input. There is no time field and no target length field in this dialog; neither is offered on create or edit here, even though the underlying records can hold both.

Nothing is written on open. The dialog holds all edits in local state until Save.

#### Leave without acting

Closing the dialog with Cancel, Escape, or a click outside writes nothing. No row is created and no existing plan is touched. Because the calendar unmounts the dialog on close, whatever was typed is gone; reopening starts fresh from the plan or the preset date again.

#### Begin acting

The user's first edit only makes the form dirty in memory. Real work starts when they click the primary button, "Create plan" or "Save changes". That button is disabled until the form is valid: the title must be non-blank, and if no script is selected and the plan does not carry a remix script, the no-script checkbox must be ticked. From the click, the button reads "Saving" and is disabled so a second click cannot start a second write.

#### While acting

The dialog stays open with its button showing "Saving". In create mode this is a single write. In edit mode the dialog applies only the fields that changed, one action at a time, in a fixed order: title and note first, then the date, then the script, then the video kind. Each is its own server action. If one fails, the sequence stops there: whatever already succeeded stays written, the dialog stops with "Saving" cleared, and the failure reason appears as red inline text below the fields. The user is not told which writes landed before the failure; they see the plan partly changed on the next refresh.

There is no single patch action for a planned post. The edit path calls up to four actions in sequence (`updatePlannedPostAction` for title and note, `schedulePlannedPostAction` or `unschedulePlannedPostAction` for the date, `attachScriptToPlanAction` or `detachScriptFromPlanAction` for the script, `updatePlannedPostAction` again for the video kind). A mid-sequence failure is therefore a partial edit, not a rollback.

#### Finish

On success the dialog closes, a toast confirms the result, the calendar's parent clears the dialog, and the page re-reads so the new or changed plan shows. The toasts are: "Planned" when a create carried a date, "Saved as a draft" when a create had no date, and "Plan updated" for any successful edit. On failure the dialog stays open with the typed values intact and the reason shown inline; the user can fix and retry.

How the date decides the state: a create with a date writes a scheduled plan, a create without one writes a draft. On edit, giving a dateless plan a date schedules it, and clearing a scheduled plan's date returns it to draft (undated). A date in the past is accepted, not refused; it simply reads as missed on the calendar, which is derived on read, never stored.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (draft, scheduled, missed, published) | State is not read directly; the date field carries it. A draft opens with a blank date, a scheduled or missed plan opens with its date filled, a published plan opens like any other (this dialog neither shows nor sets published). What changes is set at Save from the date: a date present means scheduled, absent means draft. | Editing the date reschedules (any future or past date) or, if cleared, unschedules back to draft. There is no control here to mark or clear published; that lives on the calendar and the studio. Editing a missed plan does not "un-miss" it except by moving its date forward or clearing it. |
| Attached data present or absent (script, remix session) | If the plan carries a script from a remix session, the script select is replaced by a line saying detaching is not offered here and to do it from the vault. Otherwise the script select loads the attached script, or "No script" with the acknowledgment checkbox. | Choosing a different script swaps the attachment; choosing "No script" detaches it and surfaces the acknowledgment checkbox. A plan carrying a remix script cannot be detached in this dialog at all. |
| External service availability (LLM proxy, Graph, sidecar) | No effect. The dialog reads and writes only local plan records. The script list is passed in from the page, not fetched live. | No effect on the write. A missing service does not block creating, editing, scheduling, attaching, or deleting a plan. |
| Keyboard shortcut in play | Escape closes the dialog and discards. Focus lands in the dialog on open. | Enter inside the title input does not submit; there is no keyboard shortcut that commits. Enter in the note textarea inserts a newline. |

The one modifier that changes what Save does is the date field's presence. There is no other mode toggle.

### Cancel and interrupt

| Event | Before commit (dialog open) | While in flight (saving) |
| --- | --- | --- |
| Explicit cancel or stop | Cancel, Escape, or a click outside closes the dialog and discards every edit. Nothing is written. | The primary button is disabled while saving, so there is no cancel; the write sequence runs to completion or to its first failure. |
| Navigate away mid action | Leaving the calendar abandons the open dialog with nothing saved. "Create in Studio" is a deliberate navigation, not an interrupt: it leaves without saving any pending edits. | A navigation can land after some edit-sequence writes committed and before others; the plan is left partly changed. No toast or refresh follows if the page unmounted. |
| Reload or tab or window closed | The open dialog and all unsaved edits are lost. Nothing is written. | A reload mid-sequence can leave a partial edit: the writes that reached the server hold, the rest do not. The next load shows the true stored state. |
| A backing service fails mid action | No external service is used, so nothing fails on open. The script list was loaded with the page. | A database error returns `{ok:false}` with a reason shown inline; the dialog stays open. In edit mode the failure stops the sequence, so earlier writes in the order stay committed. |
| The target record changes underneath | If the plan was deleted in another tab, editing it returns "That planned post no longer exists." If a chosen script was deleted meanwhile, attaching returns "That script no longer exists." Values loaded on open can already be stale. | The same errors surface mid-sequence and halt it. A create is unaffected since it has no prior record. |
| A background job finishes or fails on its own | No effect. This dialog does not spawn or watch any background job; a cook run elsewhere does not touch it. | No effect. |
| A second tab or a double action on the same record | Two dialogs open on the same plan hold independent copies; the last Save wins per field, and a field one tab did not touch is left as the other tab wrote it. | A double click on Save is blocked by the disabled state. Two tabs saving at once can interleave writes across the sequence, since each field is a separate action. |

After an interrupt the plan is left in whatever state the committed writes produced. A create either wrote its one row or did not. An edit can be partial because it is a sequence of separate writes with no rollback.

### Interactions with other systems

**Persistence and autosave.** Nothing in the dialog autosaves. Every field lives in local state until Save, and closing discards it. The only durable writes are the plan actions the primary button fires. The acknowledgment checkbox is never stored; the plan's null script link is what records "no script", and the calendar renders that null state distinctly.

**History and undo.** Saving a create or an edit is not undoable from the dialog. Deleting a plan is undoable, but that control and its Undo live on the calendar (above), not here: the delete toast offers Undo, which recreates the plan from its title, note, date, and script. That recreation drops the video kind and the remix and source links, so an undone delete is not a byte-for-byte restore.

**Navigation and refresh.** After a successful save the dialog calls a router refresh so the calendar re-reads and shows the change. "Create in Studio" navigates to `/mine/{postId}/studio`.

**Background jobs and the sidecar.** None. Planning a post neither starts a cook run nor waits on the sidecar sync. A plan is inert until the user opens it in the studio.

**External services.** None. The dialog calls no LLM proxy, no Graph API, no transcript provider. It is one of the parts of the core loop that works fully in every restricted state.

**Status and failures.** Success is a toast; failure is red inline text inside the dialog, not a toast. This differs from the keep this post button, which shows failures as toasts and keeps no inline error. Delete and mark-published, run from the calendar and studio, report through toasts.

**Configuration and settings.** None. No app setting changes this dialog. The video kind options come from a fixed eight-item list in the code (explainer, site-tour, product-promo, music-video, pr-announcement, talking-head, slideshow, general), not from settings; the stale flag mentioned in the checkbox text (a scriptless plan gets flagged stale after 30 days) is applied by the calendar's read, not by this dialog.

### Edge cases

- The dialog never sets a time or a target length. The `plannedPosts` record and the schedule and update actions can hold both, and other paths (a remix finish, the studio) may set them, but this dialog leaves them untouched. Editing a plan through this dialog preserves whatever time or target length it already had.
- The video kind select only ever offers the eight valid kinds, so the action's `BAD_VIDEO_KIND` refusal is not reachable from the UI. It guards a crafted request, not a user click.
- Detaching a script here writes no reason. The detach records a note like "Script detached on 2026-08-27." so the plan reads as one that lost its script, distinct from a plan that never had one. A reason string is supported by the action but the dialog does not collect one.
- Attaching a script clears any prior detach note, since the plan is no longer in the "lost its script" state that note describes.
- A plan that carries a remix script cannot have that script changed or removed in this dialog; the script select is hidden and a line points the user to the vault. Other fields on such a plan are still editable.
- On edit, if the user opens the dialog and saves without changing anything, no action fires (each write is gated on a real change), so the "Plan updated" toast can appear even though nothing was written.
- A blank or whitespace-only title is refused on both create and edit; the title is trimmed before the check.
- Marking a plan published and deleting a plan are part of the planned post lifecycle but are not in this dialog. Mark-published runs from the calendar's reconcile prompt and no-link control and from the studio publish step; delete runs from the calendar day panel and the undated drafts list. Marking published with no linked own post is legal and means "it went out, I am not linking it"; a non-null own post id is checked against the own posts table first.
</content>
