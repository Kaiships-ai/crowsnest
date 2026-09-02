# studio: concept brief

Where one dated plan is cooked into a rendered video and marked done. The last stop in the
core loop.

## What it is

The studio is the screen at `/mine/{postId}/studio`, one route per [planned post](../../shared/data-model.md),
that turns a plan into a finished vertical video. It is a three pane screen: a read only
Brief on the left describing what is about to be cooked, a live Claude Code terminal in the
center, and an Output rail on the right with the render preview, Publish, and Save to
calendar. The user reaches it two ways, both deep links: the [remix](../remix/03-feature-description.md)
finish stage's "Open the studio" link, and the [plan dialog](../mine/03-feature-description.md)'s
"Create in Studio" button. Either way the page opens on the brief.

The one durable thing that happens here is a cook run: clicking Cook types a `/ksa:cooking`
slash command into the terminal session, which spawns a long lived cook process, claims a
`create_runs` row, and renders an MP4 into the run's workspace. A status pill, an elapsed
clock, and the streamed terminal output show it working; when the render lands it appears in
the Output rail and gates Publish. Publish then types `/ksa:serve` into the same session
(the official Graph API path) after a confirm. See [03-feature-description](03-feature-description.md)
for the full behavior and [04-test-cases](04-test-cases.md) for the checks.

## Why it exists

The rest of the app finds outliers, saves them, remixes a script, and schedules a plan on a
calendar; none of that produces a video. The studio is the component that closes the loop:
it takes the plan the remix built and hands a cooking agent everything it needs to actually
render the reel, then lets the user publish it. The cook is deliberately an agent session in
a terminal rather than a fixed pipeline, so the render logic lives in the Claude Code
harness and its slash commands, not in the Next.js app; the app's job is to compose the
brief, spawn and track the run, and surface the result.

The brief the agent reads is a separate `brief.md` written into the run workspace on cook
start, richer than the on screen brief: it carries the remix's chosen hook and script
variant, the persona, and the source video's transcript and beats. The on screen brief is
just enough for the user to confirm what they are about to cook.

## Boundaries

The studio owns the studio screen, the cook run's launch and status tracking, the render
capture that gates publish, and the two publish controls. It does not own what the cook
agent actually does inside the session: the harness, its `/ksa:cooking` and `/ksa:serve`
commands, the pty, and the websocket frames are terminal internals, out of scope here (see
[background jobs](../../shared/background-jobs.md), which owns the five create-run statuses).
It does not own the plan, its script, or its remix session, all persisted before the studio
opens (see [mine](../mine/03-feature-description.md) and [remix](../remix/03-feature-description.md)).
Publishing to Instagram is likewise the injected `/ksa:serve` agent's concern; the app's own
planned-posts table has no network path, and Save to calendar only marks a row by hand. A
frame pass, which would fill the brief's Visual direction section, is not wired up in this
build, so that section reads "Frame pass not run." for essentially all real plans.
