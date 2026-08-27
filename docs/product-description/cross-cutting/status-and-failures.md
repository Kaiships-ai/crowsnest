# Status and failures

## Summary

The core loop tells the user what is happening and what went wrong through four
surfaces, each with its own scope and lifetime. A toast is transient and belongs to one
action. The failure strip is persistent and sits in the shell across the whole app. The
remix run log is the per session history of one remix. A run pill is the live status of
one cook run. Around all four are the empty and error states each page shows when it has
nothing to render or cannot render. This document owns them as one account: what each is,
how they differ, and how each behaves when an action is interrupted.

This is a reference document, not the description of a single interaction. The other
documents describe the actions; this one names the surfaces those actions light up and
keeps their meanings in one place so no two documents describe the same pill or the same
tone differently. Where a surface belongs to a feature, that feature's document owns the
interaction and links here for the surface. The run status meanings themselves are owned
by [background jobs](../foundations/background-jobs.md); this document covers how they are
shown, not what they mean.

## The simple case

The user keeps a post: a toast slides in reading "Kept in the vault" and fades on its own.
They start a cook in the studio: a pill appears next to the button reading "cooking" and a
clock counts up. They generate script variants in the remix: a row lands in the run log
reading "Success" with the elapsed time. Meanwhile a sync failed an hour ago, so the strip
under the topbar has been quietly carrying "Partial sync" on every page they visited. Four
surfaces, four scopes: one for the action just taken, one for the app's standing state, one
for the remix's own history, one for the live run in front of them.

## The interaction, event by event

There is no single interaction here. The four surfaces are described below, then the empty
and error states, then how each behaves through the five phases where it has behavior at
all.

### The failure strip

The strip is a banner in the topbar, below the header, on every route under the
[shell](../foundations/navigation-and-shell.md). It is the app's standing status surface:
persistent, app wide, and read fresh on each navigation rather than tied to any one action.

In practice the strip reports the most recent sidecar sync. It reads the single latest sync
job and classifies it into one of a fixed set of kinds:

- Local service down. The sidecar could not be reached, so no sync could run.
- Session expired. The Instagram session needs a human to reconnect it in settings.
- Cooling down. Instagram paused the whole connection; it clears on its own, and the strip
  shows a live countdown only when Instagram supplied one.
- No network. The network call to Instagram failed.
- Partial sync. Some channels did not finish, but the connection is fine. The strip says
  what survived, not only what broke.
- Sync failed. Every channel failed for reasons of its own, with the connection intact.

Two more kinds never reach the screen: nothing to report, and a run in flight. While a sync
is running the strip hides itself and the shell's progress panel tells that story instead,
so a mid flight run is never shown as a verdict.

The strip carries two tones. Partial is the softer warn tone; every connection level kind
is the harder bad tone. Neither is amber and neither is a red alert bar: only a left rule
and a dot carry the severity, because in this design amber means one thing, a post beating
its channel, and failure is a normal state rather than an alarm. Each kind offers the one
recovery action the user can actually take: copy the start command, reconnect in settings,
try again (disabled while a cooldown is still counting down), or retry the named channels.
A partial notice can be dismissed and heals on its own; a connection level notice stays
until its cause is fixed, so it has no dismiss control to lie with.

The strip is read once per server render by the shell layout, so it is current as of the
last navigation. It also watches the live sync poll while the shell is mounted: the moment a
run starts anywhere, from this tab, the sidebar, or another tab, the strip steps aside for
the progress panel; when that run finishes, its verdict returns on the next navigation or
refresh.

> Technical note: the strip's data is a prop read by `getFailureStrip()` once per server
> render, freshened not by re fetching the prop but by the `useSyncProgress` poll the strip
> component watches. The prop only changes on navigation or a `router.refresh()`, so a run
> that finishes while the shell sits still updates the strip's live "is a run in flight"
> read immediately but its finished verdict only on the next server render.

### Toasts

Every server action in the core loop settles into a toast. On success the action shows a
short confirmation; on failure it shows the error the action returned. This is the one
pattern every action shares: nothing throws across the action boundary, so the client always
lands on either a success toast or an error toast, never an unhandled crash. A toast is
transient and belongs to one action: it appears in a corner, stays briefly, and fades, and
it does not survive being ignored.

Destructive actions carry their undo inside the toast. Removing a kept post shows "Removed
from the vault" with an Undo action that re creates the row; the same pattern covers the
other destructive actions in the loop. The undo lives only as long as the toast: once it
fades, the action is the only way back. This is the app's undo model for these actions,
described in full for the keep button in [save to vault](../feed/keep-this-post.md); there is
no global undo stack behind it.

A toast reports the result; it does not change the page. Where the display depends on server
data, the action also calls a [refresh](../foundations/navigation-and-shell.md) so the
server rendered value catches up, and the toast is only the notification that the write
landed.

### The remix run log

The run log is the [remix session](../glossary.md)'s own history, shown below the stage in
the [remix studio](../remix/remix-overview.md). It is per session, not app wide, and it is
append only: every generation attempt writes a row, on success and on failure, newest first,
each with its elapsed time. Sub second attempts read in milliseconds and longer ones in
seconds, so a fast hook generation does not round away to nothing.

Each row carries one of three tones, and the tone is the point:

- Success. The attempt produced a usable result. For a variant generation this means at
  least one of the three variants came back.
- Partial. Some of the attempt succeeded and some failed, read from the row's own "N of M
  variants succeeded" count. Only variant generation can be partial; a partial attempt is
  never shown in the same tone as a clean one.
- Failed. The attempt errored and produced nothing.

The run log is also where the studio reads whether the model proxy is down: a connection
error in the last few rows flips the generation stages to blocked, and the next successful
attempt clears it. That inference belongs to the [remix studio](../remix/remix-overview.md);
the run log is the evidence it reads.

### The create-run run pills

The [run pill](../glossary.md) is the live status of one cook run, on the studio panel.
It is per run and live: it repaints as the run reports a new status and it is not persisted,
so it is view state that resets on a reload. It shows the five create run statuses with user
facing labels, not the raw status words:

- running reads "cooking", with a pulsing amber dot.
- waiting reads "waiting on you", with a pulsing neutral dot.
- success reads "done".
- failed reads "failed".
- canceled reads "canceled".

Amber is reserved for the running dot alone; the other pills reuse the neutral, positive,
and destructive tones the runs list already uses. A status the panel does not recognize
falls back to the "canceled" pill rather than showing nothing, so an unknown status still
reads as a neutral, ended looking pill. A clock beside the pill counts up while the status is
running or waiting and freezes on any ending. The full drive from the user's side, including
the clock's zero point and the Stop button, is owned by [the cook run](../studio/cook-run.md).

### Empty and error states

When a page has nothing to render, or cannot render, it says so in place rather than showing
a failure. These are not failures; they are the honest resting state of a read.

The [feed](../feed/feed.md) has four distinct empty states, each matched to the reason the
slice came back empty: no channels tracked at all, channels tracked but none synced yet, a
search that matched nothing, and a filter slice that cleared everything out. The recovery
link differs per case, so the user is pointed at the actual fix rather than a generic "no
results".

The [calendar](../mine/calendar.md) is careful about the difference between "nothing happened"
and "nothing was checked". A month with no plans simply shows empty day cells. The published
and dead air markers depend on a Graph measurement having run at all: a channel that has never
been measured has no own posts to reconcile against, so those markers stay off entirely rather
than reading an empty month as a failure. The scheduled, missed, and open states still render,
because they come from planned posts and need no Graph connection.

The [studio](../studio/cook-run.md) panel's Output pane reads "Run Cook to start the session"
before a cook, and "Cooking. The render appears here when it finishes." once a cook is started
but before a render lands. A failed cook keeps that placeholder rather than inventing an error
panel; the terminal is where the reason was printed. The header also notes "Frame pass not run"
when the post has no frame pass, a separate readiness note rather than a failure.

## Variants

The surfaces differ by what drives them, not by a per action variant table. The axis that
matters is scope and lifetime.

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state | The strip reflects the last sync's stored outcome; a pill reflects nothing until a run reports; the run log reflects the session's stored attempts; empty states reflect what the read found. | A new sync verdict appears on the next navigation; a pill repaints live as the run reports; a run log row appends on each attempt; a re read changes an empty state to content or the reverse. |
| Attached data present or absent | The strip's facts row shows only the codes and counts the sync actually recorded; a partial run log row shows its real "N of M" count; empty states name only the reason that applies. | Missing pieces are dropped rather than shown blank, so a surface never fabricates a field the data did not carry. |
| External service availability | A down sidecar, an expired session, or a network failure each pick a distinct strip kind. The proxy being down shows up in the run log as connection errors, not in the strip. | The strip reclassifies on the next sync; the run log's proxy down read flips the generation stages on the next attempt. |
| Keyboard shortcut in play | None of these surfaces is keyboard driven. | The strip's dismiss and recovery controls are ordinary buttons; toasts and pills have no keyboard affordance of their own. |

## Cancel and interrupt

This is a reference document, so there is no single action to cancel. What matters is how
each surface behaves when the user does the two things any page allows at any time: navigate
away and reload. The full interrupt tables live in the feature documents that own each
action; this is the surfaces' side of them.

- Navigate away. A toast is app level, so it survives a navigation within the shell and keeps
  its remaining time and its Undo. The failure strip re reads on the new page and shows the
  same standing verdict. The remix run log is server backed, so it rebuilds from the session
  on the page it belongs to. A run pill is live view state and is lost on leaving the studio;
  the run itself keeps going server side, and its true state is read fresh, not from the pill.
- Reload. Toasts are cleared, so an Undo not yet clicked is gone. The strip is re read from
  the latest sync row. The run log is re read from the database. A run pill resets to the
  starting Cook control even while the cook is still running, because the pill was never
  persisted; the run continues and its render still gates publish once it lands.

The rule across all four: the durable surfaces (the strip's underlying sync row, the run
log's rows) come back exactly as the database holds them, and the ephemeral surfaces (toasts,
pills) do not come back at all. Nothing is left half shown, because a surface that cannot be
rebuilt from the server simply starts clean.

## Interactions with other systems

**Persistence and autosave.** The run log rows and the sync job behind the strip are durable
and survive a reload. Toasts and run pills are ephemeral view state and do not. The strip's
data is a server rendered snapshot re read on each navigation. See
[persistence](persistence.md).

**History and undo.** Undo lives inside the toast for destructive actions and nowhere else;
once the toast fades, the action is the only way back. The run log is append only history,
not an undo stack: it records that an attempt happened but does not restore what an attempt
replaced. See [save to vault](../feed/keep-this-post.md) for the undo pattern in full.

**Navigation and refresh.** The strip is read once per server render and freshened by the
live sync poll while the shell is mounted; a `router.refresh()` after a write is what flips
any server rendered status a toast reported. Run pills do not use refresh; they repaint from
the live session. See [navigation and shell](../foundations/navigation-and-shell.md).

**Background jobs and the sidecar.** The failure strip is the [sidecar sync](../foundations/background-jobs.md)'s
status surface; the run pill is the [cook run](../studio/cook-run.md)'s. Both read their
state from the database, which is why a run's verdict outlives the page that started it. See
[background jobs](../foundations/background-jobs.md).

**External services.** The strip classifies the sidecar, session, cooldown, and network
codes a sync reports. The [LLM proxy](external-services.md) being down does not touch the
strip; it surfaces as connection errors in the remix run log, which the studio reads to block
generation. See [external services](external-services.md).

**Status and failures.** This document owns them.

**Configuration and settings.** No user setting changes the tones, the labels, or the
classification. The pill labels, the run log tones, and the strip kinds are fixed in the
code, not tunable.

## Edge cases

- The strip's framing is app wide but its content is the last sync only. A failed cook run
  surfaces on its own pill and, per the feature documents, is meant to reach the strip too,
  but the strip's classifier reads sync jobs; whether a cook failure actually lands there is
  called out in open questions.
- A run in flight hides the strip entirely rather than showing a stale verdict underneath the
  progress panel, so the shell never shows two contradictory sync states at once.
- A partial notice is the only strip kind the user can dismiss, because it is the only one
  that heals on its own; a connection level notice has no dismiss so it cannot be cleared
  while its cause is still true.
- A variant generation that saved at least one variant writes a Success row even though some
  variants failed; the Partial tone exists precisely so that "1 of 3" is not shown as loudly
  as "3 of 3". The failed slots show their own inline errors on the stage.
- An unrecognized run status renders as the "canceled" pill rather than nothing, so a status
  the panel was never taught still reads as an ended run.
- A toast is fire and forget: navigating keeps it, but reloading drops it, so an Undo the user
  meant to click but did not is unrecoverable after a reload.
- The calendar's published and dead air markers stay off for an unmeasured channel, so an
  empty month reads as "nothing checked" rather than "nothing happened".

## Open questions and verification

- Whether a failed cook run actually appears in the shell failure strip was not confirmed.
  The other documents describe the strip as surfacing failures across the app, but
  `getFailureStrip` reads only the latest sync job and classifies Instagram error codes, so
  a create run failure may reach the strip through a path not traced here, or may only show on
  its own pill. This needs a live check with a deliberately failed cook.
- The exact placement, duration, and stacking of toasts (which corner, how long before they
  fade, how many stack) were read as the sonner defaults and not confirmed by hand.
- Whether a toast's Undo reliably survives a fast navigation to a different route, or is torn
  down with the page that raised it, was read from sonner being mounted at the app level but
  not confirmed by hand.
- Whether the "waiting on you" pill's meaning (input, phase boundary, or a stalled heartbeat)
  matches the label was deferred to [background jobs](../foundations/background-jobs.md) and
  needs confirming against a real cook.

Verified against this repo commit `4f26fb9`.
</content>
</invoke>
