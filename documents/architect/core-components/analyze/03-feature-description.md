# analyze: feature description

## Analyze and reanalyze a video

### Summary

Analysis reads a video and writes down what it is doing: its hook type, the beats
of its structure, format and style tags, and a "why it worked" note. It is what
turns a raw video in the feed into an analyzed one, and it is the gate almost
everything downstream sits behind (save to vault, generate an idea, and the source
description a remix reads all need an analysis to exist first).

Analysis lives on the video detail page, inside the Hook and structure tab and the
Why it worked tab. On an unanalyzed video both tabs show the same gate, an offer to
analyze the video. On an analyzed video the tabs show the result, and the Beats
section carries a Re-analyze control that runs a fresh pass over a video that
already has one. There is no separate page and no dialog; the whole interaction is
one button and the generation it triggers.

Analysis needs two things to run: a transcript of the video, and the Claude API
key. A transcript it will make on demand through a transcript provider if none is
stored and one is reachable. The key it cannot make; without it the generation
fails. When neither a stored transcript nor a reachable provider exists, analysis
that needs a transcript cannot run at all, and the gate says so instead of offering
a button.

Technical note: the write is a server action (`analyzeVideoAction`,
`reanalyzeVideoAction`) returning `{ ok: true }` or `{ ok: false, error }`. Unlike
most core loop actions it carries no `code` field, so the client branches on
nothing but success or failure and shows the `error` string as a toast. The layout
a video can also carry is not produced here; see the layout note under edge cases.

### The simple case

The user opens a video that has never been analyzed and clicks Hook and structure.
The tab shows one button, "Analyze this video". They click it. The button disables
and reads "Analyzing" while the model works. When it finishes, a toast says
"Analysis complete", the page re-reads, and the tab now shows the hook type, the
format and style tags, and the beat by beat structure. The Why it worked tab, which
showed the same gate before, now shows its note too, because one pass fills both.

If the video has no transcript yet but a provider is reachable, the button instead
reads "Transcribe & Analyze". Clicking it transcribes the video first and then
analyzes it, both under one wait, and the button reads "Transcribing" the whole
time.

To refresh an existing analysis the user clicks Re-analyze, next to the Beats
heading. It runs the same text pass again and replaces the stored hook, beats, tags,
and note with the new ones.

### The interaction, event by event

```
stateDiagram-v2
    [*] --> gate : arrive, not analyzed
    [*] --> analyzed : arrive, already analyzed
    gate --> analyzing : click Analyze (or Transcribe & Analyze)
    analyzing --> analyzed : success (row written, toast, refresh)
    analyzing --> gate : failure (toast, button re-enabled)
    analyzed --> reanalyzing : click Re-analyze
    reanalyzing --> analyzed : success (text columns replaced)
    reanalyzing --> analyzed : failure (toast, nothing changed)
```

#### Arrive

The detail page decides what the tabs show from a server read, not from anything the
button fetches. On load it reads whether the video has an analysis, whether it has a
transcript, whether the Claude API key is set, and whether at least one transcript
provider is reachable right now. From those four facts the gate picks one of four
faces:

- No stored transcript and no reachable provider: an alert, "No transcript available
  yet", with a hint to install a local transcriber or add a Groq key in Settings.
  There is no button, because a click could do nothing.
- No stored transcript but a provider is reachable: a live "Transcribe & Analyze"
  button. It works even with no Claude key set, because transcribing is keyless
  (whisper.cpp is local); if the analysis step then needs the key, that error
  surfaces from the same click.
- A transcript but no Claude key: an alert asking for the key. No button.
- A transcript and the key: the plain "Analyze this video" button.

If the video is already analyzed there is no gate at all. The tabs render the result
and the Beats section shows the Re-analyze control.

#### Leave without acting

Opening the page and leaving it, or switching tabs, records nothing. Nothing starts
until the user clicks the button. There is no dirty state to lose and no draft to
keep.

#### Begin acting

Clicking the button starts the write. From that instant the button is disabled so a
second click in the same tab cannot start a second pass. For a video with no stored
transcript this single action also transcribes first, on demand, before it analyzes;
the user does not run transcription as a separate step.

#### While acting

The button stays disabled and relabels itself: "Analyzing" for the plain button,
"Transcribing" for the transcribe-and-analyze button, "Re-analyzing" for Re-analyze.
The transcribe-and-analyze button reads "Transcribing" for the whole wait even while
it is really in the analysis half, because the label is fixed to the branch, not to
the current step. Nothing else on the page changes and there is no progress bar.

Technical note: the pending state is plain component state, not a React transition,
so the disabled button is the only thing the wait blocks. The rest of the page stays
live, including the arrow key feed navigation, so the user can page to another video
mid-analysis.

#### Finish

On success the action has written the analysis row, the toast says "Analysis
complete" (or "Re-analysis complete"), and the client re-reads the page so the tabs
repaint with the result. No manual reload is needed. The user stays on the same
page.

On failure nothing is written (a failed generation leaves no partial row), the
button re-enables, and a toast shows the reason: the key is missing, no transcript
could be made, the video is gone, or an unexpected model error. The gate stays as it
was.

A re-analysis replaces only the text columns (hook, beats, tags, why). It leaves the
video's layout and the timestamp of when it was first analyzed alone. See the layout
note under edge cases.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (video analyzed or not) | Analyzed means no gate and a Re-analyze control; not analyzed means the gate. | If the video is analyzed in another tab while this one shows the gate, this tab still shows the gate; clicking Analyze here finds the existing analysis and shows it after the refresh rather than erroring. |
| Attached data present or absent (transcript, key) | The gate's face is chosen from these: a stored transcript gives the "Analyze" button; no transcript with a reachable provider gives "Transcribe & Analyze"; no transcript and no provider gives the dead-end alert; a transcript with no key gives the key alert. | A transcript or a key appearing or disappearing has no live effect on the open page; the gate is fixed until the next load. |
| External service availability (transcript providers, Claude key, LLM proxy) | Providers decide whether the transcribe button is offered at all; the Claude key decides whether analysis can run once a transcript is in hand. Graph and the sidecar do not matter here. | If the model or a provider fails during the wait, the action returns a failure and the toast names it; nothing is written. |
| Keyboard shortcut in play | Left and right arrow keys page to the previous and next video (a detail-page shortcut, not an analysis one). No key starts or submits an analysis. | Because the wait is not a transition, an arrow key still navigates away mid-analysis; the button itself has no keyboard action beyond the standard focus-and-activate. |

### Cancel and interrupt

| Event | Before commit (gate shown) | While in flight (analyzing or re-analyzing) |
| --- | --- | --- |
| Explicit cancel or stop | There is nothing to cancel; no work has started. | There is no cancel or stop control and no way to abort the running generation. The button is disabled and the pass runs to completion on the server. |
| Navigate away mid action | Leaving records nothing. | An arrow key or a sidebar link still navigates, because the wait is not a transition. The server pass may still finish and write the row, but the toast and refresh do not fire on the page the user left; the next visit shows whatever landed. |
| Reload or tab or window closed | Nothing is saved. | The client wait is abandoned. The server pass may or may not complete; on next load the tabs reflect whatever the database holds. There is no partial analysis: the row is written whole or not at all. |
| A backing service fails mid action | The gate already shows an alert instead of a live button when the needed service is missing (no provider, or no key with a transcript present). | A missing key, an unmakeable transcript, or a model error returns a failure; the toast names the reason and no row is written. The button re-enables. |
| The target record changes underneath | If a sync removed the video, clicking Analyze returns "Video not found, try refreshing the page" and the detail page itself will 404 on the next load. | The pass already holds the video it read; a removal during the wait is a rare race. |
| A background job finishes or fails on its own | No effect. Analysis is not a background job; nothing external completes it. | No effect. |
| A second tab or a double action on the same record | Two tabs can both show the gate; each can start a pass. | A double click in one tab is blocked by the disabled button. Two tabs racing the very first analysis of one video contend for a single row keyed by the video id; the later write can fail with a generic error while the first succeeds, and at most one analysis row ever exists. |

After any interrupt the user stays where they are. The analysis row either exists in
full or does not exist; there is never a half-written one.

### Interactions with other systems

Persistence and autosave. There is no autosave and no dirty state; analysis commits
as one row at the end of the pass. A transcript made on demand is persisted as its
own row first, cache-first, so a later analyze or a later remix reuses it rather
than transcribing again.

History and undo. None. Re-analyze overwrites the stored hook, beats, tags, and note
in place; the previous text is gone with no version kept. The only way back to a
different analysis is to re-analyze again. A re-analysis does preserve the layout
and the first-analyzed timestamp.

Navigation and refresh. On success the client calls a refresh so the tabs repaint
without a manual reload. The wait is component state, not a transition, so it does
not block navigation.

Background jobs and the sidecar. Analysis runs inside the action, not as a
background job, and it is not the frame pass (which is a separate polled job) nor a
cook run. The sidecar touches analysis only by removing a video, which cascades its
analysis away with it.

External services. The Claude API key does the analysis; the transcript providers
(whisper.cpp locally, or Groq with a key) make the transcript when none is stored.
Analysis that needs a transcript cannot run when none is stored and no provider is
reachable.

Status and failures. Success and failure both surface as toasts; there is no inline
error region, and a failed pass just re-enables the button. The two dead-end states,
no provider and no key, render as alerts in the gate rather than as toasts.

Configuration and settings. The Claude key and the Groq key are set in Settings, and
whisper.cpp availability depends on a local install; together these decide which
face the gate shows. The resolved Claude model name is recorded on the analysis row.
No user tunable threshold changes this behavior.

### Edge cases

- The gate appears on two tabs, Hook and structure and Why it worked. One pass fills
  both, so whichever tab the user analyzes from, both show a result afterward.
- Layout is not produced by analysis. A video's layout comes from a separate frame
  pass, run from its own control in the Layout tab, with its own model and timestamp.
  A re-analysis deliberately leaves the layout columns untouched, because a text pass
  has seen no frames and wiping or reusing them would misattribute a real reading.
- Re-analyze exists mostly to backfill old rows. Beats gained a verbatim per-beat
  transcript quote later than the first analyses were written; a beat from before
  that shows a "re-analyze to capture the transcript per beat" hint instead of an
  invented quote, and Re-analyze is the only way to fill it in. A beat with no words
  spoken shows "(no words spoken in this beat)".
- Style tags render muted with an "unverified" marker while format tags render
  plain, because a text-only model can only guess at visual style until a frame
  pass confirms it. This is display, owned by video detail, but it is part of what
  an analysis produces.
- Save to Vault and Generate idea both need an analysis to exist; before one is run
  they are disabled or hidden on the detail page. Analysis is their precondition.
- The transcribe-and-analyze button reads "Transcribing" for the entire wait even
  while it is really analyzing, so a long analysis half looks like a long
  transcribe.

## Generate an idea

### Summary

Generate idea turns one analyzed video into a single content idea and drops it into
the ideas inbox. It is a plain outline button in the action row at the bottom of
the video detail page, sharing that row with Remix this, the two save actions, and
Copy as prompt. The button carries a lightbulb icon and reads "Generate idea".
Pressing it asks the language model, through the LLM proxy, for a short concept and
an angle grounded in the video's analysis and the creator's persona, then writes an
idea row. This is an exit from the core loop: the idea lands in the ideas inbox,
which is a separate surface out of scope for this repo. The button is the only core
loop touchpoint, and its whole visible result is a toast. The user does not leave
the video detail page.

The button appears only on a video that has been analyzed, the same gate the save
to vault dialog beside it uses. On an unanalyzed video there is no Generate idea
button at all, because the underlying generation reads the video's analysis and has
nothing to work from without it.

Technical note: unlike the analyze gate on the same page, this button does not
check whether generation is actually available before rendering. It shows on any
analyzed video, and a missing key or a down proxy surfaces only after the click, as
a failed toast.

### The simple case

On an analyzed video detail page the user clicks "Generate idea". The button
relabels to "Generating" and disables while the model works. When it settles, a
toast confirms the result: "Idea added to the inbox" when this is the first idea
for the video, or "Idea updated" when an idea for this video already existed. The
user stays on the same page. To see the idea, they open the ideas inbox, which is a
different screen this repo does not describe.

If generation fails, the button re-enables and a toast shows the reason. Nothing is
written.

### The interaction, event by event

```
stateDiagram-v2
    [*] --> idle
    idle --> generating : click Generate idea
    generating --> idle : added (toast "Idea added to the inbox")
    generating --> idle : updated (toast "Idea updated")
    generating --> idle : failed (error toast, nothing written)
```

#### Arrive

The video detail page renders on the server. The button is present only when the
video has an analysis. Nothing about the ideas inbox is read for this button: it
does not look up whether an idea already exists for the video, so it always reads
"Generate idea" regardless of whether one was generated before. There is no dialog
and nothing is prefilled. The button does nothing until clicked.

#### Leave without acting

Leaving the page without clicking records nothing. There is no form and no draft
state to keep. A reload or a navigation loses nothing because nothing was started.

#### Begin acting

Clicking the button starts the generation. From that instant the button is disabled
and relabeled "Generating" so a second click cannot start a second request. What
the idea is built from is decided when the request runs, not when the page loaded:
the model reads the video's current analysis, the creator's persona, and the
video's outlier score at that moment. If the analysis changed since the page
loaded, the newer analysis is what feeds the idea.

#### While acting

The button stays disabled and reads "Generating". This is a real wait on the model,
not a brief flicker. Nothing else on the page changes. There is no inline progress
and no run log entry: this generation does not append to the remix run log the way
remix stages do.

#### Finish

On success an idea row is committed to the ideas inbox and a toast reports which
happened. "Idea added to the inbox" means a new idea was created. "Idea updated"
means an idea for this video was already there. The user lands nowhere new; they
remain on the video detail page. The page does not refresh, because nothing on it
depends on the idea.

On failure nothing is written and a toast shows the reason. The button re-enables
so the user can retry.

This is the handoff. The idea now lives in the ideas inbox, where it can be
shortlisted, discarded, or turned into a remix session. Those actions, and the
inbox screen itself, are out of scope for this repo.

Technical note: an existing idea is only rewritten with the fresh concept and angle
when it is still untouched in the inbox. Once the idea has been shortlisted or
scripted, a second Generate idea leaves it exactly as it was and still reports
"Idea updated". A previously discarded idea does not block a fresh one: a new inbox
idea is created and the toast reads "Idea added to the inbox".

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (video analyzed; idea already present or not) | The video must be analyzed for the button to exist. Whether an idea already exists is not read, so the button looks identical either way; it only shows in the toast whether the idea was added or updated. | The analysis and idea state cannot be changed by the user mid click. A sync could delete the video underneath (see cancel and interrupt). |
| Attached data present or absent (transcript, analysis) | Analysis is required and gates the button. A transcript is not read directly by this action; the analysis row is what the idea is built from. The creator's persona is optional and falls back to its defaults. | No effect. |
| External service availability (LLM proxy, Graph, sidecar) | The LLM proxy is required. When it is down or no key is set, the button still renders; the click fails with a toast. The Graph API and the sidecar are not used. | The sidecar can delete the underlying video mid generation, which fails the write (see cancel and interrupt). |
| Keyboard shortcut in play | The button honors no shortcut of its own. The detail page's arrow keys page to the previous or next video and are ignored while a text input has focus; they are not tied to this button. | Pressing an arrow key after the click navigates away mid generation (see cancel and interrupt). |

There is no modifier that changes what Generate idea does. It always produces at
most one idea for the video.

### Cancel and interrupt

| Event | Before commit (idle) | While in flight (generating) |
| --- | --- | --- |
| Explicit cancel or stop | There is nothing to cancel; the button has not been pressed. | There is no cancel. The button is disabled until the request settles; the generation runs to completion or fails on its own. |
| Navigate away mid action | Leaving records nothing. | The Remix link, a sidebar link, and the arrow keys still navigate. The server request may still land and write the idea, but the toast is not seen. |
| Reload or tab or window closed | Nothing was started, nothing is lost. | The write may or may not complete. On the next visit to the inbox the idea either exists or it does not; there is no partial idea. |
| A backing service fails mid action | No service is touched until the click. | A down LLM proxy, a missing key, or a bad model reply all end as a failed toast ("Could not generate an idea for that video") with nothing written. The button re-enables. |
| The target record changes underneath | If the video was removed by a sync between page load and the click, the click fails; any idea that existed was already deleted with the video. | Same. A video deleted mid generation fails the write rather than leaving a dangling idea; the idea row is removed with its video. |
| A background job finishes or fails on its own | The sync's automatic pass may have created or refreshed this video's idea already. A later click then reports "Idea updated" rather than adding a second. | If the auto pass writes the same video's idea during the click, the two do not duplicate: at most one non discarded idea per video is kept, so one becomes an update of the other. |
| A second tab or a double action on the same record | Two tabs can both click. The result is still at most one idea for the video; the second click updates the first rather than adding a duplicate. | A double click in one tab is blocked by the disabled state. |

After any interrupt the user stays on the video detail page. The idea row either
exists or it does not, capped at one non discarded idea per video.

### Interactions with other systems

Persistence and autosave. There is nothing to autosave; the button holds no draft.
The idea row is durable once written. A second generation for a video that already
has an untouched inbox idea overwrites its concept and angle; one that has been
shortlisted or scripted is left untouched.

History and undo. Generating an idea is not undoable from here. There is no undo
toast. The idea can later be discarded from the ideas inbox, which is out of scope;
discard there is soft, not a delete.

Navigation and refresh. The button does not call a refresh after success, because
the video detail page shows nothing about ideas. The user stays put and sees only
the toast.

Background jobs and the sidecar. The same generation runs automatically for
analyzed outliers during a sidecar sync; the button is the on demand version of
that pass. The sidecar can also delete the underlying video, which cascades and
removes the idea with it.

External services. The LLM proxy is the only service used. When it is unavailable
the click fails with a toast and nothing is written. This action does not write a
remix run log entry, so a failed attempt is not visible in the remix run log; only
the toast reports it.

Status and failures. Success and failure both surface as toasts and nowhere else.
The success toast distinguishes added from updated. The failure toast carries a
single generic message for a model that returned nothing, or the underlying error
for an unexpected failure.

Configuration and settings. The manual button ignores the outlier score threshold
and the per sync cap that govern the automatic pass; it generates for any analyzed
video the user opens. The creator's persona (audience, voice, and do and don't
guidance) grounds the generated idea. The persona and threshold screens are out of
scope.

### Edge cases

- The button is hidden entirely until the video is analyzed, matching the save to
  vault dialog next to it. On an unanalyzed video there is no way to generate an
  idea.
- The button never reflects whether an idea already exists. It always reads
  "Generate idea", so a second press on the same video silently updates or leaves
  the existing idea and toasts "Idea updated" with no other on screen sign that one
  was already there.
- "Idea updated" covers two different outcomes: rewriting an untouched inbox idea
  with a fresh concept and angle, and leaving a shortlisted or scripted idea
  exactly as it was. The toast does not tell them apart.
- Unlike the analyze gate on the same page, this button does not check for a key or
  a reachable proxy before showing. When generation is unavailable the button
  still renders and the failure appears only after the click.
- The ideas inbox is out of scope for this repo. Downstream, its Create script
  action seeds a remix session from an idea and marks the idea scripted; that is
  named here as the eventual return path into the core loop, not described.
