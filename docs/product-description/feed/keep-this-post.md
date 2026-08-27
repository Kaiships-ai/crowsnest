# The keep this post button

## Summary

Keep this post saves a video to a shortlist the user can come back to. It is a single star button in the action row of the [video detail page](video-detail.md), next to the save to vault dialog, which is a different feature (that one lifts a hook or a layout out of the analysis into a reusable template; this one keeps the whole post with a short note). The button is a toggle. When the video is not kept it reads "Keep this post" and opens a small dialog; when it is kept it reads "Kept" with a filled star and removing is one click. It writes a [saved post](../glossary.md) row and needs no external service, so it works whether or not the LLM proxy, the Graph API, or the sidecar are running.

## The simple case

On a video detail page the user clicks "Keep this post". A dialog opens with one optional field, a note that answers "why it is worth keeping". The user types a line or leaves it blank, then clicks "Keep". The dialog closes, a toast says "Kept in the vault", and the button changes to "Kept" with a filled star.

To undo, the user clicks "Kept". The row is removed, a toast says "Removed from the vault", and that toast carries an Undo action that puts the row back with its original note. The button returns to "Keep this post".

## The interaction, event by event

```
stateDiagram-v2
    [*] --> notKept
    notKept --> dialogOpen : click Keep this post
    dialogOpen --> notKept : Cancel, Escape, click outside (discard note)
    dialogOpen --> keeping : click Keep
    keeping --> kept : success (row written, toast)
    keeping --> dialogOpen : error (toast, dialog stays)
    kept --> removing : click Kept
    removing --> notKept : success (row deleted, undo toast)
    notKept --> kept : Undo (re-create row)
```

### Arrive

The detail page decides which button to show from a server read, not from anything the button fetches itself. When the page loads it looks up whether this video already has a saved post, and hands the button either the saved row (its id and note) or nothing. If there is a row, the button renders "Kept" straight away. If not, it renders "Keep this post". Nothing opens until the user clicks.

### Leave without acting

Opening the dialog and closing it again with Cancel, Escape, or a click outside records nothing. No row is written. The note the user typed stays in the field if they reopen the dialog in the same page visit, because the field is only cleared after a successful keep, not on cancel. A page reload clears it.

### Begin acting

Clicking "Keep" starts the write. The note is trimmed; a blank or whitespace only note is sent as no note at all. The button pair is disabled from this instant so a second click cannot start a second write.

### While acting

The dialog stays open and both buttons are disabled. The Keep button's label changes to "Keeping". Nothing else on the page changes yet. There is no spinner beyond the label.

### Finish

On success the dialog closes, the note field clears, a toast says "Kept in the vault", and the page re-reads so the button flips to "Kept" without a manual reload. On failure the dialog stays open, the typed note is kept, and a toast shows the reason (the post is already saved, the post no longer exists, or an unexpected error). Removing works the same way in reverse: clicking "Kept" deletes the row, re-reads the page, and shows a "Removed from the vault" toast whose Undo action re-creates the row with the note it had.

> Technical note: the button's kept or not kept state is a prop off the page's server read, not local state. The refresh after a keep or a remove is what flips it. Between the write landing and the refresh completing there is a brief window where the button label and the database disagree.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (video saved or not) | Decides the whole button: "Kept" if a saved row exists, "Keep this post" if not. | If the same video is saved in another tab while this dialog is open, this tab still shows "Keep this post" and the Keep click returns "already saved". |
| Attached data present or absent (transcript, analysis) | No effect. Keeping a post does not depend on it having a transcript or an analysis. | No effect. |
| External service availability (LLM proxy, Graph, sidecar) | No effect. The write needs none of them. | No effect, except that the sidecar can delete the underlying video (see interrupt row 5). |
| Keyboard shortcut in play | Escape closes the dialog. | Enter inside the note field inserts a newline; it does not submit. There is no keyboard submit. |

Changing a variant mid action is limited to the note field's own text. There is no modifier that changes what Keep does.

## Cancel and interrupt

| Event | Before commit (dialog open) | While in flight (keeping or removing) |
| --- | --- | --- |
| Explicit cancel or stop | Cancel, Escape, or a click outside closes the dialog and discards nothing committed. The note text survives a reopen in the same visit. | The buttons are disabled, so there is no cancel; the write runs to completion. |
| Navigate away mid action | Leaving the page abandons the open dialog. Nothing is saved. | A sidebar link still navigates. The server write may land, but the refresh that flips the button does not; the next visit shows the true state. |
| Reload or tab or window closed | The open dialog and any typed note are lost. Nothing is saved. | The write may or may not have completed. On next load the button reflects whatever the database holds. |
| A backing service fails mid action | No external service is used. If the underlying video was removed between page load and the click, Keep returns "That post no longer exists." | A database error returns an unexpected error and a toast; the dialog stays open with the note intact. |
| The target record changes underneath | If the video is deleted by a sync, Keep returns "That post no longer exists" and any existing saved row is already gone (the saved row is removed with its video). | Same. A delete of an already removed row is treated as success, so an Undo that races a cascade does not error. |
| A background job finishes or fails on its own | No effect. | No effect. |
| A second tab or a double action on the same record | Two tabs both showing "Keep this post": the first Keep wins, the second returns "That post is already saved" and the dialog stays open. | A double click is blocked by the disabled state. Remove then Undo re-creates the row. |

After an interrupt the user stays where they are. Nothing is left half written: the row either exists or it does not, capped at one per video.

## Interactions with other systems

**Persistence and autosave.** The note is not autosaved. It lives in the dialog until the user clicks Keep, and is discarded on cancel. The saved row itself is durable once written.

**History and undo.** Remove is undoable through its toast, which re-creates the row with the original note if the user clicks Undo before the toast closes. Keeping is not given a separate undo; the user removes a kept post by clicking "Kept". There is no global undo stack.

**Navigation and refresh.** The button reads its state from the page's server load, so after a keep or a remove the page is re-read and the button flips without a manual reload. See [navigation and shell](../foundations/navigation-and-shell.md) for the refresh model.

**Background jobs and the sidecar.** The sidecar sync can delete the underlying video, which removes the saved row with it. Nothing else here touches background jobs.

**External services.** None. This is the one action in the core loop that needs neither the LLM proxy nor the Graph API nor a transcript provider.

**Status and failures.** Success and failure both surface as toasts. There is no inline error inside the dialog; a failed keep leaves the dialog open and shows the reason as a toast.

**Configuration and settings.** None. No setting changes this behavior.

## Edge cases

- Reopening the dialog after cancelling shows the note the user typed before, because the field is cleared only on a successful keep. A reload clears it.
- A whitespace only note is stored as nothing, and the vault renders it as a dash rather than a blank.
- Removing a row that is already gone is a no-op success, so a stale Undo, a double remove, or an Undo that races a video deletion does not error.
- Save is one row per video. A second keep on an already saved video is refused rather than duplicated, which the user only meets in a race between two tabs, since the button hides Keep once a video is kept.
- This button is deliberately separate from the save to vault dialog beside it. Both are called saving; one produces a shortlist entry, the other a reusable template. They are documented separately.

## Open questions and verification

- Whether a navigation or reload during the brief keeping window reliably commits the write was read from the code but not confirmed by hand. The write is a server action inside a React transition; the exact behavior when the page unmounts mid transition needs a live check.
- Whether the note field genuinely retains its text across a cancel and reopen in the running product, or whether a dialog remount clears it, needs a live check. The code keeps the note in component state that only a successful keep resets.

Verified against this repo commit `4f26fb9`.
