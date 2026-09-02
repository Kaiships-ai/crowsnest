# Background jobs and the sidecar

## Summary

Two kinds of work in the core loop happen outside a single request: the sidecar sync that fills the feed with videos, and the cook run that turns a planned post into a rendered video. This document owns the user visible model of both, and the meaning of the create run statuses that the studio shows. The internals (the Python sidecar process, the pseudo terminal, the websocket frames) are out of scope; what is here is what the user can observe and depend on.

## The sidecar sync

Videos appear in the feed because a sync ran, not because the user asked for one per video. The sidecar is a local service the app talks to over localhost to fetch posts from tracked channels and write videos. A sync run reads a window of recent posts per channel and records how many it saw and how many it created.

What the user can depend on:

- The feed reflects the last sync, not the live state of the source platform. When the sidecar is not running, no new videos arrive and the feed goes stale rather than erroring. Every downstream action (save, remix, plan, cook) still works on the videos already there.
- A sync can remove a video that is gone from the source. That removal cascades: the video's saved post is deleted with it, and any planned post that pointed at it keeps the plan but loses the link.
- A sync does not block the user. It runs in the background; the failure strip in the shell is where a failed sync surfaces.

> Technical note: the sync window and behavior are tunable through environment values read once at boot: a lookback of 30 days, at most 200 items per sync, 3 retries per retryable upstream call with a jittered backoff, and an auto interval that is off by default (a value of 0 means no timed re sync). The sidecar URL defaults to a localhost port. These are defaults, not promises to the user.

## The cook run

A cook run is a create run: one long lived process that cooks and renders a planned post into a video. It is the one action in the core loop that the user starts and then watches rather than a request that returns. The studio's cook run document owns the interaction; this document owns its statuses.

Starting a cook claims a create run row in the `running` state and hands back its id; the process then spawns and reports back its process id, a heartbeat, and status changes. The user can leave the studio while it runs and return to its current state, because the status lives in the database, not in the page.

### The statuses

A create run's status is one of five:

- running. The process is alive and working.
- waiting. The run is between phases or waiting on something before it continues.
- success. The run finished and produced a rendered asset. The rendered asset id is stored, which is what makes the post publishable.
- failed. The run ended without a rendered asset; an error message is stored.
- canceled. The user stopped the run. The row is marked canceled whether or not a live process was found to kill, so a run whose process already exited on its own still reads as canceled rather than staying running forever.

The run pill on the studio panel shows the current status. Publish is gated on the stored rendered asset id of the post's latest run, not on anything held in the page, so a render that finished before a reload still counts as publishable.

> Technical note: stopping a run signals the whole process group, so the render and any child processes die with the cook rather than being orphaned, then the row is marked canceled regardless of what was found to signal.

## The render watch

A cook produces a rendered file, and the studio reflects when that file exists. The exact watch mechanism is an internal of the terminal layer and out of scope; what the user sees is that the render appears in the studio panel when it is ready, and that its existence is what enables publish.

## Interactions with other systems

**Persistence and autosave.** Sync results and create run rows are durable. A run's status survives a reload because it is stored, not held in the page.

**History and undo.** Neither a sync nor a cook run is undoable. A cook can be stopped; a sync cannot be reversed.

**Navigation and refresh.** A run finishing while the shell is mounted freshens the failure strip through a refresh, not a poll. The studio panel receives status changes directly while it is open.

**Background jobs and the sidecar.** This document owns them.

**External services.** The sidecar talks to the source platform; the cook run drives local rendering. Generation through the LLM proxy is a separate path, described in [external services](external-services.md).

**Status and failures.** A failed sync or a failed run surfaces in the failure strip and, for a run, in its pill. See [status and failures](status-and-failures.md).

**Configuration and settings.** The sync window and retry behavior are environment defaults, not user settings; they are not changed from within the core loop.

## Edge cases

- With the sidecar off, the feed still works on existing videos; only new arrivals stop.
- A canceled run and a failed run both end without a publishable render, but they read differently: canceled is the user's choice, failed carries an error.
- A run whose process died on its own still moves to canceled when the user stops it, rather than being stuck at running.
- Removing a video through a sync is the one way a video the user is looking at can vanish underneath them; its downstream links degrade rather than break.
