# The month calendar

## Summary

The month calendar is the planner's main view: a seven column grid, Monday
through Sunday, of the current month, where each day cell shows what is planned
or what published on that date. It is the Month tab of the [my channel
page](mine-overview.md), which is where it lives and how it is reached, and it
is the default tab, so it is what the user sees when they land on `/mine`. The
tab is active when the Month trigger is selected and the grid is on screen.

The calendar reads two things: [planned posts](../foundations/data-model.md#planned-post),
which need no external service, and published cells drawn from own channel
measurements, which need the [Graph API](../foundations/data-model.md#own-post).
Because of that split it is available in every restricted state. With no own
channel set the my channel page shows a picker and the calendar does not render
at all. With the Graph token invalid or the channel never measured, the grid
still renders every plan; only the published and dead air cells stay off, and a
line says so. The [LLM proxy](../glossary.md#generation) and the sidecar have no
part in this tab.

Rescheduling a plan is an edit in the [plan dialog](plan-dialog.md), not a drag.
There is no drag anywhere in this tab. A day cell is a button that opens the day
detail; every change to a plan's date is made through the dialog.

> Technical note: the drag move logic in `src/lib/kanban-moves.ts` belongs to the
> Channels board (`src/components/channels/kanban-board.tsx`), a different screen
> outside the core loop. It never touches the calendar. `mine-calendar.tsx`
> renders cells as plain buttons with no drag handlers.

## The simple case

The user opens the my channel page. The Month tab shows the current month. Days
with nothing planned are empty outlines. A day with a scheduled plan shows the
word "scheduled" and the plan's title. A scheduled day whose date has already
passed shows "missed" in red instead. If the own channel has been measured, days
that published show the reach number, and long runs with nothing published are
shaded as dead air.

The user clicks a day. A panel slides in from the right (or up from the bottom on
a narrow screen) showing that day's detail: the date, the plan's title, its
state, its note, and its script if it carries one. From the panel the user can
open the plan for editing, mark it published, or delete it. To plan a new post
the user clicks "New planned post" at the top, or clicks an empty day and then
"Plan something for this day". Both open the [plan dialog](plan-dialog.md). The
arrows beside the month name move to the previous or next month; "Today" jumps
back to the current one.

## The interaction, event by event

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

The [plan dialog](plan-dialog.md) owns the create and edit flow; this document
stops at the point the calendar hands off to it and picks up when it returns.

### Arrive

The month is decided by the `?month=YYYY-MM` query parameter, defaulting to the
current month when it is absent or malformed. The page reads the whole month in
one server call: the plans that fall in it, the undated drafts (which belong to
no month and appear under every one), the published cells from own posts, the
dead air runs, and whether any measurement exists at all. The grid is built from
that. Nothing is focused and no panel is open. Today's cell is labelled "today".
Cells for days spilling in from the neighbouring months are dimmed but still
clickable.

### Leave without acting

Switching to another tab, navigating away, or reloading records nothing. The
selected day and the open detail panel are client state only; there is no draft
of a plan sitting in the calendar. The only durable state is what already lives
in the database.

### Begin acting

Clicking a day cell selects it and opens the day detail panel. This is the
calendar's "begin acting": it commits nothing, it just reveals what that day
holds and the actions available on it. From here the real work is one of four
things, and three of them leave the calendar. Opening the plan dialog (New,
edit, reschedule, or Plan something) hands off to [that document](plan-dialog.md).
The two the calendar owns are marking a plan published and deleting a plan.

### While acting

The plan dialog manages its own in flight state. For the two calendar owned
writes, marking published and deleting, the action runs as a server call and the
panel stays as it is until it settles. There is no progress indicator on the
cell itself; the grid does not change until the page re-reads.

### Finish

Marking a plan published writes `publishedOwnPostId` on it and shows a toast
("Marked published" when reconciled against a matching own post, "Marked
published, no post linked" otherwise), then re-reads the month. The cell then
carries a small filled marker in its corner. Deleting a plan removes the row,
closes the panel, re-reads, and shows a "Planned post deleted" toast with an
Undo action. A new plan created or an existing one edited or rescheduled commits
inside the [plan dialog](plan-dialog.md); on return the page re-reads and the
cell reflects the change.

Missed is not a finish state anyone reaches by acting. A scheduled plan whose
date has passed reads as missed on the next read, with nothing written and no
click involved.

> Technical note: "missed" is computed on every read in
> `getCalendarMonth`/`getPlannedPosts` from today's date against the plan's
> `plannedDate`. The stored `state` column is only ever draft or scheduled. There
> is no code path in this tab that writes missed, by design: a stored missed would
> become a lie the moment the plan was rescheduled.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (plan draft, scheduled, missed, published) | Decides the cell. An undated draft shows only in the undated drafts list below the grid, not in any day cell. A scheduled plan shows "scheduled" and its title; if its date has passed it shows "missed" in red. A day with an own post shows as published with its reach. A plan marked published carries a filled corner marker. | The user changes state by marking published (from the panel) or by rescheduling in the plan dialog. Missed changes to scheduled only by giving the plan a future date. |
| Attached data present or absent (script) | A plan with a script shows its script title in the detail and a link to the source outlier when it has one. A plan whose script was detached shows the detach note in red, distinct from a plan that never had a script ("no script yet"). | Attaching or detaching a script happens in the plan dialog, not here; the panel reflects it after the re-read. |
| External service availability (Graph, LLM proxy, sidecar) | The Graph API gates the published and dead air cells and the legend entries for them. With no measurement the grid shows plans only and a line explains the rest is unavailable. The LLM proxy and sidecar have no effect. | No effect. None of these is called by a calendar action. |
| Keyboard shortcut in play | None on the grid itself; the cells are ordinary buttons reached by Tab. | Escape closes the open day detail panel. There is no keyboard shortcut to move months or to select a day. |

## Cancel and interrupt

The in flight window here is short: a single server action (mark published or
delete) inside a React transition, followed by a page re-read. The calendar does
not run generations or background jobs of its own.

| Event | Before commit (panel open, or dialog handed off) | While in flight (marking or deleting) |
| --- | --- | --- |
| Explicit cancel or stop | Escape or a click outside closes the day detail and writes nothing. Cancelling the plan dialog is that document's concern. | There is no cancel for a mark or a delete once clicked; the write runs to completion. |
| Navigate away mid action | Leaving abandons the open panel; nothing is saved. | A navigation still leaves. The server write may land, but the re-read that flips the cell does not; the next visit shows the true state. |
| Reload or tab or window closed | The open panel and selected day are lost. Nothing was pending to save. | The write may or may not have completed. On next load the grid reflects whatever the database holds. |
| A backing service fails mid action | The published and dead air cells depend on the Graph measurement; when it is absent they simply do not render and a line says so. Nothing errors. | A delete or a mark that hits a database error returns a message and a toast; the panel stays open. Marking published against an own post that no longer exists returns "That own-channel post doesn't exist." |
| The target record changes underneath | A plan edited or deleted in another tab is not reflected until this page re-reads. The panel holds the copy the last read handed it. A source video removed by a sync leaves the plan in place with its source link gone null (the "source outlier" link disappears). | A delete of an already deleted row is treated as success. A mark against a plan another tab already deleted returns "That planned post no longer exists." |
| A background job finishes or fails on its own | The sidecar can write new own posts or a measurement between reads; the calendar shows them only after a re-read. No cook run or render touches this tab. | No effect. |
| A second tab or a double action on the same record | Two tabs can each open the same day; each holds its own copy. | A double delete is a no-op success the second time. A double mark published just rewrites the same value. Undo after a delete re-creates the plan (see edge cases). |

## Interactions with other systems

**Persistence and autosave.** Nothing in the calendar autosaves. The selected
day and the open panel are transient client state. A plan is durable only once
the plan dialog, a mark published, or a delete has committed it. The month in the
URL persists across a reload because it is in the query string.

**History and undo.** Deleting a plan offers an Undo in its toast, which
re-creates the plan. The re-create carries the title, note, date, and script but
not the plan's original id, its remix session link, its source video link, its
video kind, its time, its target length, or its published mark; so an undone
delete is a similar plan, not the identical record. There is no undo for marking
published, for an edit, or for a reschedule; those are reversed by editing again.
There is no global undo stack.

**Navigation and refresh.** Moving between months is navigation, not client
state: the previous, next, and Today controls are links that change the `?month`
query parameter and reload the page for the new month. After a mark published or
a delete the page calls a refresh so the grid re-reads without a manual reload.
See [navigation and shell](../foundations/navigation-and-shell.md) for the
refresh model.

**Background jobs and the sidecar.** The sidecar sync writes own posts and
account measurements, which feed the published cells, the reach numbers, the dead
air runs, and the reconciliation prompt. The calendar reads them; it never
triggers the sidecar. No cook run or render is started or shown here.

**External services.** The Graph API measurement gates half the grid: published
cells, dead air shading, reach numbers, and the "you posted something on this
date" reconciliation prompt all need it. Plans need nothing external. The LLM
proxy and transcript providers have no part in this tab.

**Status and failures.** Success and failure of a mark or a delete surface as
toasts. The missing measurement is not an error; it is stated plainly as a line
above the grid and by the absence of the published and dead air legend entries.
There is no inline error inside the day panel.

**Configuration and settings.** The dead air threshold (three or more elapsed
days with nothing published) is a fixed constant, not a user setting. Nothing on
the settings page changes this tab's behavior.

## Edge cases

- Days from the neighbouring months fill the first and last rows so weeks are
  whole. They are dimmed but clickable, and a plan or a published post on such a
  day still shows and still opens.
- Cell kind has a fixed precedence: published wins over missed, missed over
  scheduled, scheduled over dead air, dead air over open. A day that both
  published and had a plan reads as published.
- A published cell whose measurement carries no reach number shows a dash rather
  than a zero. The same dash stands in for a missing title in the day panel.
- Dead air never extends into the future: a run of empty days is truncated at
  today, since a day that has not happened cannot be a missed day yet.
- The undated drafts list under the grid holds every plan with no date, on every
  month. "Give it a date" opens the plan dialog to schedule it; deleting one
  offers the same Undo as a dated plan.
- The reconciliation prompt is a suggestion, never an automatic confirm. A same
  date match between a plan and an own post is a strong hint, not proof (two
  different videos can post on one day), so the calendar asks "mark this plan
  published against it?" and waits for the click. Once a plan is marked published
  by hand the prompt stops appearing.

## Open questions and verification

- A plan marked published by hand, whose date has passed and which has no own
  post on that date, computes as missed on read while also carrying the published
  corner marker, so its cell can read as a red missed day with a published mark.
  Whether this pairing is intended or should suppress the missed reading was read
  from code but not confirmed by hand.
- Whether a mark published or a delete that is interrupted by a navigation or a
  reload during the brief in flight window reliably commits was read from the
  code but not confirmed by hand. The write is a server action inside a React
  transition; the exact behavior when the page unmounts mid transition needs a
  live check.
- The lossy Undo after a delete (a re-created plan missing the original id, remix
  session, source video, video kind, time, target length, and published mark) was
  read from the code but its felt impact on the user was not confirmed in the
  running product.
- The month navigation and Today controls are full page links rather than client
  state; whether the reload feels instant enough in the running product to read
  as a tab change was not confirmed by hand.

Verified against this repo commit `4f26fb9`.
