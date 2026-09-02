# studio: architecture

## Key files

- `src/app/(shell)/mine/[postId]/studio/page.tsx`: the route. `force-dynamic` so
  `getStudioBrief` re-reads plan and video on every visit; a post id with no plan is a 404.
- `src/server/queries/studio.ts`: `getStudioBrief` composes the brief from three existing
  single-record loaders — the plan (`getPlannedPostById`), the source video detail
  (`getVideoDetail`, including the frame-pass `analysis.layout`), and the remix session the
  plan came from (`getRemixSession` plus that session's own video analysis).
- `src/components/studio/studio-screen.tsx`: the three-pane shell. Renders the Brief pane
  server-side (title, video-kind chip, score badge, script line, `source outlier` link,
  per-beat Visual direction or "Frame pass not run."), then mounts `StudioPanel`.
- `src/components/studio/studio-panel.tsx`: the client pane pair. Owns the Cook/Stop/Retry
  button, the run pill (`RUN_PILL`), the elapsed clock, the captured render, and the
  Publish and Save-to-calendar transitions. Starts nothing itself — it only renders what
  the terminal reports.
- `src/components/studio/terminal-pane.tsx`: the xterm.js pane wired to the per-post
  websocket. Relays keystrokes and output, and forwards `render` and `run` server frames up
  to the panel via `onRender`/`onRun`.
- `src/server/terminal/ws.ts`: `attachTerminal`, the server side of that socket — spawns
  the cook, writes `brief.md`, claims and updates the `create_runs` row, watches for the
  render, and keeps the cook alive across a detached socket.
- `src/server/studio/write-brief.ts`: `writeBrief` serializes the cook's richer `brief.md`
  (hook, chosen variant, persona, source transcript, per-beat layout) into the run sandbox.
- `src/server/studio/paths.ts`: `slugify`, `sandboxDir`, and `rendersDir` under
  `config.WORKSPACE_ROOT` — where `brief.md` and the render land.
- `src/server/actions/create-run-actions.ts`: `startCreateRunAction` (claims a `running`
  row), `stopCreateRunAction` (Stop), and `getPublishStateAction` (the mount-time gate).
- `src/server/queries/create-runs.ts`: the `create_runs` query layer —
  `getLatestCreateRunForPost`, `updateCreateRun`, and `reconcileOrphanCreateRuns` (startup
  cleanup of runs orphaned by a server restart).
- `src/server/terminal/render-watch.ts`, `src/server/terminal/session-registry.ts`: the
  render file watch and the per-postId `CookEntry` registry that lets a cook outlive its
  socket.

## Data flow

**Brief.** The route awaits `getStudioBrief(postId)`, 404s on null, and passes the result
to `StudioScreen`, which renders the Brief entirely server-side. No external service is
touched; the brief is a database read, so proxy/Graph/sidecar state is irrelevant to it.

**Cook.** Clicking Cook calls `inject("/ksa:cooking")`, which sends the command over the
terminal socket as one input line. On the server, `attachTerminal` reserves a `CookEntry`
for the postId synchronously (closing the double-spawn window), awaits `writeBrief` into the
sandbox, then queues the spawn on `runOnCookQueue`. The spawned session fires
`startCreateRunAction` (a `running` row, then patched with the pid), arms a long watchdog and
a waiting-idle check, and starts `watchForRender`. Status changes are pushed back as
`{type:"run",...}` frames; the panel repaints its pill and ticks the clock (measured from
when the panel first saw the run, on the user's machine — not the row's server start).

**Render and publish gate.** When `render-watch` finds the MP4, `ws.ts` stores it via the
asset store, updates the run to `success` with the `renderAssetId`, and sends a `render`
frame that fills the Output rail. Publish is gated two ways: the live `render` capture, and
`getPublishStateAction`, which the panel reads once on mount off the latest run's stored
`renderAssetId` so Publish survives a reload. Save to calendar has the stricter gate — it
needs the live in-session `render`, so a reload disables it while Publish stays on.

**Stop.** `stopCreateRunAction` signals the tracked pid's whole process group
(`process.kill(-pid)`) so ffmpeg/sub-agent children die with the cook, then marks the row
`canceled` whether or not a live process was found — a run whose process already exited
still ends canceled rather than stuck at `running`.

**Publish and save.** Publish opens a native confirm, then `inject("/ksa:serve")`; the app
writes nothing and the button does not change. Save to calendar calls
`markPlanPublishedAction(postId, null)` in a transition.

## Decisions

- **The panel never starts a run; the terminal layer does.** Cook types a slash command;
  `ws.ts` spawns the pty and claims the `create_runs` row, then reports status back. The
  panel is a pure view of those frames, which is why a reload (a fresh mount with no live
  frame yet) shows the Cook button and no pill even while the cook runs on server-side.
- **A cook outlives its socket.** The session, watchdog, render watch, and teardown
  controller live in a `session-registry` `CookEntry` keyed by postId, not in the socket's
  closure. Closing a tab detaches the viewer; it never kills the cook. A later attach for
  the same post reattaches and re-sends the latest run status rather than spawning a second.
- **Publish gates on a persisted `renderAssetId`, not client state.** The render is captured
  into the asset store and stamped on the run row, so `getPublishStateAction` can re-enable
  Publish after a reload from the database alone.
- **`brief.md` is written from real columns only.** `writeBrief` prefers the remix's chosen
  variant over the plan's attached script row, and omits any section with no backing field
  rather than printing an invented hook/angle/outline. A layout row in the old flat shape is
  treated as absent, not pinned onto beats it never described.
- **Save to calendar marks with a null own-post id.** `markPlanPublishedAction(postId, null)`
  is the legal "it went out, I'm not linking it" call, but the plan's published condition is
  derived from a non-null link, so the only durable effect is a bumped `updatedAt`. This is
  the known gap in the on-screen "Saved to calendar" label (see below).

## Open, not verified end to end

Per [05-backlog-to-enhance](05-backlog-to-enhance.md) and [04-test-cases](04-test-cases.md):

- **B-01** — Save to calendar's null-id write never reads as published; the "Saved to
  calendar" label is client state a reload discards.
- **B-06** — a reload during a live cook loses the panel's pill and clock (the run continues
  server-side and still gates Publish); the reattach path re-sends the latest status, but
  the panel does not restore the live view.
- **B-13** — after a reload Publish stays enabled off the stored render while Save to
  calendar disables (no live capture), so the two disagree.
- **B-17b** — the on-screen brief omits the remix hook and chosen variant; they reach only
  the cook's `brief.md`.
- No frame pass is wired up in this build, so Visual direction reads "Frame pass not run."
  for essentially all real plans, and the per-beat rows are unverifiable by hand.
