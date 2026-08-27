# The studio page and its brief

## Summary

The studio is where one [planned post](../foundations/data-model.md) is turned into a
rendered video and published. This document owns the page as a whole and the brief it
shows: the read only left pane that describes what is about to be cooked. It does not own
the cook itself. The Cook and Stop buttons, the run pills, and the terminal are the
[cook run](cook-run.md); the Publish and Save to calendar controls are [publish](publish.md).
Both live in the panel to the right of the brief and are described in their own documents.

The page lives at `/mine/{postId}/studio`, one route per planned post, addressed by the
post's id. It is reached two ways: the [remix finish stage](../remix/stage-finish.md)
offers an "Open the studio" link after it creates the plan, and the
[plan dialog](../mine/plan-dialog.md) offers a "Create in Studio" button in edit mode,
which is how a plan opened from the [calendar](../mine/calendar.md) reaches here. Either
way the page opens on the brief.

The brief is a direct server read, like the feed and the video detail page. It renders the
plan and its source video or it renders nothing; there is no action to submit and nothing
to fail. It needs no external service: the [LLM proxy](../cross-cutting/external-services.md)
being down, the Graph token being invalid, and the sidecar being off change nothing about
the brief. Those states matter only once the user cooks, which is the [cook run](cook-run.md).
An id that resolves to no plan is a 404, not an empty state.

## The simple case

The user finishes a remix, or opens a plan from the calendar and clicks "Create in Studio".
The studio page loads. The left pane, headed "Brief", shows the plan's title, a chip for its
video kind, and a score badge carrying the source outlier's multiplier. Below that a "Script"
line names the attached script or says none is attached, with a link back to the source
outlier. Below that a "Visual direction" section lists the source video's shot by shot layout,
one block per beat, or says the frame pass has not run. To the right sit the cook and publish
panes. The user reads the brief, then clicks Cook to begin the [cook run](cook-run.md).

## The interaction, event by event

The studio page has no committing action of its own. Its interaction is arrive and read,
then hand off to the panel. Every durable write on this screen belongs to the
[cook run](cook-run.md) or [publish](publish.md).

```
stateDiagram-v2
    [*] --> loading : open /mine/{postId}/studio
    loading --> notFound : no plan for this id (404)
    loading --> brief : plan loaded
    brief --> brief : read the plan, script, and layout
    brief --> cookRun : click Cook (see cook-run.md)
    brief --> [*] : navigate away (nothing to save)
```

### Arrive

The page loads the brief in one server read keyed to the post id. The read composes three
things: the plan itself, the source video's detail when the plan carries a source video id,
and the remix session the plan came out of when it carries a remix session id. If the id
matches no plan the page is a 404. The route is forced dynamic, so every visit re-reads and
the brief is never a stale build time snapshot.

The left pane then shows, top to bottom:

- The word "Brief" and the plan's title.
- A chip row: the plan's video kind in a bordered chip when it has one, and a score badge
  reading the source outlier's multiplier (for example "3.2x score") when the plan has a
  source video. With no source video there is no badge.
- A "Script" block: the attached script's title, or "Untitled script" when the script has
  no title, or "No script attached." when nothing is attached. A "source outlier" link to
  `/feed/{sourceVideoId}` appears when the plan carries a source video id.
- A "Visual direction" block: one block per beat of the source video's layout, or the line
  "Frame pass not run." when there is no per beat layout.

Each beat block shows the beat's label, its window as M:SS to M:SS, and six labeled rows:
On-screen text, Animation, Demo cursor, Tool demo, Text position, Voice pace. A row whose
reading the pass could not determine shows a dash, which is distinct from a beat that was
never analyzed at all.

> Technical note: the brief the user reads on screen shows the plan's own source video
> layout. The brief the cooking agent reads is a separate markdown file, `brief.md`, written
> into the run's workspace when a cook starts. That file carries more: the chosen hook and
> the chosen script variant from the remix session, the persona, and the source video's
> transcript and beats. The remix session's chosen hook is composed into the read but is not
> shown anywhere in the on screen brief; only the cook's `brief.md` surfaces it. The two
> layouts agree in the normal finish flow because they describe the same video, and can
> diverge only if a plan is hand edited to a different source video than the remix used.

### Leave without acting

Leaving the studio page records nothing. The brief is a read; there is no dirty state, no
draft, no autosave here. The plan, its script, and its remix session were all persisted by
the features that made them. Returning to the page rebuilds the same brief from the current
data.

### Begin acting

There is no acting on the brief. The one thing the user does on this page is click Cook,
which starts a [cook run](cook-run.md) in the center panel. That click and everything after
it belongs to the cook run document.

### While acting

Nothing in the brief pane changes while a cook runs. The brief is static once loaded; the
run pills, elapsed clock, and terminal output all live in the panel. See
[cook run](cook-run.md) for what moves while a cook is in flight.

### Finish

The brief has nothing to commit. What finishes on this page is the cook, whose success
captures a render and unlocks Publish, both owned by [cook run](cook-run.md) and
[publish](publish.md). The user lands next inside the panel, or follows the "source outlier"
link back to the [video detail page](../feed/video-detail.md).

## Variants

| Variant | Set on arrival | Changed while acting |
| --- | --- | --- |
| Record state (planned post draft, scheduled, missed, or published) | No effect on the brief. The same title, script line, and layout render whatever the plan's state. State drives the panel's Publish and Save, not the brief. See [publish](publish.md). | The brief does not act, so state does not change here. A state change made elsewhere shows on the next re-read. |
| Attached data present or absent (script, source video, frame pass layout, remix session) | Decides most of what shows. A script gives its title, none gives "No script attached." A source video gives the score badge, the source outlier link, and the layout; none removes all three. A per beat layout gives the Visual direction blocks, none gives "Frame pass not run." A remix session feeds the cook's `brief.md` hook and variant but changes nothing the user sees on screen. | The brief is read once on load; attaching or detaching in another tab shows only after the page re-reads. |
| External service availability (LLM proxy, Graph, sidecar) | No effect. The brief is a database read that touches no external service. Those matter at Cook, not here. See [external services](../cross-cutting/external-services.md). | No effect on the brief. |
| Keyboard shortcut in play | None. The brief pane has no arrow navigation, no Enter, no Escape. The "source outlier" link is a plain link. | None. |

## Cancel and interrupt

The brief has no action to cancel and nothing in flight. Every cell below reflects that the
committing actions on this screen belong to the [cook run](cook-run.md) and
[publish](publish.md); the interrupt behavior of a running cook is theirs, not the brief's.

| Event | Before commit (reading the brief) | While in flight (a cook running, see cook-run.md) |
| --- | --- | --- |
| Explicit cancel or stop | Nothing to cancel. The brief writes nothing. Stop ends a cook and belongs to [cook run](cook-run.md). | Stop targets the cook run, not the brief. See [cook run](cook-run.md). |
| Navigate away mid action | Leaving records nothing; the plan is durable and rebuilds on return. | Leaving abandons the terminal view. The run keeps running server side; the panel reflects it on return. See [cook run](cook-run.md). |
| Reload or tab or window closed | Nothing lost. The forced dynamic route re-reads the brief on the next load. | The brief re-reads unchanged; whether the panel reattaches to the run is owned by [cook run](cook-run.md). |
| A backing service fails mid action | The brief read uses no external service, so it cannot fail on one. A database read that finds no plan is a 404, not an error state. | A failed cook is a cook run failure, surfaced in the panel. See [cook run](cook-run.md) and [external services](../cross-cutting/external-services.md). |
| The target record changes underneath | The brief is stale until it re-reads. A source video removed by a sync makes the video null on the next read, dropping the score badge, the source outlier link, and the layout while the plan keeps its now null link. A script detached elsewhere reads as "No script attached." A plan edited in another tab shows the old copy until re-read. | Same staleness. A record change does not disturb a running cook's terminal; the panel repaints its own run pill. See [the data model](../foundations/data-model.md). |
| A background job finishes or fails on its own | No effect on the brief. A cook completing while the user reads the brief updates the panel, not the brief pane. | Owned by [cook run](cook-run.md): the run pill and Output pane react to the run's own status. |
| A second tab or a double action on the same record | Two studio tabs on one plan both show the same brief; a read has no conflict. | Two cooks on one plan is a cook run concern. See [cook run](cook-run.md). |

After an interrupt on this page the user stays where they are with an unchanged plan. The
brief holds nothing that a reload could lose.

## Interactions with other systems

**Persistence and autosave.** The brief writes nothing. The plan, its script, and its remix
session were persisted by the [plan dialog](../mine/plan-dialog.md) and the
[remix](../remix/remix-overview.md) before the studio was ever opened. The one write tied to
this page is the cook's `brief.md`, written into the run workspace when a cook starts, which
is described from the cook's side in [cook run](cook-run.md). See
[persistence](../cross-cutting/persistence.md).

**History and undo.** Nothing to undo. The brief is a read. Undo for the plan and its script
lives in the features that create them.

**Navigation and refresh.** The route is forced dynamic and re-reads on every visit, so the
brief always reflects the current plan. The "source outlier" link points at
`/feed/{sourceVideoId}`. The page is reached by deep link from the
[finish stage](../remix/stage-finish.md) and the [plan dialog](../mine/plan-dialog.md). See
[navigation and shell](../foundations/navigation-and-shell.md).

**Background jobs and the sidecar.** The [sidecar sync](../foundations/background-jobs.md)
can remove the source video underneath the page, which drops the score badge, the source
outlier link, and the layout on the next read. The cook run is the background job this page
launches, and it is owned by [cook run](cook-run.md).

**External services.** The brief itself reaches none. Generation, the Graph API, and the
transcript providers matter to the cook and to publish, not to displaying the brief. A frame
pass, which would fill the Visual direction section, needs a language model with image input
that is not wired up in this build, so the section reports "Frame pass not run" for current
data. See [external services](../cross-cutting/external-services.md).

**Status and failures.** The only failure the brief itself can show is a 404 when the post id
resolves to no plan. There are no toasts on the brief; failures belong to the cook run and
publish panels. See [status and failures](../cross-cutting/status-and-failures.md).

**Configuration and settings.** No setting gates the brief. The `WORKSPACE_ROOT` config
decides where the cook's `brief.md` and the render land, which is a cook run concern. See
[cook run](cook-run.md).

## Edge cases

- No frame pass is wired up in this build, and nothing constructs a per beat layout, so the
  Visual direction section shows "Frame pass not run." for essentially all real plans. The
  per beat blocks are what the section will show once a frame pass exists.
- A layout row written before the layout became per beat (the old flat shape) is treated as
  no layout: the section reports "Frame pass not run." rather than pinning a whole video
  reading onto beats it never described.
- The on screen brief never shows the remix's chosen hook, even though the page reads it. The
  hook reaches only the cook's `brief.md`. A user reading the screen sees the title, the
  script line, and the layout, but not the hook the remix settled on.
- A plan with no source video shows just the title, the video kind chip if any, and the
  script line. No score badge, no source outlier link, and no layout.
- The score badge shows even when the source video has no computed outlier score; a null
  score renders as a dash followed by "score" rather than hiding the badge.
- A plan can outlive its script, its remix session, and its source video (see
  [the data model](../foundations/data-model.md)). The brief renders whatever survives: a
  detached script reads as "No script attached.", a removed source video drops its badge,
  link, and layout, and the page still loads on the plan alone.

## Open questions and verification

- That the Visual direction section shows "Frame pass not run." for all current plans was
  read from the schema comment that no frame pass client exists yet; it was not confirmed by
  loading a plan whose source video carries a stored per beat layout.
- Whether a source video removed by a sync between page load and a Cook click leaves the cook
  a usable `brief.md` was read from the composition path but not confirmed by hand; the
  divergence between the on screen layout (the plan's source video) and the cook's layout
  (the remix's source video) exists only under a hand edited plan and was not reproduced.
- Whether the studio route ever renders for a planned post in the published state, or whether
  the calendar and plan dialog only route drafts and scheduled plans here, was not confirmed
  by hand; the page itself does not gate on plan state.

Verified against this repo commit `4f26fb9`.
