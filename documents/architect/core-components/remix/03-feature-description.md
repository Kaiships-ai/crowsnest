# remix: feature description

The remix pipeline turns one source video into a script through six stages: prompt, research, hook, style, script, finish. This document walks the full pipeline in order, starting with the studio shell that holds every stage.

## The remix studio

### Summary

The remix studio turns one source video into a script through six stages: prompt, research, hook, style, script, finish. It is the hardest and largest part of the core loop. This document owns the studio shell that holds every stage: the stepper, how the active stage relates to the furthest reached, the Back, Restart, and Continue controls, the Quick Remix shortcut, the run log, the source context rail, and how generation is blocked when the model is unavailable. Each stage has its own document; this one owns everything around them and the session lifecycle they share.

The studio is reached from the video detail page at `/feed/{videoId}/remix`. There is one remix session per source video: arriving opens the existing session or creates a fresh one at the prompt stage. The studio needs the LLM proxy for its generation stages; the prompt and research stages work without it, and the whole studio works with existing data when the sidecar is off.

### The simple case

The user opens a video and clicks remix. The studio opens on the prompt stage with the topic prefilled. They set a topic and length and click Continue, or click Quick Remix to run every generation stage at once. Moving through the stages they generate hooks and pick one, generate an outline and edit its beats, generate three script variants and pick one, then finish. Finishing puts the remix on the plan as an undated draft and offers a link into its studio to cook it.

At any point the user can click a completed stage in the stepper to jump back and change it. The run log below the stage records every generation attempt, successful or failed.

### The interaction, event by event

```
stateDiagram-v2
    [*] --> prompt : open the remix (get or create session)
    prompt --> research : Continue (topic set)
    research --> hook : Continue
    hook --> style : Continue (hook chosen)
    style --> script : Continue (outline exists)
    script --> finish : Continue (a variant exists)
    finish --> [*] : Finish and open studio
    research --> prompt : Restart (stage only)
    hook --> prompt : click a completed step
```

#### Arrive

Opening `/feed/{videoId}/remix` loads the source video, the session (existing or new), the user's vault hooks and styles, the vault saved posts, and the niche. The studio opens on the stage the session records as furthest, unless a deep link carries a seed (a vault hook or style, or a quick remix intent) that moves it. The source video sits in a context rail on the left, present on every stage. A one line banner names what the studio is doing so the six steps read as a sequence.

#### Leave without acting

Leaving the studio without generating anything records the session at whatever stage it reached, which for a fresh session is prompt with the prefilled topic autosaved. Nothing else is written. The session persists, so returning to the same video resumes where the user left off.

#### Begin acting

The first real work is the first generation or the first edit: setting the topic, running research, generating hooks. Each stage autosaves its own edits as they happen (see persistence below), so beginning to act is continuous rather than a single submit.

#### While acting

The active stage renders its own controls. The stepper shows the current stage filled and completed stages checked and clickable. The footer holds Back (disabled on prompt), Restart (disabled on prompt), and Continue (disabled until the current stage's requirement is met). Below the stage, on every stage except prompt, the run log lists generation attempts newest first with their outcome and elapsed time.

Continue advances to the next stage and, if that is past the furthest reached, records the new furthest stage. Its requirement per stage: prompt needs a topic, research always allows it, hook needs a chosen hook, style needs an outline, script needs at least one variant to exist (not to be picked; the pick is confirmed at finish). Back moves to the previous stage without changing the furthest. Clicking a completed step in the stepper jumps straight to it. Restart sets the stage back to prompt but keeps everything generation already produced (topic, hooks, outline, variants); it clears only the position, not the work.

#### Finish

The finish stage creates a planned post if the session does not already have one and opens a link into its studio. See [the finish stage](#the-finish-stage).

### Quick Remix

On the prompt stage, Quick Remix runs research, hooks (auto picking the first), outline, and variants in one server call, then lands the studio on the script stage with every earlier stage reachable and editable. It is disabled without a topic or without the model available. While it runs the button reads "Running Quick Remix". When it finishes the session is re read and the run log refreshes, showing the several attempts it made.

### When generation is blocked

The generation stages (hook, style, script) replace their whole surface with a block panel when the model is unavailable, rather than showing a button that will fail. Two reasons share the panel: no API key configured, and the local proxy looking unreachable. The proxy down read is grounded in the run log itself: if a recent attempt failed with a connection error, the studio treats the proxy as down and blocks the generation stages until an attempt succeeds. The prompt and research stages stay usable either way, since research assembles locally and makes no model call.

> Technical note: proxy down is inferred from the last few run log rows, not a live ping. A connection style error in the last three attempts marks it down; the next successful attempt clears it.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (session stage) | The studio opens on the furthest stage the session reached, or a deep linked stage. | Continue and Restart move the furthest stage; clicking a step moves only the active stage. |
| Attached data present or absent | A session with a chosen hook, an outline, or variants opens with them shown; a fresh session has none. | Each stage fills its own field as the user generates or edits; the stepper unlocks the next stage. |
| External service availability | With the model unavailable, hook, style, and script open blocked; prompt and research still work. | An attempt that fails on a connection error flips the generation stages to blocked until one succeeds. |
| Keyboard shortcut in play | None specific to the shell. | Text fields inside stages behave as normal inputs; there is no studio wide keyboard submit. |

### Cancel and interrupt

| Event | Before commit (mid stage) | While in flight (generating) |
| --- | --- | --- |
| Explicit cancel or stop | There is no cancel button; leaving a stage keeps its autosaved edits. Restart returns to prompt without discarding generated work. | A generation cannot be cancelled from the UI; the button is disabled until it settles. |
| Navigate away mid action | Leaving keeps the session at its furthest stage with all autosaved fields. Returning resumes there. | Leaving during a generation abandons the client wait; the server attempt still writes its run log row and its result. On return the session reflects whatever landed. |
| Reload or tab or window closed | The session is server backed, so a reload resumes at the furthest stage with saved fields. Unsaved local text in a focused field that has not blurred is lost. | Same: the reload resumes from the database; the in flight attempt's row and result appear once it lands. |
| A backing service fails mid action | The prompt and research stages are unaffected. | A generation that fails shows a toast and writes a failed run log row; the previous value of the field it targeted is left intact. Repeated connection failures flip the stage to blocked. |
| The target record changes underneath | If the source video is removed by a sync, the session keeps its own copied data (topic, hooks, variants); research that re assembles may find less. | Same. Generation reads the session's stored inputs, not the live video, so a mid run removal does not corrupt the attempt. |
| A background job finishes or fails on its own | Not applicable in the studio; the cook run belongs to the studio page. | Not applicable. |
| A second tab or a double action on the same record | Two tabs on the same video share one session (get or create returns the same row); their autosaves race last write wins. | A double generation is prevented per stage by the disabled state; two tabs generating at once both write run rows and the later write wins on the session field. |

After an interrupt the user resumes at the furthest stage. Nothing generation produced is discarded by leaving; only unblurred local text is at risk.

### Interactions with other systems

**Persistence and autosave.** Every stage autosaves its edits, most on blur, some on change. A failed autosave surfaces as a toast rather than failing silently. The run log is its own table, written on every attempt. See persistence.

**History and undo.** There is no undo across stages. Restart keeps generated work but resets position. Regenerating replaces a field's value; the previous value is not recoverable except from the run log's record that an attempt happened.

**Navigation and refresh.** The studio is a client shell that keeps the session in local state and autosaves to the server, so it does not rely on a full refresh to stay current within a visit. Deep links seed the opening stage. See navigation and shell.

**Background jobs and the sidecar.** The studio reads the source video and its analysis, both written by the sidecar. It does not start a background job; the cook run is later, in the studio page.

**External services.** The generation stages call the LLM proxy. When it is down they block. See external services.

**Status and failures.** The run log is the studio's own status surface, distinct from the shell failure strip. A partial variant generation reads as Partial, a clean one as Success, a failure as Failed. See status and failures.

**Configuration and settings.** The niche is read from settings and shown as a chip on the prompt stage with a link to edit it. The target length default is 45 seconds.

### Edge cases

- A session is created on first arrival even if the user does nothing, so every remixed video has a row from the first visit.
- Restart keeps generated hooks, outline, and variants, so a restarted run can reuse them rather than regenerate.
- Continue on the script stage needs only that a variant exists, not that one is chosen; the pick is confirmed at finish, so the screen that explains a missing pick is never hidden.
- The furthest stage only ever advances through Continue or Quick Remix; Back and stepper clicks never lower it.
- Quick Remix auto picks the first hook, so a session it produced has a chosen hook the user did not read; they can change it by going back to the hook stage.

## The prompt stage

### Summary

The prompt stage is the first of the six stages in the [remix studio](#the-remix-studio). It sets the three inputs every later generation reads: what the script is about, whose niche it is for, and how long it should run. It is a short form, not a generation step. It makes no model call of its own. The user lands here with a topic already filled in, adjusts it and the target length, and moves on with Continue or with [Quick Remix](#quick-remix), which hands off to the studio to run every generation stage at once.

It lives inside the studio shell at `/feed/{videoId}/remix`, on the first step of the [stepper](#the-remix-studio). The shell, the stepper, the Back, Restart, and Continue controls in the footer, the run log, and the source [context rail](#the-remix-studio) all belong to [the remix studio](#the-remix-studio); this document covers only what fills the prompt step. The stage owns four things: the topic field, a read-only niche chip that links to settings, the target length select, and the Quick Remix button with the note that appears beside it when no model key is set.

The stage works in every restricted state. It reads no external service, so the LLM proxy being down, the Graph API token being invalid, and the sidecar sync being off leave it fully usable. The only service dependence is on Quick Remix, which the stage disables when no model key is configured and otherwise delegates to the studio.

### The simple case

The user opens a video and clicks remix. The studio opens on the prompt stage. The topic field is already filled with the source video's caption followed by "for my niche". A read-only chip below it names the niche, with an "Edit in Settings" link. A target length select reads 45s. The user tweaks the topic to say what they actually want, leaves the length alone, and clicks Continue to move to the research stage. Or they click Quick Remix and let the studio run research, hooks, outline, and variants in one pass, landing them on the script stage.

### The interaction, event by event

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

#### Arrive

Opening the studio on a fresh session shows the prompt stage with the topic field prefilled. The prefill is the source video's caption with "for my niche" appended. When the video has no caption the source topic falls back to the words "this topic", so the field reads "this topic for my niche". The niche chip shows the niche read from settings, not from the session. The target length select shows the session's saved length, or 45s when none is saved.

Nothing is focused for the user by default. The field is editable from the first render.

On a fresh session whose stored topic is still empty, the stage writes the prefilled topic back to the session once, on mount, without the user doing anything. This is what makes Continue work straight away and what makes a later generation read the prefilled framing rather than the bare caption.

> Technical note: the sync fires only while the session's stored topic is null. It calls the same autosave path a blur uses. On a session that already has a saved topic (a reopened prompt step, or a session seeded from an idea) the sync does not fire, and the field shows the saved topic instead of a fresh prefill.

When the user returns to a video whose session has already moved past prompt, the studio opens on the furthest stage reached, not here. The prompt stage is then reached only by clicking its step in the stepper or by Restart, and it shows the saved topic and length.

#### Leave without acting

Leaving the prompt stage without touching anything still leaves a mark on a fresh session: the mount sync has already written the prefilled topic. That is deliberate, so every remixed video carries a topic from its first visit rather than a null the generation stages would have to paper over. Nothing else is written. The niche is never written by this stage. On a session that already had a saved topic, leaving without acting writes nothing at all.

#### Begin acting

The first real change is typing in the topic field or changing the target length. Typing updates the field and the studio's live copy of the topic on every keystroke, which keeps the Continue gate responsive, but it does not save to the server per keystroke. Changing the length saves immediately, because a select has no blur to defer to.

#### While acting

The topic field shows what the user types. The studio's Continue button in the footer enables the moment the topic is non-empty and disables again if the field is cleared to nothing. The Quick Remix button follows the same topic condition and additionally stays disabled without a model key. Nothing generates on this stage, so there is no pending result to wait for and no run log entry from an edit here. The run log the studio shows below other stages is hidden on the prompt stage.

#### Finish

There is no commit that ends the prompt stage on its own terms. The stage's edits are committed continuously by autosave: the topic on blur, the length on change, the prefill once on mount. The user finishes the stage by clicking Continue, which advances to research, or Quick Remix, which runs the whole generation pass and lands them on the script stage. Both of those transitions belong to [the remix studio](#the-remix-studio). Continue is gated on a topic existing; because the prefill sync sets one, that gate is met from arrival unless the user empties the field.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (session stage) | A fresh session at the prompt stage prefills the topic and syncs it once. A session that already holds a topic shows the saved value and does not re-prefill. | Editing the topic or length updates those fields; it does not move the session's stage. The stage only advances through the studio's Continue or Quick Remix. |
| Attached data present or absent | No effect. The prefill uses the source caption, not the transcript or the analysis. The niche and the length do not depend on any attached data. | No effect. |
| External service availability | No model key configured shows an inline note under the length select and disables Quick Remix. The proxy being down, the Graph token being invalid, and the sidecar being off do not change anything the prompt stage renders. | With no key, Quick Remix stays disabled. With a key present but the proxy down, Quick Remix is still enabled here and fails when clicked, surfacing as a toast from the studio. The prompt stage does not show the generation-blocked panel that the hook, style, and script stages show. |
| Keyboard shortcut in play | None specific to the stage. The topic field is a plain text input; nothing is auto-focused. | Enter in the topic field does not submit, because there is no form to submit. The length select opens and closes with the keyboard but honors no stage-specific key. There is no keyboard shortcut for Continue or Quick Remix. |

The only mid-action change available is the text of the topic and the choice of length. There is no modifier that changes what Continue or Quick Remix does.

### Cancel and interrupt

The columns are the action before its edit commits (an unsaved keystroke) and while an autosave is in flight. Quick Remix, once clicked, runs in the studio; its in-flight behavior is [the remix studio's](#cancel-and-interrupt), not this stage's.

| Event | Before commit (unsaved edit) | While in flight (autosave running) |
| --- | --- | --- |
| Explicit cancel or stop | There is no cancel button and no dialog on this stage. Escape does nothing to the fields; on the open length select it closes the list without changing the value. There is nothing to stop. | An autosave cannot be cancelled from the UI; it is a fire and forget write that runs to completion or fails to a toast. |
| Navigate away mid action | Leaving the stage keeps whatever was already saved. An unblurred topic edit is lost. A length change was already saved on selection, so it survives. | Leaving still lets the in-flight write land on the server; the studio is a client shell and does not re-read on navigation, so the current view does not reflect a write that lands after the user has gone. |
| Reload or tab or window closed | The session is server backed, so a reload resumes at the furthest stage with the saved topic and length. An unblurred topic edit is lost. | The write may or may not have landed. On next load the field shows whatever the database holds. |
| A backing service fails mid action | The prompt stage's own edits touch no external service; a failed edit can only be a failed database write. | A failed autosave surfaces as an "Autosave failed" toast and leaves the field as the user typed it. The proxy, Graph, and sidecar being down do not affect saving a topic or a length. |
| The target record changes underneath | If the source video is removed by a sync, the prompt stage is unaffected: its prefill was computed once from the caption already loaded, and the topic and length live on the session, not the video. | Same. The autosave writes to the session row, which a video removal does not touch. |
| A background job finishes or fails on its own | Not applicable on this stage. The cook run belongs to the studio page, and this stage starts no background job. Quick Remix's server pass writes to the studio's run log, described in [the remix studio](#the-remix-studio). | Not applicable. |
| A second tab or a double action on the same record | Two tabs on the same video share one session, because get or create returns the same row. Their topic and length autosaves race, last write wins. | A double click on Quick Remix is prevented by the pending state that disables the button while it runs. Two concurrent autosaves of the same field settle last write wins. |

After any interrupt the user resumes at the furthest stage the session reached, with the saved topic and length. Only an unblurred topic edit is ever at risk.

### Interactions with other systems

**Persistence and autosave.** The topic saves on blur; the length saves on change, since a select has no blur; the prefilled topic saves once on mount when the session's stored topic is null. Typing keeps the field and the studio's live topic in step on every keystroke without a per-keystroke network call, so the Continue gate stays responsive while the server write waits for blur. A failed autosave shows a toast rather than failing silently. See persistence.

**History and undo.** There is no undo. Editing the topic or length overwrites the previous value, including the prefill. Clearing the field and reopening the stage does not restore the prefill, because the prefill only runs while the stored topic is null and the mount write has already filled it.

**Navigation and refresh.** The stage does not call `router.refresh`; it keeps its state in the studio's client shell and advances through Continue in the footer. Deep links seed the hook and style stages, not this one; a fresh session with no seed opens here. See navigation and shell.

**Background jobs and the sidecar.** The prompt stage starts no background job. The source caption it prefills from was written by the sidecar sync. Quick Remix delegates its server pass to the studio.

**External services.** The stage itself makes no model call. Quick Remix calls the LLM proxy through the studio. When no model key is set, an inline note titled "Add your Claude API key" tells the user to add `ANTHROPIC_API_KEY` in settings to generate hooks, outlines, and scripts, and Quick Remix is disabled. See external services.

**Status and failures.** The stage has no run log and no inline error on its fields. An autosave failure is a toast. A Quick Remix failure is a toast raised by the studio. See status and failures.

**Configuration and settings.** The niche is read from settings and shown as a read-only chip with an "Edit in Settings" link. The target length default is 45 seconds, with 30, 45, 60, and 90 the only options.

> Technical note: the niche on the chip is the same value the generation stages send to the model, read through the one settings lookup both use, so what the user sees on the chip cannot drift from what is actually sent. The niche is display only here; the prompt stage never writes it to the session. When settings hold no niche it reads "general short-form content".

### Edge cases

- Clearing the topic field to nothing disables both Continue and Quick Remix. Restoring any non-empty text re-enables them.
- A video with no caption prefills the topic as "this topic for my niche", because the source topic falls back to the words "this topic".
- The prefill sync writes the topic even when the user does nothing, so a fresh session leaves the prompt stage with a non-null topic on its very first visit.
- Reopening the prompt stage after the session has progressed shows the saved topic and length, and the prefill does not run again.
- The keyless note on this stage is a plain inline alert, not the full generation-blocked panel the hook, style, and script stages show in place of their controls. The prompt stage keeps its controls because it needs no model to do its own job.
- Quick Remix here is disabled only for a missing topic or a missing key, not for a proxy that looks down. With a key present and the proxy unreachable, the button is clickable and the attempt fails to a toast, unlike the generation stages, which replace themselves with the block panel before the user can try.
- The target length select offers exactly 30s, 45s, 60s, and 90s. There is no free entry.

## The research stage

### Summary

The research stage is the second step of the [remix studio](#the-remix-studio). It lays out what the remix is working from before any generation happens: the source post's analysis, a transcript excerpt, the top similar outliers, and a box for the user to add their own facts. It is reached by clicking Continue on the prompt stage, or by clicking the research step in the stepper once the session has reached it. Its distinguishing signal is a two part layout with a rule across each section header: "source inputs, sent to every stage" over the material the later stages actually read, and "reference, not sent" over the vault and similar lists that are there to look at but do not flow into any prompt.

The stage assembles itself. On arrival, if the remix session has no research notes yet, it builds them from the source post with no model call, which is why this stage works with no API key and with the LLM proxy down. Only the "your additions" facts box is editable, and it autosaves on blur. Continue is always allowed from here; there is nothing to require.

### The simple case

The user clicks Continue on the prompt stage and lands on research. For a fresh session the screen briefly reads "Assembling research from the source post" with two placeholder blocks, then fills in: why the source post worked, its hook pattern as a set of tags, its structure broken into beats with each beat's note and the words that were said, and below that a list of similar tracked outliers and the posts saved in the vault. The user reads it, optionally types their own angle or a stat into the "your additions" box, clicks away to save it, and clicks Continue to move to the hook stage.

On a return visit the assembly does not run again. The stored notes render straight away, with the facts box holding whatever the user last saved.

### The interaction, event by event

```
stateDiagram-v2
    [*] --> assembling : arrive with no research notes
    [*] --> ready : arrive with research notes already stored
    assembling --> ready : assembly lands (notes persisted)
    ready --> editingFacts : type in the additions box
    editingFacts --> ready : blur (autosave)
    ready --> [*] : Continue to the hook stage
```

#### Arrive

Opening the research stage reads the session the studio already loaded. If the session has research notes, the stage renders them at once. If it does not, the stage shows a skeleton loader and kicks off the assembly: it pulls the source post's analysis, a transcript excerpt capped at 500 characters, and the top five similar outliers, writes them to the session, and hands them back to the studio so the rest of the stages can read them. The facts box starts from whatever facts the session already holds, empty for a fresh assembly.

The assembly makes no call to the model. It reads records the sidecar and the analysis step already wrote, so it needs neither an API key nor the proxy.

#### Leave without acting

Leaving research without touching the facts box records nothing new beyond what the assembly already persisted. The assembled notes are written to the session as part of arriving, not as a separate save, so backing out to the prompt stage or out of the studio keeps them. Returning resumes with the same notes and does not reassemble.

#### Begin acting

The first real work here is the auto assembly itself, which happens without the user asking. The only user driven action is the first keystroke in the "your additions" box, which makes the field dirty. Nothing is committed on that keystroke; the text lives in the field until the field loses focus.

#### While acting

Editing the facts box updates the field live as the user types. Nothing else on the stage changes. When the field loses focus the current text is written to the session's research notes and the studio's local copy is updated in step, so the facts flow into the hook, style, and script prompts from then on. A failed save surfaces as an "Autosave failed" toast; there is no inline error.

#### Finish

There is no commit step that closes this stage. The assembled notes are already durable, and the facts box commits on each blur. Continue advances to the hook stage. Because Continue is always allowed, the user can move on with an empty facts box, with an unanalyzed source, or before the assembly has even finished.

> Technical note: the assembly is a server action fired from an effect that runs only while the session has no research notes. It writes the notes to the database directly, then reports them back to the client. If the user navigates away before it lands, the client update is dropped but the database write still happens, so the next visit shows the notes.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (session stage) | The stage assembles when the session has no research notes and renders the stored notes otherwise. Whether the source video is analyzed decides the top block: the source inputs when it is, a "this post has not been analyzed" note with a link to analyze it when it is not. | Editing the facts box does not move the session stage. The stage never reassembles once notes exist; there is no rebuild control. |
| Attached data present or absent | With an analysis, the why it worked line, the hook pattern tags, and the structure beats show; without one, the fallback note shows instead. With a transcript, an excerpt fills the collapsed fallback and each beat can carry the words said; without one, the fallback reads "No transcript available." Similar outliers show when other analyzed videos exist, an "analyze more videos" note when they do not. | No effect. The assembled block is fixed once written; only the facts box changes. |
| External service availability (LLM proxy, Graph, sidecar) | No effect on the stage running. Assembly reads stored records and makes no model call, so it works with the proxy down, with no API key, and with the sidecar off. The sidecar and the analysis step are what wrote the records it reads. | No effect. Saving the facts box is a local database write. |
| Keyboard shortcut in play | None. There is no dialog and no keyboard submit. | Enter in the facts box inserts a newline. Tabbing or clicking out of the field blurs it and triggers the autosave. |

### Cancel and interrupt

| Event | Before commit (reading or editing) | While in flight (assembling or saving facts) |
| --- | --- | --- |
| Explicit cancel or stop | There is no cancel or stop control on this stage. Leaving keeps the assembled notes and the last saved facts. | The assembly cannot be cancelled from the UI. A facts autosave cannot be cancelled; it runs to completion. |
| Navigate away mid action | Leaving keeps everything already written. Text typed in the facts box but not yet blurred is not saved. | Leaving during the assembly drops the client update but the database write still lands, so the notes appear on the next visit. Leaving during a facts save lets the write finish; the toast may not appear. |
| Reload or tab or window closed | The session is server backed, so a reload resumes with the stored notes and the last saved facts. Unblurred facts text is lost. | A reload during assembly re reads the session: if the notes had been written, they show; if not, the next mount reassembles. A reload during a facts save may or may not have committed; the next load shows what the database holds. |
| A backing service fails mid action | No external service is used. | If the assembly action fails, the client sets nothing and the stage stays on the skeleton loader, since the session's research notes stay empty. A failed facts save shows an "Autosave failed" toast and leaves the text in the field. |
| The target record changes underneath | If the source video was removed by a sync before assembly, the assembly finds no analysis or transcript and builds notes with those parts empty; similar outliers are computed from whatever analyzed videos remain. The vault list is read fresh on each visit, so a save or remove elsewhere shows up next time. | Same. Assembly reads the stored records at the moment it runs; a later change does not rewrite an already assembled note. |
| A background job finishes or fails on its own | A sidecar sync that adds or analyzes videos changes what a fresh assembly would produce, but only for a session that has no notes yet. Once assembled, the source inputs and the similar list are frozen; only the facts box and the live vault list change. | No effect. This stage starts no background job. |
| A second tab or a double action on the same record | Two tabs on the same video share one session. Both showing an unassembled stage can each trigger the assembly; the writes are the same content and the last one wins. | Two facts saves race last write wins. A second assembly overwrites the first with identical notes. |

After an interrupt the user resumes reading the same notes. Nothing here is left half written except facts text that was typed but never blurred.

### Interactions with other systems

**Persistence and autosave.** The assembled notes are persisted to the session as part of arriving, not on a save button. The facts box autosaves on blur into the same research notes record; it is the one field on this stage the user can edit after assembly. See persistence.

**History and undo.** There is no undo. Editing the facts box overwrites the previous text with no way back. The assembled block cannot be edited at all and is never rebuilt once written, so it is stable across the life of the session.

**Navigation and refresh.** Most of the stage is client state seeded from the session the studio loaded. The vault saved posts list is the exception: it is read live on the server on each visit rather than frozen into the notes, so saving or removing a post from the feed is reflected the next time research opens. See navigation and shell.

**Background jobs and the sidecar.** Assembly reads the video, its analysis, and its transcript, all written earlier by the sidecar and the analysis step. It starts no job of its own. The similar outliers are computed from the analyses of other tracked videos. See background jobs.

**External services.** None. This stage makes no generation call, which is why it stays usable when the hook, style, and script stages are blocked for a missing key or a down proxy. See external services and the generation blocked posture in [the remix studio](#the-remix-studio).

**Status and failures.** This stage does not write a remix run row, so nothing it does appears in the run log; only the generation stages log there. Its own failures are a stuck skeleton on a failed assembly and an "Autosave failed" toast on a failed facts save. See status and failures.

**Configuration and settings.** The transcript excerpt cap of 500 characters and the similar outliers cap of 5 are fixed constants, not user settings. The niche is not shown on this stage; it belongs to the prompt stage.

### Edge cases

- The assembly runs only when the session has no research notes. There is no manual rebuild, so re analyzing the source post after assembly does not update the stored source inputs; the old notes stay until a session with empty notes is assembled.
- Quick Remix from the prompt stage assembles research as its first step, so a session it produced already has notes and this stage never reassembles when the user visits it.
- The transcript excerpt is truncated to 500 characters with an ellipsis appended, and it is shown only inside the collapsed "full transcript fallback", described as the source of the words for beats that carry no per beat transcript of their own.
- Each structure beat shows both a note and the words said when the beat was analyzed with a per beat transcript. Beats analyzed before that existed show the note alone rather than an empty second line.
- The vault list is read live and the similar list is frozen at assembly time, so the two "reference" lists can disagree about what the vault holds if the user saved a post after this session's research was first built.
- Continue is allowed even while the assembly is still running or when the source is unanalyzed, so the user can reach the hook stage with empty or partial research notes.

## The hook stage

### Summary

The hook stage generates a set of opening lines for the script, shows them as
option cards the user reads, and lets the user pick one to carry forward. It is
the third of the six remix stages. It generates against the source video's own
hook pattern by default, or against a vault item the user
seeds it with, produces three to seven read only options, and ends when the user
chooses one, which pins it at the top of the stage and unlocks Continue. It needs
the LLM proxy; without a key or with the
proxy unreachable the whole stage is the block panel from
[the remix overview](#the-remix-studio).

The stage lives inside the [remix studio](#the-remix-studio) and is reached by
Continue from the research stage, by a stepper click once reached, or by a
deep link from a vault hook template
card that seeds the vault select. Its generation attempts are logged to the run
log under the hook stage.

### The simple case

The user arrives from research and clicks Generate hooks. A short wait, then five
option cards appear, each one candidate opening line. The user reads them, clicks
"Use this hook" on the one they like, and it lifts to a pinned panel at the top of
the stage while its card marks Selected. Continue is now enabled. If none land,
the user types a note in the steer box ("punchier, lead with the number") and
clicks Regenerate with note, or seeds the generation from a saved vault hook first.
Any option worth keeping can be saved back to the vault as a template.

### The interaction, event by event

```
stateDiagram-v2
    [*] --> empty : arrive (no hooks yet)
    [*] --> options : arrive (session already has hooks)
    empty --> generating : Generate hooks
    options --> generating : Regenerate hooks or steer note
    generating --> options : hooks returned (cards shown)
    generating --> empty : error (toast, prior hooks kept)
    options --> chosen : Use this hook (pins, autosaves)
    chosen --> generating : Regenerate hooks or steer note
    chosen --> chosen : Use a different hook
    chosen --> [*] : Continue (chosen hook set)
```

#### Arrive

The stage opens with whatever the session already holds. If the session has hook
options they render as cards straight away and the button reads Regenerate hooks;
if not, the stage shows the grounded in line and a single Generate hooks button
over an empty prompt. If the session already has a chosen hook it shows pinned in a
panel at the top, and its card, if still among the options, is marked Selected. The
vault seed select defaults to "None, use source hook pattern". A deep link from a
vault hook template card preselects that hook in the select, but only jumps the
studio to this stage when the session is still fresh at prompt; a session with real
progress keeps its own stage and honors the seed whenever the user reaches hook.

#### Leave without acting

Leaving before generating records nothing new. The grounded in line, the empty
state, and the seed select are not saved state, so nothing is lost. A vault seed
picked in the select but never generated from is dropped; it lives only in the
stage until a generation reads it, since the hook stage has no persisted seed
column.

#### Begin acting

The first real work is Generate hooks (or Regenerate hooks once options exist).
The stage sends the topic, niche, facts, and either the source video's hook
pattern or the seeded vault template, asks for a set of hooks, and shows an
indeterminate generating state, five card shaped placeholders, while it waits. The
generate button is disabled for the duration so a second click cannot start a
second run.

#### While acting

When the hooks return they replace the card set and the button relabels to
Regenerate hooks. Each card is a read only line: it cannot be edited in place, and
"Use this hook" is the only way to commit one. Choosing a hook records it
immediately, both to the pinned panel at the top and to the session, so the finish
view and the cook brief read the hook the user actually chose. A steer box sits
below the cards: a note typed there is added to the same inputs and reruns the
generation. Each card also offers "Save as template", which writes the line to the
vault as a reusable hook item without changing the current pick. A failed
generation shows a toast and leaves the previous options and the pinned choice
intact.

#### Finish

The stage has no commit of its own beyond the chosen hook, which autosaves the
moment "Use this hook" is clicked. Continue in the studio footer, enabled once a
hook is chosen, advances to the style stage. The chosen hook then grounds the
outline and script generations downstream.

> Technical note: choosing a hook stores the line's raw text on the session, not a
> reference to any vault item. A hook seeded from a vault template and one written
> fresh are indistinguishable once chosen, so nothing links a saved script back to
> the vault hook that shaped it.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (hooks present, one chosen) | Opens with the session's hooks as cards and its chosen hook pinned, or an empty prompt if neither exists. | Generating replaces the whole card set; choosing a hook pins it and enables Continue. Regenerating does not clear an existing chosen hook. |
| Attached data present or absent | The grounded in line lists only the inputs that exist (why it worked, hook pattern, opening beat transcript, topic, niche, facts); a missing input is not listed, and with none it reads "nothing yet, fill in Prompt and Research first". A vault seed select shows a disabled "No saved hooks yet" option when the vault is empty. | Generation reads whatever the session holds at the moment of the call, including the seed select's current value. |
| External service availability | With no key or the proxy unreachable the whole stage is the block panel; the seed select and cards are not shown. | A generation failing on a connection error contributes to the studio's proxy down read and can flip the stage to blocked on the next render. |
| Keyboard shortcut in play | None specific. | The steer box textarea behaves as a normal field; there is no keyboard submit. |

The seed select is the only modifier: "None, use source hook pattern" grounds the
generation in the source video's own hook type, a picked vault hook swaps that
pattern for the template's text. An empty vault never blocks the stage; generation
still falls back to the source pattern.

### Cancel and interrupt

| Event | Before commit (reading or picking) | While in flight (generating) |
| --- | --- | --- |
| Explicit cancel or stop | There is no cancel; a hook is committed only by "Use this hook", and not choosing one commits nothing. | The generate and regenerate buttons are disabled while running; there is no stop. |
| Navigate away mid action | Leaving keeps the session's hooks and any chosen hook. A vault seed picked but not generated from is dropped, and any steer note is lost. | Leaving abandons the client wait; the server still writes the hooks (on success) and the run log row. On return the session reflects what landed. |
| Reload or tab or window closed | The hooks and the chosen hook survive because they are server backed. The seed select resets to its default and the steer note clears. | The reload resumes from the database; the in flight result and its run row appear once landed. |
| A backing service fails mid action | No effect until the user generates; the stage reads no external service to display cards. | A failed generation shows a toast and writes a failed run log row; the previous hooks and the chosen hook are left intact. Repeated connection failures flip the stage to blocked. |
| The target record changes underneath | If the source video is removed by a sync, the session keeps its own copied hooks and pattern; a later regenerate falls back to a default pattern when the analysis is gone. | Generation reads the session's stored inputs, not the live video, so a mid run removal does not corrupt the attempt. |
| A background job finishes or fails on its own | Not applicable here; the cook run belongs to the studio page. | Not applicable. |
| A second tab or a double action on the same record | Two tabs on the same session share one row; the last "Use this hook" click wins on the chosen hook field. | A double generation is prevented by the disabled button; two tabs generating at once both write run rows and the later write wins on the hook options field. |

After an interrupt the user resumes with the server's copy of the hooks and the
chosen hook. The steer note and the seed select are page state and reset on
remount.

### Interactions with other systems

**Persistence and autosave.** The chosen hook autosaves the instant "Use this
hook" is clicked, through the shared autosave path; a failed save surfaces as an
"Autosave failed" toast rather than failing silently. The generated hook options
are persisted by the generation itself. The steer note is never persisted, and the
seed select is not saved. See persistence.

**History and undo.** No undo. Regenerating replaces the whole option set; the run
log records that an attempt happened but does not keep the replaced hooks.
Choosing a different hook overwrites the previous pick.

**Navigation and refresh.** The stage keeps its state locally within a visit and
does not need a refresh; a reload rebuilds from the session. A deep link seeds the
select and, from a fresh session, the opening stage. See
navigation and shell.

**Background jobs and the sidecar.** None directly. The stage reads the source
video's analysis, written by the sidecar, to describe the hook pattern and the
opening beat.

**External services.** Generation calls the LLM proxy. When it is down the stage
blocks. Save as template writes to the vault and needs no model. See
external services.

**Status and failures.** Generation writes a run log row under the hook stage on
every attempt, Success on the hooks returning and Failed on an error, and asks the
studio to re-read the log so its proxy down read stays live. See
status and failures.

**Configuration and settings.** The niche is read from settings and fed to the
prompt; the persona, when filled, is appended too. Neither is edited here.

### Edge cases

- The option cards are read only. An edit typed into a card would never reach the
  server, so the cards are plain text and "Use this hook" is the only commit; a
  hook is changed by choosing another or regenerating, not by editing.
- Regenerating does not clear an existing chosen hook. If the new options do not
  contain the previously chosen line, the pinned panel still shows it, no card is
  marked Selected, and Continue stays enabled, because the chosen hook is stored as
  text independent of the current option set.
- Save as template writes a new vault hook item titled from the first forty
  characters of the line, but the seed select does not refresh to include it within
  the same visit; the new template appears in the select only after the page is
  reloaded.
- An empty vault does not block the stage. The seed select shows a disabled "No
  saved hooks yet" option, and generation falls back to the source video's own hook
  pattern.
- A vault seed chosen in the select but never generated from is discarded on leave,
  because the hook stage has no persisted seed column; only the picked hook's text
  is saved, after generation.
- If a hook was chosen before the proxy went down, Continue stays enabled from the
  session's stored choice even though the whole stage is now the block panel and no
  cards are visible.

## The style stage

### Summary

The style stage decides the shape of the script: which structure the beats follow, and what those beats say. It is the fourth of the six remix stages. The user picks a structure (the source post's own structure by default, or a saved style template from the vault), clicks Generate outline, and gets back a list of beats they can read and edit by hand: each beat is a target length in seconds, a short label, and a line of content. It needs the LLM proxy to generate; without it the whole stage is the block panel from [the remix overview](#the-remix-studio).

The stage lives inside the [remix studio](#the-remix-studio) and is reached by Continue from the hook stage, or by a stepper click once the stage has been reached. Its outline generation is logged to the run log under the style stage. Continue to the script stage is gated on an outline existing.

### The simple case

The user arrives on the style stage with a hook chosen behind them. The structure select reads "Source post's structure". They leave it there, or open it and pick one of their saved style templates, then click Generate outline. A short pending state shows four placeholders, then the outline arrives as a numbered list of beats. Each beat has a seconds box, a label, and a content line, all editable. The user tweaks a label here, retimes a beat there, and clicks out of the field to save. If the shape is wrong they type a note in the steer box and regenerate, or click Regenerate outline to draw a fresh one. When the outline reads the way they want, they Continue to the script stage.

### The interaction, event by event

```
stateDiagram-v2
    [*] --> ready : arrive (structure select, no outline yet)
    ready --> ready : select a structure (autosaves styleVaultItemId)
    ready --> generating : Generate outline
    generating --> outline : beats returned (autosaved)
    generating --> ready : error (toast, prior beats kept)
    outline --> editing : type in a beat field
    editing --> outline : blur (autosave the whole outline)
    outline --> generating : Regenerate outline, or Regenerate with note
    outline --> [*] : Continue to script
```

#### Arrive

Opening the style stage loads the session's current structure choice and its current outline, both from the session the [studio shell](#the-remix-studio) already holds. The structure select starts on whatever the session last recorded: "Source post's structure" when no style vault item is set, or the named style template when one is. If the session already has an outline, its beats render straight away as editable rows and the button reads "Regenerate outline". If not, the stage shows a grounded in line and a single Generate outline button over the line "Generate an outline to get started."

The structure select lists "Source post's structure" first, then one option per saved style vault item. When the vault holds no style templates the select still opens, but the only extra option is a disabled "No saved styles yet" that cannot be picked. An empty vault is not a dead end: generation falls back to the source post's own structure either way, so the disabled option only explains why there is nothing else to choose.

#### Leave without acting

Leaving the stage without generating records nothing new. The structure choice is already saved the moment it changes (see below), so it survives leaving regardless. The grounded in line and the empty prompt are not state; nothing is lost by walking away before a generation.

#### Begin acting

There are two ways to begin. Changing the structure select is the first: picking a style template autosaves that choice to the session immediately, and picking "Source post's structure" clears it back to none. Clicking Generate outline is the other: it starts the model call that produces the beats. A hand edit to an existing beat also counts as acting, and autosaves on blur.

#### While acting

While a generation runs, the button reads "Generating…" and is disabled, the beats and the steer box are replaced by four placeholder rows, and the structure select stays visible but no new generation can start until this one settles. The stage does not claim to know how far along the model is; the call is atomic with no incremental signal.

When the outline returns it replaces the beat list and the button relabels to "Regenerate outline". Each beat is three fields: a narrow seconds box, a label input, and a two row content area. Typing in any of them updates the beat on screen with every keystroke, so the outline the studio holds stays current as the user types. Nothing is sent to the server until the user leaves the field: on blur the whole outline is saved at once. Below the beats, the steer box takes a note ("add a beat before the payoff, tighten the build") and regenerates the outline with that note folded into the same inputs.

#### Finish

There is no single commit for this stage. The structure choice is committed when it changes, the outline is committed when a generation lands and again on every blur after an edit, and the run log gets a row on every generation attempt. Continue in the studio footer moves to the [script stage](#the-script-stage); it is enabled as soon as an outline exists on the session. The style stage does not create a script or a planned post; it only shapes the beats the script stage will write from.

> Technical note: the seconds box stores a number. Clearing it or typing anything that is not a number lands the beat at 0 seconds rather than refusing the keystroke, because the field coerces its text to a number and falls back to 0 when that fails.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (session stage, outline present or not) | An outline already on the session renders as editable beats and the button reads "Regenerate outline"; no outline shows the empty prompt and "Generate outline". | A landed generation fills the beats and flips the button label; editing a beat and blurring resaves the whole outline. |
| Attached data present or absent | The grounded in line lists only the inputs that exist: the structure (source beats or the named vault template), why the source worked, the chosen hook, the topic, and the user's own facts. A missing input is simply not named. With nothing yet, the line reads "nothing yet, fill in Prompt and Research first". | Selecting a vault style template swaps the structure clause from "source structure beats" to the template's name; the why it worked clause stays either way. Generation reads whatever the session holds at the moment of the call. |
| External service availability (LLM proxy, Graph, sidecar) | With no API key or the proxy looking down the whole stage is the block panel and none of these controls render. The Graph token and the sidecar have no effect here. | A generation that fails on a connection error contributes to the studio's proxy down read and can flip the whole stage to blocked until an attempt succeeds. |
| Keyboard shortcut in play | None specific. The structure select opens with the keyboard as any select does. | The seconds box, label input, content area, and steer box are ordinary text fields; there is no keyboard submit and Enter in a field does not generate. |

Regenerating draws a whole new outline every time; there is no per beat regenerate on this stage. A hand edit and a regenerate both change the beats the same way, and both flow straight into whatever the script stage generates next, because that stage reads the session's stored outline at the moment it runs.

### Cancel and interrupt

| Event | Before commit (selecting or editing) | While in flight (generating) |
| --- | --- | --- |
| Explicit cancel or stop | There is no cancel button. A structure change is already saved, so there is nothing to undo but to pick again. An unblurred beat edit is discarded only if the user changes the value back or reloads before blur. | The Generate and steer buttons are disabled while running; there is no stop. The call runs to completion. |
| Navigate away mid action | Leaving keeps the saved structure choice and the last saved outline. Returning resumes with them. | Leaving abandons the client wait, but the server call still writes the new outline and the run log row. The new beats do not appear in the studio's live copy; a reload or a return that re-reads the session shows what landed. |
| Reload or tab or window closed | The structure choice and the outline are server backed, so a reload resumes with them. An unblurred edit in a beat field is lost. | The reload resumes from the database; the in flight generation's outline and its run row appear once it lands. |
| A backing service fails mid action | The select and hand edits do not touch the model, so they are unaffected. | A failed generation shows a toast with the reason, writes a failed run log row under the style stage, and leaves the previous beats intact. Repeated connection failures flip the stage to blocked. |
| The target record changes underneath | If the source video is removed by a sync, the session keeps its stored analysis and outline; a later regenerate that falls back to source structure may find less to ground on. | Generation reads the session's stored inputs, not the live video, so a mid run removal does not corrupt the attempt. |
| A background job finishes or fails on its own | Not applicable on this stage; the cook run belongs to the studio page. | Not applicable. |
| A second tab or a double action on the same record | Two tabs on the same session share one row; their structure choices and beat autosaves race, last write wins. | A double generation in one tab is blocked by the disabled button. Two tabs generating at once both write run rows and the later write wins on the session's outline column. |

After an interrupt the user resumes with the server's copy of the structure choice and the outline. Only an unblurred beat edit is at risk; everything else is already durable.

### Interactions with other systems

**Persistence and autosave.** Two things autosave here. The structure choice saves the instant the select changes, source clearing it to none. Beat edits save on blur as the whole outline, not per field, so leaving a field commits every edit made since the last blur. A generation persists its outline server side as it lands. A failed autosave surfaces as a toast rather than failing silently. See persistence.

**History and undo.** No undo. Regenerating replaces the whole outline; editing a beat replaces its text. The run log records that an attempt happened and how many beats it produced, but it does not keep the replaced outline, so a regenerate that reads worse than the last one cannot be rolled back except by generating again.

**Navigation and refresh.** The stage keeps the outline in the studio's local state within a visit and does not need a refresh to stay current while the user is on it. A reload rebuilds the beats from the session. See navigation and shell.

**Background jobs and the sidecar.** None directly. The source analysis the outline grounds on was written by the sidecar earlier; the outline itself feeds only the later [script stage](#the-script-stage) and, through it, the cook run.

**External services.** Outline generation calls the LLM proxy. When there is no API key or the proxy looks unreachable the stage is the block panel and offers no generate button at all. See external services.

**Status and failures.** Every outline attempt writes a run log row under the style stage: success with the beat count, or an error with the message. The run log is the studio's own status surface, distinct from the shell failure strip. See status and failures.

**Configuration and settings.** The niche and the persona feed the generation prompt from settings, the same as the other generation stages, without appearing on this screen. The target length default of 45 seconds set on the prompt stage is what the outline's beats are timed against.

### Edge cases

- An empty vault does not block the stage. The structure select shows a disabled "No saved styles yet" and generation falls back to the source post's own structure.
- The grounded in line is honest about the structure source: once a vault style template is picked it names that template and stops claiming the source beats fed the structure, because generation uses the template's structure instead. The why it worked clause stays either way, since that input is passed regardless of the structure choice.
- Regenerating the outline does not touch anything the script stage already produced. A session that generated variants, then came back and regenerated the outline, keeps its old variants against a new outline until the user regenerates the variants too. Nothing on this stage warns about that mismatch.
- A generation that returns no beats still counts as an outline: the session records an empty outline, so Continue to the script stage becomes enabled while the stage itself still shows "Generate an outline to get started" and no beat rows.
- Clearing a beat's seconds box, or typing a non number into it, sets that beat to 0 seconds rather than leaving the field blank.
- The steer note is local to the stage and never saved. Leaving the stage and coming back starts the steer box empty; the note only ever exists for the one regenerate it drives.

## The script stage

### Summary

The script stage generates the actual script text, as three variants the user reads, edits, and picks between. It is the fifth of the six remix stages and the richest one: it generates in parallel, isolates a failed variant from the successful ones, lets each variant be edited or regenerated on its own, and ends by saving a chosen variant as a script and optionally putting it on the plan with a date. It needs the LLM proxy; without it the stage shows the block panel from [the remix overview](#the-remix-studio).

The stage lives inside the [remix studio](#the-remix-studio) and is reached by Continue from the style stage or by a stepper click once reached. Its generation attempts are logged to the run log under the script stage.

### The simple case

The user arrives with an outline behind them and clicks Write script. Three variants appear as tabs, each a full script the user can read and edit. They flip between tabs, tweak the wording, and pick the one they want by opening its tab. They click Save script, confirm a title, and the variant is saved to their scripts. If they want a date on it, they add one under Add to plan. Otherwise they Continue to finish.

### The interaction, event by event

```
stateDiagram-v2
    [*] --> empty
    empty --> writing : Write script
    writing --> variants : 3 variants returned
    variants --> writing : Regenerate all
    variants --> regenOne : Regenerate one (single slot)
    regenOne --> variants : slot replaced
    variants --> saved : Save script (title, picks variant)
    saved --> planned : Add to plan (date)
    saved --> variants : edit or regenerate the saved slot (save cleared)
```

#### Arrive

The stage opens on the variant the session already records as chosen, so returning does not silently move the pick to the first variant. If the session has variants, they appear as tabs; if not, the stage shows a grounded in line naming what will feed generation and a single Write script button. A line above the controls names the inputs that ground generation: the structure beats, why the source worked, the chosen hook, and the user's own facts, each shown only when present.

#### Leave without acting

Leaving before generating records nothing new; the session keeps whatever it had. The grounded in line and the empty state are not state, so nothing is lost.

#### Begin acting

Write script generates three variants in parallel, each against one of three fixed angles: stay close to the source, open from a different hook angle, and tighten the pacing. While it runs the stage shows an indeterminate writing state with three placeholders; it does not claim to know which variant is being written, because the call is atomic with no incremental signal.

#### While acting

When the variants return they replace the tab set and the active tab resets to the first. Each variant is an editable text area. Editing a variant updates it locally on each keystroke and saves the whole set on blur. Opening a variant's tab is the pick: it is recorded immediately so the finish view and the cook brief read the variant in front of the user rather than the first one.

Per variant, the user can Regenerate (replacing just that slot, keeping its angle), Copy it to the clipboard, or type a note in the steer box and regenerate with that note added to the same inputs. A variant that failed to generate shows a destructive alert with the error and a Retry button in place of the text area; the other variants are untouched. Regenerate all replaces the whole set again.

Create Prompt copies a remix scoped prompt (built from the session, including the chosen hook and variant) to the clipboard for pasting into any model, distinct from the source scoped prompt on the video detail page.

#### Finish

Save script opens a dialog with a title, prefilled from a derived short title rather than the raw topic. Saving writes the open variant as a script, records that variant as the chosen one, and shows a toast with a link to open it in the vault. Once saved, an Add to plan row appears: choosing a date and clicking Add to plan creates a planned post carrying the saved script for that date. Adding a date here is optional; the script is already saved either way, and skipping it leaves the script in the vault. The stage's own Continue (in the studio footer) moves to finish, which is where the pick is finally confirmed and a plan is guaranteed.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (variants present, one chosen) | Opens on the recorded chosen variant if there is one, else the first tab; empty state if no variants. | Opening a tab records the pick; Regenerate all clears the pick and any prior save. |
| Attached data present or absent | The grounded in line lists only the inputs that exist (hook, facts, analysis). A missing input is simply not listed. | Generation reads whatever the session holds at the moment of the call. |
| External service availability | With the model unavailable the whole stage is the block panel. | A generation failing on a connection error contributes to the studio's proxy down read and can flip the stage to blocked. |
| Keyboard shortcut in play | None specific. | The variant text areas and the title input behave as normal fields; there is no keyboard submit. |

Regenerating a single slot keeps that slot's angle; regenerating all draws the three angles fresh. A hand edit and a regenerate are treated the same way for staleness: either one on the saved slot clears the save.

### Cancel and interrupt

| Event | Before commit (editing or picking) | While in flight (generating) |
| --- | --- | --- |
| Explicit cancel or stop | Closing the save dialog with Escape or its close discards the title entry, not the variants. There is no cancel for a generation. | The generate and regenerate buttons are disabled while running; there is no stop. |
| Navigate away mid action | Leaving keeps the autosaved variants and the recorded pick. A title typed in the open save dialog is lost. | Leaving abandons the client wait; the server still writes the variant result and the run log row. On return the variants reflect what landed. |
| Reload or tab or window closed | The variants, the pick, and any saved script survive because they are server backed. Unblurred edits in a variant text area are lost. A saved script id held only in the page is lost, so the Add to plan row disappears until the user saves again. | The reload resumes from the database; the in flight result and its run row appear once landed. |
| A backing service fails mid action | The prompt and research inputs are unaffected. | A failed variant becomes an inline error at its own slot while the others succeed; a whole failed generation shows a toast and leaves the previous variants intact. Zero successes writes a failed run row. |
| The target record changes underneath | Generation reads the session's stored inputs, not the live video, so a source removal does not change an in progress edit. | Same. |
| A background job finishes or fails on its own | Not applicable here. | Not applicable. |
| A second tab or a double action on the same record | Two tabs editing the same session race their autosaves; last write wins per slot. | A single slot regenerate read modify writes only its slot server side, so a concurrent edit of a sibling slot is not clobbered. Regenerate all replaces the whole set. |

After an interrupt the user resumes with the server's copy of the variants and the recorded pick. A saved script row is durable; the Add to plan affordance is page state and reappears only after a fresh save.

### Interactions with other systems

**Persistence and autosave.** Variant edits autosave on blur as the whole set. The pick autosaves the moment a tab opens. A single slot regenerate is persisted server side into just that slot. A failed autosave shows a toast. See persistence.

**History and undo.** No undo. Regenerating or editing replaces a variant's text; the run log records that an attempt happened but does not keep the replaced text.

**Navigation and refresh.** The stage keeps its state locally within a visit and does not need a refresh; a reload rebuilds from the session. Save opens a toast link to the vault; Create Prompt writes to the clipboard.

**Background jobs and the sidecar.** None directly. The saved script and any planned post feed the later cook run.

**External services.** Generation calls the LLM proxy; a clipboard copy needs a permitted clipboard. A denied clipboard shows a toast rather than failing silently. See external services.

**Status and failures.** Generation writes a run log row on every attempt: Success when at least one variant returns, Partial when some of the three fail, Failed when none return. See status and failures.

**Configuration and settings.** The default variant count is three. The niche and persona feed the prompt from settings, described in the generation stages.

### Edge cases

- A failed variant is isolated: it shows an error at its own tab while the successful variants stay usable, and Retry regenerates only it.
- Regenerate all clears the chosen variant and any prior save, because the earlier pick and script now point at text that no longer exists.
- Editing or regenerating the exact slot a save came from clears that save, hiding Add to plan until the user saves again; editing a different slot leaves the save intact.
- The save title is derived to a short form, not the raw topic, because the prompt stage prefills the topic with the whole source caption, which once landed as multi thousand character titles.
- Continue advances to finish on a variant merely existing, not being picked, so the finish view can explain a missing pick rather than being unreachable.
- Add to plan here creates a dated planned post directly, a second path to the plan alongside the [finish stage](#the-finish-stage), which creates an undated draft.

## The finish stage

### Summary

The finish stage is where a remix stops being working state and becomes a durable
planned post. It shows a short summary of what the run
produced, the chosen hook and the chosen script variant, and offers one button that puts
the remix on the plan and links into its studio to cook it. It is the sixth and last of
the six remix stages. Unlike the hook, style, and script stages, it makes no model call:
finishing is bookkeeping, not generation, so this is the one generation stage that stays
fully usable with the LLM proxy down, the Graph token
invalid, or the sidecar off. It needs none of them.

The stage lives inside the [remix studio](#the-remix-studio) and is reached by Continue
from the [script stage](#the-script-stage), which the studio allows once a variant exists,
or by a stepper click once the stage has been reached. It has no Continue of its own; the
"Finish and open studio" button is the end of the line.

### The simple case

The user arrives from the script stage with a hook and a variant already chosen. The stage
shows the hook text and the chosen variant, labeled as variant N of the set. The user reads
the summary and clicks "Finish and open studio". A toast says the remix was added to their
plan, the button is replaced by a line saying the remix is ready to cook and a link that
reads "Open the studio", and clicking it opens the studio page
for the new planned post.

### The interaction, event by event

This stage has no generation. Its "finish" phase is the creation of the planned post, the
single durable write the whole remix builds toward.

```
stateDiagram-v2
    [*] --> summary : arrive on the finish stage
    summary --> summary : leave without acting (nothing written)
    summary --> finishing : click Finish and open studio
    finishing --> done : plan created or reused, script reconciled
    finishing --> summary : error (toast, button re-enabled)
    done --> [*] : Open the studio link
```

#### Arrive

Opening the finish stage shows two read only summaries built from the session as it stands.
The Hook block shows the chosen hook, or the placeholder "(no hook chosen)" when none was
picked. The Chosen script block shows the chosen variant with a "Variant N of M" label, or
the placeholder "(no variant picked yet)" with a line telling the user to go back to the
script stage, open the variant they want, and save it. Nothing is generated, nothing is
fetched, and nothing is written on arrival. The button reads "Finish and open studio".

> Technical note: the summary reads the session's stored chosen hook and chosen variant
> index. It deliberately does not fall back to the first variant when nothing is picked. A
> hook or a variant the user never chose renders as an explicit placeholder, never as a
> plausible looking default.

#### Leave without acting

Leaving the stage without clicking the button writes no planned post and no script. The
summary is derived from session fields that were already autosaved by earlier stages, so
there is nothing here to lose. Returning to the stage rebuilds the same summary.

#### Begin acting

There is one action: clicking "Finish and open studio". That click starts the finish write.
The button is disabled from that instant so a second click cannot start a second write.

#### While acting

The button label changes to "Finishing" and stays disabled. Nothing streams and nothing
else on the page changes. The write is a single server call with no model behind it, so the
in flight window is short. This phase is thin by design; there is no partial state to show.

#### Finish

The server ensures the session has a planned post to cook and hands back its id. If the
session already has a plan linked to it, that plan is reused; if not, a new planned post is
created in the draft state with no date. Either way the plan's attached script is reconciled
to the currently chosen variant, so the plan carries the words the user has in front of them
rather than a stale earlier save. The button is replaced by the line "This remix is on your
plan and ready to cook." and an "Open the studio" link into `/mine/{postId}/studio`. A toast
confirms the result: "Added to your plan. Open the studio to cook it." when the plan was
created, or "Opening the studio for this remix." when an existing plan was reused. The user
lands next by following the link into the studio page.

The plan is created with no date on purpose. Finishing a script is not a decision about when
to post it, and inventing a date would put a commitment on the calendar the user never made.
A dateless plan reads as a draft, which is what it is. This is the difference from the
[script stage's Add to plan](#the-script-stage), which dates the plan then and there; the two
are the two paths to a planned post, one undated and one dated. See
the data model for what a draft planned post is.

> Technical note: the finish is idempotent. It reads the most recent plan linked to the
> session before writing, so clicking the button twice, or finishing again after a page
> reload, reuses the same plan rather than dropping a duplicate on the calendar. It also
> re-reconciles the attached script every time, which is what catches a stale attach after
> the user regenerated or re-picked a variant without saving again.

### Variants

This stage is thin on variants: it has no inputs to set and no controls beyond the one
button, so most rows are inert. What varies is the session state the summary reads.

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (chosen hook and chosen variant present) | Decides the summary: the hook text or "(no hook chosen)", the chosen variant or "(no variant picked yet)". A session with neither still finishes, creating an undated draft with a derived title and no script attached. | This stage has no editing controls, so the pick does not change here; to change it the user goes back to the script stage. The button click itself is atomic and reads the session once. |
| Attached data present or absent (chosen hook, chosen variant, a saved script) | With a chosen variant, the plan carries a script reconciled to it. With no chosen variant, the plan carries the latest saved script if one exists, or no script at all. Placeholders stand in for whatever is absent. | No effect during the write. |
| External service availability (LLM proxy, Graph, sidecar) | No effect. The finish makes no model call and touches no external service, so it works when the generation stages are blocked and when the sidecar and Graph are down. | No effect. |
| Keyboard shortcut in play | None. There is no dialog, no Enter to submit, no Escape to cancel. The button is a plain button. | None. |

### Cancel and interrupt

| Event | Before commit (summary shown) | While in flight (finishing) |
| --- | --- | --- |
| Explicit cancel or stop | There is nothing to cancel; no plan exists until the button is clicked, and viewing the summary writes nothing. | The button is disabled and there is no stop. The write has no model behind it and runs to completion in one call. |
| Navigate away mid action | Leaving records nothing. The session stays where it is and the summary rebuilds on return. | A sidebar link still navigates. The server write may land, but the id it returns is lost with the page, so the "Open the studio" link does not appear. The next finish reuses the plan that landed rather than making a second one. |
| Reload or tab or window closed | Nothing is lost; the summary re-derives from the session. | The write may or may not have completed. On reload the button shows again because the returned id lived only in page state. Clicking it re-finishes, and idempotency means any plan already created is reused, not duplicated. |
| A backing service fails mid action | No external service is used, so nothing here can fail on one. | A database error returns a failure, shows its reason as a toast, and re-enables the button. No plan is left half written. |
| The target record changes underneath | If the source video was removed by a sync, the session keeps its own copied hook and variant text, so the summary still renders and the finish still creates a plan. If the plan was deleted in another tab, the next finish creates a fresh one; if it still exists, the finish reuses it and refreshes its script link. | Same. The write reads the session's stored inputs and the most recent linked plan, not the live video, so a mid write removal does not corrupt it. A script detached elsewhere is re-attached by the reconcile. |
| A background job finishes or fails on its own | No effect. No cook run exists yet; the cook run begins later, on the studio page. | No effect. |
| A second tab or a double action on the same record | Two tabs both showing the button, or one button double clicked, converge on a single plan: the finish reuses the most recent plan linked to the session rather than creating a second. | The disabled state blocks a double click in one tab. Across two tabs, each finish that finds the existing plan reuses it. |

After an interrupt the user is left with either no plan or exactly one plan for the session,
never a duplicate and never a half written row.

### Interactions with other systems

**Persistence and autosave.** The finish writes durable rows: a planned post, and a script
when a variant is chosen and no matching saved script already exists. The summary itself is
not autosaved here; it reads session fields that earlier stages already saved. The returned
post id is ephemeral page state that a reload drops. See persistence.

**History and undo.** There is no undo. The planned post and any reconciled script are
durable; the user removes them from the plan or the vault elsewhere. A repeat finish never
creates a duplicate, so there is no accumulation to undo.

**Navigation and refresh.** The "Open the studio" link is a plain link to
`/mine/{postId}/studio`; the stage does not call a refresh. The button is swapped for the
link through local state, and a reload drops that state and shows the button again. See
navigation and shell.

**Background jobs and the sidecar.** None are started here. The finish makes no model call
and spawns no run. The cook run that renders the planned post is a later step on the
studio page.

**External services.** None. This is the one remix stage that reaches no service: no LLM
proxy, no Graph API, no transcript provider. See external services.

**Status and failures.** Success and failure both surface as toasts. The run log below the
stage still shows the earlier generation attempts, but a finish writes no run log row,
because it is not a generation. See status and failures.

**Configuration and settings.** The new plan inherits the session's target length, and its
title comes from the reconciled script's title or, when there is no script, a short title
derived from the session topic (the same derivation the [script stage](#the-script-stage)
uses, chosen because the topic is prefilled with the whole source caption). No setting gates
this stage.

### Edge cases

- The finish never fabricates. A hook or a variant the user did not pick shows an explicit
  placeholder, not a filled in default, in the summary and in the plan it produces.
- Finishing with nothing picked still works: it creates an undated draft with a derived
  title and no script attached. The "(no variant picked yet)" guidance points the user back
  to the script stage, but it does not block the button. This exists because the script
  stage's Continue is satisfied by a variant merely existing, not by one being picked, so
  the finish stage is reachable with no pick.
- Reconcile repairs a stale attach. If the user saved a variant, then regenerated or
  re-picked without saving again, the earlier saved script no longer matches the chosen
  variant. Finishing again writes a fresh script for the current variant and points the
  plan at it, even when the plan already existed.
- The "Open the studio" link is page state. After a reload the link is gone and the button
  is back; clicking it re-finishes, which is safe because the same plan is reused.
- There are two paths to a planned post from a remix: this stage, which creates an undated
  draft, and the script stage's Add to plan, which creates a dated one. A session can reach
  both; the finish reuses whichever plan is already linked rather than adding another.

