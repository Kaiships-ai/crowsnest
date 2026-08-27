# The filter bar and saved views

## Summary

The filter bar is the row of controls above the [feed](feed.md) that builds the query the feed runs. It holds a search box, a set of narrowing controls (fleet, minimum score, minimum views, minimum engagement, timeframe, analyzed status, follower band), a sort, layout and density toggles, a saved views dropdown, and an "Add post URL" button. Every choice is written into the URL and the feed re-renders from that URL, so the bar never fetches results itself: it edits the address and the [feed page](feed.md) reads the new address. This document owns those controls, the [manage saved views dialog](../glossary.md) reached from the dropdown, and the add-video dialog reached from the button. It does not own the results grid, the counts, or what a bare `/feed` visit shows; that is [the feed page](feed.md).

The bar lives in the sticky header of `/feed`. It needs no external service: the controls only rewrite the URL, and creating, renaming, or deleting a saved view writes a local row. The one part that reaches outside is the add-video dialog, which fetches a single post before writing it, so it is the only control here that can fail on a service being unreachable.

> Technical note: filter state is held entirely in the URL query string, not in React state. The controls read `useSearchParams()` and call `router.replace(..., { scroll: false })`, so a filter change is a client-side navigation, not a form submit. See [navigation and shell](../foundations/navigation-and-shell.md) for the URL and refresh model.

## The simple case

The user narrows the feed by picking from the bar. Choosing "5x+" from the score control rewrites the URL to carry `minScore=5` and the grid below re-renders to matching posts. Typing in the search box filters by caption, handle, or display name after a short pause. Each follower band shows a live count of how many posts sit in it under the other active filters. When any filter is set, a "Clear filters" button appears and one click drops them all.

To keep a set of filters, the user opens "Saved views", clicks "Save / manage views", names the current filters, and saves. The named view then appears in the dropdown, and picking it later restores those filters. The two built-in views, Balanced and High Conviction, are always there and cannot be renamed or deleted.

To pull a single post into the feed by hand, the user clicks "Add post URL", pastes a post link, and clicks "Import post". The post is fetched and written, the dialog closes, and the feed refreshes with it present.

## The interaction, event by event

```
stateDiagram-v2
    [*] --> browsing
    browsing --> browsing : pick a filter (URL replaced, feed re-renders)
    browsing --> browsing : Clear filters (filter params dropped)
    browsing --> manageOpen : Save / manage views
    manageOpen --> browsing : Escape or close (discard unsaved name)
    manageOpen --> manageOpen : create, rename, delete a view (toast, refresh)
    browsing --> addOpen : Add post URL
    addOpen --> browsing : Escape or close (discard typed URL)
    addOpen --> importing : Import post
    importing --> browsing : success (post written, refresh, dialog closes)
    importing --> addOpen : failure (inline error, dialog stays)
```

### Arrive

The bar renders from three server reads handed to it: the tracked fleets, the saved views, and a count per follower band computed under every other active filter. It also receives what the page actually filtered by, which is not always what the URL literally says. Each control shows its current value read from the URL, falling back to that applied value when the URL is silent, so the row always states the filter that ran rather than a stale placeholder. The search box shows its own local echo of the URL's query so typing feels instant. Nothing is focused on arrival and no dialog is open.

### Leave without acting

Leaving the feed without touching a control records nothing beyond whatever the URL already held. A filter change is only made when a control is used. Opening either dialog and closing it again with Escape, a click outside, or the close control discards anything typed: an unsaved view name, an in-progress rename, a pasted URL. None of that is written. The URL filters themselves survive leaving, a reload, and browser back or forward, because they are the address, not component state.

### Begin acting

Three different actions start real work, and they commit differently.

Picking any filter control commits immediately: the URL is rewritten in place and the feed re-renders. There is no pending state and nothing to confirm, because the change is a navigation, not a server write. The search box is the exception; it waits until typing stops before rewriting the URL.

Opening the manage dialog and typing a name begins a saved-view create; it does not commit until "Save view" is clicked. Editing a view's name begins a rename; deleting asks for a confirm first.

Opening the add-video dialog and pasting a URL begins an import; it does not commit until "Import post" is clicked.

### While acting

A filter change has no in-flight window worth watching: the URL updates and the grid repaints. The search box holds its typed text locally and rewrites the URL after 350ms of no further keystrokes, so the feed refetches once per pause rather than once per key.

In the manage dialog, a create, rename, or delete runs as a server action: its button is disabled and relabeled ("Saving...", "Deleting...") until it settles. The list does not change optimistically; it re-reads after the write lands.

In the add-video dialog, "Import post" is disabled and relabeled "Importing..." while the single post is fetched and written. This is a foreground request the dialog holds open, not a background job; there is no progress bar, only the disabled button.

> Technical note: the import runs inline in one server action (fetch the post, upsert the video and its channel, recompute scores), so a reload during it loses the in-page result. This is unlike the periodic [sidecar sync](../foundations/background-jobs.md) that normally fills the feed, which runs in the background and reports progress separately.

### Finish

A filter change is finished the moment the URL is rewritten; the feed page owns what renders next. Using a control also drops the `limit` param, so a narrowed feed starts from its first page rather than keeping a "load more" depth from the previous filter.

A saved-view create, rename, or delete finishes by showing a toast and re-reading the page so the dropdown and the dialog list reflect the change. A create writes a new non-system row; the dialog clears the name field and keeps the dialog open. A rename collapses the edit row back to a label. A delete removes the row.

An import finishes by closing the dialog, showing a "Post imported" toast, and refreshing so the new video can appear in the grid. A failed import keeps the dialog open and shows the reason as an inline alert inside it, not a toast.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state | The URL decides which filters are active and which the "Clear filters" button responds to; the saved views read decides which views the dropdown lists, and whether each is a built-in (Balanced, High Conviction) with no rename or delete, or a user view with both. For an import, whether the post's channel is already tracked decides create versus update. | Picking a filter changes the active set live. Deleting a user view in the dialog removes it from the list without closing. A saved view already applied into the URL is unaffected by later deleting that view, because applying copied its criteria into the URL rather than linking to the row. |
| Attached data present or absent | A saved view carries only the three criteria it can restore (minimum score, minimum views, timeframe); a view with none summarizes as "No filters". The analyzed control keys off whether a post has an analysis, not whether one is loaded here. | Saving a view with all three controls on "any" stores an empty criteria set, which round-trips as "No filters". Adding or removing a criterion before saving changes what the summary line shows. |
| External service availability | The filter controls and the manage dialog need no external service; they read and write local rows only. The add-video dialog needs the post-fetch provider reachable to import. | The LLM proxy, the Graph token, and the sidecar being down have no effect on filtering or on managing views. Only the import can fail on the fetch provider being unreachable or the post being gone. |
| Keyboard shortcut in play | None is armed on arrival; focus is not trapped in the bar. Arrow-key navigation belongs to the [video detail page](video-detail.md), not here. | Typing in the search box drives the debounced filter. Enter in the "Name this view" field saves the view; Enter in a rename field confirms it and Escape cancels the rename; Enter in the add-URL field imports. Escape closes an open dialog. |

There is no modifier that changes what a control does. Each control has one behavior; the only "variant" of a filter is which value is chosen.

## Cancel and interrupt

| Event | Before commit | While in flight |
| --- | --- | --- |
| Explicit cancel or stop | A filter has no cancel: it commits on pick. To undo one, re-pick its "any" value or click "Clear filters". In the manage dialog, Escape or close discards an unsaved name or an open rename; a delete is a two-step confirm whose Cancel backs out. In the add dialog, Escape or close discards the typed URL. | The create, rename, delete, and import buttons are disabled while their write runs, so there is no cancel; the write runs to completion. |
| Navigate away mid action | Leaving the feed carries the committed URL filters forward only where a link forwards them (a card or the detail page); cosmetic params like density and view are dropped. An open dialog is abandoned with nothing saved. | A sidebar link still navigates during a write. The server write may land, but the refresh that would show it does not; the next visit reflects the true state. |
| Reload or tab or window closed | URL filters survive a reload and back or forward, because they are the address. Any open dialog and its typed text are lost. | An in-flight create, rename, delete, or import may or may not have completed; the next load reflects whatever the database holds. |
| A backing service fails mid action | Filtering and managing views use no external service. An import can fail before it starts writing if the post cannot be fetched. | A failed import returns its reason as an inline alert and the dialog stays open. A database error on a view write returns an unexpected-error toast (code `SAVED_VIEW_UNKNOWN`) and the dialog stays open. |
| The target record changes underneath | If a saved view was deleted in another tab, renaming or deleting it here returns "That view no longer exists" (`SAVED_VIEW_NOT_FOUND`). A view applied into the URL is not disturbed by the row later changing. | Re-importing a post that already exists updates the existing video rather than duplicating it, and still reports success. |
| A background job finishes or fails on its own | A [sidecar sync](../foundations/background-jobs.md) adding or removing videos changes the counts and the grid only after the next navigation or refresh; the controls themselves are unaffected. A sync removing a channel does not touch a saved view, whose criteria are score, views, and date, not a channel. | Same. A sync running while a dialog is open has no effect on the dialog. |
| A second tab or a double action on the same record | Two tabs both saving a view of the same name both succeed; view names are not deduplicated (only the two built-in names are reserved, and only against a second built-in). | The Save, Rename, Delete, and Import buttons are disabled during their own write, so a double click cannot start a second one. |

## Interactions with other systems

**Persistence and autosave.** Nothing in the bar autosaves. Filters persist because they live in the URL, so a bookmarked or shared feed URL restores them. A saved view is the deliberate way to keep a filter set by name; it is a durable row written only on "Save view". A typed view name, a rename in progress, and a pasted import URL are held in the dialog and discarded on close. See [persistence](../cross-cutting/persistence.md).

**History and undo.** Browser back and forward move between filter states, since each change is a URL replace. There is no undo for saving, renaming, or deleting a view; a delete is guarded by a two-step confirm instead. An import has no undo from here.

**Navigation and refresh.** Every control rewrites the URL with `router.replace` and no scroll, and the [feed page](feed.md) re-renders from it. The dialogs call [`router.refresh`](../foundations/navigation-and-shell.md) after a write so the dropdown, the list, and the grid reflect it without a manual reload.

**Background jobs and the sidecar.** The feed is normally filled by the [sidecar sync](../foundations/background-jobs.md). The add-video dialog is a separate, manual, foreground import of one post; it does not start a background job and reports no progress.

**External services.** Filtering and managing views reach no external service. The import fetches a single post through the post-fetch provider; when that is unreachable or the post is gone, the import fails with a reason. See [external services](../cross-cutting/external-services.md).

**Status and failures.** A saved-view create, rename, or delete reports success and failure as toasts. An import reports success as a toast but failure as an inline alert inside its dialog. There is no failure strip surface owned here. See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** The score, views, engagement, timeframe, and band thresholds are fixed option lists, not user settings. The built-in views Balanced and High Conviction are seeded once at install and marked built-in; the product configures them, the user does not. There is no platform control: the feed is Instagram only, so the platform param exists in the URL and schema but no control writes it.

## Edge cases

- The "any" option of the score, views, engagement, timeframe, and band controls is written to the URL as an explicit `key=any` token rather than dropping the key. This lets "explicitly no condition" stay distinct from "never set", so the feed does not reapply a default the moment a control is cleared. The [feed page](feed.md) owns what that distinction means for a bare visit.
- The layout and density toggles and the sort control are not filters. They rewrite the URL but do not count toward "any filters set", so they do not surface the "Clear filters" button, do not reset the load-more depth, and do not ride along into a detail page link.
- The follower band counts sum to less than the feed total when channels have no follower count or fall between the bands; a channel with an unknown or in-between follower count matches no band chip and still shows under "Any followers".
- A saved view can only restore the three criteria it stores. A view saved while a search term, an engagement floor, an analyzed filter, or a band were set does not restore those; picking the view sets only score, views, and timeframe.
- The add-video dialog is the same dialog the channels board uses to add a channel; the feed opens it straight to its "Paste post URL" tab. Its other tab tracks a whole channel by handle, which is outside this control's purpose.

## Open questions and verification

- Whether a bare `/feed` visit auto-applies a default view or shows the full library was read as conflicting in the code: one helper resolves a bare visit to no criteria (the full library) while another names High Conviction as a default to apply, and a stale comment on the bar mentions a "Balanced" default. Which the feed page actually calls is owned by [the feed page](feed.md) and needs a live check.
- Whether an import that the user navigates away from mid-flight reliably completes its write was read from the code but not confirmed by hand; the server action runs inside a client transition and the exact behavior on unmount needs a live check.
- Whether two tabs saving views of the same name is intended, or should be deduplicated, was read from the create action (no dedupe) but not decided; noted for triage.

Verified against this repo commit `4f26fb9`.
</content>
</invoke>
