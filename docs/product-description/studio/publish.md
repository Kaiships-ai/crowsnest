# Publish and save to calendar

## Summary

Publishing is the last step of the core loop: a cooked post has produced a render, and the user marks it done. It lives on the right hand output rail of the [studio panel](studio-overview.md), below the render preview, as two buttons. Publish hands a `/ksa:serve` command to the running [Claude Code session](cook-run.md) after a confirm; Save to calendar marks the [planned post](../foundations/data-model.md#planned-post) done in the app's own database. Neither button starts a network publish from the app's data; the schema is explicit that nothing in the planned posts table reaches any network call, and the only marking is by hand.

Publish is gated. It is enabled only when the post's latest [create run](../foundations/data-model.md#create-run) has a stored render asset, which the panel reads once on mount so the gate survives a reload. Until a cook run succeeds and produces a render, Publish stays disabled. Save to calendar has a stricter gate: it needs a render captured in the current session, so a reload disables it even while Publish stays on.

Both buttons are database or in-session actions, so they do not depend on the LLM proxy, the Graph token, or the sidecar being up. What the injected `/ksa:serve` does inside the session (it uses the official Graph API) is the agent run's concern and out of scope here; this document describes the buttons, not the serve.

## The simple case

The user has cooked a post in the studio. A run finished and its render is playing in the output rail. Publish is enabled. The user clicks Publish, a browser confirm asks "Publish this render to Instagram?", the user accepts, and `/ksa:serve` is typed into the session for the agent to run. Nothing else on the panel changes.

To record the post as handled without touching Instagram, the user clicks Save to calendar. The button briefly disables, then reads "Saved to calendar" and stays that way.

## The interaction, event by event

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

### Arrive

When the panel mounts it asks the server whether this post is publishable, reading the render asset id off the post's latest create run. If one exists, Publish is enabled; if the post has no run yet, or its latest run has no render (still running, or it never finished), Publish stays disabled. This read runs once, keyed to the post. Save to calendar is enabled only when a render was captured live in this session, which a fresh mount has not done, so it starts disabled until a run finishes here. Nothing is focused or prefilled; these are buttons, not a form.

### Leave without acting

Leaving the studio page records nothing. No confirm, no write. The publish gate is recomputed from the database on the next visit.

### Begin acting

Publish begins with the click that opens the native confirm. Save to calendar begins with its click, which fires the mark-published write immediately with no confirm.

### While acting

Publish has almost no in-flight window from the app's side: accepting the confirm injects `/ksa:serve` into the session as one line and returns. The button does not disable, show a spinner, or wait for the serve to finish; whatever the serve does surfaces in the terminal pane, not here. Save to calendar runs inside a React transition, so it disables while the write is in flight.

### Finish

Publish commits nothing in the app. The command is handed to the session and the button looks exactly as before. Save to calendar commits a write to the planned post row: on success the button switches to "Saved to calendar" and stays disabled for the rest of the visit; on failure a red line appears under it with the reason and the button re-enables. The page is not refreshed either way.

> Technical note: Save to calendar marks the plan published by calling the mark-published action with a null own post id, "it went out and I am not linking it." But the plan's published condition is derived only from a non-null own post link, so passing null leaves the row indistinguishable from a plan that was never published. The only durable effect of Save to calendar is bumping the row's updated timestamp; the "Saved to calendar" label is client state that a reload discards. See [Edge cases](#edge-cases).

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (the create run behind the post) | Publish is enabled only if the latest run is a [success carrying a render](../foundations/background-jobs.md#the-statuses). A run that is running, waiting, failed, or canceled with no render leaves it disabled. | A run that finishes with a render this session enables both buttons through the live capture. The mount-time gate does not re-fetch, so it never disables Publish once opened. |
| Attached data present or absent (script, render asset) | The gate depends only on the render asset on the latest run, not on whether the plan carries a script. Save to calendar depends only on a live render. | Capturing a render mid session flips both buttons on. Whether the plan has a script never changes either. |
| External service availability (LLM proxy, Graph, sidecar) | None of them affect either button's enabled state; the gate is a database read. | Publish's `/ksa:serve` uses the Graph API inside the session; a bad token fails there, in the terminal, not on the button. Save to calendar needs no service. |
| Keyboard shortcut in play | None on the buttons themselves. | The Publish confirm is a native browser dialog: Enter accepts, Escape dismisses. No other key is honored. |

## Cancel and interrupt

The cancel, stop, and interrupt definitions live in [the interaction model](../foundations/interaction-model.md#commit-cancel-stop-interrupt).

| Event | Before commit | While in flight |
| --- | --- | --- |
| Explicit cancel or stop | Dismissing the Publish confirm aborts it; nothing is injected. Save to calendar has no confirm and no cancel. | Publish has no app-side in-flight step to cancel. Save to calendar's transition cannot be interrupted; the write runs to completion. A `/ksa:serve` already handed off is stopped only through the run's [Stop button](cook-run.md), not here. |
| Navigate away mid action | Leaving abandons an open confirm; nothing publishes. | A Save to calendar write may still land, but the "Saved to calendar" label does not show on return because it is client state and the page is not refreshed. |
| Reload or tab or window closed | An open confirm is lost; nothing publishes. | On reload Publish re-gates from the database and stays enabled if the render is stored. Save to calendar resets to disabled (no live render after a reload) and its "Saved" label is gone even if the write landed. |
| A backing service fails mid action | Neither button calls an external service to become enabled. | A `/ksa:serve` that fails (bad Graph token, proxy down) fails inside the terminal, not on the button. A Save to calendar database error shows as a red line under the button. |
| The target record changes underneath | If the plan was deleted in another tab, Save to calendar returns "That planned post no longer exists" as a red line. The publish gate is read once on mount and is not re-read, so Publish can stay enabled off a stale render even if the latest run has since changed. | Same. The mark-published write validates the plan still exists and fails cleanly if not. |
| A background job finishes or fails on its own | A cook run finishing with a render while the user is on the panel enables Save to calendar (through the live capture) and keeps Publish enabled. A run failing does not disable Publish if an earlier render is already stored. | Same; the buttons only ever gain capability from a run finishing, never lose it mid action. |
| A second tab or a double action on the same record | Two tabs each gate independently off the same stored render. | Publish does not disable, so a double click opens the confirm twice and can inject `/ksa:serve` twice into the session. Save to calendar disables after the first click (`pending`, then `saved`), so a double submit is blocked. |

## Interactions with other systems

**Persistence and autosave.** Nothing here autosaves. Publish writes no app record at all. Save to calendar writes the planned post's updated timestamp (and sets the own post link to null, that is, unchanged). The publish gate itself is durable because it reads the render asset id stored on the create run, not the ephemeral live capture. See [persistence](../cross-cutting/persistence.md).

**History and undo.** Neither action is undoable from the app. Save to calendar has no undo and there is no un-publish button; a plan is un-marked only by editing the row directly, which this panel does not offer.

**Navigation and refresh.** Neither button calls `router.refresh`. Save to calendar's result is client state only; the [calendar](../mine/calendar.md) is not re-read, so a plan marked here does not repaint there until that page loads fresh. A reload of the studio re-reads only the publish gate.

**Background jobs and the sidecar.** The render that opens the gate comes from a [cook run](cook-run.md); see [background jobs](../foundations/background-jobs.md#the-render-watch) for how a render is captured and stored. Publish hands `/ksa:serve` to that same session.

**External services.** The buttons touch none. `/ksa:serve` uses the official Graph API from inside the agent session, which is out of scope; the app's planned posts table has no code path to any network call. See [external services](../cross-cutting/external-services.md).

**Status and failures.** A Save to calendar failure shows as a red line under the button, not a toast. Publish gives no app-side success or failure signal; the outcome of the serve is only visible in the terminal pane. See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** None. No setting changes either button.

## Edge cases

- After a reload Publish can be enabled while Save to calendar is disabled. The gate reads the render stored on the latest run, which survives the reload; Save to calendar keys off the live in-session capture, which a reload throws away.
- Save to calendar does not produce a published state anyone can see. It marks the plan with a null own post link, and the plan's published condition is derived only from a non-null link, so the row still reads as draft, scheduled, or missed. The visible effect is the button's own "Saved to calendar" label, which a reload discards. This looks like a gap; see [Open questions](#open-questions-and-verification).
- Publish never disables itself, so a fast double click injects `/ksa:serve` twice.
- The confirm says "Publish this render to Instagram?" but the app itself publishes nothing; the serve command inside the session is what would reach Instagram.
- The "frame pass not run" note that can appear in the panel header is about the frame pass, not the publish gate; Publish does not depend on it.

## Open questions and verification

- Whether Save to calendar is meant to leave the own post link null (making the plan indistinguishable from unpublished, with only the updated timestamp changed) or whether it should link an own post so the plan reads as published, was read from the code but not confirmed as intended. It looks like a gap between the button's label and its effect.
- Whether the mount-time publish gate ever re-fetches after a new run finishes in the same visit was read as no; it is fetched once, keyed to the post id, and thereafter only the live capture can enable Publish. Needs a live check.
- The timing and visible result of `/ksa:serve` inside the session cannot be observed from the app side and were not confirmed by hand.

Verified against this repo commit `4f26fb9`.
