# Background jobs and the sidecar

## Summary

One kind of work in the core loop happens outside a single request: the sidecar sync that fills the feed with videos. This document owns the user visible model of it. The sidecar's internals (the Python process it runs as) are out of scope; what is here is what the user can observe and depend on.

## The sidecar sync

Videos appear in the feed because a sync ran, not because the user asked for one per video. The sidecar is a local service the app talks to over localhost to fetch posts from tracked channels and write videos. A sync run reads a window of recent posts per channel and records how many it saw and how many it created.

What the user can depend on:

- The feed reflects the last sync, not the live state of the source platform. When the sidecar is not running, no new videos arrive and the feed goes stale rather than erroring. Every downstream action (save, remix, plan) still works on the videos already there.
- A sync can remove a video that is gone from the source. That removal cascades: the video's saved post is deleted with it, and any planned post that pointed at it keeps the plan but loses the link.
- A sync does not block the user. It runs in the background; the failure strip in the shell is where a failed sync surfaces.

> Technical note: the sync window and behavior are tunable through environment values read once at boot: a lookback of 30 days, at most 200 items per sync, 3 retries per retryable upstream call with a jittered backoff, and an auto interval that is off by default (a value of 0 means no timed re sync). The sidecar URL defaults to a localhost port. These are defaults, not promises to the user.

## Interactions with other systems

**Persistence and autosave.** Sync results are durable.

**History and undo.** A sync is not undoable and cannot be reversed.

**Navigation and refresh.** Sync progress is reflected in the shell through the live sync poll and the failure strip, described in [status and failures](status-and-failures.md).

**Background jobs and the sidecar.** This document owns them.

**External services.** The sidecar talks to the source platform. Generation through the LLM proxy is a separate path, described in [external services](external-services.md).

**Status and failures.** A failed sync surfaces in the failure strip. See [status and failures](status-and-failures.md).

**Configuration and settings.** The sync window and retry behavior are environment defaults, not user settings; they are not changed from within the core loop.

## Edge cases

- With the sidecar off, the feed still works on existing videos; only new arrivals stop.
- Removing a video through a sync is the one way a video the user is looking at can vanish underneath them; its downstream links degrade rather than break.
