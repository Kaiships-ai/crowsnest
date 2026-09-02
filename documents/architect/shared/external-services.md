# External services

## Summary

The core loop runs on the local database, but four things it can do reach past
that database to a service that may not answer: generating text, measuring the
own channel, making a transcript, and filling the feed. This document owns one
question for each of them, "what does the user see when it is down", and is the
single place other documents link to for that answer so they do not each explain
it differently.

The four services are the LLM proxy that
generation calls, the Anthropic API key that generation also
needs and that is distinct from the proxy, the Graph API
token the my channel page measures through, and the
transcript providers that analysis draws
a transcript from. The sidecar sync that
writes videos is a fifth dependency, owned in full by
background jobs; its degradation is
summarized here so the map below is complete.

The shape shared by all of them is the shape the
interaction model states once: the core loop degrades rather than blocks. A service being down
removes the one thing that needs it and leaves everything else working. No
service failure takes down the feed, the calendar, the planner, or the ability
to save, schedule, or open a video.

This is a reference document, not a single interaction. It has no arrive, act,
and finish of its own, because it describes a concern that cuts across every
feature rather than one action on one page. The sections below that do not fit a
cross-cutting concern say so and stay in place, so the document stays comparable
to the feature documents. The one interrupt that is this document's whole
subject, a backing service failing mid action, is covered in full.

## The service map

Each row is one service, what in the core loop needs it, what the user sees when
it is unavailable, and whether the rest of the loop keeps working. This table is
the summary other documents link to; the sections after it give the detail.

| Service | What needs it | What the user sees when it is down | Rest of the loop |
| --- | --- | --- | --- |
| LLM proxy | The remix generation stages (hook, style, script), Quick Remix, and generate idea. | The generation stages become the block panel with the proxy down reason, inferred from the run log. Quick Remix is disabled. Generate idea fails with a toast. | Works. Feed, detail reads, save, plan, schedule, calendar, and studio all keep working. |
| Anthropic API key | Every generation, and analysis of a video. This is the credential, separate from the proxy. | With no key, the generation stages show the block panel with the no key reason, and analysis shows a key alert in place of its button. A generation attempt fails with a toast naming the missing key. | Works, minus generation and analysis. |
| Graph API token | The metrics band on the my channel page: stat tiles, progress, reach bars, own post list, weekday rhythm. | A connect panel naming what is missing. Historical numbers still show when the account was measured before, with the connect panel stacked above them. | Works. Planning, the calendar, and the studio do not need it. |
| Transcript providers | Analysis of a video that has no stored transcript. | If no provider is reachable, the analyze gate shows a dead end alert with no button. If a provider is reachable, a Transcribe and Analyze button. whisper.cpp is local, so keyless transcription still works with no network provider. | Works. A video that already has a stored transcript analyzes with no provider at all. |
| Sidecar sync | New videos arriving in the feed, and own post measurement. Owned by background jobs. | No new videos. The feed goes stale rather than erroring. | Works. Every downstream action runs on the videos already there. |

## The simple case

Nothing is the simple case here, because the user does not act on a service
directly. The user acts on a feature, and the service sits behind it. The
representative moment is a generation the user starts when the proxy is
unreachable: instead of a button that spins and fails, the remix stage is already
the block panel before they click, because the studio read the run log on load
and saw the last attempts fail with a connection error. The user sees a panel
that says generation is unavailable and why, not a crash and not a silent
nothing. Every other feature they can reach on that same visit, the feed, the
calendar, the planner, still works. That is the pattern every row of the map
above follows: the one thing that needs the service is visibly unavailable and
labeled, and nothing else is touched.

## The interaction, event by event

Not applicable as a single interaction, and the heading is kept only so this
document lines up with the feature documents. A service dependency is not an
action with phases; it is a condition that other actions run inside. The phases
that matter belong to the feature that touches the service, and each feature
document narrates its own: analysis for the transcript and
the key, the remix overview and each remix stage
for the proxy, the my channel page for the Graph
token. What this document adds is the single consistent account of the failed
state those interactions land in, gathered in the map above and detailed below.

## The LLM proxy and generation

Every generation in the core loop, the hooks, the outline, the
script variants, a generated idea, calls the language model through the LLM
proxy. When the proxy does not answer, generation fails. It fails the same way
everywhere: the attempt returns a failure, a toast names it, and a
remix run row is written for the failed attempt so the run log
records it.

The remix studio does not wait for a click to discover the proxy is down. It
reads its own run log and infers the state. If a recent attempt failed with a
connection style error, the studio treats the proxy as down and replaces the
generation stages (hook, style, script) with the block panel, so the user never
faces a button that is going to fail. The prompt and research stages stay usable,
because research assembles locally and calls no model. The remix overview owns this
block panel and the inferred down read; the hook stage
and the other generation stages each name their own use of it.

Generate idea, an exit from the core loop into the ideas inbox, has no block
panel in front of it. It is a single action that calls the model and, when the
proxy is down, returns a failure the user sees as a toast rather than a stage
that pre blocks.

> Technical note: "proxy down" is inferred, not pinged. The run log view marks
> the proxy likely down when any of the last three run rows carries a connection
> style error message ("connection error", "econnrefused", "fetch failed",
> "network error"), or, for the script stage, when a variant run reports zero of
> N variants succeeded. The next successful attempt clears the inference. This is
> a read of recent history, so a proxy that just recovered still reads as down
> until one attempt succeeds, and a proxy that just died reads as up until an
> attempt fails.

## The Anthropic API key versus the local proxy

Generation needs two separate things, and the difference is visible to the user
because they fail differently. One is the Anthropic API key, the credential.
The other is the local proxy, the endpoint the request is routed through. A
machine can have the key and not the proxy, or the proxy and not the key, and the
two produce different states.

- No key configured. Generation cannot run at all. The remix generation stages
  show the block panel with the no key reason, which invites the user to add the
  key in Settings. Analysis shows a key alert in place of
  its analyze button when a transcript is already in hand. This is a
  configuration state, not a network failure: nothing was attempted, because
  there is no credential to attempt with.
- Key present, proxy unreachable. The credential exists, so the app tries, and
  the try fails on the connection. This is the inferred down state above: the run
  log carries a connection error and the generation stages block on it until an
  attempt succeeds.

Both reasons share the one block panel in the remix studio, which names which of
the two it is. The distinction matters because the fix differs: one is a key to
paste, the other is a proxy to start.

> Technical note: the key gate and the proxy are separate in the code. Asking for
> the model with no key raises a dedicated no key error before any request is
> made, which callers turn into the "add your key in Settings" surface. The proxy
> is a base URL override that routes the same request through a local compatible
> router; when that router is not running the request fails with a connection
> error, which is the string the run log matches on. Analysis carries only the
> key half of this: it needs the key, and it surfaces a missing key as an alert
> in the gate rather than as a block panel.

## The Graph API token

The my channel page measures the user's own channel
through the Graph API, gated by a token it
checks on load. The token is the one external dependency of that page, and only
for the metrics band. When the token is missing or rejected, the page does not
error. It shows a connect panel that names what is missing and what connecting
would produce, and it keeps its header and its tab strip. The planner, the own
post list, and the weekday chart render regardless, because they read data the
token would have produced, not the token itself.

Two token states read differently, and the my channel page
owns the detail:

- Never measured, or token unconfigured. The connect panel stands alone where the
  metrics would be. There are no stat tiles, no progress bar, no reach bars,
  because there is nothing measured to show.
- Measured before, token invalid now. The connect panel sits on top of the real
  historical numbers rather than hiding them. The tiles, progress, and reach bars
  still show the last measured figures, with the connection problem named above
  them.

The posts and metrics tabs follow the same rule:
they show past Graph measurements, never a live call, so an invalid token means
stale, not broken. Planning a post, scheduling it, and cooking it in the studio
need no Graph token at all.

## The transcript providers

Analysis needs a transcript of the video. If one is
already stored, analysis uses it and reaches for no provider. If none is stored,
analysis makes one on demand through a transcript provider, and
here the provider's reachability decides what the analyze gate offers:

- A provider is reachable. The gate offers a Transcribe and Analyze button that
  transcribes first and then analyzes, under one wait.
- No provider is reachable and no transcript is stored. The gate shows a dead end
  alert, "No transcript available yet", with no button, because a click could do
  nothing. Analysis that needs a transcript cannot run.

The keyless case is worth stating plainly, because it is the reason "no provider"
and "no network" are not the same thing. whisper.cpp is a local transcriber. When
it is installed, transcription works with no key and no network provider, so the
Transcribe and Analyze button appears and works even on a machine with no
Anthropic key set, since transcribing is keyless; only the analysis half that
follows needs the key. A Groq key is the alternative provider, network based and
keyed. So a machine with whisper.cpp installed is never at the dead end for lack
of a network transcript service, and a machine with neither whisper.cpp nor a
Groq key, and no stored transcript, is.

A video that already carries a stored transcript sidesteps this entirely: it
analyzes with no provider reachable at all, because the transcript it needs is
already on disk.

## The sidecar sync

The sidecar sync is the writer of the
videos the feed shows and the source of own
post measurement. It is owned by background jobs;
its degradation is summarized here only so the service map is complete. When the
sidecar is not running, no new videos arrive and the feed goes
stale rather than erroring. Every downstream action, save, remix, plan, schedule,
cook, still works on the videos already there. Unlike the other services here,
the sidecar has no in page failure surface of its own; a failed sync shows in the
shell failure strip, and its absence
shows only as a feed that stops gaining new posts.

## Variants

Not applicable in the four variant row form the feature documents use, because
this document does not act on a single record with a state, an attached datum, a
service, and a keyboard shortcut. The one variant axis that is this document's
subject, external service availability, is the whole document, and it is laid out
in the service map and the sections above rather than in a four row table. The
heading is kept so the set stays comparable.

## Cancel and interrupt

The seven interrupt rows are asked of every feature document. Here they are asked
of the general case, "an action that touches a service", since this document owns
no single action. Row four, a backing service failing mid action, is this
document's whole subject and is answered in full; the other rows point at the
feature that owns the interrupt, because a service does not change what cancel,
reload, or a second tab do.

| Event | The general answer for a service touching action |
| --- | --- |
| Explicit cancel or stop | A generation cannot be cancelled from the UI; its trigger is disabled until it settles. A cook run can be stopped; that is the cook run document, not a service failure. Nothing here adds a cancel of its own. |
| Navigate away mid action | Leaving during a generation abandons the client wait; the server attempt still writes its result and its run log row, so the run log stays complete. On return the record reflects whatever landed. The owning feature document narrates this per stage. |
| Reload or tab or window closed | The in flight attempt's row and result appear once it lands, because generation and measurement are server backed. A reload resumes from the database, not from the lost page. |
| A backing service fails mid action | The subject of this document. Generation that fails on the proxy or a missing key returns a failure, shows a toast, writes a failed run log row, and leaves the field it targeted at its previous value; repeated connection failures flip the remix generation stages to the block panel. Analysis that fails on a missing key or an unmakeable transcript returns a failure and writes no partial row. A Graph measurement that the token cannot reach shows the reason as a toast and leaves the connect panel in place. In every case nothing partial is written and nothing else in the loop is disturbed. |
| The target record changes underneath | A service failure does not change the record; a sync removing the source video does. Generation reads the session's stored inputs, not the live video, so a removal mid attempt does not corrupt it. See the owning feature document. |
| A background job finishes or fails on its own | Not a service failure. The one background run in the core loop is the cook run, whose completion is owned by background jobs. |
| A second tab or a double action on the same record | A double generation is prevented per stage by the disabled trigger. Two tabs generating at once both write run rows and the later write wins on the session field, whatever the services are doing. |

After a service failure the user stays where they are. The failed action wrote
nothing partial, the run log records the attempt when there is one, and every
feature that did not need the failed service is unaffected.

## Interactions with other systems

The seven cross-cutting concerns, in the fixed order, read against this
document's subject.

**Persistence and autosave.** A service failure writes nothing partial. A failed
generation still appends a remix run row so the attempt is
recorded, but it does not write a half result to the session. An on demand
transcript, once made, is persisted as its own row cache first, so a later
analyze or remix reuses it rather than transcribing again. See
[persistence](persistence.md).

**History and undo.** A service failure is not undoable, and there is nothing to
undo, because nothing committed. A successful generation that replaced a field is
not recoverable except from the run log's record that an attempt happened; that is
the owning feature's concern, not a service concern.

**Navigation and refresh.** The states a service failure produces are read on
page load, not pushed live. The remix studio infers proxy down from the run log
on render; the my channel page checks the Graph token on load; the analyze gate
picks its face from a server read of the four facts it needs. A service
recovering or failing after load does not repaint the open page until a
navigation or refresh. This is why the
proxy down inference can lag the real proxy in both directions.

**Background jobs and the sidecar.** The sidecar is one of the services this
document maps, degrading to a stale feed. Background jobs
owns it and the cook run; this document owns only the user visible degradation of
the four request time services. See [background jobs](background-jobs.md).

**External services.** This document owns them.

**Status and failures.** Each service failure has its own surface: the remix
block panel and run log for the proxy and the key, the connect panel for the
Graph token, the analyze gate alert for a missing transcript or key, and toasts
for a failed attempt in flight. The shell failure strip
carries failures that surface across navigation, including a failed sync. See
[status and failures](status-and-failures.md).

**Configuration and settings.** The Anthropic key and the Groq key are set in
Settings; whisper.cpp availability depends on a local install; the Graph token is
an environment credential. None of these is changed from within the core loop,
and the core loop names them only where a failure surfaces. The proxy is an
environment override, not a user setting.

## Edge cases

- The proxy down read is inferred from recent run history, not a live probe, so
  it can disagree with the real proxy for a moment in either direction: a proxy
  that just recovered still reads down until one attempt succeeds, and a proxy
  that just died still reads up until one attempt fails. See the technical note
  under the LLM proxy section.
- A hook chosen before the proxy went down keeps the remix Continue enabled from
  the session's stored choice, even though the whole stage is now the block panel
  and no cards are visible. The block is on generating, not on the value already
  stored.
- Transcription being keyless is what separates "no transcript service" from "no
  network". A machine with whisper.cpp installed can transcribe with no key and
  no network provider; the analysis step that follows still needs the Anthropic
  key, and a machine with a transcript but no key stops at the key alert, not the
  transcript dead end.
- The Graph token being invalid does not hide history. A channel measured before
  shows its last real numbers with the connect panel on top, because a live check
  failing now and figures measured earlier are different facts. Only a channel
  never measured shows the connect panel alone.
- A stored transcript makes analysis independent of every transcript provider. The
  provider only matters when there is nothing stored yet.
- The Anthropic key and the local proxy fail as two different states with two
  different fixes. Reading the block panel's reason is how the user tells a key to
  paste from a proxy to start.

## Seeds for ig-sync and llm

This document is the full technical reference for external services and stays
whole here. Two components read a slice of it as their own seed rather than
duplicating the map:

- The ig-sync component's own reference starts from the sidecar sync section
  above: the sidecar as a local service reached over localhost, its lookback and
  retry defaults, and the failure strip as its status surface.
- The llm component's own reference starts from the LLM proxy and Anthropic API
  key sections above: the proxy as a base URL override, the key as a separate
  credential, and the inferred "proxy down" read from the run log.
