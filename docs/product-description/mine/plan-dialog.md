# The plan dialog

## Summary

The plan dialog creates a new planned post or edits an existing one. A [planned post](../foundations/data-model.md#planned-post) is a dated intention to publish on the user's own channel, optionally carrying a [script](../foundations/data-model.md#script). This one dialog is where the user names it, dates it, attaches or detaches a script, and sets a video kind. It is a single modal, not a page. It is reached from the [calendar](calendar.md): clicking an empty day, or the "add" control, opens it in create mode with the day prefilled; clicking an existing plan opens it in edit mode with that plan's fields loaded. Its own header says what it is doing, "New planned post" or "Edit planned post", and its description states the one thing it does not do: "Nothing here publishes or reminds. This is a dated intention, nothing more, until you mark it published by hand."

The dialog writes only to the `plannedPosts` table through the planned post actions. It needs no external service, so it works whole whether or not the LLM proxy, the Graph API, or the sidecar are running. There is no automatic publish path anywhere in this feature: a plan becomes published only when the user marks it so by hand, and that control lives on the calendar and the studio, not in this dialog.

> Technical note: the calendar mounts the dialog only while it is open and unmounts it on close (`dialogState` goes null). Every open therefore starts from a fresh copy of the plan or the preset date; nothing typed into one open survives into the next.

## The simple case

To plan a post, the user clicks a day on the calendar. The dialog opens with that date filled in. They type a title, optionally a note, optionally pick a script and a video kind, and click "Create plan". The dialog closes, a toast says "Planned" (or "Saved as a draft" if they cleared the date), and the new plan appears on the calendar.

To change a plan, the user clicks it on the calendar. The dialog opens with its title, note, date, script, and video kind already loaded. They edit any of these and click "Save changes". The dialog closes, a toast says "Plan updated", and the calendar reflects the change. From edit mode the user can also click "Create in Studio", which leaves the dialog and opens the [studio](../studio/studio-overview.md) for that plan.

A plan with no script is allowed, but the user has to say so on purpose. If no script is selected the dialog shows a checkbox, "I don't have a script yet", and Save stays disabled until it is ticked. This is the one rule the dialog exists to enforce: a title should not turn into a note with a date by accident.

## The interaction, event by event

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

### Arrive

In create mode the dialog opens empty except for the date, which is prefilled from the calendar cell that was clicked (the preset date). Title, note, script, and video kind start blank. The no-script checkbox starts unticked, so Save is disabled until a title is typed and the checkbox is ticked (or a script is chosen).

In edit mode every field is loaded from the plan: its title, note, planned date, attached script, and video kind. If the plan already had no script and no [remix session](../foundations/data-model.md#remix-session), the no-script checkbox arrives already ticked, so an existing scriptless plan does not force the user to re-acknowledge it just to change the title.

The date field is a native date input. There is no time field and no target length field in this dialog; neither is offered on create or edit here, even though the underlying records can hold both.

Nothing is written on open. The dialog holds all edits in local state until Save.

### Leave without acting

Closing the dialog with Cancel, Escape, or a click outside writes nothing. No row is created and no existing plan is touched. Because the calendar unmounts the dialog on close, whatever was typed is gone; reopening starts fresh from the plan or the preset date again.

### Begin acting

The user's first edit only makes the form dirty in memory. Real work starts when they click the primary button, "Create plan" or "Save changes". That button is disabled until the form is valid: the title must be non-blank, and if no script is selected and the plan does not carry a remix script, the no-script checkbox must be ticked. From the click, the button reads "Saving…" and is disabled so a second click cannot start a second write.

### While acting

The dialog stays open with its button showing "Saving…". In create mode this is a single write. In edit mode the dialog applies only the fields that changed, one action at a time, in a fixed order: title and note first, then the date, then the script, then the video kind. Each is its own server action. If one fails, the sequence stops there: whatever already succeeded stays written, the dialog stops with "Saving…" cleared, and the failure reason appears as red inline text below the fields. The user is not told which writes landed before the failure; they see the plan partly changed on the next refresh.

> Technical note: there is no single patch action for a planned post. The edit path calls up to four actions in sequence (`updatePlannedPostAction` for title and note, `schedulePlannedPostAction` or `unschedulePlannedPostAction` for the date, `attachScriptToPlanAction` or `detachScriptFromPlanAction` for the script, `updatePlannedPostAction` again for the video kind). A mid-sequence failure is therefore a partial edit, not a rollback.

### Finish

On success the dialog closes, a toast confirms the result, the calendar's parent clears the dialog, and the page re-reads so the new or changed plan shows. The toasts are: "Planned" when a create carried a date, "Saved as a draft" when a create had no date, and "Plan updated" for any successful edit. On failure the dialog stays open with the typed values intact and the reason shown inline; the user can fix and retry.

How the date decides the state: a create with a date writes a scheduled plan, a create without one writes a draft. On edit, giving a dateless plan a date schedules it, and clearing a scheduled plan's date returns it to draft (undated). A date in the past is accepted, not refused; it simply reads as [missed](../foundations/data-model.md#planned-post) on the calendar, which is derived on read, never stored.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (draft, scheduled, missed, published) | State is not read directly; the date field carries it. A draft opens with a blank date, a scheduled or missed plan opens with its date filled, a published plan opens like any other (this dialog neither shows nor sets published). What changes is set at Save from the date: a date present means scheduled, absent means draft. | Editing the date reschedules (any future or past date) or, if cleared, unschedules back to draft. There is no control here to mark or clear published; that lives on the [calendar](calendar.md) and [studio](../studio/publish.md). Editing a missed plan does not "un-miss" it except by moving its date forward or clearing it. |
| Attached data present or absent (script, remix session) | If the plan carries a script from a remix session, the script select is replaced by a line saying detaching is not offered here and to do it from the vault. Otherwise the script select loads the attached script, or "No script" with the acknowledgment checkbox. | Choosing a different script swaps the attachment; choosing "No script" detaches it and surfaces the acknowledgment checkbox. A plan carrying a remix script cannot be detached in this dialog at all. |
| External service availability (LLM proxy, Graph, sidecar) | No effect. The dialog reads and writes only local plan records. The script list is passed in from the page, not fetched live. | No effect on the write. A missing service does not block creating, editing, scheduling, attaching, or deleting a plan. |
| Keyboard shortcut in play | Escape closes the dialog and discards. Focus lands in the dialog on open. | Enter inside the title input does not submit; there is no keyboard shortcut that commits. Enter in the note textarea inserts a newline. |

The one modifier that changes what Save does is the date field's presence. There is no other mode toggle.

## Cancel and interrupt

| Event | Before commit (dialog open) | While in flight (saving) |
| --- | --- | --- |
| Explicit cancel or stop | Cancel, Escape, or a click outside closes the dialog and discards every edit. Nothing is written. | The primary button is disabled while saving, so there is no cancel; the write sequence runs to completion or to its first failure. |
| Navigate away mid action | Leaving the calendar abandons the open dialog with nothing saved. "Create in Studio" is a deliberate navigation, not an interrupt: it leaves without saving any pending edits. | A navigation can land after some edit-sequence writes committed and before others; the plan is left partly changed. No toast or refresh follows if the page unmounted. |
| Reload or tab or window closed | The open dialog and all unsaved edits are lost. Nothing is written. | A reload mid-sequence can leave a partial edit: the writes that reached the server hold, the rest do not. The next load shows the true stored state. |
| A backing service fails mid action | No external service is used, so nothing fails on open. The script list was loaded with the page. | A database error returns `{ok:false}` with a reason shown inline; the dialog stays open. In edit mode the failure stops the sequence, so earlier writes in the order stay committed. |
| The target record changes underneath | If the plan was deleted in another tab, editing it returns "That planned post no longer exists." If a chosen script was deleted meanwhile, attaching returns "That script no longer exists." Values loaded on open can already be stale. | The same errors surface mid-sequence and halt it. A create is unaffected since it has no prior record. |
| A background job finishes or fails on its own | No effect. This dialog does not spawn or watch any [background job](../foundations/background-jobs.md); a [cook run](../studio/cook-run.md) elsewhere does not touch it. | No effect. |
| A second tab or a double action on the same record | Two dialogs open on the same plan hold independent copies; the last Save wins per field, and a field one tab did not touch is left as the other tab wrote it. | A double click on Save is blocked by the disabled state. Two tabs saving at once can interleave writes across the sequence, since each field is a separate action. |

After an interrupt the plan is left in whatever state the committed writes produced. A create either wrote its one row or did not. An edit can be partial because it is a sequence of separate writes with no rollback.

## Interactions with other systems

**Persistence and autosave.** Nothing in the dialog autosaves. Every field lives in local state until Save, and closing discards it. The only durable writes are the plan actions the primary button fires. The acknowledgment checkbox is never stored; the plan's null script link is what records "no script", and the calendar renders that null state distinctly.

**History and undo.** Saving a create or an edit is not undoable from the dialog. Deleting a plan is undoable, but that control and its Undo live on the [calendar](calendar.md), not here: the delete toast offers Undo, which recreates the plan from its title, note, date, and script. That recreation drops the video kind and the remix and source links, so an undone delete is not a byte-for-byte restore.

**Navigation and refresh.** After a successful save the dialog calls a router refresh so the calendar re-reads and shows the change. "Create in Studio" navigates to `/mine/{postId}/studio`. See [navigation and shell](../foundations/navigation-and-shell.md) for the refresh model.

**Background jobs and the sidecar.** None. Planning a post neither starts a [cook run](../studio/cook-run.md) nor waits on the [sidecar sync](../foundations/background-jobs.md). A plan is inert until the user opens it in the studio.

**External services.** None. The dialog calls no LLM proxy, no Graph API, no transcript provider. It is one of the parts of the core loop that works fully in every restricted state.

**Status and failures.** Success is a toast; failure is red inline text inside the dialog, not a toast. This differs from the [keep this post button](../feed/save-to-vault.md), which shows failures as toasts and keeps no inline error. Delete and mark-published, run from the calendar and studio, report through toasts.

**Configuration and settings.** None. No app setting changes this dialog. The video kind options come from a fixed eight-item list in the code (explainer, site-tour, product-promo, music-video, pr-announcement, talking-head, slideshow, general), not from settings; the stale flag mentioned in the checkbox text (a scriptless plan gets flagged stale after 30 days) is applied by the calendar's read, not by this dialog.

## Edge cases

- The dialog never sets a time or a target length. The `plannedPosts` record and the schedule and update actions can hold both, and other paths (a remix finish, the studio) may set them, but this dialog leaves them untouched. Editing a plan through this dialog preserves whatever time or target length it already had.
- The video kind select only ever offers the eight valid kinds, so the action's `BAD_VIDEO_KIND` refusal is not reachable from the UI. It guards a crafted request, not a user click.
- Detaching a script here writes no reason. The detach records a note like "Script detached on 2026-08-27." so the plan reads as one that lost its script, distinct from a plan that never had one. A reason string is supported by the action but the dialog does not collect one.
- Attaching a script clears any prior detach note, since the plan is no longer in the "lost its script" state that note describes.
- A plan that carries a remix script cannot have that script changed or removed in this dialog; the script select is hidden and a line points the user to the vault. Other fields on such a plan are still editable.
- On edit, if the user opens the dialog and saves without changing anything, no action fires (each write is gated on a real change), so the "Plan updated" toast can appear even though nothing was written.
- A blank or whitespace-only title is refused on both create and edit; the title is trimmed before the check.
- Marking a plan published and deleting a plan are part of the planned post lifecycle but are not in this dialog. Mark-published runs from the calendar's reconcile prompt and no-link control and from the studio publish step; delete runs from the calendar day panel and the undated drafts list. Marking published with no linked own post is legal and means "it went out, I am not linking it"; a non-null own post id is checked against the own posts table first.

## Open questions and verification

- Whether a partial edit (a mid-sequence failure that left title saved but the date write failed, for example) is clearly legible to the user was read from the code but not confirmed by hand. The dialog shows one inline error and does not say which writes landed.
- Whether the "Plan updated" toast really appears on a no-op edit (opening and saving with no field changed) was inferred from the change-gated writes and needs a live check.
- Whether the native date input rejects or silently coerces a malformed date before the action's own date validation runs was not checked in the running product; the action rejects an invalid date with `PLAN_INVALID_DATE` regardless.
- Whether two tabs editing the same plan interleave field writes as described was reasoned from the per-field action design, not observed.

Verified against this repo commit `4f26fb9`.
