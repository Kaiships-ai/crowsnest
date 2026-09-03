# studio: feature description

The studio is the last stop in the core loop: a plan turned into a rendered video and, from there, published or marked done. It lives at `/mine/{postId}/studio`, one route per planned post. It is reached two ways, both deep links: the remix finish stage's "Open the studio" link after it creates the plan (see [remix](../remix/03-feature-description.md)), and the plan dialog's "Create in Studio" button in edit mode, which is how a plan opened from the calendar reaches here (see [mine](../mine/03-feature-description.md)). Either way the page opens on the brief.

The page has three parts: a read only Brief on the left describing what is about to be cooked, a live Claude Code terminal in the center that the Cook button drives, and an Output rail on the right carrying the render preview, Publish, and Save to calendar. The terminal's session spawns the moment the page loads, before any click; Cook only sends it a command. The run's five statuses, and the sidecar sync that is unrelated to it, are owned by [background jobs](../../shared/background-jobs.md).

## 1. Feature summary

Legend: ● Built, ◐ Partial, ○ Roadmap.

| # | Feature | What it does | Status | Grounded in | Open item |
| --- | --- | --- | --- | --- | --- |
| 2 | View the brief | Read only summary of the plan, its script, and the source video's layout, composed server side | ● | `queries/studio.ts` (getStudioBrief) | B-17b, the on screen brief omits the remix hook and chosen variant |
| 3 | Cook a post | Type `/ksa:cooking` into the already running session and watch it render | ● | `terminal/ws.ts` (attachTerminal), `studio-panel.tsx` | B-06, a reload loses the live pill and clock |
| 4 | Publish to Instagram | Type `/ksa:serve` into the session after a confirm | ● | `studio-panel.tsx` (publish) | none |
| 5 | Save to calendar | Mark the plan done in the app's own database, with no network call | ● | `actions/planned-post-actions.ts` (markPlanPublishedAction) | none |

## 2. View the brief

### Who uses it

The user, arriving from the remix finish stage or the plan dialog's "Create in Studio" button.

### What it does

`getStudioBrief` composes three existing single record loaders into one read: the plan itself, the source video's detail when the plan carries a source video id, and the remix session the plan came from when it carries a remix session id. The left pane renders the plan's title, a chip for its video kind, a score badge carrying the source outlier's multiplier, a "Script" line naming the attached script or saying none is attached with a link back to the source outlier, and a "Visual direction" block listing the source video's shot by shot layout one block per beat, or saying the frame pass has not run. Each beat block shows the beat's label, its window as M:SS to M:SS, and six labeled rows: on screen text, animation, demo cursor, tool demo, text position, voice pace. There is no committing action on this pane; it is a read.

### How to access it

It is the left pane of the studio screen, rendered on every visit since the route is `force-dynamic`. There is no separate page or trigger.

### Business rules

- A post id that resolves to no plan is a 404, not an empty brief.
- The brief on screen never shows the remix's chosen hook or its chosen script variant. Those reach only the cook's `brief.md`, a richer markdown file `writeBrief` writes into the run's sandbox directory when the terminal session spawns.
- A layout row written before the layout became per beat (the old flat shape) is treated as no layout, reported as "Frame pass not run." rather than pinned onto beats it never described.
- A plan can outlive its script, its remix session, and its source video. The brief renders whatever survives: a detached script reads as "No script attached.", a removed source video drops its score badge, its source outlier link, and its layout, and the page still loads on the plan alone.
- The score badge shows even when the source video has no computed outlier score; a null score renders as a dash followed by "score" rather than hiding the badge.

### Limitations

- No frame pass is wired up in this build, so Visual direction reads "Frame pass not run." for essentially all real plans.
- The brief needs no external service, but it also cannot show anything an external service would have supplied; a stale sync means a stale score badge, not an error.

### User guide

When you open the studio for a plan, the left panel shows what you are about to cook: the title, the kind of video, a score for how well the source post performed, the script you are working from, and a shot by shot breakdown of the source video once a frame pass has produced one. Nothing here needs to be filled in or saved; it simply reflects the plan as it stands. If a piece is missing, for example no script or no source video, that section just says so rather than showing a blank space.

## 3. Cook a post

### Who uses it

The user, on the studio page for a planned post.

### What it does

Opening the studio page mounts the terminal pane, which opens a per post websocket right away. The server resolves the post, writes `brief.md` into a sandbox directory, and spawns a Claude Code session there with the `ksa` plugin loaded. That spawn claims a `create_runs` row in `running` status immediately, independent of anything the user has clicked. The Cook button's job is narrower than that: it types `/ksa:cooking` into the session that is already running. The center pane streams the session's raw output as it works. A status pill next to the button repaints as the run's status changes ("cooking" while the process works, "waiting on you" when it goes quiet waiting on the next step), and a clock beside it counts up from the moment the panel first saw the run. When the render lands, the pill reads "done", the clock stops, and the video appears in the Output rail, which is what makes the post publishable. Clicking Stop while it is live ends the run as "canceled"; after any ending the button reads "Retry cook" and a click types the command again into the same session.

### How to access it

The Cook button in the center pane, next to the terminal. A "view run" link beside the pill points at the run's own page on the Runs screen, outside the core loop.

### Business rules

- The session spawns on socket attach, not on the Cook click. A page reload reopens the socket and claims a fresh `create_runs` row; a second attach for the same post while one is already live reattaches instead of spawning a second session.
- Input typed before the session's first output is queued and flushed once the session proves it is listening (or after an 8 second fallback), so a fast click right after the page loads is never dropped.
- Stop signals the tracked pid's whole process group so ffmpeg and any sub-agent children die with the cook, then marks the row canceled whether or not a live process was found to kill, a run whose process already exited still ends canceled rather than staying stuck at "running".
- A 6 hour watchdog kills a hung session. A separate check flips a quiet run to "waiting" after 20 seconds of no output, clearing the watchdog while a human is expected to be reading a prompt, and flips it back and re-arms the watchdog the moment output resumes.
- A stale `running` or `waiting` row whose pid is no longer alive is reconciled to "failed" once, at server startup, since a cook's pid dies with the server process that spawned it.
- The studio needs no external service to start or run a cook; it depends only on the local session and its rendering pipeline, not the LLM proxy, the Graph token, or the sidecar.

### Limitations

- After a reload while a cook is still running, the panel shows the Cook button and no pill, as if no run were live. The run is unaffected and finishes server side; only the page's view of it was reset (B-06).
- The clock is measured from when the panel first saw the run, on the user's machine, not from the run's recorded server start; a reload loses it entirely even though the cook is still working.
- Because the session and its `running` row are claimed on page mount, a run frame that arrives before the user has read the brief can show the pill and switch the button to Stop with no Cook click having happened; this follows from the code but has not been observed against the running app (see [architecture](02-architecture.md#7-open-not-verified)).

### User guide

Open a plan's studio page and you will see a terminal on Cook, ready to work. Click Cook to start the render. You will see a status next to the button (cooking, then done, failed, or canceled) and a clock counting how long it has taken. You can leave the page while it works; the cook keeps running and you can check on it later from the Runs screen. When it finishes successfully, the rendered video shows up on the right side of the screen and you can play it right there. If something goes wrong, the status reads failed and no video appears; you can click Retry cook to try again in the same session.

## 4. Publish to Instagram

### Who uses it

The user, once a cook has produced a render.

### What it does

Publish types `/ksa:serve` into the running session after a native confirm, which is the official Graph API path run from inside the agent session. The app itself writes nothing and the button does not change once the command is sent; whatever the serve does surfaces in the terminal, not on the button.

### How to access it

The Publish button in the Output rail, below the render preview.

### Business rules

- Publish is enabled only when the post's latest `create_runs` row carries a stored `render_asset_id`, read once when the panel mounts, so the gate survives a reload.
- Publish never disables itself after a click, so a fast double click can inject `/ksa:serve` twice into the session.
- The planned posts table has no code path to any network call; the only thing that could reach Instagram is the injected command inside the agent session.

### Limitations

- Publish gives no app side success or failure signal. A bad Graph token or a proxy outage fails only inside the terminal, where the user has to read it.
- The confirm reads "Publish this render to Instagram?" but the app itself publishes nothing; wording aside, the actual reach comes from the serve command.

### User guide

Once a render finishes, the Publish button becomes available. Click it, confirm you want to publish to Instagram, and the app hands that off to the same session that cooked the video, which posts it through Instagram's official API. Watch the terminal for what happens next; the button itself will not tell you whether it succeeded.

## 5. Save to calendar

### Who uses it

The user, once a render has been captured in the current session, as an alternative to publishing through Instagram.

### What it does

Save to calendar calls `markPlanPublishedAction(postId, null)`, marking the planned post done without any network call. On success the button reads "Saved to calendar" and stays disabled for the rest of the visit; on failure a red line under it names the reason and the button re-enables.

### How to access it

The Save to calendar button in the Output rail, below Publish.

### Business rules

- Save to calendar needs a render captured live in the current session; a fresh page mount starts it disabled even when Publish is already enabled from an earlier session's stored render.
- The write passes a null own post id, "it went out, I'm not linking it." The write stores `state: "published"` directly, so the plan flips to published even with no linked own post (B-01, fixed); the own post id is still recorded when one is given.
- If the plan was deleted in another tab, the write fails with "That planned post no longer exists" as a red line, and nothing is marked.

### Limitations

- The "Saved to calendar" label is client state only; a reload discards the label, though the plan itself still reads as published, since the write is durable.
- After a reload, Publish can stay enabled off the stored render while Save to calendar is disabled, since Save to calendar's gate needs a live capture that a reload throws away (B-13).

### User guide

If you would rather mark a post handled without publishing it through Instagram, for example you posted it another way, click Save to calendar once a render has finished. The button will confirm with "Saved to calendar," and the plan's status on the calendar flips to published. Note that the on screen label itself does not persist across a reload, even though the underlying status change does.

## 6. Interactions with other systems

Persistence and autosave. The brief writes nothing. The `create_runs` row and its final status are durable, owned by [background jobs](../../shared/background-jobs.md); the pill, the clock, and the captured render on the panel are live view state only and reset on a reload. The render's stored `render_asset_id` is the one thing that survives a reload, which is what keeps Publish's gate honest.

Navigation and refresh. The studio route is `force-dynamic` and re-reads the brief on every visit. The cook controls do not call `router.refresh`; they repaint from the live websocket as frames arrive. Save to calendar's result does not repaint the calendar; a plan marked here shows there only once that page loads fresh.

Background jobs and the sidecar. The cook run is a background job, owned in full by [background jobs](../../shared/background-jobs.md), which is where its five statuses and the render watch are defined. The sidecar sync is unrelated to a cook and is not needed for one.

External services. Starting, watching, and stopping a cook need none of the LLM proxy, the Graph token, or the sidecar. Publish's `/ksa:serve` uses the Graph API, but only from inside the agent session, not from app code. See [external services](../../shared/external-services.md).

Status and failures. The pill is the run's status surface on this panel. A failed run also surfaces in the shell's failure strip. See [status and failures](../../shared/status-and-failures.md).

Configuration and settings. `WORKSPACE_ROOT` decides where `brief.md` and the render land. The cook's watchdog, its concurrency limit, and its waiting idle threshold are environment defaults, not user settings.

## 7. Edge cases

- Opening the studio page spawns a session and claims a running create run before Cook is ever clicked; the Cook button only types a command into that session. A reload does this again, claiming a fresh row each time.
- After a reload during a live cook, the panel shows no pill, no clock, and the Cook button, as if nothing were running, while the run continues server side and still gates Publish once it finishes (B-06).
- Publish can stay enabled after a reload while Save to calendar disables, because they read different sources: Publish reads the row's stored render, Save to calendar needs a live capture (B-13).
- Save to calendar's on screen "Saved to calendar" label is client state and does not survive a reload, even though the write itself is durable and the plan reads as published (B-01, fixed).
- The on screen brief never shows the remix's chosen hook or chosen script variant, even though the page reads them; they reach only the cook's `brief.md` (B-17b).
- No frame pass is wired up in this build, so Visual direction reads "Frame pass not run." for essentially all real plans.
- An unrecognized run status falls back to the "canceled" pill rather than showing nothing.
