# Analyze and reanalyze a video

## Summary

Analysis reads a video and writes down what it is doing: its hook type, the beats
of its structure, format and style tags, and a "why it worked" note. It is what
turns a raw [video](../glossary.md) in the feed into an [analyzed](../glossary.md)
one, and it is the gate almost everything downstream sits behind (save to vault,
generate an idea, and the source description a [remix](../remix/remix-overview.md)
reads all need an analysis to exist first).

Analysis lives on the [video detail page](video-detail.md), inside the Hook and
structure tab and the Why it worked tab. On an unanalyzed video both tabs show the
same gate, an offer to analyze the video. On an analyzed video the tabs show the
result, and the Beats section carries a Re-analyze control that runs a fresh pass
over a video that already has one. There is no separate page and no dialog; the
whole interaction is one button and the [generation](../glossary.md) it triggers.

Analysis needs two things to run: a transcript of the video, and the Claude API
key. A transcript it will make on demand through a [transcript
provider](../glossary.md) if none is stored and one is reachable. The key it cannot
make; without it the generation fails. When neither a stored transcript nor a
reachable provider exists, analysis that needs a transcript cannot run at all, and
the gate says so instead of offering a button.

> Technical note: the write is a server action (`analyzeVideoAction`,
> `reanalyzeVideoAction`) returning `{ ok: true }` or `{ ok: false, error }`. Unlike
> most core loop actions it carries no `code` field, so the client branches on
> nothing but success or failure and shows the `error` string as a toast. The layout
> a video can also carry is not produced here; see the Layout note below.

## The simple case

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

## The interaction, event by event

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

### Arrive

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

### Leave without acting

Opening the page and leaving it, or switching tabs, records nothing. Nothing starts
until the user clicks the button. There is no dirty state to lose and no draft to
keep.

### Begin acting

Clicking the button starts the write. From that instant the button is disabled so a
second click in the same tab cannot start a second pass. For a video with no stored
transcript this single action also transcribes first, on demand, before it analyzes;
the user does not run transcription as a separate step.

### While acting

The button stays disabled and relabels itself: "Analyzing" for the plain button,
"Transcribing" for the transcribe-and-analyze button, "Re-analyzing" for Re-analyze.
The transcribe-and-analyze button reads "Transcribing" for the whole wait even while
it is really in the analysis half, because the label is fixed to the branch, not to
the current step. Nothing else on the page changes and there is no progress bar.

> Technical note: the pending state is plain component state, not a React transition,
> so the disabled button is the only thing the wait blocks. The rest of the page
> stays live, including the arrow key feed navigation, so the user can page to another
> video mid-analysis (see interrupt row 2).

### Finish

On success the action has written the analysis row, the toast says "Analysis
complete" (or "Re-analysis complete"), and the client re-reads the page so the tabs
repaint with the result. No manual reload is needed. The user stays on the same
page.

On failure nothing is written (a failed generation leaves no partial row), the
button re-enables, and a toast shows the reason: the key is missing, no transcript
could be made, the video is gone, or an unexpected model error. The gate stays as it
was.

A re-analysis replaces only the text columns (hook, beats, tags, why). It leaves the
video's layout and the timestamp of when it was first analyzed alone. See the Layout
note under edge cases.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (video analyzed or not) | Analyzed means no gate and a Re-analyze control; not analyzed means the gate. | If the video is analyzed in another tab while this one shows the gate, this tab still shows the gate; clicking Analyze here finds the existing analysis and shows it after the refresh rather than erroring. |
| Attached data present or absent (transcript, key) | The gate's face is chosen from these: a stored transcript gives the "Analyze" button; no transcript with a reachable provider gives "Transcribe & Analyze"; no transcript and no provider gives the dead-end alert; a transcript with no key gives the key alert. | A transcript or a key appearing or disappearing has no live effect on the open page; the gate is fixed until the next load. |
| External service availability (transcript providers, Claude key, LLM proxy) | Providers decide whether the transcribe button is offered at all; the Claude key decides whether analysis can run once a transcript is in hand. Graph and the sidecar do not matter here. | If the model or a provider fails during the wait, the action returns a failure and the toast names it; nothing is written. |
| Keyboard shortcut in play | Left and right arrow keys page to the previous and next video (a detail-page shortcut, not an analysis one). No key starts or submits an analysis. | Because the wait is not a transition, an arrow key still navigates away mid-analysis; the button itself has no keyboard action beyond the standard focus-and-activate. |

## Cancel and interrupt

| Event | Before commit (gate shown) | While in flight (analyzing or re-analyzing) |
| --- | --- | --- |
| Explicit cancel or stop | There is nothing to cancel; no work has started. | There is no cancel or stop control and no way to abort the running generation. The button is disabled and the pass runs to completion on the server. |
| Navigate away mid action | Leaving records nothing. | An arrow key or a sidebar link still navigates, because the wait is not a transition. The server pass may still finish and write the row, but the toast and refresh do not fire on the page the user left; the next visit shows whatever landed. |
| Reload or tab or window closed | Nothing is saved. | The client wait is abandoned. The server pass may or may not complete; on next load the tabs reflect whatever the database holds. There is no partial analysis: the row is written whole or not at all. |
| A backing service fails mid action | The gate already shows an alert instead of a live button when the needed service is missing (no provider, or no key with a transcript present). | A missing key, an unmakeable transcript, or a model error returns a failure; the toast names the reason and no row is written. The button re-enables. |
| The target record changes underneath | If a sync removed the video, clicking Analyze returns "Video not found, try refreshing the page" and the detail page itself will 404 on the next load. | The pass already holds the video it read; a removal during the wait is a rare race (see open questions). |
| A background job finishes or fails on its own | No effect. Analysis is not a background job; nothing external completes it. | No effect. |
| A second tab or a double action on the same record | Two tabs can both show the gate; each can start a pass. | A double click in one tab is blocked by the disabled button. Two tabs racing the very first analysis of one video contend for a single row keyed by the video id; the later write can fail with a generic error while the first succeeds, and at most one analysis row ever exists. |

After any interrupt the user stays where they are. The analysis row either exists in
full or does not exist; there is never a half-written one.

## Interactions with other systems

**Persistence and autosave.** There is no autosave and no dirty state; analysis
commits as one row at the end of the pass. A transcript made on demand is persisted
as its own row first, cache-first, so a later analyze or a later remix reuses it
rather than transcribing again. See [persistence](../cross-cutting/persistence.md).

**History and undo.** None. Re-analyze overwrites the stored hook, beats, tags, and
note in place; the previous text is gone with no version kept. The only way back to a
different analysis is to re-analyze again. A re-analysis does preserve the layout and
the first-analyzed timestamp.

**Navigation and refresh.** On success the client calls a refresh so the tabs
repaint without a manual reload. The wait is component state, not a transition, so it
does not block navigation. See the refresh model in [navigation and
shell](../foundations/navigation-and-shell.md).

**Background jobs and the sidecar.** Analysis runs inside the action, not as a
background job, and it is not the frame pass (which is a separate polled job) nor a
[cook run](../studio/cook-run.md). The [sidecar](../foundations/background-jobs.md)
touches analysis only by removing a video, which cascades its analysis away with it.

**External services.** The Claude API key does the analysis; the [transcript
providers](../glossary.md) (whisper.cpp locally, or Groq with a key) make the
transcript when none is stored. Analysis that needs a transcript cannot run when none
is stored and no provider is reachable. See [external
services](../cross-cutting/external-services.md).

**Status and failures.** Success and failure both surface as toasts; there is no
inline error region, and a failed pass just re-enables the button. The two dead-end
states, no provider and no key, render as alerts in the gate rather than as toasts.
See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** The Claude key and the Groq key are set in Settings,
and whisper.cpp availability depends on a local install; together these decide which
face the gate shows. The resolved Claude model name is recorded on the analysis row.
No user tunable threshold changes this behavior.

## Edge cases

- The gate appears on two tabs, Hook and structure and Why it worked. One pass fills
  both, so whichever tab the user analyzes from, both show a result afterward.
- Layout is not produced by analysis. A video's layout comes from a separate frame
  pass, run from its own control in the Layout tab, with its own model and timestamp.
  A re-analysis deliberately leaves the layout columns untouched, because a text pass
  has seen no frames and wiping or reusing them would misattribute a real reading.
  The frame pass interaction is owned by [video detail](video-detail.md).
- Re-analyze exists mostly to backfill old rows. Beats gained a verbatim per-beat
  transcript quote later than the first analyses were written; a beat from before
  that shows a "re-analyze to capture the transcript per beat" hint instead of an
  invented quote, and Re-analyze is the only way to fill it in. A beat with no words
  spoken shows "(no words spoken in this beat)".
- Style tags render muted with an "unverified" marker while format tags render plain,
  because a text-only model can only guess at visual style until a frame pass
  confirms it. This is display, owned by [video detail](video-detail.md), but it is
  part of what an analysis produces.
- Save to Vault and Generate idea both need an analysis to exist; before one is run
  they are disabled or hidden on the detail page. Analysis is their precondition.
- The transcribe-and-analyze button reads "Transcribing" for the entire wait even
  while it is really analyzing, so a long analysis half looks like a long transcribe.

## Open questions and verification

- Whether a navigation or reload during the pending window reliably commits the
  server write was read from the code but not confirmed by hand. Because the wait is
  plain component state rather than a transition, the exact fate of an in-flight pass
  when the page unmounts needs a live check.
- The outcome when two tabs race the first analysis of one video (a primary key
  conflict surfacing as a generic error toast, versus the writes serializing cleanly)
  was inferred from the single-row-per-video key and not confirmed live.
- Whether a sync that removes the video mid-generation cascades the just-written
  analysis row away was inferred from the foreign key cascade and not confirmed.
- The `videoAnalyses` row has a summary field and the detail page renders it when
  present, but the analyze pass does not write it. Where a summary comes from could
  not be determined from this feature's code.

Verified against this repo commit `4f26fb9`.
