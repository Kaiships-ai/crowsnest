# The interaction model

## Summary

This document owns the shape of every action in the core loop: the five phases each action passes through, what it means for an action to commit, and the definitions of cancel, stop, and interrupt that every feature document's cancel and interrupt table relies on. Other documents link here rather than restating these. It also describes the two ways an action reaches the server (a server action or a direct server read) and how generation and background runs differ from an instant write.

## The five phases

The unit of interaction is one action the user takes on a page. Every feature document narrates it in the same five phases, renamed only where the feature's own words are clearer.

- Arrive. The page or dialog opens. What loads, what is focused, what is prefilled. Pages render on the server, so what the user sees on arrival is a snapshot read at load time.
- Leave without acting. The user backs out before changing anything: closes a dialog, navigates away, reloads. The question every document answers here is whether anything was recorded. Usually nothing is.
- Begin acting. The first change or click that starts real work: the first edit that makes a form dirty, the first generation request, the moment a run spawns. This is the line between the short path (leave without acting) and the long one.
- While acting. What updates while the work is in flight. For an instant write this is a disabled button for a moment. For a generation it is a pending state until the model answers. For a run it is a status pill and streaming output.
- Finish. What is committed and where the user lands. Commit is the durable step; see below.

## Commit, cancel, stop, interrupt

These four words are used the same way in every document.

Commit is the durable step of an action: a database row written, a script saved, a planned post created, a render asset recorded. Until an action commits, leaving discards it. Most core loop writes commit a single row, so an action's result is all or nothing: the row exists or it does not.

Cancel is the user ending an action on purpose before it commits: Escape or a close on a dialog, a Cancel button. A cancel discards uncommitted work and returns the user to where they were.

Stop is ending a running cook run on purpose. Unlike a cancel, a stop acts on work that has already started producing side effects, so what is left behind depends on how far the run got. See [the cook run](../studio/cook-run.md).

Interrupt is anything that ends or disturbs an action that the user did not do on purpose. The seven interrupt rows are the fixed list every document fills: an explicit cancel or stop, navigating away, a reload or closed tab, a backing service failing, the target record changing underneath, a background job finishing on its own, and a second tab or double action. The rows and their order do not change between documents.

## How an action reaches the server

There are two paths, and which one a feature uses changes what "arrive" and "finish" mean.

A direct server read is a page that queries the database on the server as it renders. The [feed](../feed/feed.md), the [video detail page](../feed/video-detail.md), and the [calendar](../mine/calendar.md) read this way. There is no action to fail; the page either renders with data or renders an empty state. Filters and navigation change the read by changing the URL, which re renders the page.

A server action is a write the user triggers from a client component: saving a post, running a remix stage, starting a cook run. Every server action in this app returns a result rather than throwing. A result is either a success, sometimes carrying an id or a payload, or a failure carrying a human readable message and a code that tells one failure apart from another (for example a video that no longer exists versus a post already saved versus an unexpected error). The client reads the result and shows a toast; nothing crosses the boundary as an exception.

> Technical note: the result shape is `{ ok: true, ... }` or `{ ok: false, error, code }`. The code is what lets a caller react differently to, say, "already saved" than to "gone". A caller that only shows `error` still shows a sensible message.

While a server action runs, the client holds a pending state (a React transition). The button that started it is disabled and often relabeled ("Keeping", "Generating"). When the action settles, the client shows a toast and, for anything whose display depends on server data, re reads the page so the new state appears without a manual reload. See [navigation and shell](navigation-and-shell.md) for the refresh model.

## Generation

Some actions call the language model through the [LLM proxy](background-jobs.md) to produce text: research notes, hooks, an outline, variants, an idea. Generation is the same server action shape, but slower and able to fail on the proxy rather than the database. Its "while acting" phase is a real wait, and its finish writes the generated text to the record and appends a [remix run](data-model.md#remix-run) row on both success and failure, so the run log records the attempt either way. When the proxy is down, generation fails with a message and the run log shows the failed attempt; nothing partial is written to the session.

## Background runs

A cook run is different from every other action: it is a long lived process the user starts and then watches, not a request that returns. Starting it spawns a process and claims a [create run](data-model.md#create-run) row; the process reports its status back (running, waiting, success, failed, canceled) and the studio panel repaints as each status arrives. The user can leave the page while it runs and come back to its current state. [Background jobs](background-jobs.md) owns the status meanings and [the cook run](../studio/cook-run.md) owns the interaction.

## What is unavailable in restricted states

The core loop degrades rather than blocks when a service is missing:

- LLM proxy down: generation fails; browsing, saving, scheduling, and the calendar still work.
- Sidecar not running: no new videos arrive; the existing feed still reads and every downstream action still works.
- Graph token invalid: the [my channel](../mine/mine-overview.md) metrics are unavailable and the page shows a connect panel; planning and the studio still work.
- No own channel set: the my channel page shows a picker instead of its dashboard.

## Edge cases

- A page read reflects the database at load time, so a record can change underneath an open page. Acting then can return a "no longer exists" or "already done" result, which the feature surfaces as a toast rather than a crash.
- A pending transition disables the trigger, so a double click cannot start a second write, but a separate navigation control still works during the pending window.
- A generation that fails still leaves a run log entry, so the history of attempts is complete even when nothing was produced.

## Open questions and verification

- Whether every server action reliably completes when the page unmounts mid transition (a navigation during the pending window) was not confirmed by hand; it is called out in each affected feature document.
- The precise boundary of the `waiting` create run status (between phases, or waiting on a queue) is deferred to [the cook run](../studio/cook-run.md).

Verified against this repo commit `4f26fb9`.
