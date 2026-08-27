# Driving a cook run

## Summary

A cook run is how a [planned post](../glossary.md) becomes a rendered video. On the [studio page](studio-overview.md) the user clicks Cook, a run starts, and the studio shows it working: a status pill, a running clock, and a terminal that streams the session's output. This document owns that drive from the user's side. It covers the Cook button, the [run pill](../glossary.md) and what each status means to the user, the elapsed clock, what the terminal shows, and the Stop button that ends a run. It does not cover Publish, which is a separate control on the same panel with its own gate; see [publish](publish.md). The run's status meanings are owned by [background jobs](../foundations/background-jobs.md); this document links to them rather than redefining them.

A cook run is a [background run](../foundations/interaction-model.md#background-runs): the user starts it and then watches it, rather than a request that returns. Its status lives in the database, so it keeps going server side whether or not the user stays on the page. The run needs the local terminal session and its rendering pipeline to be alive; it does not depend on the LLM proxy, the Graph token, or the sidecar, so a cook can run in every restricted state those cause.

> Technical note: the studio panel never starts a run itself. Clicking Cook types a slash command into the terminal session; the terminal layer spawns the cook process and claims the run row server side, then reports its id and status back to the panel. The panel renders what it is told. The websocket, the pseudo terminal, and the frames that carry status back are terminal internals and out of scope here. This document stops at what the user sees.

## The simple case

The user opens the studio page for a planned post. The center pane is a terminal labeled Claude Code, and to its right is an Output panel that reads "Run Cook to start the session." The user clicks Cook. The terminal begins printing the session's output as the cook works. A pill appears next to the button reading "cooking" with a pulsing dot, and a clock beside it counts up from 0:00. The button itself changes to Stop.

The user can watch or leave. When the cook finishes, the pill turns to "done", the clock stops, and the rendered video appears in the Output panel where the user can play it. From there Publish and Save to calendar become available; those belong to [publish](publish.md).

If something goes wrong the pill reads "failed" instead, and no render appears. If the user clicks Stop while it is working, the pill reads "canceled" and the run ends.

## The interaction, event by event

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

### Arrive

The studio page loads server rendered. The terminal pane opens and connects its session; the Output panel shows "Run Cook to start the session." There is no run yet, so there is no pill and no clock. The button reads Cook.

One thing loads in the background on arrival that this document does not own: the panel asks the server whether the post's latest run already produced a render, so Publish can be enabled across a reload. That gate is [publish](publish.md)'s subject. The Cook control and the run status do not read from it; they are driven only by the live session.

The header also shows "frame pass not run" when the post has no frame pass yet. That is a note about a separate readiness check, not part of the cook run itself.

### Leave without acting

Leaving the studio page before clicking Cook records nothing. No run exists, so there is nothing to abandon. Coming back shows the same starting state.

### Begin acting

Clicking Cook is the start. The button types the cook command into the live terminal session and marks the session started. Nothing about a run is shown yet; the pill and clock appear only once the session reports back that a run has spawned. Between the click and the first status, the Output panel reads "Cooking. The render appears here when it finishes."

The moment the first run status arrives, the clock's zero point is set and the pill appears. From here the button reads Stop for as long as the run is live.

### While acting

While the run is live the panel shows three things that update:

- The pill, which repaints as the status changes. "cooking" while the process is working, "waiting on you" when the run is waiting between phases or on input. Both carry a pulsing dot.
- The clock, which counts up once per second while the status is running or waiting, in minutes and seconds.
- The terminal, which streams the session's output line by line as the cook produces it. This is the raw output of the session, the same text a person would see in that terminal. What it contains is up to the cook, not this panel.

A "view run" link sits next to the pill, pointing at the run's own page outside the core loop.

> Technical note: the clock counts from the moment the panel first saw the run, measured on the user's machine, not from the run's recorded server start time. The two are close but not identical. The clock stops ticking as soon as the status is anything other than running or waiting, so a finished, failed, or canceled run freezes its final elapsed time.

### Finish

A run finishes in one of three ways, and the pill is how the user tells them apart:

- Success. The pill reads "done", the clock stops, and the rendered video appears in the Output panel. The render is what makes the post publishable. See [publish](publish.md).
- Failed. The pill reads "failed" and the clock stops. No render appears; the Output panel keeps its "Cooking" placeholder. The terminal output is where the reason, if any, was printed.
- Canceled. The user clicked Stop. The pill reads "canceled" and the clock stops. Whatever the cook had produced up to that point is what is left; a canceled run does not produce a publishable render.

After any ending the button reads "Retry cook". Clicking it types the cook command again and begins a fresh run in the same session.

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (the run's status) | On arrival there is no live run, so the button reads Cook and no pill shows, even if a past run for this post succeeded. Publish may already be enabled from that past render, but the cook controls start clean. | The status drives everything: running and waiting show Stop and a ticking clock; success, failed, and canceled show "Retry cook" and a frozen clock. An unrecognized status is shown with the canceled pill. |
| Attached data present or absent (render captured) | A render captured in an earlier live session is not remembered across a page load, so on arrival the Output panel is empty regardless. | When a live run reports its render, the video appears in the Output panel and the cook is finished. |
| External service availability (LLM proxy, Graph, sidecar) | No effect on starting a cook. The cook needs the local session and its rendering pipeline, not the proxy, the Graph token, or the sidecar. | No effect on the run controls. A cook that internally calls out to a service handles that inside its own output; the pill only reflects the run's reported status. |
| Keyboard shortcut in play | None. Cook, Stop, and Retry cook are click only. | Typing goes to the terminal, which forwards keystrokes to the live session. There is no keyboard shortcut on the Cook or Stop buttons. |

## Cancel and interrupt

| Event | Before commit (no run started) | While in flight (run live) |
| --- | --- | --- |
| Explicit cancel or stop | There is nothing to stop before Cook is clicked. | Stop ends the run. It signals the running process and marks the run canceled whether or not a live process was found to kill, so a run whose process already exited on its own still reads canceled rather than staying running. See [background jobs](../foundations/background-jobs.md). The button reads "Stopping…" until the action settles, then the pill turns to "canceled". |
| Navigate away mid action | Nothing has started; leaving records nothing. | The run keeps going server side because its status is stored, not held in the page. Leaving the studio does not stop the cook. Returning to the page does not re-show the live pill or clock, because those are driven by the session the page just reconnected to, not reloaded from the run row; the button reads Cook again. Publish still reflects the render once the run finishes, since that is read from the server. |
| Reload or tab or window closed | Nothing to lose. | Same as navigating away: the run continues server side. After a reload the panel has lost the live run state, so it shows no pill, no clock, and the button reads Cook, even while the cook is still working. The run itself is unaffected; only the page's view of it is reset. |
| A backing service fails mid action | Starting a cook does not depend on the proxy, the Graph token, or the sidecar, so their being down does not block Cook. | The run controls only reflect what the session reports. If the cook's own work hits a failing service, that surfaces as failed output and, if the run ends without a render, a "failed" pill. The panel does not distinguish which service failed. |
| The target record changes underneath | The panel reads its Publish gate from the latest run for this post; a run finishing elsewhere can change that between load and interaction. The cook controls themselves start from the live session, not the row. | The pill follows the status the session reports. If Stop is clicked, only a run whose id still matches the one on screen is flipped to canceled locally; a status for a different run is ignored. |
| A background job finishes or fails on its own | If a past run for this post finished, its render already gates Publish on arrival. It does not put a pill on the cook controls. | A run finishing on its own moves the pill to "done" or "failed" and stops the clock without any user action. The render, if any, appears in the Output panel. See [background jobs](../foundations/background-jobs.md). |
| A second tab or a double action on the same record | Two studio tabs on the same post each start from a clean cook control. Neither knows about the other's live run; each drives its own session. | Clicking Cook again is not possible while a run is live, because the button is Stop. Clicking Stop twice is guarded by the disabled "Stopping…" state. Starting a second cook from a second tab is possible; each tab tracks the run its own session reported. |

After any interrupt the user stays on the studio page. The run's true state lives in the database, so a render that finished is not lost even when the page's live view of the run is gone.

## Interactions with other systems

**Persistence and autosave.** The run row and its final status are durable and owned by [background jobs](../foundations/background-jobs.md). The pill, the clock, and the captured render on this panel are live view state only; they are not persisted and reset on a reload. The one thing that survives a reload is the Publish gate, read fresh from the server, which is [publish](publish.md)'s subject.

**History and undo.** A cook run cannot be undone. It can be stopped while live, which ends it as canceled. A finished run stays as it ended; Retry cook starts a new run rather than reversing the old one.

**Navigation and refresh.** The cook controls do not use `router.refresh`; they repaint from the live session as statuses arrive. Leaving and returning reconnects the session rather than restoring the previous run's pill. See [navigation and shell](../foundations/navigation-and-shell.md) for the shell's refresh model.

**Background jobs and the sidecar.** The cook run is a background job; [background jobs](../foundations/background-jobs.md) owns its lifecycle and its five statuses. The sidecar sync is unrelated to a cook and is not needed for one.

**External services.** Starting, watching, and stopping a cook need none of the LLM proxy, the Graph API, or the transcript providers. A cook may call out to services inside its own work, but that is invisible to the run controls, which only show the reported status. See [external services](../cross-cutting/external-services.md).

**Status and failures.** The pill is the run's status surface on this panel: "cooking", "waiting on you", "done", "failed", "canceled". A failed run also surfaces in the shell's failure strip. See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** No user setting changes how the cook controls behave. The run's own tunables are environment defaults owned by [background jobs](../foundations/background-jobs.md).

## Edge cases

- After a reload while a cook is still running, the panel shows the Cook button and no pill, as if no run were live. The run is unaffected and finishes server side; only the page's view of it was reset. The render still gates Publish once the run finishes.
- The clock is measured from when the panel first saw the run, on the user's machine, not from the run's server start. A run watched from the start reads close to true elapsed time; one joined late does not, and after a reload there is no clock at all.
- An unrecognized run status falls back to the "canceled" pill rather than showing nothing, so a status the panel does not know still renders as a neutral, ended-looking pill.
- Stop marks the run canceled even when no live process was found to kill, so a run whose process already exited cannot get stuck reading "cooking" forever once the user stops it.
- The button reads "Cook" only before the first run of a page visit; after any run it reads "Retry cook", because the session is already started even if the run ended.
- The terminal shows the session's raw output. What appears there is the cook's own text, not something this panel formats; the panel only relays it.

## Open questions and verification

- Whether reconnecting the session on a return to the studio page ever re-emits a live run's status (re-showing the pill and clock) was read as not happening at this commit, on the note that reattaching to an in-progress run is deferred to a later task. This needs a live check with a long running cook and a reload.
- The exact boundary of the "waiting on you" status, whether it means waiting on user input, a phase boundary, or a stalled heartbeat, is inferred from the label and the status list and is deferred to [background jobs](../foundations/background-jobs.md); it needs confirming against a real cook.
- Whether Stop reliably lands and repaints the pill to "canceled" when clicked in the instant before the first status arrives (while the button may still read Cook rather than Stop) was read from the code but not confirmed by hand.
- Whether a second cook started from a second tab on the same post produces two independent run rows, or contends on one session, was read from the per-post session wiring but not confirmed by hand.

Verified against this repo commit `4f26fb9`.
