# The remix studio

## Summary

The remix studio turns one source video into a script through six stages: prompt, research, hook, style, script, finish. It is the hardest and largest part of the core loop. This document owns the studio shell that holds every stage: the stepper, how the active stage relates to the furthest reached, the Back, Restart, and Continue controls, the Quick Remix shortcut, the run log, the source context rail, and how generation is blocked when the model is unavailable. Each stage has its own document; this one owns everything around them and the session lifecycle they share.

The studio is reached from the [video detail page](../feed/video-detail.md) at `/feed/{videoId}/remix`. There is one [remix session](../glossary.md) per source video: arriving opens the existing session or creates a fresh one at the prompt stage. The studio needs the [LLM proxy](../foundations/background-jobs.md) for its generation stages; the prompt and research stages work without it, and the whole studio works with existing data when the sidecar is off.

## The simple case

The user opens a video and clicks remix. The studio opens on the prompt stage with the topic prefilled. They set a topic and length and click Continue, or click Quick Remix to run every generation stage at once. Moving through the stages they generate hooks and pick one, generate an outline and edit its beats, generate three script variants and pick one, then finish. Finishing puts the remix on the plan as an undated draft and offers a link into its [studio](../studio/studio-overview.md) to cook it.

At any point the user can click a completed stage in the stepper to jump back and change it. The run log below the stage records every generation attempt, successful or failed.

## The interaction, event by event

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

### Arrive

Opening `/feed/{videoId}/remix` loads the source video, the session (existing or new), the user's vault hooks and styles, the vault saved posts, and the niche. The studio opens on the stage the session records as furthest, unless a [deep link](../foundations/navigation-and-shell.md) carries a seed (a vault hook or style, or a quick remix intent) that moves it. The source video sits in a context rail on the left, present on every stage. A one line banner names what the studio is doing so the six steps read as a sequence.

### Leave without acting

Leaving the studio without generating anything records the session at whatever stage it reached, which for a fresh session is prompt with the prefilled topic autosaved. Nothing else is written. The session persists, so returning to the same video resumes where the user left off.

### Begin acting

The first real work is the first generation or the first edit: setting the topic, running research, generating hooks. Each stage autosaves its own edits as they happen (see persistence below), so beginning to act is continuous rather than a single submit.

### While acting

The active stage renders its own controls. The stepper shows the current stage filled and completed stages checked and clickable. The footer holds Back (disabled on prompt), Restart (disabled on prompt), and Continue (disabled until the current stage's requirement is met). Below the stage, on every stage except prompt, the run log lists generation attempts newest first with their outcome and elapsed time.

Continue advances to the next stage and, if that is past the furthest reached, records the new furthest stage. Its requirement per stage: prompt needs a topic, research always allows it, hook needs a chosen hook, style needs an outline, script needs at least one variant to exist (not to be picked; the pick is confirmed at finish). Back moves to the previous stage without changing the furthest. Clicking a completed step in the stepper jumps straight to it. Restart sets the stage back to prompt but keeps everything generation already produced (topic, hooks, outline, variants); it clears only the position, not the work.

### Finish

The finish stage creates a planned post if the session does not already have one and opens a link into its studio. See [the finish stage](stage-finish.md).

## Quick Remix

On the prompt stage, Quick Remix runs research, hooks (auto picking the first), outline, and variants in one server call, then lands the studio on the script stage with every earlier stage reachable and editable. It is disabled without a topic or without the model available. While it runs the button reads "Running Quick Remix". When it finishes the session is re read and the run log refreshes, showing the several attempts it made.

## When generation is blocked

The generation stages (hook, style, script) replace their whole surface with a block panel when the model is unavailable, rather than showing a button that will fail. Two reasons share the panel: no API key configured, and the local proxy looking unreachable. The proxy down read is grounded in the run log itself: if a recent attempt failed with a connection error, the studio treats the proxy as down and blocks the generation stages until an attempt succeeds. The prompt and research stages stay usable either way, since research assembles locally and makes no model call.

> Technical note: proxy down is inferred from the last few run log rows, not a live ping. A connection style error in the last three attempts marks it down; the next successful attempt clears it.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (session stage) | The studio opens on the furthest stage the session reached, or a deep linked stage. | Continue and Restart move the furthest stage; clicking a step moves only the active stage. |
| Attached data present or absent | A session with a chosen hook, an outline, or variants opens with them shown; a fresh session has none. | Each stage fills its own field as the user generates or edits; the stepper unlocks the next stage. |
| External service availability | With the model unavailable, hook, style, and script open blocked; prompt and research still work. | An attempt that fails on a connection error flips the generation stages to blocked until one succeeds. |
| Keyboard shortcut in play | None specific to the shell. | Text fields inside stages behave as normal inputs; there is no studio wide keyboard submit. |

## Cancel and interrupt

| Event | Before commit (mid stage) | While in flight (generating) |
| --- | --- | --- |
| Explicit cancel or stop | There is no cancel button; leaving a stage keeps its autosaved edits. Restart returns to prompt without discarding generated work. | A generation cannot be cancelled from the UI; the button is disabled until it settles. |
| Navigate away mid action | Leaving keeps the session at its furthest stage with all autosaved fields. Returning resumes there. | Leaving during a generation abandons the client wait; the server attempt still writes its run log row and its result. On return the session reflects whatever landed. |
| Reload or tab or window closed | The session is server backed, so a reload resumes at the furthest stage with saved fields. Unsaved local text in a focused field that has not blurred is lost. | Same: the reload resumes from the database; the in flight attempt's row and result appear once it lands. |
| A backing service fails mid action | The prompt and research stages are unaffected. | A generation that fails shows a toast and writes a failed run log row; the previous value of the field it targeted is left intact. Repeated connection failures flip the stage to blocked. |
| The target record changes underneath | If the source video is removed by a sync, the session keeps its own copied data (topic, hooks, variants); research that re assembles may find less. | Same. Generation reads the session's stored inputs, not the live video, so a mid run removal does not corrupt the attempt. |
| A background job finishes or fails on its own | Not applicable in the studio; the cook run belongs to the [studio page](../studio/cook-run.md). | Not applicable. |
| A second tab or a double action on the same record | Two tabs on the same video share one session (get or create returns the same row); their autosaves race last write wins. | A double generation is prevented per stage by the disabled state; two tabs generating at once both write run rows and the later write wins on the session field. |

After an interrupt the user resumes at the furthest stage. Nothing generation produced is discarded by leaving; only unblurred local text is at risk.

## Interactions with other systems

**Persistence and autosave.** Every stage autosaves its edits, most on blur, some on change. A failed autosave surfaces as a toast rather than failing silently. The run log is its own table, written on every attempt. See [persistence](../cross-cutting/persistence.md).

**History and undo.** There is no undo across stages. Restart keeps generated work but resets position. Regenerating replaces a field's value; the previous value is not recoverable except from the run log's record that an attempt happened.

**Navigation and refresh.** The studio is a client shell that keeps the session in local state and autosaves to the server, so it does not rely on a full refresh to stay current within a visit. Deep links seed the opening stage. See [navigation and shell](../foundations/navigation-and-shell.md).

**Background jobs and the sidecar.** The studio reads the source video and its analysis, both written by the sidecar. It does not start a background job; the cook run is later, in the studio page.

**External services.** The generation stages call the LLM proxy. When it is down they block. See [external services](../cross-cutting/external-services.md).

**Status and failures.** The run log is the studio's own status surface, distinct from the shell failure strip. A partial variant generation reads as Partial, a clean one as Success, a failure as Failed. See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** The niche is read from settings and shown as a chip on the prompt stage with a link to edit it. The target length default is 45 seconds.

## Edge cases

- A session is created on first arrival even if the user does nothing, so every remixed video has a row from the first visit.
- Restart keeps generated hooks, outline, and variants, so a restarted run can reuse them rather than regenerate.
- Continue on the script stage needs only that a variant exists, not that one is chosen; the pick is confirmed at finish, so the screen that explains a missing pick is never hidden.
- The furthest stage only ever advances through Continue or Quick Remix; Back and stepper clicks never lower it.
- Quick Remix auto picks the first hook, so a session it produced has a chosen hook the user did not read; they can change it by going back to the hook stage.

## Open questions and verification

- Whether two tabs on the same session reliably converge (last write wins on each field) or can interleave a half applied outline was read from the autosave path but not tested with real concurrency.
- The exact behavior of a Continue click issued while a generation is still in flight (whether the stage advance and the pending write can cross) was not confirmed by hand.
- Whether unblurred local text in a stage field is always lost on reload, or sometimes autosaved by a preceding change, needs a live check per stage.

Verified against this repo commit `4f26fb9`.
