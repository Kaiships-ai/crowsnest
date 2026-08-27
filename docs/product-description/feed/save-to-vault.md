# The save to vault dialog

## Summary

Save to vault lifts a reusable template out of a video's analysis. Where [keep this post](keep-this-post.md) keeps the whole video on a shortlist, this dialog takes the shape of what worked, its hook, its structure and style, or both, and writes it back as a [vault item](../glossary.md) the remix can draw on later. It is an outline button reading "Save to vault" with a bookmark icon, in the same action row of the [video detail page](video-detail.md), directly next to the star keep button. The two are deliberately separate: one produces a shortlist entry, the other a template you write from. This dialog is gated on the video having an [analysis](analysis.md), because everything it offers is prefilled from that analysis. Without one the button is disabled and a tooltip says to analyze the video first. The write itself needs no external service; it stores a `vaultItems` row and returns.

## The simple case

On an analyzed video detail page the user clicks "Save to vault". A dialog opens on a three way choice, Hook, Style, or Both, starting on Hook. Below the choice sit editable fields already filled in from the analysis: for a hook, a title, a template line, and a comma separated tag list; for a style, the same three. The user reads the suggestion, edits the title or the template text, adjusts the tags, and clicks "Save". The dialog closes, a toast says "Saved hook to Vault" (or style, or "Saved hook and style to Vault"), and the page refreshes. The new template now shows up in the remix [hook stage](../remix/stage-hook.md) seed select and, for a style, in the [style stage](../remix/stage-style.md) structure select.

There is nothing to undo from here. Removing a vault item is done later on the vault page, which is outside the core loop.

## The interaction, event by event

```
stateDiagram-v2
    [*] --> closed
    closed --> dialogOpen : click Save to vault (analysis present)
    closed --> closed : button disabled (no analysis)
    dialogOpen --> dialogOpen : switch Hook / Style / Both, edit fields
    dialogOpen --> closed : Escape or click outside (discard edits)
    dialogOpen --> saving : click Save
    saving --> closed : success (row(s) written, toast, refresh)
    saving --> dialogOpen : error (toast, dialog stays, fields intact)
```

### Arrive

The button appears only when the page's server read carried an analysis for this video. If it did, the button is live; if not, it renders disabled with a tooltip, "Analyze this video first to save hook/style templates". Opening the dialog fills the fields from the analysis right away, computed on the client from the analysis already on the page, with no further fetch. The hook title is the analysis hook type in title case followed by "Hook"; the hook template is the first structure note with " for {topic}" appended, or a generic "A {hook type} hook about {topic}" when there is no note; the hook tags start as the hook type. The style title joins the structure labels; the style template joins the labels and the style tags into one line, or a generic "Describe the structure and editing style." when the analysis carries neither; the style tags start as the analysis style tags. The choice starts on Hook and the Save button is enabled from the first paint.

### Leave without acting

Closing the dialog with Escape or a click outside records nothing. No row is written. The edits the user made to the fields survive if they reopen the dialog in the same page visit, because the fields are React state initialized once and never reset on close. The choice they left it on (Hook, Style, or Both) also survives a reopen. A page reload throws all of that away and recomputes the suggestions from the analysis.

### Begin acting

Clicking "Save" starts the write. What gets written is decided at that instant from the current choice: Hook writes one hook item, Style writes one style item, Both writes one of each in parallel. The title, template text, and tags are read from the fields as they stand at the click; tags are split on commas, trimmed, and blanks dropped. The Save button is disabled from this instant so a second click cannot start a second write.

### While acting

The Save button reads "Saving…" and is disabled. The choice toggle and the text fields are not disabled, but editing them mid write has no effect on the write in flight, because its values were captured at the click. Nothing else on the page changes yet. There is no spinner beyond the button label.

### Finish

On success the dialog closes, a toast names what was saved, and the page re-reads so any surface that counts vault items (the dashboard, the remix selects on the next visit) reflects the new rows. On failure the dialog stays open, the fields keep their text, and a toast shows the error. The fields are never cleared, on success or failure, so a second Save on a reopened dialog with the same text would write a second copy.

> Technical note: Both fires the two inserts with `Promise.all` and reports the first failure it finds. If one insert succeeds and the other fails, the succeeded row is already committed but the toast shows only the error and the dialog stays open. Clicking Save again then re-inserts both, duplicating the one that already landed. There is no dedupe and no cap on vault items.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (video analyzed or not) | Decides whether the button exists at all: live when the page loaded an analysis, disabled with a tooltip when it did not. Whether the video is kept or not (the sibling star) has no bearing here. | If the analysis is removed underneath an open dialog, the dialog keeps its prefilled and edited values (they are in state) and Save still writes, as long as the video row still exists. |
| Attached data present or absent (transcript, analysis) | The analysis is the source of every prefilled field. A rich analysis yields specific suggestions; a sparse one falls back to the generic hook and style lines. A transcript is not read directly once an analysis exists. | No effect. The captured field values are whatever the analysis produced when the dialog opened, plus any edits. |
| External service availability (LLM proxy, Graph, sidecar) | No effect on the write, which needs none of them. The gate is indirect: an analysis only exists because the LLM proxy produced one earlier. | No effect, except that a sync can delete the source video (see interrupt row 5). |
| Keyboard shortcut in play | Escape closes the dialog. The Hook/Style/Both toggle takes arrow keys for its own focus movement. | Enter in a field does not submit; there is no keyboard submit. Enter in the template textarea inserts a newline. |

Switching Hook, Style, or Both before Save is the one mid dialog choice that changes what is written. Switching it during the write does not, because the write already captured the choice.

## Cancel and interrupt

| Event | Before commit (dialog open) | While in flight (saving) |
| --- | --- | --- |
| Explicit cancel or stop | Escape or a click outside closes the dialog and discards nothing committed. Edited field text survives a reopen in the same visit. There is no Cancel button; the footer holds only Save. | The Save button is disabled, so there is no cancel; the write runs to completion. |
| Navigate away mid action | Leaving the page abandons the open dialog. Nothing is saved. | A sidebar link still navigates. The insert may land, but the refresh that would surface it does not; the next visit shows the true state. |
| Reload or tab or window closed | The open dialog and any edited text are lost. Nothing is saved. | The write may or may not have completed. On next load the vault holds whatever the database committed. |
| A backing service fails mid action | No external service is used. | A database error returns and surfaces as a toast; the dialog stays open with fields intact. For Both, a partial write can result (see the technical note). |
| The target record changes underneath | If the analysis is removed, the open dialog is unaffected and Save still works. If the source video is deleted, the insert may fail on the source video reference; see open questions. | Same. A committed vault item keeps its content even after its source video is later deleted; the source link is cleared to none rather than the item being removed. |
| A background job finishes or fails on its own | No effect. | No effect. |
| A second tab or a double action on the same record | Two saves, from two tabs or two reopenings, both succeed and create two separate rows. There is no "already saved" state and no toggle; the button always reads "Save to vault". | A double click on Save is blocked by the disabled state. Reopening and saving again is not blocked and duplicates freely. |

After an interrupt the user stays where they are. Because there is no cap and no dedupe, an interrupted or repeated save leaves either zero rows or one row per insert attempted, never a half written row, but possibly duplicates.

## Interactions with other systems

**Persistence and autosave.** Nothing here is autosaved. The fields live in the dialog until Save; there is no blur save and no draft. The vault item rows are durable once written. See [persistence](../cross-cutting/persistence.md).

**History and undo.** The save has no undo. Unlike the keep button's remove toast, this dialog offers no Undo action. A vault item is removed later on the vault page, which is out of the core loop.

**Navigation and refresh.** A successful save calls `router.refresh()` so vault counts and the remix selects pick up the new rows on the next read. The dialog itself does not change the URL. See [navigation and shell](../foundations/navigation-and-shell.md).

**Background jobs and the sidecar.** The sidecar sync can delete the source video. A vault item's link to its source video is cleared to none when that happens; the item itself survives. Nothing else here touches background jobs. See [background jobs](../foundations/background-jobs.md).

**External services.** None for the write. The dialog only exists because an analysis exists, and that analysis needed the [LLM proxy](../cross-cutting/external-services.md) earlier, but saving a template calls no service.

**Status and failures.** Success and failure both surface as toasts. There is no inline error inside the dialog; a failed save leaves it open and shows the reason as a toast.

**Configuration and settings.** None. No setting changes this behavior.

## Edge cases

- The fields never reset. Reopening the dialog after a cancel, or after a successful save, shows the last text the user had, not a fresh suggestion. Only a page reload recomputes the prefill from the analysis.
- There is no validation. An empty title or empty template text saves an empty vault item; a blank tag field saves no tags. The dialog does not stop the user.
- Both is two independent inserts. A partial failure commits one and reports the other as an error, and a retry duplicates the one that landed. This is the one place the dialog can leave the vault in a surprising state.
- Saving the same video twice, or the same choice twice, always creates new rows. There is no per video or per template cap, unlike the keep button's one row per video.
- This dialog is deliberately separate from the star keep button beside it, which the code comment on `save-post-button.tsx` states in the same words: both are called saving, one produces a template you write from, the other a shortlist you come back to. They are documented separately.

## Open questions and verification

- Whether inserting a vault item for a video that a sync deleted between opening the dialog and clicking Save fails on the source video reference, or whether the reference is nullable at write time so the insert succeeds with no source link, was read from the schema (the source video reference clears to none on delete) but not confirmed by hand. The failure path depends on when the constraint is checked.
- Whether arrow keys pressed while the dialog is open but focus is on the Save button or the toggle, rather than in a text field, page the underlying feed, was read from the detail page's key handler (it skips only inputs, textareas, and content editable targets) but not confirmed by hand in the running product.
- Whether a navigation or reload during the brief saving window reliably commits the insert was read from the code but not confirmed by hand, the same open question the keep button carries.

Verified against this repo commit `4f26fb9`.
