# studio: feature description

## Summary

The studio is where one [planned post](../../shared/data-model.md) is turned into a rendered
video and published. It lives at `/mine/{postId}/studio`, one route per planned post, addressed
by the post's id. It is reached two ways: the remix finish stage offers an "Open the studio" link
after it creates the plan (see [remix](../remix/03-feature-description.md)), and the plan dialog
offers a "Create in Studio" button in edit mode, which is how a plan opened from the calendar
reaches here (see [mine](../mine/03-feature-description.md)). Either way the page opens on the
brief.

The page has three parts, described in turn below: the brief (a read only left pane describing
what is about to be cooked), the cook run (the Cook and Stop buttons, the run pill, and the
terminal), and publish (the Publish and Save to calendar controls). The cook run and publish
panes sit to the right of the brief.

The brief is a direct server read, like the feed and the video detail page. It renders the plan
and its source video or it renders nothing; there is no action to submit and nothing to fail. It
needs no external service: the [LLM proxy](../../shared/external-services.md) being down, the
Graph token being invalid, and the sidecar being off change nothing about the brief. Those states
matter only once the user cooks. An id that resolves to no plan is a 404, not an empty state.

## The brief

### The simple case

The user finishes a remix, or opens a plan from the calendar and clicks "Create in Studio". The
studio page loads. The left pane, headed "Brief", shows the plan's title, a chip for its video
kind, and a score badge carrying the source outlier's multiplier. Below that a "Script" line
names the attached script or says none is attached, with a link back to the source outlier.
Below that a "Visual direction" section lists the source video's shot by shot layout, one block
per beat, or says the frame pass has not run. To the right sit the cook and publish panes. The
user reads the brief, then clicks Cook to begin the cook run.

### The interaction, event by event

The studio page has no committing action of its own. Its interaction is arrive and read, then
hand off to the panel. Every durable write on this screen belongs to the cook run or publish.

```
stateDiagram-v2
    [*] --> loading : open /mine/{postId}/studio
    loading --> notFound : no plan for this id (404)
    loading --> brief : plan loaded
    brief --> brief : read the plan, script, and layout
    brief --> cookRun : click Cook
    brief --> [*] : navigate away (nothing to save)
```

#### Arrive

The page loads the brief in one server read keyed to the post id. The read composes three
things: the plan itself, the source video's detail when the plan carries a source video id, and
the remix session the plan came out of when it carries a remix session id. If the id matches no
plan the page is a 404. The route is forced dynamic, so every visit re-reads and the brief is
never a stale build time snapshot.

The left pane then shows, top to bottom:

- The word "Brief" and the plan's title.
- A chip row: the plan's video kind in a bordered chip when it has one, and a score badge
  reading the source outlier's multiplier (for example "3.2x score") when the plan has a source
  video. With no source video there is no badge.
- A "Script" block: the attached script's title, or "Untitled script" when the script has no
  title, or "No script attached." when nothing is attached. A "source outlier" link to
  `/feed/{sourceVideoId}` appears when the plan carries a source video id.
- A "Visual direction" block: one block per beat of the source video's layout, or the line
  "Frame pass not run." when there is no per beat layout.

Each beat block shows the beat's label, its window as M:SS to M:SS, and six labeled rows:
On-screen text, Animation, Demo cursor, Tool demo, Text position, Voice pace. A row whose reading
the pass could not determine shows a dash, which is distinct from a beat that was never analyzed
at all.

Technical note: the brief the user reads on screen shows the plan's own source video layout. The
brief the cooking agent reads is a separate markdown file, `brief.md`, written into the run's
workspace when a cook starts. That file carries more: the chosen hook and the chosen script
variant from the remix session, the persona, and the source video's transcript and beats. The
remix session's chosen hook is composed into the read but is not shown anywhere in the on screen
brief; only the cook's `brief.md` surfaces it. The two layouts agree in the normal finish flow
because they describe the same video, and can diverge only if a plan is hand edited to a
different source video than the remix used.

#### Leave without acting

Leaving the studio page records nothing. The brief is a read; there is no dirty state, no draft,
no autosave here. The plan, its script, and its remix session were all persisted by the features
that made them. Returning to the page rebuilds the same brief from the current data.

#### Begin acting

There is no acting on the brief. The one thing the user does on this page is click Cook, which
starts a cook run in the center panel. That click and everything after it belongs to the cook
run.

#### While acting

Nothing in the brief pane changes while a cook runs. The brief is static once loaded; the run
pills, elapsed clock, and terminal output all live in the panel. See "The cook run" below for
what moves while a cook is in flight.

#### Finish

The brief has nothing to commit. What finishes on this page is the cook, whose success captures
a render and unlocks Publish, both owned by the cook run and publish. The user lands next inside
the panel, or follows the "source outlier" link back to the video detail page (see
[feed](../feed/03-feature-description.md)).

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (planned post draft, scheduled, missed, or published) | No effect on the brief. The same title, script line, and layout render whatever the plan's state. State drives the panel's Publish and Save, not the brief. See "Publish and save to calendar" below. | The brief does not act, so state does not change here. A state change made elsewhere shows on the next re-read. |
| Attached data present or absent (script, source video, frame pass layout, remix session) | Decides most of what shows. A script gives its title, none gives "No script attached." A source video gives the score badge, the source outlier link, and the layout; none removes all three. A per beat layout gives the Visual direction blocks, none gives "Frame pass not run." A remix session feeds the cook's `brief.md` hook and variant but changes nothing the user sees on screen. | The brief is read once on load; attaching or detaching in another tab shows only after the page re-reads. |
| External service availability (LLM proxy, Graph, sidecar) | No effect. The brief is a database read that touches no external service. Those matter at Cook, not here. See [external services](../../shared/external-services.md). | No effect on the brief. |
| Keyboard shortcut in play | None. The brief pane has no arrow navigation, no Enter, no Escape. The "source outlier" link is a plain link. | None. |

### Cancel and interrupt

The brief has no action to cancel and nothing in flight. Every cell below reflects that the
committing actions on this screen belong to the cook run and publish; the interrupt behavior of
a running cook is theirs, not the brief's.

| Event | Before commit (reading the brief) | While in flight (a cook running) |
| --- | --- | --- |
| Explicit cancel or stop | Nothing to cancel. The brief writes nothing. Stop ends a cook and belongs to the cook run. | Stop targets the cook run, not the brief. |
| Navigate away mid action | Leaving records nothing; the plan is durable and rebuilds on return. | Leaving abandons the terminal view. The run keeps running server side; the panel reflects it on return. |
| Reload or tab or window closed | Nothing lost. The forced dynamic route re-reads the brief on the next load. | The brief re-reads unchanged; whether the panel reattaches to the run is owned by the cook run. |
| A backing service fails mid action | The brief read uses no external service, so it cannot fail on one. A database read that finds no plan is a 404, not an error state. | A failed cook is a cook run failure, surfaced in the panel. See [external services](../../shared/external-services.md). |
| The target record changes underneath | The brief is stale until it re-reads. A source video removed by a sync makes the video null on the next read, dropping the score badge, the source outlier link, and the layout while the plan keeps its now null link. A script detached elsewhere reads as "No script attached." A plan edited in another tab shows the old copy until re-read. | Same staleness. A record change does not disturb a running cook's terminal; the panel repaints its own run pill. See [the data model](../../shared/data-model.md). |
| A background job finishes or fails on its own | No effect on the brief. A cook completing while the user reads the brief updates the panel, not the brief pane. | Owned by the cook run: the run pill and Output pane react to the run's own status. |
| A second tab or a double action on the same record | Two studio tabs on one plan both show the same brief; a read has no conflict. | Two cooks on one plan is a cook run concern. |

After an interrupt on this page the user stays where they are with an unchanged plan. The brief
holds nothing that a reload could lose.

### Interactions with other systems

**Persistence and autosave.** The brief writes nothing. The plan, its script, and its remix
session were persisted by the plan dialog and the remix before the studio was ever opened (see
[mine](../mine/03-feature-description.md) and [remix](../remix/03-feature-description.md)). The
one write tied to this page is the cook's `brief.md`, written into the run workspace when a cook
starts, described from the cook's side below. See [persistence](../../shared/persistence.md).

**History and undo.** Nothing to undo. The brief is a read. Undo for the plan and its script
lives in the features that create them.

**Navigation and refresh.** The route is forced dynamic and re-reads on every visit, so the brief
always reflects the current plan. The "source outlier" link points at `/feed/{sourceVideoId}`.
The page is reached by deep link from the remix finish stage and the plan dialog. See
[navigation and shell](../../shared/navigation-and-shell.md).

**Background jobs and the sidecar.** The sidecar sync can remove the source video underneath the
page, which drops the score badge, the source outlier link, and the layout on the next read. The
cook run is the background job this page launches, described below. See
[background jobs](../../shared/background-jobs.md).

**External services.** The brief itself reaches none. Generation, the Graph API, and the
transcript providers matter to the cook and to publish, not to displaying the brief. A frame
pass, which would fill the Visual direction section, needs a language model with image input
that is not wired up in this build, so the section reports "Frame pass not run" for current
data. See [external services](../../shared/external-services.md).

**Status and failures.** The only failure the brief itself can show is a 404 when the post id
resolves to no plan. There are no toasts on the brief; failures belong to the cook run and
publish panels. See [status and failures](../../shared/status-and-failures.md).

**Configuration and settings.** No setting gates the brief. The `WORKSPACE_ROOT` config decides
where the cook's `brief.md` and the render land, which is a cook run concern.

### Edge cases

- No frame pass is wired up in this build, and nothing constructs a per beat layout, so the
  Visual direction section shows "Frame pass not run." for essentially all real plans. The per
  beat blocks are what the section will show once a frame pass exists.
- A layout row written before the layout became per beat (the old flat shape) is treated as no
  layout: the section reports "Frame pass not run." rather than pinning a whole video reading
  onto beats it never described.
- The on screen brief never shows the remix's chosen hook, even though the page reads it. The
  hook reaches only the cook's `brief.md`. A user reading the screen sees the title, the script
  line, and the layout, but not the hook the remix settled on.
- A plan with no source video shows just the title, the video kind chip if any, and the script
  line. No score badge, no source outlier link, and no layout.
- The score badge shows even when the source video has no computed outlier score; a null score
  renders as a dash followed by "score" rather than hiding the badge.
- A plan can outlive its script, its remix session, and its source video (see
  [the data model](../../shared/data-model.md)). The brief renders whatever survives: a detached
  script reads as "No script attached.", a removed source video drops its badge, link, and
  layout, and the page still loads on the plan alone.

## The cook run

A cook run is how a planned post becomes a rendered video. On the studio page the user clicks
Cook, a run starts, and the studio shows it working: a status pill, a running clock, and a
terminal that streams the session's output. This section covers the Cook button, the run pill
and what each status means to the user, the elapsed clock, what the terminal shows, and the Stop
button that ends a run. It does not cover Publish, which is a separate control on the same panel
with its own gate; see "Publish and save to calendar" below. The run's status meanings are owned
by [background jobs](../../shared/background-jobs.md); this section links to that rather than
redefining it.

A cook run is a background run: the user starts it and then watches it, rather than a request
that returns. Its status lives in the database, so it keeps going server side whether or not the
user stays on the page. The run needs the local terminal session and its rendering pipeline to be
alive; it does not depend on the LLM proxy, the Graph token, or the sidecar, so a cook can run in
every restricted state those cause.

Technical note: the studio panel never starts a run itself. Clicking Cook types a slash command
into the terminal session; the terminal layer spawns the cook process and claims the run row
server side, then reports its id and status back to the panel. The panel renders what it is
told. The websocket, the pseudo terminal, and the frames that carry status back are terminal
internals and out of scope here. This section stops at what the user sees.

### The simple case

The user opens the studio page for a planned post. The center pane is a terminal labeled Claude
Code, and to its right is an Output panel that reads "Run Cook to start the session." The user
clicks Cook. The terminal begins printing the session's output as the cook works. A pill appears
next to the button reading "cooking" with a pulsing dot, and a clock beside it counts up from
0:00. The button itself changes to Stop.

The user can watch or leave. When the cook finishes, the pill turns to "done", the clock stops,
and the rendered video appears in the Output panel where the user can play it. From there
Publish and Save to calendar become available; those belong to "Publish and save to calendar"
below.

If something goes wrong the pill reads "failed" instead, and no render appears. If the user
clicks Stop while it is working, the pill reads "canceled" and the run ends.

### The interaction, event by event

```
stateDiagram-v2
    [*] --> idle
    idle --> cooking : click Cook (types the cook command)
    cooking --> waiting : run reports waiting
    waiting --> cooking : run reports running
    cooking --> done : success (render appears)
    waiting --> done : success (render appears)
    cooking --> failed : run reports failed
    waiting --> failed : run reports failed
    cooking --> canceled : click Stop
    waiting --> canceled : click Stop
    done --> cooking : click Retry cook
    failed --> cooking : click Retry cook
    canceled --> cooking : click Retry cook
```

#### Arrive

The studio page loads server rendered. The terminal pane opens and connects its session; the
Output panel shows "Run Cook to start the session." There is no run yet, so there is no pill and
no clock. The button reads Cook.

One thing loads in the background on arrival that belongs to publish: the panel asks the server
whether the post's latest run already produced a render, so Publish can be enabled across a
reload. That gate is publish's subject, described below. The Cook control and the run status do
not read from it; they are driven only by the live session.

The header also shows "frame pass not run" when the post has no frame pass yet. That is a note
about a separate readiness check, not part of the cook run itself.

#### Leave without acting

Leaving the studio page before clicking Cook records nothing. No run exists, so there is nothing
to abandon. Coming back shows the same starting state.

#### Begin acting

Clicking Cook is the start. The button types the cook command into the live terminal session and
marks the session started. Nothing about a run is shown yet; the pill and clock appear only once
the session reports back that a run has spawned. Between the click and the first status, the
Output panel reads "Cooking. The render appears here when it finishes."

The moment the first run status arrives, the clock's zero point is set and the pill appears. From
here the button reads Stop for as long as the run is live.

#### While acting

While the run is live the panel shows three things that update:

- The pill, which repaints as the status changes. "cooking" while the process is working,
  "waiting on you" when the run is waiting between phases or on input. Both carry a pulsing dot.
- The clock, which counts up once per second while the status is running or waiting, in minutes
  and seconds.
- The terminal, which streams the session's output line by line as the cook produces it. This is
  the raw output of the session, the same text a person would see in that terminal. What it
  contains is up to the cook, not this panel.

A "view run" link sits next to the pill, pointing at the run's own page outside the core loop.

Technical note: the clock counts from the moment the panel first saw the run, measured on the
user's machine, not from the run's recorded server start time. The two are close but not
identical. The clock stops ticking as soon as the status is anything other than running or
waiting, so a finished, failed, or canceled run freezes its final elapsed time.

#### Finish

A run finishes in one of three ways, and the pill is how the user tells them apart:

- Success. The pill reads "done", the clock stops, and the rendered video appears in the Output
  panel. The render is what makes the post publishable. See "Publish and save to calendar" below.
- Failed. The pill reads "failed" and the clock stops. No render appears; the Output panel keeps
  its "Cooking" placeholder. The terminal output is where the reason, if any, was printed.
- Canceled. The user clicked Stop. The pill reads "canceled" and the clock stops. Whatever the
  cook had produced up to that point is what is left; a canceled run does not produce a
  publishable render.

After any ending the button reads "Retry cook". Clicking it types the cook command again and
begins a fresh run in the same session.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (the run's status) | On arrival there is no live run, so the button reads Cook and no pill shows, even if a past run for this post succeeded. Publish may already be enabled from that past render, but the cook controls start clean. | The status drives everything: running and waiting show Stop and a ticking clock; success, failed, and canceled show "Retry cook" and a frozen clock. An unrecognized status is shown with the canceled pill. |
| Attached data present or absent (render captured) | A render captured in an earlier live session is not remembered across a page load, so on arrival the Output panel is empty regardless. | When a live run reports its render, the video appears in the Output panel and the cook is finished. |
| External service availability (LLM proxy, Graph, sidecar) | No effect on starting a cook. The cook needs the local session and its rendering pipeline, not the proxy, the Graph token, or the sidecar. | No effect on the run controls. A cook that internally calls out to a service handles that inside its own output; the pill only reflects the run's reported status. |
| Keyboard shortcut in play | None. Cook, Stop, and Retry cook are click only. | Typing goes to the terminal, which forwards keystrokes to the live session. There is no keyboard shortcut on the Cook or Stop buttons. |

### Cancel and interrupt

| Event | Before commit (no run started) | While in flight (run live) |
| --- | --- | --- |
| Explicit cancel or stop | There is nothing to stop before Cook is clicked. | Stop ends the run. It signals the running process and marks the run canceled whether or not a live process was found to kill, so a run whose process already exited on its own still reads canceled rather than staying running. See [background jobs](../../shared/background-jobs.md). The button reads "Stopping..." until the action settles, then the pill turns to "canceled". |
| Navigate away mid action | Nothing has started; leaving records nothing. | The run keeps going server side because its status is stored, not held in the page. Leaving the studio does not stop the cook. Returning to the page does not re-show the live pill or clock, because those are driven by the session the page just reconnected to, not reloaded from the run row; the button reads Cook again. Publish still reflects the render once the run finishes, since that is read from the server. |
| Reload or tab or window closed | Nothing to lose. | Same as navigating away: the run continues server side. After a reload the panel has lost the live run state, so it shows no pill, no clock, and the button reads Cook, even while the cook is still working. The run itself is unaffected; only the page's view of it is reset. |
| A backing service fails mid action | Starting a cook does not depend on the proxy, the Graph token, or the sidecar, so their being down does not block Cook. | The run controls only reflect what the session reports. If the cook's own work hits a failing service, that surfaces as failed output and, if the run ends without a render, a "failed" pill. The panel does not distinguish which service failed. |
| The target record changes underneath | The panel reads its Publish gate from the latest run for this post; a run finishing elsewhere can change that between load and interaction. The cook controls themselves start from the live session, not the row. | The pill follows the status the session reports. If Stop is clicked, only a run whose id still matches the one on screen is flipped to canceled locally; a status for a different run is ignored. |
| A background job finishes or fails on its own | If a past run for this post finished, its render already gates Publish on arrival. It does not put a pill on the cook controls. | A run finishing on its own moves the pill to "done" or "failed" and stops the clock without any user action. The render, if any, appears in the Output panel. See [background jobs](../../shared/background-jobs.md). |
| A second tab or a double action on the same record | Two studio tabs on the same post each start from a clean cook control. Neither knows about the other's live run; each drives its own session. | Clicking Cook again is not possible while a run is live, because the button is Stop. Clicking Stop twice is guarded by the disabled "Stopping..." state. Starting a second cook from a second tab is possible; each tab tracks the run its own session reported. |

After any interrupt the user stays on the studio page. The run's true state lives in the
database, so a render that finished is not lost even when the page's live view of the run is
gone.

### Interactions with other systems

**Persistence and autosave.** The run row and its final status are durable and owned by
[background jobs](../../shared/background-jobs.md). The pill, the clock, and the captured render
on this panel are live view state only; they are not persisted and reset on a reload. The one
thing that survives a reload is the Publish gate, read fresh from the server, described below.

**History and undo.** A cook run cannot be undone. It can be stopped while live, which ends it as
canceled. A finished run stays as it ended; Retry cook starts a new run rather than reversing the
old one.

**Navigation and refresh.** The cook controls do not use `router.refresh`; they repaint from the
live session as statuses arrive. Leaving and returning reconnects the session rather than
restoring the previous run's pill. See
[navigation and shell](../../shared/navigation-and-shell.md) for the shell's refresh model.

**Background jobs and the sidecar.** The cook run is a background job;
[background jobs](../../shared/background-jobs.md) owns its lifecycle and its five statuses. The
sidecar sync is unrelated to a cook and is not needed for one.

**External services.** Starting, watching, and stopping a cook need none of the LLM proxy, the
Graph API, or the transcript providers. A cook may call out to services inside its own work, but
that is invisible to the run controls, which only show the reported status. See
[external services](../../shared/external-services.md).

**Status and failures.** The pill is the run's status surface on this panel: "cooking", "waiting
on you", "done", "failed", "canceled". A failed run also surfaces in the shell's failure strip.
See [status and failures](../../shared/status-and-failures.md).

**Configuration and settings.** No user setting changes how the cook controls behave. The run's
own tunables are environment defaults owned by [background jobs](../../shared/background-jobs.md).

### Edge cases

- After a reload while a cook is still running, the panel shows the Cook button and no pill, as
  if no run were live. The run is unaffected and finishes server side; only the page's view of it
  was reset. The render still gates Publish once the run finishes.
- The clock is measured from when the panel first saw the run, on the user's machine, not from
  the run's server start. A run watched from the start reads close to true elapsed time; one
  joined late does not, and after a reload there is no clock at all.
- An unrecognized run status falls back to the "canceled" pill rather than showing nothing, so a
  status the panel does not know still renders as a neutral, ended-looking pill.
- Stop marks the run canceled even when no live process was found to kill, so a run whose process
  already exited cannot get stuck reading "cooking" forever once the user stops it.
- The button reads "Cook" only before the first run of a page visit; after any run it reads
  "Retry cook", because the session is already started even if the run ended.
- The terminal shows the session's raw output. What appears there is the cook's own text, not
  something this panel formats; the panel only relays it.

## Publish and save to calendar

Publishing is the last step of the core loop: a cooked post has produced a render, and the user
marks it done. It lives on the right hand output rail of the studio panel, below the render
preview, as two buttons. Publish hands a `/ksa:serve` command to the running Claude Code session
after a confirm; Save to calendar marks the [planned post](../../shared/data-model.md) done in
the app's own database. Neither button starts a network publish from the app's data; the schema
is explicit that nothing in the planned posts table reaches any network call, and the only
marking is by hand.

Publish is gated. It is enabled only when the post's latest create run has a stored render asset,
which the panel reads once on mount so the gate survives a reload. Until a cook run succeeds and
produces a render, Publish stays disabled. Save to calendar has a stricter gate: it needs a
render captured in the current session, so a reload disables it even while Publish stays on.

Both buttons are database or in-session actions, so they do not depend on the LLM proxy, the
Graph token, or the sidecar being up. What the injected `/ksa:serve` does inside the session (it
uses the official Graph API) is the agent run's concern and out of scope here; this section
describes the buttons, not the serve.

### The simple case

The user has cooked a post in the studio. A run finished and its render is playing in the output
rail. Publish is enabled. The user clicks Publish, a browser confirm asks "Publish this render to
Instagram?", the user accepts, and `/ksa:serve` is typed into the session for the agent to run.
Nothing else on the panel changes.

To record the post as handled without touching Instagram, the user clicks Save to calendar. The
button briefly disables, then reads "Saved to calendar" and stays that way.

### The interaction, event by event

```
stateDiagram-v2
    [*] --> gateClosed : no stored render on the latest run
    [*] --> gateOpen : latest run already carries a render (read on mount)
    gateClosed --> gateOpen : a cook run finishes with a render this session
    gateOpen --> confirming : click Publish
    confirming --> gateOpen : dismiss the confirm
    confirming --> served : accept (inject /ksa:serve into the session)
    served --> gateOpen : command handed off, button unchanged
    gateOpen --> savedToCalendar : click Save to calendar (needs a live render)
```

#### Arrive

When the panel mounts it asks the server whether this post is publishable, reading the render
asset id off the post's latest create run. If one exists, Publish is enabled; if the post has no
run yet, or its latest run has no render (still running, or it never finished), Publish stays
disabled. This read runs once, keyed to the post. Save to calendar is enabled only when a render
was captured live in this session, which a fresh mount has not done, so it starts disabled until
a run finishes here. Nothing is focused or prefilled; these are buttons, not a form.

#### Leave without acting

Leaving the studio page records nothing. No confirm, no write. The publish gate is recomputed
from the database on the next visit.

#### Begin acting

Publish begins with the click that opens the native confirm. Save to calendar begins with its
click, which fires the mark-published write immediately with no confirm.

#### While acting

Publish has almost no in-flight window from the app's side: accepting the confirm injects
`/ksa:serve` into the session as one line and returns. The button does not disable, show a
spinner, or wait for the serve to finish; whatever the serve does surfaces in the terminal pane,
not here. Save to calendar runs inside a React transition, so it disables while the write is in
flight.

#### Finish

Publish commits nothing in the app. The command is handed to the session and the button looks
exactly as before. Save to calendar commits a write to the planned post row: on success the
button switches to "Saved to calendar" and stays disabled for the rest of the visit; on failure a
red line appears under it with the reason and the button re-enables. The page is not refreshed
either way.

Technical note: Save to calendar marks the plan published by calling the mark-published action
with a null own post id, "it went out and I am not linking it." But the plan's published
condition is derived only from a non-null own post link, so passing null leaves the row
indistinguishable from a plan that was never published. The only durable effect of Save to
calendar is bumping the row's updated timestamp; the "Saved to calendar" label is client state
that a reload discards. See "Edge cases" below.

### Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (the create run behind the post) | Publish is enabled only if the latest run is a [success carrying a render](../../shared/background-jobs.md). A run that is running, waiting, failed, or canceled with no render leaves it disabled. | A run that finishes with a render this session enables both buttons through the live capture. The mount-time gate does not re-fetch, so it never disables Publish once opened. |
| Attached data present or absent (script, render asset) | The gate depends only on the render asset on the latest run, not on whether the plan carries a script. Save to calendar depends only on a live render. | Capturing a render mid session flips both buttons on. Whether the plan has a script never changes either. |
| External service availability (LLM proxy, Graph, sidecar) | None of them affect either button's enabled state; the gate is a database read. | Publish's `/ksa:serve` uses the Graph API inside the session; a bad token fails there, in the terminal, not on the button. Save to calendar needs no service. |
| Keyboard shortcut in play | None on the buttons themselves. | The Publish confirm is a native browser dialog: Enter accepts, Escape dismisses. No other key is honored. |

### Cancel and interrupt

| Event | Before commit | While in flight |
| --- | --- | --- |
| Explicit cancel or stop | Dismissing the Publish confirm aborts it; nothing is injected. Save to calendar has no confirm and no cancel. | Publish has no app-side in-flight step to cancel. Save to calendar's transition cannot be interrupted; the write runs to completion. A `/ksa:serve` already handed off is stopped only through the run's Stop button, not here. |
| Navigate away mid action | Leaving abandons an open confirm; nothing publishes. | A Save to calendar write may still land, but the "Saved to calendar" label does not show on return because it is client state and the page is not refreshed. |
| Reload or tab or window closed | An open confirm is lost; nothing publishes. | On reload Publish re-gates from the database and stays enabled if the render is stored. Save to calendar resets to disabled (no live render after a reload) and its "Saved" label is gone even if the write landed. |
| A backing service fails mid action | Neither button calls an external service to become enabled. | A `/ksa:serve` that fails (bad Graph token, proxy down) fails inside the terminal, not on the button. A Save to calendar database error shows as a red line under the button. |
| The target record changes underneath | If the plan was deleted in another tab, Save to calendar returns "That planned post no longer exists" as a red line. The publish gate is read once on mount and is not re-read, so Publish can stay enabled off a stale render even if the latest run has since changed. | Same. The mark-published write validates the plan still exists and fails cleanly if not. |
| A background job finishes or fails on its own | A cook run finishing with a render while the user is on the panel enables Save to calendar (through the live capture) and keeps Publish enabled. A run failing does not disable Publish if an earlier render is already stored. | Same; the buttons only ever gain capability from a run finishing, never lose it mid action. |
| A second tab or a double action on the same record | Two tabs each gate independently off the same stored render. | Publish does not disable, so a double click opens the confirm twice and can inject `/ksa:serve` twice into the session. Save to calendar disables after the first click (pending, then saved), so a double submit is blocked. |

### Interactions with other systems

**Persistence and autosave.** Nothing here autosaves. Publish writes no app record at all. Save
to calendar writes the planned post's updated timestamp (and sets the own post link to null,
that is, unchanged). The publish gate itself is durable because it reads the render asset id
stored on the create run, not the ephemeral live capture. See
[persistence](../../shared/persistence.md).

**History and undo.** Neither action is undoable from the app. Save to calendar has no undo and
there is no un-publish button; a plan is un-marked only by editing the row directly, which this
panel does not offer.

**Navigation and refresh.** Neither button calls `router.refresh`. Save to calendar's result is
client state only; the calendar (see [mine](../mine/03-feature-description.md)) is not re-read,
so a plan marked here does not repaint there until that page loads fresh. A reload of the studio
re-reads only the publish gate.

**Background jobs and the sidecar.** The render that opens the gate comes from the cook run; see
[background jobs](../../shared/background-jobs.md) for how a render is captured and stored.
Publish hands `/ksa:serve` to that same session.

**External services.** The buttons touch none. `/ksa:serve` uses the official Graph API from
inside the agent session, which is out of scope; the app's planned posts table has no code path
to any network call. See [external services](../../shared/external-services.md).

**Status and failures.** A Save to calendar failure shows as a red line under the button, not a
toast. Publish gives no app-side success or failure signal; the outcome of the serve is only
visible in the terminal pane. See [status and failures](../../shared/status-and-failures.md).

**Configuration and settings.** None. No setting changes either button.

### Edge cases

- After a reload Publish can be enabled while Save to calendar is disabled. The gate reads the
  render stored on the latest run, which survives the reload; Save to calendar keys off the live
  in-session capture, which a reload throws away.
- Save to calendar does not produce a published state anyone can see. It marks the plan with a
  null own post link, and the plan's published condition is derived only from a non-null link, so
  the row still reads as draft, scheduled, or missed. The visible effect is the button's own
  "Saved to calendar" label, which a reload discards. This looks like a gap; see the component
  backlog.
- Publish never disables itself, so a fast double click injects `/ksa:serve` twice.
- The confirm says "Publish this render to Instagram?" but the app itself publishes nothing; the
  serve command inside the session is what would reach Instagram.
- The "frame pass not run" note that can appear in the panel header is about the frame pass, not
  the publish gate; Publish does not depend on it.
