# analyze: test cases

How to run these: start the dev server and open `http://localhost:3001` (never
`127.0.0.1`), on a database with at least one tracked channel that has finished a
sync. Seed a mix: an unanalyzed video and an analyzed one, one video with a stored
transcript and one without, and a way to toggle the transcript providers (whisper.cpp
local, or a Groq key) and the Claude API key. The analyze rows need a transcript
provider and the Claude key; the idea rows need the LLM proxy up and a key. Stop the
LLM proxy (or unset `LLM_BASE_URL`) for the proxy-down state, and unset
`ANTHROPIC_API_KEY` for the no-key state; the two read differently. "A second tab"
shares the session; it is not a second browser.

## Analyze and reanalyze a video

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ANALYZE-01 | P1 | transcript + key | Analysis needs a transcript and the Claude key; a transcript with the key gives the plain "Analyze this video" button. | An unanalyzed video with a stored transcript and `ANTHROPIC_API_KEY` set. | 1. Open Hook and structure. | The tab shows one "Analyze this video" button. | not run |
| ANALYZE-02 | P1 | no transcript, no provider | Gate face: no stored transcript and no reachable provider shows a "No transcript available yet" alert with no button. | A video with no transcript, whisper.cpp absent and no Groq key. | 1. Open Hook and structure. | An alert "No transcript available yet" with a hint to install a transcriber or add a Groq key, and no button. | not run |
| ANALYZE-03 | P1 | transcript, no key | Gate face: a transcript but no Claude key shows an alert asking for the key, with no button. | A video with a transcript, `ANTHROPIC_API_KEY` unset. | 1. Open Hook and structure. | An alert asking for the key, no button. | not run |
| ANALYZE-04 | P1 | no transcript, provider up | Gate face: no transcript but a provider reachable shows a live "Transcribe & Analyze" button, which works even with no Claude key. | A video with no transcript, whisper.cpp or Groq reachable, no Claude key needed for this face. | 1. Open Hook and structure. | A live "Transcribe & Analyze" button. | not run |
| ANALYZE-05 | P1 | transcript + key | One pass fills both the Hook and structure and the Why it worked tabs. | An unanalyzed video with a transcript and key. | 1. Click Analyze from Hook and structure.<br>2. Switch to Why it worked. | After the refresh, both tabs show a result. | not run |
| ANALYZE-06 | P1 | transcript + key | Success writes the row, toasts "Analysis complete", and re-reads the page; failure writes nothing and re-enables the button with a reason toast. | An analyzable video; then a way to force a failure (unset the key). | 1. Click Analyze and let it finish.<br>2. On another video, unset the key and click Analyze. | Success repaints the tabs with a toast; failure leaves no partial row, re-enables the button, and names the reason. | not run |
| ANALYZE-07 | P1 | key | Re-analyze replaces only the text columns (hook, beats, tags, why), leaving the layout and the first-analyzed timestamp. | An analyzed video that also has a layout from a frame pass. | 1. Click Re-analyze by the Beats heading.<br>2. Check the layout and the first-analyzed timestamp. | Hook, beats, tags, and note are replaced; the layout and the first-analyzed timestamp are unchanged. | not run |
| ANALYZE-08 | P1 | proxy/key | (B-17a) The analyze action returns only `{ ok, error }` with no `code` field, so the client shows the raw error string. | A video where analysis will fail (no key). | 1. Click Analyze and read the failure toast. | Record what happens: a plain error-string toast with no code to tell one failure from another. (suspected bug) | not run |
| ANALYZE-09 | P1 | transcript + key | (B-10) The `videoAnalyses.summary` field is never written by the analyze pass. | An analyzable video. | 1. Analyze it.<br>2. Read the detail page summary and the analysis row. | Record what happens: the summary stays empty after a successful analysis. (suspected bug) | fail (confirmed at data level): 0 of 24 analyses have a non-empty summary; re-analyze not driven, scripted pass |
| ANALYZE-10 | P2 | transcript + key | The button disables and relabels while the pass runs, and "Transcribing" stays for the whole transcribe-and-analyze wait even during the analysis half. | A video needing the transcribe-and-analyze button. | 1. Click Transcribe & Analyze.<br>2. Watch the label the whole wait. | The button is disabled and reads "Transcribing" from click to finish, never switching to "Analyzing". | not run |
| ANALYZE-11 | P2 | keyboard | The wait is component state, not a transition, so an arrow key still navigates away mid-analysis. | A video mid-analysis. | 1. Click Analyze.<br>2. During the wait press an arrow key. | The page navigates to the neighbour; the server pass may still land, but its toast and refresh do not fire on the left page. | not run |
| ANALYZE-12 | P2 | second tab | Two tabs racing the first analysis contend for one row keyed by the video id; the later write can fail generic while the first succeeds, and at most one row exists. | The same unanalyzed video open in two tabs at the gate. | 1. Click Analyze in both tabs near-simultaneously. | Record what happens: one succeeds, the later write may toast a generic error, and only one analysis row exists. | not run |
| ANALYZE-13 | P2 | mouse | A beat written before per-beat quotes shows a "re-analyze to capture the transcript per beat" hint, and a silent beat shows "(no words spoken in this beat)". | An old analysis row with a beat lacking a quote, and a silent beat. | 1. View the Beats section. | The hint for the pre-quote beat and the silent-beat text, never an invented quote. | not run |
| ANALYZE-14 | P3 | mouse | Style tags render muted with an "unverified" marker while format tags render plain. | An analyzed video. | 1. View the format and style tags. | Style tags muted with an unverified marker, format tags plain. | not run |

Not checkable by hand:

- Whether a navigation or reload during the pending window reliably commits the
  server write.
- Whether a sync that removes the video mid-generation cascades the just-written
  analysis row away.
- Where a summary would come from, which could not be determined from the code.

## Generate an idea

| ID | P | Needs | Claim | Setup | Steps | Expected | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IDEA-01 | P1 | mouse | The Generate idea button appears only on an analyzed video; on an unanalyzed one there is no button at all. | An unanalyzed and an analyzed video. | 1. Check the action row on both. | The button is hidden on the unanalyzed video and present on the analyzed one. | not run |
| IDEA-02 | P1 | proxy down or no key | (B-12) The button does not gate on a key or a reachable proxy and never reflects an existing idea; failure surfaces only after the click. | An analyzed video with the proxy down or `ANTHROPIC_API_KEY` unset, and one that already has an idea. | 1. Observe the button on both.<br>2. Click it with the proxy down. | Record what happens: the button always reads "Generate idea" regardless of an existing idea, and a missing key or down proxy shows only as a failed toast after the click. (suspected bug) | not run |
| IDEA-03 | P1 | proxy up + key | At most one non-discarded idea per video: the first press adds, a second updates, and the toast distinguishes "Idea added to the inbox" from "Idea updated". | An analyzed video with no idea yet, proxy up and a key. | 1. Click Generate idea and wait.<br>2. Click it again. | First toast "Idea added to the inbox", second "Idea updated", and no duplicate idea. | not run |
| IDEA-04 | P1 | proxy down | (B-17a) The action returns only `{ ok, error }` with no `code` field, and a failure funnels to one generic "Could not generate an idea for that video". | An analyzed video, proxy down. | 1. Click Generate idea and read the toast. | Record what happens: a single generic failure toast with no code field. (suspected bug) | not run |
| IDEA-05 | P1 | proxy up + key | The user stays on the detail page and the page does not refresh, since nothing on it depends on the idea; the whole visible result is a toast. | An analyzed video. | 1. Click Generate idea and wait for it to settle. | The user stays put, the page does not refresh, and only a toast appears. | not run |
| IDEA-06 | P1 | proxy down | On failure nothing is written and the button re-enables so the user can retry. | An analyzed video, proxy down. | 1. Click Generate idea. | No idea row is written and the button re-enables. | not run |
| IDEA-07 | P2 | proxy up + key | The button disables and relabels "Generating" during a real model wait, so a second click cannot start a second request. | An analyzed video. | 1. Click Generate idea.<br>2. Try to click it again during the wait. | The button is disabled and reads "Generating"; the second click does nothing. | not run |
| IDEA-08 | P2 | proxy up + key | The idea is built from the video's current analysis, persona, and outlier score at the moment the request runs, not at page load. | An analyzed video where Re-analyze is available. | 1. Re-analyze the video.<br>2. Click Generate idea. | The generated idea reflects the newer analysis rather than the one present at page load. | not run |
| IDEA-09 | P2 | proxy up + key | "Idea updated" covers both rewriting an untouched inbox idea and leaving a shortlisted or scripted idea unchanged; the toast does not tell them apart. | An analyzed video whose idea has been shortlisted or scripted. | 1. Click Generate idea. | The toast reads "Idea updated" and the existing shortlisted or scripted idea is unchanged. | not run |
| IDEA-10 | P2 | keyboard | The button honors no shortcut; the detail arrow keys page videos and are not tied to it, so an arrow after the click navigates away mid-generation. | An analyzed video. | 1. Click Generate idea.<br>2. Press an arrow key during the wait. | The page navigates to the neighbour; the server request may still land unseen. | not run |

Not checkable by hand:

- Whether a navigation or reload during the generating window reliably commits or
  abandons the write.
- Whether the failure toast wording differs in practice between a down proxy, a
  missing key, and a bad model reply.
- Whether the automatic sync pass and a manual click can be observed racing on the
  same video.
