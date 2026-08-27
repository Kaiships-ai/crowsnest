# The finish stage

## Summary

The finish stage is where a remix stops being working state and becomes a durable
[planned post](../foundations/data-model.md). It shows a short summary of what the run
produced, the chosen hook and the chosen script variant, and offers one button that puts
the remix on the plan and links into its studio to cook it. It is the sixth and last of
the six remix stages. Unlike the hook, style, and script stages, it makes no model call:
finishing is bookkeeping, not generation, so this is the one generation stage that stays
fully usable with the [LLM proxy](../foundations/background-jobs.md) down, the Graph token
invalid, or the sidecar off. It needs none of them.

The stage lives inside the [remix studio](remix-overview.md) and is reached by Continue
from the [script stage](stage-script.md), which the studio allows once a variant exists,
or by a stepper click once the stage has been reached. It has no Continue of its own; the
"Finish and open studio" button is the end of the line.

## The simple case

The user arrives from the script stage with a hook and a variant already chosen. The stage
shows the hook text and the chosen variant, labeled as variant N of the set. The user reads
the summary and clicks "Finish and open studio". A toast says the remix was added to their
plan, the button is replaced by a line saying the remix is ready to cook and a link that
reads "Open the studio", and clicking it opens the [studio page](../studio/studio-overview.md)
for the new planned post.

## The interaction, event by event

This stage has no generation. Its "finish" phase is the creation of the planned post, the
single durable write the whole remix builds toward.

```
stateDiagram-v2
    [*] --> summary : arrive on the finish stage
    summary --> summary : leave without acting (nothing written)
    summary --> finishing : click Finish and open studio
    finishing --> done : plan created or reused, script reconciled
    finishing --> summary : error (toast, button re-enabled)
    done --> [*] : Open the studio link
```

### Arrive

Opening the finish stage shows two read only summaries built from the session as it stands.
The Hook block shows the chosen hook, or the placeholder "(no hook chosen)" when none was
picked. The Chosen script block shows the chosen variant with a "Variant N of M" label, or
the placeholder "(no variant picked yet)" with a line telling the user to go back to the
script stage, open the variant they want, and save it. Nothing is generated, nothing is
fetched, and nothing is written on arrival. The button reads "Finish and open studio".

> Technical note: the summary reads the session's stored chosen hook and chosen variant
> index. It deliberately does not fall back to the first variant when nothing is picked. A
> hook or a variant the user never chose renders as an explicit placeholder, never as a
> plausible looking default.

### Leave without acting

Leaving the stage without clicking the button writes no planned post and no script. The
summary is derived from session fields that were already autosaved by earlier stages, so
there is nothing here to lose. Returning to the stage rebuilds the same summary.

### Begin acting

There is one action: clicking "Finish and open studio". That click starts the finish write.
The button is disabled from that instant so a second click cannot start a second write.

### While acting

The button label changes to "Finishing" and stays disabled. Nothing streams and nothing
else on the page changes. The write is a single server call with no model behind it, so the
in flight window is short. This phase is thin by design; there is no partial state to show.

### Finish

The server ensures the session has a planned post to cook and hands back its id. If the
session already has a plan linked to it, that plan is reused; if not, a new planned post is
created in the draft state with no date. Either way the plan's attached script is reconciled
to the currently chosen variant, so the plan carries the words the user has in front of them
rather than a stale earlier save. The button is replaced by the line "This remix is on your
plan and ready to cook." and an "Open the studio" link into `/mine/{postId}/studio`. A toast
confirms the result: "Added to your plan. Open the studio to cook it." when the plan was
created, or "Opening the studio for this remix." when an existing plan was reused. The user
lands next by following the link into the studio page.

The plan is created with no date on purpose. Finishing a script is not a decision about when
to post it, and inventing a date would put a commitment on the calendar the user never made.
A dateless plan reads as a draft, which is what it is. This is the difference from the
[script stage's Add to plan](stage-script.md), which dates the plan then and there; the two
are the two paths to a planned post, one undated and one dated. See
[the data model](../foundations/data-model.md) for what a draft planned post is.

> Technical note: the finish is idempotent. It reads the most recent plan linked to the
> session before writing, so clicking the button twice, or finishing again after a page
> reload, reuses the same plan rather than dropping a duplicate on the calendar. It also
> re-reconciles the attached script every time, which is what catches a stale attach after
> the user regenerated or re-picked a variant without saving again.

## Variants

This stage is thin on variants: it has no inputs to set and no controls beyond the one
button, so most rows are inert. What varies is the session state the summary reads.

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (chosen hook and chosen variant present) | Decides the summary: the hook text or "(no hook chosen)", the chosen variant or "(no variant picked yet)". A session with neither still finishes, creating an undated draft with a derived title and no script attached. | This stage has no editing controls, so the pick does not change here; to change it the user goes back to the script stage. The button click itself is atomic and reads the session once. |
| Attached data present or absent (chosen hook, chosen variant, a saved script) | With a chosen variant, the plan carries a script reconciled to it. With no chosen variant, the plan carries the latest saved script if one exists, or no script at all. Placeholders stand in for whatever is absent. | No effect during the write. |
| External service availability (LLM proxy, Graph, sidecar) | No effect. The finish makes no model call and touches no external service, so it works when the generation stages are blocked and when the sidecar and Graph are down. | No effect. |
| Keyboard shortcut in play | None. There is no dialog, no Enter to submit, no Escape to cancel. The button is a plain button. | None. |

## Cancel and interrupt

| Event | Before commit (summary shown) | While in flight (finishing) |
| --- | --- | --- |
| Explicit cancel or stop | There is nothing to cancel; no plan exists until the button is clicked, and viewing the summary writes nothing. | The button is disabled and there is no stop. The write has no model behind it and runs to completion in one call. |
| Navigate away mid action | Leaving records nothing. The session stays where it is and the summary rebuilds on return. | A sidebar link still navigates. The server write may land, but the id it returns is lost with the page, so the "Open the studio" link does not appear. The next finish reuses the plan that landed rather than making a second one. |
| Reload or tab or window closed | Nothing is lost; the summary re-derives from the session. | The write may or may not have completed. On reload the button shows again because the returned id lived only in page state. Clicking it re-finishes, and idempotency means any plan already created is reused, not duplicated. |
| A backing service fails mid action | No external service is used, so nothing here can fail on one. | A database error returns a failure, shows its reason as a toast, and re-enables the button. No plan is left half written. |
| The target record changes underneath | If the source video was removed by a sync, the session keeps its own copied hook and variant text, so the summary still renders and the finish still creates a plan. If the plan was deleted in another tab, the next finish creates a fresh one; if it still exists, the finish reuses it and refreshes its script link. | Same. The write reads the session's stored inputs and the most recent linked plan, not the live video, so a mid write removal does not corrupt it. A script detached elsewhere is re-attached by the reconcile. |
| A background job finishes or fails on its own | No effect. No cook run exists yet; the [cook run](../studio/cook-run.md) begins later, on the studio page. | No effect. |
| A second tab or a double action on the same record | Two tabs both showing the button, or one button double clicked, converge on a single plan: the finish reuses the most recent plan linked to the session rather than creating a second. | The disabled state blocks a double click in one tab. Across two tabs, each finish that finds the existing plan reuses it. |

After an interrupt the user is left with either no plan or exactly one plan for the session,
never a duplicate and never a half written row.

## Interactions with other systems

**Persistence and autosave.** The finish writes durable rows: a planned post, and a script
when a variant is chosen and no matching saved script already exists. The summary itself is
not autosaved here; it reads session fields that earlier stages already saved. The returned
post id is ephemeral page state that a reload drops. See [persistence](../cross-cutting/persistence.md).

**History and undo.** There is no undo. The planned post and any reconciled script are
durable; the user removes them from the plan or the vault elsewhere. A repeat finish never
creates a duplicate, so there is no accumulation to undo.

**Navigation and refresh.** The "Open the studio" link is a plain link to
`/mine/{postId}/studio`; the stage does not call a refresh. The button is swapped for the
link through local state, and a reload drops that state and shows the button again. See
[navigation and shell](../foundations/navigation-and-shell.md).

**Background jobs and the sidecar.** None are started here. The finish makes no model call
and spawns no run. The cook run that renders the planned post is a later step on the
[studio page](../studio/cook-run.md).

**External services.** None. This is the one remix stage that reaches no service: no LLM
proxy, no Graph API, no transcript provider. See [external services](../cross-cutting/external-services.md).

**Status and failures.** Success and failure both surface as toasts. The run log below the
stage still shows the earlier generation attempts, but a finish writes no run log row,
because it is not a generation. See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** The new plan inherits the session's target length, and its
title comes from the reconciled script's title or, when there is no script, a short title
derived from the session topic (the same derivation the [script stage](stage-script.md)
uses, chosen because the topic is prefilled with the whole source caption). No setting gates
this stage.

## Edge cases

- The finish never fabricates. A hook or a variant the user did not pick shows an explicit
  placeholder, not a filled in default, in the summary and in the plan it produces.
- Finishing with nothing picked still works: it creates an undated draft with a derived
  title and no script attached. The "(no variant picked yet)" guidance points the user back
  to the script stage, but it does not block the button. This exists because the script
  stage's Continue is satisfied by a variant merely existing, not by one being picked, so
  the finish stage is reachable with no pick.
- Reconcile repairs a stale attach. If the user saved a variant, then regenerated or
  re-picked without saving again, the earlier saved script no longer matches the chosen
  variant. Finishing again writes a fresh script for the current variant and points the
  plan at it, even when the plan already existed.
- The "Open the studio" link is page state. After a reload the link is gone and the button
  is back; clicking it re-finishes, which is safe because the same plan is reused.
- There are two paths to a planned post from a remix: this stage, which creates an undated
  draft, and the script stage's Add to plan, which creates a dated one. A session can reach
  both; the finish reuses whichever plan is already linked rather than adding another.

## Open questions and verification

- Idempotency is a read then write: the finish checks for an existing linked plan before
  inserting one, and there is no unique constraint on the session link. Whether two truly
  simultaneous first finishes on a session with no plan could both insert, producing a
  duplicate, was read from the code but not tested under real concurrency.
- Whether the session's stage column reaches `finish` only when the button is clicked, or
  earlier when the shell's Continue advances the furthest stage, was not confirmed by hand;
  the finish write sets the stage to finish itself, and the shell may set it too. The
  stepper behavior is owned by [the remix overview](remix-overview.md).
- Whether a navigation away during the finishing window reliably lands the plan server side,
  so that a later finish reuses it rather than creating a second, was read from the
  idempotent path but not confirmed by hand.

Verified against this repo commit `4f26fb9`.
