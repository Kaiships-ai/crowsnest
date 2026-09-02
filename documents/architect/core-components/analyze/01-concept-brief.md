# analyze: concept brief

AI analysis of an outlier and idea generation from a video.

## What it is

Analyze is the component that reads one video and writes down what it is doing: its
hook type, the beats of its structure, format and style tags, and a "why it worked"
note. It is what turns a raw outlier in the feed into an analyzed one, and it is the
gate almost everything downstream sits behind — save to vault, generate an idea, and
the source description a remix reads all need an analysis to exist first. It lives on
the video detail page inside the Hook and structure and Why it worked tabs, driven by
one button (`analyzeVideoAction`, `reanalyzeVideoAction`) and the generation it
triggers; there is no separate page and no dialog. A second feature, Generate idea,
lives in the same page's action row: it turns one analyzed video plus the creator's
persona into a single content idea and drops it into the ideas inbox
(`generateIdeaAction`). The two interactions are documented in full in
[feature description](03-feature-description.md).

Analysis needs two things to run: a transcript of the video and the Claude API key.
A transcript it will make on demand through a transcript provider (whisper.cpp
locally, or Groq with a key) if none is stored; the key it cannot make, and without
it the generation fails. A cache hit returns the stored analysis without touching the
transcript chain or the model at all.

## Why it exists

The whole product is a loop from someone else's outlier to the user's own script, and
that loop is only possible once the app has an opinion about *why* the outlier worked.
Analyze produces that opinion in a fixed, structured shape (validated against
`VideoAnalysisSchema`) so that every downstream step — the idea generator, the remix
research stage, the save-to-vault templates — reads the same hook/structure/tags/why
fields rather than re-reading the raw video each time. Making it on-demand and
cache-first, rather than analyzing every video at sync time, keeps the model spend on
the handful of videos the user actually opens while still letting the sidecar sync
run an automatic pass over the top-scoring outliers ahead of the user.

## Boundaries

Analyze owns the text pass over a video: resolving or creating its transcript, calling
the model through the [llm layer](../llm/01-concept-brief.md), and writing the one
`videoAnalyses` row (hook, structure, format tags, style tags, why) — see the
[data model](../../shared/data-model.md). It owns Generate idea's on-demand button and
the shared service the sync's automatic pass reuses. It does not own the layout of a
video: that is a separate frame pass, run from the Layout tab with its own model and
timestamp, which a re-analysis deliberately leaves untouched. It does not own
transcription itself (a separate keyless-capable path) nor the model client (the llm
layer). It does not own the ideas inbox: Generate idea is an exit from the core loop,
and the inbox screen where the idea lands is out of scope for this repo. Success and
failure surface only as toasts; the two dead-end states (no transcript provider, no
key) render as alerts in the analyze gate rather than as toasts.
