# The generate idea button

## Summary

Generate idea turns one analyzed video into a single content idea and drops it into the ideas inbox. It is a plain outline button in the action row at the bottom of the [video detail page](video-detail.md), sharing that row with Remix this, the two save actions, and Copy as prompt. The button carries a lightbulb icon and reads "Generate idea". Pressing it asks the language model, through the [LLM proxy](../foundations/background-jobs.md), for a short concept and an angle grounded in the video's analysis and the creator's persona, then writes an idea row. This is an exit from the core loop: the idea lands in the ideas inbox, which is a separate surface out of scope for this repo. The button is the only core loop touchpoint, and its whole visible result is a toast. The user does not leave the video detail page.

The button appears only on a video that has been analyzed, the same gate the [save to vault](save-to-vault.md) dialog beside it uses. On an unanalyzed video there is no Generate idea button at all, because the underlying generation reads the video's analysis and has nothing to work from without it.

> Technical note: unlike the analyze gate in the same page, this button does not check whether generation is actually available before rendering. It shows on any analyzed video, and a missing key or a down proxy surfaces only after the click, as a failed toast.

## The simple case

On an analyzed video detail page the user clicks "Generate idea". The button relabels to "Generating" and disables while the model works. When it settles, a toast confirms the result: "Idea added to the inbox" when this is the first idea for the video, or "Idea updated" when an idea for this video already existed. The user stays on the same page. To see the idea, they open the ideas inbox, which is a different screen this repo does not describe.

If generation fails, the button re-enables and a toast shows the reason. Nothing is written.

## The interaction, event by event

```
stateDiagram-v2
    [*] --> idle
    idle --> generating : click Generate idea
    generating --> idle : added (toast "Idea added to the inbox")
    generating --> idle : updated (toast "Idea updated")
    generating --> idle : failed (error toast, nothing written)
```

### Arrive

The video detail page renders on the server. The button is present only when the video has an analysis. Nothing about the ideas inbox is read for this button: it does not look up whether an idea already exists for the video, so it always reads "Generate idea" regardless of whether one was generated before. There is no dialog and nothing is prefilled. The button does nothing until clicked.

### Leave without acting

Leaving the page without clicking records nothing. There is no form and no draft state to keep. A reload or a navigation loses nothing because nothing was started.

### Begin acting

Clicking the button starts the generation. From that instant the button is disabled and relabeled "Generating" so a second click cannot start a second request. What the idea is built from is decided when the request runs, not when the page loaded: the model reads the video's current analysis, the creator's persona, and the video's outlier score at that moment. If the analysis changed since the page loaded, the newer analysis is what feeds the idea.

### While acting

The button stays disabled and reads "Generating". This is a real wait on the model, not a brief flicker. Nothing else on the page changes. There is no inline progress and no run log entry: this generation does not append to the remix run log the way remix stages do (see [interaction model, generation](../foundations/interaction-model.md#generation)).

### Finish

On success an idea row is committed to the ideas inbox and a toast reports which happened. "Idea added to the inbox" means a new idea was created. "Idea updated" means an idea for this video was already there. The user lands nowhere new; they remain on the video detail page. The page does not refresh, because nothing on it depends on the idea.

On failure nothing is written and a toast shows the reason. The button re-enables so the user can retry.

This is the handoff. The idea now lives in the ideas inbox, where it can be shortlisted, discarded, or turned into a remix session. Those actions, and the inbox screen itself, are out of scope for this repo.

> Technical note: an existing idea is only rewritten with the fresh concept and angle when it is still untouched in the inbox. Once the idea has been shortlisted or scripted, a second Generate idea leaves it exactly as it was and still reports "Idea updated". A previously discarded idea does not block a fresh one: a new inbox idea is created and the toast reads "Idea added to the inbox".

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (video analyzed; idea already present or not) | The video must be analyzed for the button to exist. Whether an idea already exists is not read, so the button looks identical either way; it only shows in the toast whether the idea was added or updated. | The analysis and idea state cannot be changed by the user mid click. A sync could delete the video underneath (see interrupt row 5). |
| Attached data present or absent (transcript, analysis) | Analysis is required and gates the button. A transcript is not read directly by this action; the analysis row is what the idea is built from. The creator's persona is optional and falls back to its defaults. | No effect. |
| External service availability (LLM proxy, Graph, sidecar) | The LLM proxy is required. When it is down or no key is set, the button still renders; the click fails with a toast. The Graph API and the sidecar are not used. | The sidecar can delete the underlying video mid generation, which fails the write (interrupt row 5). |
| Keyboard shortcut in play | The button honors no shortcut of its own. The detail page's arrow keys page to the previous or next video and are ignored while a text input has focus; they are not tied to this button. | Pressing an arrow key after the click navigates away mid generation (interrupt row 2). |

There is no modifier that changes what Generate idea does. It always produces at most one idea for the video.

## Cancel and interrupt

| Event | Before commit (idle) | While in flight (generating) |
| --- | --- | --- |
| Explicit cancel or stop | There is nothing to cancel; the button has not been pressed. | There is no cancel. The button is disabled until the request settles; the generation runs to completion or fails on its own. |
| Navigate away mid action | Leaving records nothing. | The Remix link, a sidebar link, and the arrow keys still navigate. The server request may still land and write the idea, but the toast is not seen. See [interaction model](../foundations/interaction-model.md#how-an-action-reaches-the-server). |
| Reload or tab or window closed | Nothing was started, nothing is lost. | The write may or may not complete. On the next visit to the inbox the idea either exists or it does not; there is no partial idea. |
| A backing service fails mid action | No service is touched until the click. | A down LLM proxy, a missing key, or a bad model reply all end as a failed toast ("Could not generate an idea for that video") with nothing written. The button re-enables. |
| The target record changes underneath | If the video was removed by a sync between page load and the click, the click fails; any idea that existed was already deleted with the video. | Same. A video deleted mid generation fails the write rather than leaving a dangling idea; the idea row is removed with its video. |
| A background job finishes or fails on its own | The sync's automatic pass may have created or refreshed this video's idea already. A later click then reports "Idea updated" rather than adding a second. | If the auto pass writes the same video's idea during the click, the two do not duplicate: at most one non discarded idea per video is kept, so one becomes an update of the other. |
| A second tab or a double action on the same record | Two tabs can both click. The result is still at most one idea for the video; the second click updates the first rather than adding a duplicate. | A double click in one tab is blocked by the disabled state. |

After any interrupt the user stays on the video detail page. The idea row either exists or it does not, capped at one non discarded idea per video.

## Interactions with other systems

**Persistence and autosave.** There is nothing to autosave; the button holds no draft. The idea row is durable once written. A second generation for a video that already has an untouched inbox idea overwrites its concept and angle; one that has been shortlisted or scripted is left untouched.

**History and undo.** Generating an idea is not undoable from here. There is no undo toast. The idea can later be discarded from the ideas inbox, which is out of scope; discard there is soft, not a delete.

**Navigation and refresh.** The button does not call a refresh after success, because the video detail page shows nothing about ideas. The user stays put and sees only the toast. See [navigation and shell](../foundations/navigation-and-shell.md) for the refresh model.

**Background jobs and the sidecar.** The same generation runs automatically for analyzed outliers during a [sidecar sync](../foundations/background-jobs.md); the button is the on demand version of that pass. The sidecar can also delete the underlying video, which cascades and removes the idea with it.

**External services.** The [LLM proxy](../foundations/background-jobs.md) is the only service used. When it is unavailable the click fails with a toast and nothing is written. This action does not write a remix run log entry, so a failed attempt is not visible in the remix run log; only the toast reports it.

**Status and failures.** Success and failure both surface as toasts and nowhere else. The success toast distinguishes added from updated. The failure toast carries a single generic message for a model that returned nothing, or the underlying error for an unexpected failure.

**Configuration and settings.** The manual button ignores the outlier score threshold and the per sync cap that govern the automatic pass; it generates for any analyzed video the user opens. The creator's persona (audience, voice, and do and don't guidance) grounds the generated idea. The persona and threshold screens are out of scope.

## Edge cases

- The button is hidden entirely until the video is analyzed, matching the save to vault dialog next to it. On an unanalyzed video there is no way to generate an idea.
- The button never reflects whether an idea already exists. It always reads "Generate idea", so a second press on the same video silently updates or leaves the existing idea and toasts "Idea updated" with no other on screen sign that one was already there.
- "Idea updated" covers two different outcomes: rewriting an untouched inbox idea with a fresh concept and angle, and leaving a shortlisted or scripted idea exactly as it was. The toast does not tell them apart.
- Unlike the analyze gate on the same page, this button does not check for a key or a reachable proxy before showing. When generation is unavailable the button still renders and the failure appears only after the click.
- The ideas inbox is out of scope for this repo. Downstream, its Create script action seeds a remix session from an idea and marks the idea scripted; that is named here as the eventual return path into the core loop, not described.

## Open questions and verification

- Whether a navigation or reload during the generating window reliably commits or abandons the write was read from the code but not confirmed by hand. The generation runs in a React transition, and the exact behavior when the page unmounts mid transition needs a live check, the same open question the [interaction model](../foundations/interaction-model.md) carries.
- Whether the failure toast wording differs in practice between a down proxy, a missing key, and a bad model reply was not confirmed by hand. The code funnels an empty result into one generic message and only an unexpected thrown error carries the underlying text.
- Whether the automatic sync pass and a manual click can be observed racing on the same video, and which toast each produces, was reasoned from the upsert and the partial unique index but not reproduced by hand.

Verified against this repo commit `4f26fb9`.
