# analyze: feature description

Analyze is what turns a raw outlier in the feed into an analyzed one. It reads a video and writes down what it is doing: its hook type, the beats of its structure, format and style tags, and a why-it-worked note. It lives on the video detail page inside the Hook and structure and Why it worked tabs, driven by one button and the generation it triggers, there is no separate page and no dialog. A second feature, Generate idea, lives in the same page's action row: it turns one analyzed video plus the creator's persona into a single content idea in the ideas inbox.

Both features need an analysis (or, for Generate idea, an already-existing one) to run, and analysis itself needs two things: a transcript of the video, and the Claude API key. A transcript it will make on demand through a transcript provider (whisper.cpp locally, or Groq with a key) if none is stored and the video's own asset has already been downloaded; the key it cannot make, and without it the generation fails. Success and failure surface only as toasts; the two dead-end states, no transcript provider and no key, render as alerts in the gate rather than as toasts.

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | Analyze and reanalyze a video | Transcribes on demand if needed, then writes hook, structure, format tags, style tags, and why-it-worked for a video; Re-analyze replaces the text columns on an already-analyzed one | ● | `src/server/services/analyze.ts` (`getOrCreateAnalysis`) | B-17a: the action omits the error code field |
| 3 | Generate an idea | Turns one analyzed video plus the creator's persona into a content idea in the ideas inbox | ● | `src/server/services/ideas.ts` (`generateIdea`) | B-12 (filed in feed's backlog): the button does not gate on a key or reflect an existing idea |

## 2. Analyze and reanalyze a video

### Who uses it

The user, from the video detail page's Hook and structure tab or Why it worked tab, to run the first analysis, and from the Re-analyze control next to the Beats heading, to run a fresh pass over a video that already has one.

### What it does

Reads a video's stored transcript, or creates one on demand when none is stored and a provider is reachable, and writes one `video_analyses` row: hook type, beat-by-beat structure, format tags, style tags, and a why-it-worked note. One pass fills both the Hook and structure tab and the Why it worked tab, since they share the same row, whichever tab the user analyzes from. Re-analyze runs the same text pass again over an already-analyzed video and replaces only the text columns; it leaves the video's layout, written by a separate frame pass, and the first-analyzed timestamp alone.

### How to access it

The "Analyze this video" or "Transcribe & Analyze" button, inside the gate both the Hook and structure and Why it worked tabs show on an unanalyzed video. The Re-analyze control next to the Beats heading, on a video that already has an analysis.

### Business rules

- The gate picks one of four faces from whether the video has a transcript, whether a transcript provider is reachable right now, and whether the Claude key is set: no transcript and no reachable provider is a dead-end alert with no button; no transcript but a reachable provider is a live "Transcribe & Analyze" button, which works even with no Claude key, since transcribing is keyless; a transcript but no key is an alert asking for the key; a transcript and the key is the plain "Analyze this video" button.
- A live "Transcribe & Analyze" button does not guarantee the click will succeed: the gate's reachable-provider check looks only at whether whisper.cpp or Groq is usable in general, not at whether this particular video's own asset has already been downloaded, which the transcript step also needs. A video without a downloaded asset yet fails the click with its own distinct error.
- A cache hit returns the stored analysis without touching the transcript chain or the model at all.
- Clicking the button disables it immediately, so a second click in the same tab cannot start a second pass; the button relabels to "Transcribing" for the transcribe-and-analyze branch (for the whole wait, even during the analysis half) or "Analyzing" for the plain branch, and "Re-analyzing" for Re-analyze.
- On success the analysis row is written whole, never partially; the toast reads "Analysis complete" (or "Re-analysis complete"), and the client re-reads the page so both tabs repaint. On failure nothing is written and the button re-enables.
- Two tabs racing the very first analysis of one video contend for a single row keyed by the video id; the later write can fail with a generic error while the first succeeds, and at most one analysis row ever exists for a video.
- The pending wait is plain component state, not a transition, so the rest of the page, including the arrow-key feed navigation, stays live and the user can leave mid-analysis; the server pass runs to completion regardless, but its toast and refresh do not fire on a page the user has left.

### Limitations

- `analyzeVideoAction` and `reanalyzeVideoAction` return only `{ ok, error }` with no `code` field, so a failure surfaces as a raw string toast the client cannot tell apart from any other failure (B-17a, [backlog to enhance](05-backlog-to-enhance.md)).
- There is no cancel or stop control; the button stays disabled until the pass settles or fails on its own, and there is no way to abort a running generation from the page.
- A re-analysis is not versioned: the previous hook, beats, tags, and note are gone with no history kept, and the only way back to a different reading is to re-analyze again.

### User guide

Open a video's detail page and click Hook and structure or Why it worked. If the video has not been analyzed yet, a button offers to analyze it, or to transcribe and analyze it first if it has no transcript yet. Click it, and crowsnest reads the video, transcribing it first if needed, and writes down its hook type, its structure beat by beat, and why it worked; both tabs fill in from the one pass, whichever tab you started it from. To get a fresh read on a video you have already analyzed, click Re-analyze next to the Beats heading; this replaces the hook, beats, tags, and note with a new pass, but leaves the video's Layout tab, which comes from a separate reading, untouched.

## 3. Generate an idea

### Who uses it

The user, from the action row at the bottom of an analyzed video's detail page.

### What it does

Asks the language model for a one-line concept and a short angle grounded in the video's analysis and the creator's persona, then writes or refreshes the one idea for that video in the ideas inbox. This is an exit from the core loop: the idea lands in a separate inbox screen, out of scope for this repo, and the button's whole visible result on the video detail page is a toast.

### How to access it

The "Generate idea" button in the action row, alongside Remix this, the two save actions, and Copy as prompt. The button appears only on a video that already has an analysis; it does not exist at all on an unanalyzed one.

### Business rules

- At most one non-discarded idea exists per video, enforced by the `idea_source_active` partial index; a second press on the same video updates the existing idea rather than creating a duplicate.
- The update only rewrites an idea whose status is still `inbox`; an idea the user has already shortlisted or scripted is left exactly as it was, and the toast still reads "Idea updated" either way.
- What the idea is built from is decided when the request actually runs, not when the page loaded: the model reads the video's current analysis, the creator's persona, and the video's outlier score at that moment, so a Re-analyze done first changes what the next Generate idea produces.
- The same generation runs automatically for a channel's analyzed outliers during a sidecar sync (`generateIdeasForNewOutliers`); the button is the on-demand version of that pass, and the two never produce two ideas for the same video.
- `generateIdea` never throws on a bad model reply; it reports back that nothing was created instead, so the same call is safe to run per outlier in the sync's automatic pass.

### Limitations

- Unlike the analyze gate on the same page, the button does not check whether generation is actually available before rendering; a missing key or a down proxy surfaces only after the click, as a failed toast (B-12, filed in [feed's backlog to enhance](../feed/05-backlog-to-enhance.md)).
- The button never reflects whether an idea already exists for the video; it always reads "Generate idea," regardless (B-12).
- The button honors no shortcut of its own; the detail page's arrow keys page to the previous or next video and are not tied to it.

### User guide

On an analyzed video's detail page, click Generate idea in the action row near the bottom. crowsnest reads the video's analysis and your persona and proposes one new content idea, which lands in the ideas inbox; a toast confirms whether it was added as a new idea or updated one already there for this video. You stay on the same page. Open the ideas inbox separately to see, shortlist, discard, or turn the idea into a script.

## 4. Interactions with other systems

Persistence and autosave. There is no autosave and no dirty state for either feature; both commit as one row at the end of their pass. A transcript made on demand is persisted as its own row first, cache-first, so a later analyze or a later remix reuses it rather than transcribing again.

History and undo. Neither feature keeps history. Re-analyze overwrites the stored hook, beats, tags, and note in place with no version kept. Generate idea overwrites an untouched inbox idea's concept and angle in place; a discarded idea can later be regenerated as a fresh inbox idea.

Navigation and refresh. Analyze and Re-analyze call a client refresh on success so the tabs repaint without a manual reload. Generate idea does not refresh, since nothing on the video detail page depends on the idea it wrote. Neither wait is a React transition, so navigation is never blocked by either pending state.

Background jobs and the sidecar. Neither feature runs as a background job from the button; both run inside their server action and return once the model call settles. The sidecar's own sync calls the same underlying services directly, `autoAnalyzeNewOutliers` then `generateIdeasForNewOutliers`, over a channel's top-scoring outliers, near the end of every sync, so a video can already be analyzed and have an idea before the user ever opens it.

External services. The Claude API does both the analysis and the idea generation, direct or through a local proxy. The transcript providers, whisper.cpp locally or Groq with a key, make a transcript when none is stored; whisper.cpp also needs the video's own asset already downloaded by ig-sync.

Status and failures. Success and failure both surface as toasts for both features; there is no inline error region on the video detail page. The two dead-end states, no provider and no key, render as alerts in the analyze gate rather than as toasts, since a click there could do nothing.

Configuration and settings. The Claude key and the Groq key are set in Settings, and whisper.cpp availability depends on a local install; together these decide which gate face is shown. The resolved Claude model name is recorded on the analysis row. The creator's persona (audience, voice, do, and don't guidance) grounds Generate idea; the outlier score threshold and per-sync caps that gate the automatic passes are read from settings and do not apply to either manual button. On the Persona screen itself, each of the four fields carries a why-line naming which part of generation it steers, an enriched placeholder describing the same, and an "Insert example" action that fills the field with a sample value, but only while the field is still empty; it never overwrites text the user has already entered.

## 5. Edge cases

- The gate appears on two tabs, Hook and structure and Why it worked. One pass fills both, so whichever tab the user analyzes from, both show a result afterward.
- Layout is not produced by analysis. A video's layout comes from a separate frame pass, run from its own control in the Layout tab, with its own model and timestamp; a re-analysis deliberately leaves the layout columns untouched, because a text pass has seen no frames and reusing or wiping them would misattribute a real reading.
- Re-analyze exists mostly to backfill old rows. Beats gained a verbatim per-beat transcript quote later than the first analyses were written; a beat from before that shows a re-analyze hint instead of an invented quote, and Re-analyze is the only way to fill it in.
- Style tags render muted with an "unverified" marker while format tags render plain, because a text-only model can only guess at visual style until a frame pass confirms it. This is display, owned by the video detail page, but it reflects what an analysis pass can and cannot know.
- Save to Vault and Generate idea both need an analysis to exist before they are offered; on an unanalyzed video neither is reachable.
- A video with no locally downloaded asset yet can still show a live "Transcribe & Analyze" button, because reachability is checked at the provider level, not per video; the click then fails with a distinct "video has no downloaded video asset yet" error rather than the usual no-provider message.
- Generate idea's "Idea updated" toast covers two different outcomes: rewriting an untouched inbox idea with a fresh concept and angle, and leaving a shortlisted or scripted idea exactly as it was. The toast does not tell them apart.
