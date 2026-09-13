# Persistence

## Summary

This document owns one question asked of the whole core loop: what survives a reload, and what does not. Every other document answers it for its own feature; this one draws the single line those answers share. The line runs between state the server holds and state that lives only in the browser. Server state (a remix session, a saved post, a script, a planned post, an analysis, a saved view, the recently viewed list, the niche) comes back after a reload because it is a database row. Client state (an unblurred field, an open dialog's fields, a chosen tab, a steer note, a player's download) is gone the moment the page unmounts.

There is no single interaction here, so this document reads the layers of core loop state in order of how durable they are, then applies the seven interrupt rows to each layer at once. It has no surface of its own; it names where each kind of state is written and links to the feature that owns it.

The distinction matters because the core loop mixes three storage styles on one screen. The remix studio autosaves most fields to the server as the user edits, so a reload resumes at the furthest stage. A dialog holds its fields in the browser until the user submits, so a reload before submit loses them. The feed filters live in the URL, so a reload keeps them and a copied link carries them to someone else. Knowing which of the three a given field uses is knowing whether a reload costs the user their work.

## The simple case

The user is mid remix on the script stage, has generated three variants, edited one, and typed a title into the save dialog without clicking Save. They reload the tab. The variants come back, the edit they made and then clicked away from comes back, the chosen variant comes back, and the studio reopens on the script stage. The title they typed into the save dialog does not come back, because it never left the dialog. If they had reloaded while a variant edit was still focused and unblurred, that one edit would be gone too.

That is the whole rule in one screen: what was committed to the server is there, what was still in a field or a dialog is not.

## The layers of core loop state

Four layers, from most durable to least. The tables in [the data model](data-model.md) are the durable ones; the URL and the browser hold the rest.

**Committed durable records.** A database row, written by a server action that commits (see the interaction model). These survive a reload, a navigation, a new tab, and a machine restart. In the core loop they are: a saved post (the keep this post row), a script, a planned post, a video analysis, and the remix session itself. A record exists or it does not; a half written row is not a state the user can reach, because each of these commits as one row. The remix session is the interesting one: it is disposable working state in intent, but it is a durable row in fact, so its autosaved fields survive exactly as any other row does.

**Autosaved session fields.** The remix session's own columns (topic, target length, research notes, chosen hook, style choice, outline, variants, chosen variant), each written by a fire and forget autosave as the user edits. These are durable once the write lands, but the write is deferred: some fields save on blur, some on change (see below). Between an edit and its save there is a window where the field on screen is ahead of the database. A reload inside that window keeps the last saved value, not the on screen one.

**URL held state.** The feed filters, the sort order, and the layout and density toggles live in the query string, not in React state. The remix opening stage and its deep link seed arrive the same way. URL state survives a reload and browser back or forward, and it is shareable: the address is the state, so a copied feed URL restores the same filters for anyone who opens it. It is not private to a session and not stored in a row.

**Client only state.** Anything held in a React component and nowhere else: an unblurred field's text, a dialog's fields before submit, the chosen tab on the video detail page, a carousel slide, a steer note, a player's in-progress download, an in flight autosave's pending promise. None of it survives an unmount. A reload or a navigation discards it with no record that it existed.

> Technical note: the remix session is server backed but the studio is a client shell. It loads the session once, keeps a live copy in React state, and autosaves edits back. A reload re reads the session from the database; it does not restore the client copy. So the reload resumes at the last autosaved value of each field, which is why an unblurred edit is the one thing at risk.

## The interaction, event by event

There is no single action to narrate in five phases, so this section tracks one edit's journey from keystroke to durable row, and where a reload cuts it off.

```
stateDiagram-v2
    [*] --> clean : field renders from the saved value
    clean --> dirty : type (local state updated, not sent)
    dirty --> saving : blur or change fires the autosave
    saving --> durable : write lands (silent) 
    saving --> dirty : write fails ("Autosave failed" toast)
    dirty --> lost : reload or unmount before the trigger
    saving --> durable : reload re-reads the row; the write may still land server side
```

### Arrive

A page renders its fields from the server read at load time: the studio from the session row, the filter bar from the URL, a dialog from whatever the record already holds. Nothing the user typed in a previous visit and did not commit is restored, because it was never stored. The one write that happens on arrival without the user acting is the prompt stage prefill (the session's topic is filled once when it is null) and the video detail page recording the video as recently viewed.

### Leave without acting

Leaving before editing anything records nothing, with the two arrival writes above as the only exceptions. Closing a dialog without submitting discards its fields. Navigating away from a stage keeps whatever already autosaved and drops whatever did not.

### Begin acting

The first edit makes a field dirty. In the studio this starts a deferred autosave: the field updates locally now and the server write fires later (on blur, or on change for a control with no blur). In a dialog it changes nothing durable; the dialog's fields stay in the browser until submit. In the filter bar it rewrites the URL immediately, so there is no dirty window at all.

### While acting

An autosave is fire and forget: the handler does not await it, so the field stays responsive while the write is in flight. A failed write raises an "Autosave failed" toast rather than failing silently, so the user learns their draft is not being persisted. A dialog's fields hold locally with no network traffic until submit. The URL updates on each filter pick, or after a short pause for the search box.

### Finish

A committed record is the durable end of an action. An autosaved field is durable as soon as its write lands, with no explicit finish. A dialog commits its fields only on submit, which writes a row and then discards the dialog's own state. There is no finish for URL state; it is durable the instant it is written to the address.

## Which remix fields save on blur, which on change

The split matters because it decides what an unblurred edit costs. A field that saves on change is safe the moment it is set; a field that saves on blur is at risk until the user clicks away.

| Field | Saves | Why |
| --- | --- | --- |
| Prompt topic | On blur | A text input; the keystrokes update the live topic so Continue stays responsive, the server write waits for blur. |
| Target length | On change | A select has no blur; the choice is committed the instant it is picked. |
| Prompt prefill | Once on mount | Written when the session's topic is null, so a fresh session carries a topic from its first visit. |
| Research facts box | On blur | A textarea; the whole notes record is rewritten when the field loses focus. |
| Chosen hook | On change (on pick) | Choosing a hook pins it and saves at once. |
| Style structure choice | On change | A select; picking a template or clearing to source saves immediately. |
| Outline beats | On blur | Editing any beat field saves the whole outline when that field loses focus. |
| Script variants | On blur | Editing a variant saves the whole set when the text area blurs. |
| Chosen variant | On change (on tab open) | Opening a variant's tab records the pick immediately. |
| Deep link seed | Once on mount | A seed carried in the URL is written to the session on arrival. |

Stage advances (Continue, Restart) are a separate, awaited write of the session's stage column, not a fire and forget autosave. They land before the studio moves, so the furthest stage a reload resumes to is reliable.

## Form state that lives only in a dialog

Three dialogs hold their fields in the browser and commit only on submit, so a reload or a close before submit loses what was typed:

- The keep this post note. It lives in the dialog until Keep is clicked; a cancel or a reload discards it. It is retained across a cancel and reopen in the same page visit but not across a reload.
- The plan dialog fields. The title, date, and any script choice hold in the dialog until the plan is saved.
- The save script title. It is prefilled from a derived short title and held in the dialog; closing the dialog with Escape discards the title but not the variants underneath.

None of these autosave. They are the deliberate opposite of the studio: a dialog is a commit-on-submit surface, so leaving it is a cancel.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state | Decides what the page renders its fields from: a fresh session shows prefilled or empty fields, an existing one shows its saved values, a dialog opens from the record it edits. | Committing a record (a save, a schedule, a stage advance) moves durable state; editing an uncommitted field moves only client state. |
| Attached data present or absent | An existing session with a hook, outline, or variants restores them on reload; a fresh one has nothing to restore. | Autosaving a field adds it to what a reload will restore from then on. |
| External service availability | No effect on persistence. Every autosave, dialog submit, and URL write is a local database or browser write; the LLM proxy, the Graph API, and the sidecar are not involved in saving. | A generation that fails does not corrupt the field it targeted; the previous saved value stays. Saving is never blocked by a service being down. |
| Keyboard shortcut in play | No effect. | Enter in a textarea inserts a newline rather than submitting; blur is what triggers a studio autosave, so tabbing out of a field saves it. |

## Cancel and interrupt

The two columns are the state before it is committed (an unblurred edit, an open dialog, an unpicked filter) and while a write is in flight (an autosave, a dialog submit, a URL replace). Rows 2 and 3 are this document's whole subject.

| Event | Before commit | While in flight |
| --- | --- | --- |
| Explicit cancel or stop | Cancelling a dialog discards its fields. There is no cancel for a studio field; leaving keeps whatever autosaved. | A fire and forget autosave cannot be cancelled; it runs to completion or fails to a toast. A dialog submit's button is disabled while it runs. |
| Navigate away mid action | Committed records and URL state survive the navigation. An unblurred studio edit is lost. An open dialog's fields are discarded. The studio does not re read on navigation, so a write that lands after the user leaves does not show in the view they left. | A sidebar link still navigates during an in flight write. The server write may land, but the client copy and any refresh that would show it do not. The next visit reflects whatever the database holds. |
| Reload or tab or window closed | Committed records, autosaved fields, and URL state all come back; the studio resumes at the furthest stage. An unblurred field, an open dialog's fields, and every client only value (the open tab, the carousel slide, a steer note) are lost. | An in flight autosave or submit may or may not have landed. The reload re reads from the database, so the next render shows the last durable value, which may or may not include the write that was in flight. |
| A backing service fails mid action | Persistence uses no external service, so a proxy, Graph, or sidecar failure does not stop a save. A failed database write is the only failure here. | A failed autosave raises "Autosave failed" and leaves the field as typed; the user can blur again to retry. A failed dialog submit keeps the dialog open with its fields intact. |
| The target record changes underneath | If a sync removes the source video, the session keeps its own copied fields (topic, hooks, variants); autosave writes to the session row, which a video removal does not touch. A saved post row is removed with its video. | An autosave writes to the session row regardless of the source video's state, so a mid edit removal does not corrupt the write. |
| A background job finishes or fails on its own | No effect on persistence. A sync finishing elsewhere writes its own rows; it does not disturb an open dialog or an unblurred field. | No effect. |
| A second tab or a double action on the same record | Two tabs on one video share one session (get or create returns the same row), so their autosaves write the same columns; last write wins per field. Two dialogs on one record each hold their own fields until submit. | Concurrent autosaves of the same field settle last write wins. A double dialog submit is blocked by the disabled button. A single-slot variant regenerate writes only its slot server side, so it does not clobber a sibling slot's concurrent edit. |

After any interrupt the durable line holds: the row exists or it does not, the URL is the URL, and only client state that never reached the server is lost.

## Interactions with other systems

This document is the persistence concern itself, so the first row below is the whole document. The rest are named only where they touch what survives.

**Persistence and autosave.** The subject of this document. The remix session autosaves per field (blur or change, per the table above); dialogs commit on submit; filters and the remix stage seed live in the URL; recently viewed and the niche live in the settings store; saved views are their own rows. A failed autosave surfaces as a toast.

**History and undo.** There is no cross-loop undo stack. Overwriting an autosaved field discards its previous value with no way back except the run log's record that an attempt happened. The one scoped undo is the keep this post remove toast, which re creates the row it deleted. See the interaction model.

**Navigation and refresh.** URL held state is restored by [navigation and the shell](navigation-and-shell.md)'s model: a filter change is a URL replace, a deep link seeds the opening stage, and back and forward move between saved URL states. After a dialog write, a `router.refresh` re reads the server data so a committed row appears without a manual reload.

**Background jobs and the sidecar.** The sidecar sync writes video rows and can soft remove them; a removal takes the saved post row with the video. None of this touches an open dialog or an unblurred field. See [background jobs](background-jobs.md).

**External services.** None of the three external services is involved in saving. Every write in the core loop is a local database write or a URL change, so persistence works in every restricted state. See [external services](external-services.md).

**Status and failures.** The one persistence-specific failure surface is the "Autosave failed" toast. A failed dialog submit keeps the dialog open with its reason shown; a failed committed write returns a coded result the feature surfaces as a toast. See [status and failures](status-and-failures.md).

**Configuration and settings.** The settings store holds the recently viewed list (a JSON array of video ids, most recent first, deduped, capped at 8), and the niche the generation stages read. Some numeric thresholds are process configuration read from the environment rather than a settings row: `scoreMinUsablePosts` gates the median baseline on the video detail page, and the sync window defaults (lookback, items per sync, retries) are environment values, not user settings. A few settings rows override an environment default where both exist. None of these are edited from the core loop; they are read where they change behavior.

> Technical note: the settings store is a key/value table (`app_settings`), one row per key. Recently viewed is the `recently_viewed` key; its write is fire and forget from the detail page load, capped at 8, and any error is swallowed and logged at debug so a tracking failure never delays or breaks the page. Saved views are a separate table (`savedFilters`), one row per view, not settings keys.

## Edge cases

- An unblurred studio field is the single most common loss: the value is on screen and in the live copy but not yet in the database, so a reload or a Continue that unmounts the stage before blur drops it. Whether a Continue click's stage change lets the field's blur fire first is not settled in the code.
- The prompt prefill writes the topic even when the user does nothing, so a fresh session is never left with a null topic. Clearing the field later does not restore the prefill, because the prefill only runs while the stored topic is null.
- A dialog's fields can appear to persist across a cancel and reopen in the same page visit (the keep this post note does, because its component state is only reset on a successful keep), but this is per visit, not per reload. A reload clears it.
- URL state is the only core loop state that is shareable and visible to another person: a copied feed URL carries its filters, and a remix deep link carries its stage and seed. Nothing else in the loop leaves the user's own database.
- A saved view applied into the URL is a copy of its criteria, not a link to the row, so deleting the view later does not disturb a feed already filtered by it.
- The recently viewed list is capped at 8 but the dashboard reads only the front 4, leaving headroom for ids whose videos were deleted between the write and the read.
- Two tabs on one remix session race their autosaves with last write wins per field; there is no merge, so a field edited in both tabs keeps whichever wrote last.
