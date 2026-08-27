# The prompt stage

## Summary

The prompt stage is the first of the six stages in the [remix studio](remix-overview.md). It sets the three inputs every later generation reads: what the script is about, whose niche it is for, and how long it should run. It is a short form, not a generation step. It makes no model call of its own. The user lands here with a topic already filled in, adjusts it and the target length, and moves on with Continue or with [Quick Remix](remix-overview.md#quick-remix), which hands off to the studio to run every generation stage at once.

It lives inside the studio shell at `/feed/{videoId}/remix`, on the first step of the [stepper](remix-overview.md). The shell, the stepper, the Back, Restart, and Continue controls in the footer, the run log, and the source [context rail](remix-overview.md) all belong to [the remix studio](remix-overview.md); this document covers only what fills the prompt step. The stage owns four things: the topic field, a read-only [niche](../glossary.md) chip that links to settings, the target length select, and the Quick Remix button with the note that appears beside it when no model key is set.

The stage works in every restricted state. It reads no external service, so the [LLM proxy](../glossary.md) being down, the [Graph API](../glossary.md) token being invalid, and the [sidecar sync](../glossary.md) being off leave it fully usable. The only service dependence is on Quick Remix, which the stage disables when no model key is configured and otherwise delegates to the studio.

## The simple case

The user opens a video and clicks remix. The studio opens on the prompt stage. The topic field is already filled with the source video's caption followed by "for my niche". A read-only chip below it names the niche, with an "Edit in Settings" link. A target length select reads 45s. The user tweaks the topic to say what they actually want, leaves the length alone, and clicks Continue to move to the research stage. Or they click Quick Remix and let the studio run research, hooks, outline, and variants in one pass, landing them on the script stage.

## The interaction, event by event

```
stateDiagram-v2
    [*] --> prefilled : open the remix (fresh session)
    prefilled --> synced : prefill autosaved once (topic was null)
    [*] --> restored : reopen the prompt step (topic already saved)
    synced --> editing : type in the topic field
    restored --> editing : type in the topic field
    editing --> persisting : blur the topic field
    persisting --> editing : autosave lands (or "Autosave failed" toast)
    synced --> lengthSet : change the target length
    editing --> lengthSet : change the target length
    lengthSet --> editing : autosave lands
    synced --> [*] : Continue (topic set) or Quick Remix
    editing --> [*] : Continue (topic set) or Quick Remix
```

### Arrive

Opening the studio on a fresh session shows the prompt stage with the topic field prefilled. The prefill is the source video's caption with "for my niche" appended. When the video has no caption the source topic falls back to the words "this topic", so the field reads "this topic for my niche". The niche chip shows the niche read from settings, not from the session. The target length select shows the session's saved length, or 45s when none is saved.

Nothing is focused for the user by default. The field is editable from the first render.

On a fresh session whose stored topic is still empty, the stage writes the prefilled topic back to the session once, on mount, without the user doing anything. This is what makes Continue work straight away and what makes a later generation read the prefilled framing rather than the bare caption.

> Technical note: the sync fires only while the session's stored topic is null. It calls the same autosave path a blur uses. On a session that already has a saved topic (a reopened prompt step, or a session seeded from an idea) the sync does not fire, and the field shows the saved topic instead of a fresh prefill.

When the user returns to a video whose session has already moved past prompt, the studio opens on the furthest stage reached, not here. The prompt stage is then reached only by clicking its step in the stepper or by Restart, and it shows the saved topic and length.

### Leave without acting

Leaving the prompt stage without touching anything still leaves a mark on a fresh session: the mount sync has already written the prefilled topic. That is deliberate, so every remixed video carries a topic from its first visit rather than a null the generation stages would have to paper over. Nothing else is written. The niche is never written by this stage. On a session that already had a saved topic, leaving without acting writes nothing at all.

### Begin acting

The first real change is typing in the topic field or changing the target length. Typing updates the field and the studio's live copy of the topic on every keystroke, which keeps the Continue gate responsive, but it does not save to the server per keystroke. Changing the length saves immediately, because a select has no blur to defer to.

### While acting

The topic field shows what the user types. The studio's Continue button in the footer enables the moment the topic is non-empty and disables again if the field is cleared to nothing. The Quick Remix button follows the same topic condition and additionally stays disabled without a model key. Nothing generates on this stage, so there is no pending result to wait for and no run log entry from an edit here. The run log the studio shows below other stages is hidden on the prompt stage.

### Finish

There is no commit that ends the prompt stage on its own terms. The stage's edits are committed continuously by autosave: the topic on blur, the length on change, the prefill once on mount. The user finishes the stage by clicking Continue, which advances to research, or Quick Remix, which runs the whole generation pass and lands them on the script stage. Both of those transitions belong to [the remix studio](remix-overview.md). Continue is gated on a topic existing; because the prefill sync sets one, that gate is met from arrival unless the user empties the field.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (session stage) | A fresh session at the prompt stage prefills the topic and syncs it once. A session that already holds a topic shows the saved value and does not re-prefill. | Editing the topic or length updates those fields; it does not move the session's stage. The stage only advances through the studio's Continue or Quick Remix. |
| Attached data present or absent | No effect. The prefill uses the source caption, not the transcript or the analysis. The niche and the length do not depend on any attached data. | No effect. |
| External service availability | No model key configured shows an inline note under the length select and disables Quick Remix. The proxy being down, the Graph token being invalid, and the sidecar being off do not change anything the prompt stage renders. | With no key, Quick Remix stays disabled. With a key present but the proxy down, Quick Remix is still enabled here and fails when clicked, surfacing as a toast from the studio. The prompt stage does not show the generation-blocked panel that the hook, style, and script stages show. |
| Keyboard shortcut in play | None specific to the stage. The topic field is a plain text input; nothing is auto-focused. | Enter in the topic field does not submit, because there is no form to submit. The length select opens and closes with the keyboard but honors no stage-specific key. There is no keyboard shortcut for Continue or Quick Remix. |

The only mid-action change available is the text of the topic and the choice of length. There is no modifier that changes what Continue or Quick Remix does.

## Cancel and interrupt

The columns are the action before its edit commits (an unsaved keystroke) and while an autosave is in flight. Quick Remix, once clicked, runs in the studio; its in-flight behavior is [the remix studio's](remix-overview.md#cancel-and-interrupt), not this stage's.

| Event | Before commit (unsaved edit) | While in flight (autosave running) |
| --- | --- | --- |
| Explicit cancel or stop | There is no cancel button and no dialog on this stage. Escape does nothing to the fields; on the open length select it closes the list without changing the value. There is nothing to stop. | An autosave cannot be cancelled from the UI; it is a fire and forget write that runs to completion or fails to a toast. |
| Navigate away mid action | Leaving the stage keeps whatever was already saved. An unblurred topic edit is lost. A length change was already saved on selection, so it survives. | Leaving still lets the in-flight write land on the server; the studio is a client shell and does not re-read on navigation, so the current view does not reflect a write that lands after the user has gone. |
| Reload or tab or window closed | The session is server backed, so a reload resumes at the furthest stage with the saved topic and length. An unblurred topic edit is lost. | The write may or may not have landed. On next load the field shows whatever the database holds. |
| A backing service fails mid action | The prompt stage's own edits touch no external service; a failed edit can only be a failed database write. | A failed autosave surfaces as an "Autosave failed" toast and leaves the field as the user typed it. The proxy, Graph, and sidecar being down do not affect saving a topic or a length. |
| The target record changes underneath | If the source video is removed by a sync, the prompt stage is unaffected: its prefill was computed once from the caption already loaded, and the topic and length live on the session, not the video. | Same. The autosave writes to the session row, which a video removal does not touch. |
| A background job finishes or fails on its own | Not applicable on this stage. The cook run belongs to the [studio page](../studio/cook-run.md), and this stage starts no background job. Quick Remix's server pass writes to the studio's run log, described in [the remix studio](remix-overview.md). | Not applicable. |
| A second tab or a double action on the same record | Two tabs on the same video share one session, because get or create returns the same row. Their topic and length autosaves race, last write wins. | A double click on Quick Remix is prevented by the pending state that disables the button while it runs. Two concurrent autosaves of the same field settle last write wins. |

After any interrupt the user resumes at the furthest stage the session reached, with the saved topic and length. Only an unblurred topic edit is ever at risk.

## Interactions with other systems

**Persistence and autosave.** The topic saves on blur; the length saves on change, since a select has no blur; the prefilled topic saves once on mount when the session's stored topic is null. Typing keeps the field and the studio's live topic in step on every keystroke without a per-keystroke network call, so the Continue gate stays responsive while the server write waits for blur. A failed autosave shows a toast rather than failing silently. See [persistence](../cross-cutting/persistence.md).

**History and undo.** There is no undo. Editing the topic or length overwrites the previous value, including the prefill. Clearing the field and reopening the stage does not restore the prefill, because the prefill only runs while the stored topic is null and the mount write has already filled it.

**Navigation and refresh.** The stage does not call `router.refresh`; it keeps its state in the studio's client shell and advances through Continue in the footer. Deep links seed the hook and style stages, not this one; a fresh session with no seed opens here. See [navigation and shell](../foundations/navigation-and-shell.md).

**Background jobs and the sidecar.** The prompt stage starts no background job. The source caption it prefills from was written by the sidecar sync. Quick Remix delegates its server pass to the studio.

**External services.** The stage itself makes no model call. Quick Remix calls the [LLM proxy](../cross-cutting/external-services.md) through the studio. When no model key is set, an inline note titled "Add your Claude API key" tells the user to add `ANTHROPIC_API_KEY` in settings to generate hooks, outlines, and scripts, and Quick Remix is disabled. See [external services](../cross-cutting/external-services.md).

**Status and failures.** The stage has no run log and no inline error on its fields. An autosave failure is a toast. A Quick Remix failure is a toast raised by the studio. See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** The niche is read from settings and shown as a read-only chip with an "Edit in Settings" link. The target length default is 45 seconds, with 30, 45, 60, and 90 the only options.

> Technical note: the niche on the chip is the same value the generation stages send to the model, read through the one settings lookup both use, so what the user sees on the chip cannot drift from what is actually sent. The niche is display only here; the prompt stage never writes it to the session. When settings hold no niche it reads "general short-form content".

## Edge cases

- Clearing the topic field to nothing disables both Continue and Quick Remix. Restoring any non-empty text re-enables them.
- A video with no caption prefills the topic as "this topic for my niche", because the source topic falls back to the words "this topic".
- The prefill sync writes the topic even when the user does nothing, so a fresh session leaves the prompt stage with a non-null topic on its very first visit.
- Reopening the prompt stage after the session has progressed shows the saved topic and length, and the prefill does not run again.
- The keyless note on this stage is a plain inline alert, not the full generation-blocked panel the hook, style, and script stages show in place of their controls. The prompt stage keeps its controls because it needs no model to do its own job.
- Quick Remix here is disabled only for a missing topic or a missing key, not for a proxy that looks down. With a key present and the proxy unreachable, the button is clickable and the attempt fails to a toast, unlike the generation stages, which replace themselves with the block panel before the user can try.
- The target length select offers exactly 30s, 45s, 60s, and 90s. There is no free entry.

## Open questions and verification

- Whether an autosave in flight when the page unmounts reliably lands on the server was read from the code but not confirmed by hand. The write is a fire and forget action not awaited by the handler; its behavior across an unmount needs a live check.
- Whether the prefill sync ever races the user's first keystroke, so that a very fast edit is briefly overwritten by the mount write, was read from the effect order but not confirmed by hand.
- Whether an unblurred topic edit is always lost on reload, or occasionally saved by a length change that fires its own autosave first, needs a live check.

Verified against this repo commit `4f26fb9`.
