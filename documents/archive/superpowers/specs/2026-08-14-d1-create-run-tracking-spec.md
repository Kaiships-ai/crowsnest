# D1 create-run tracking spec

Status: draft, awaiting Kai's wireframe approval before build.
Roadmap: D1 is step 2 of 4 (E1 harness, D1 create-run tracking, E2 workspace out of vault, E3 commands and skills into Crowsnest). D1 rides on the E1 spawn. Build E1 first.

## Goal

Make a cook a tracked run. Today the cook is a live pty with no record: close the tab and it is gone, and nothing in `/runs` knows it happened. D1 adds a `create` run that starts when a cook starts, updates as it moves, survives a reload, and shows up in the runs list and the studio status strip. It also folds in the three cook-lifecycle blockers the debate raised (B1 waiting state, B2 decoupled publish, B3 survive tab close).

## Non-goals

- No harness profile work. That is E1 and D1 depends on it.
- No moving the workspace, no plugin dir, no brief.md. E2 and E3.
- No new analytics or measurement of the published post. Out of scope.

## Current state (grounded)

- There is no `runs` table. A "Run" is a read-only view built in `src/server/queries/runs.ts` over two real tables, `sync_jobs` (`schema.ts:424`) and `remix_runs` (`schema.ts:326`).
- `RunType` is `"sync" | "remix" | "download"` (`runs.ts:17`); `download` is declared but never produced. `RunStatus` is `"running" | "success" | "partial" | "failed"` (`runs.ts:18`).
- `listRuns(limit = 100)` (`runs.ts:125`) and `getRun(runId)` (`runs.ts:138`) are the read functions. `RunSummary` (`runs.ts:20-36`), `RunDetail extends RunSummary` (`runs.ts:38-46`).
- `/runs` (`src/app/(shell)/runs/page.tsx`) seeds `RunsList` from `listRuns()` and keeps it live over SSE (`src/app/api/runs/stream/route.ts`, ~2s refresh). `/runs/[runId]` (`page.tsx`) renders `RunDetail` from `getRun(runId)`.
- No `startRunAction`, `updateRun`, or `createRun` exists. The two engines insert their own rows directly (`sync-engine.ts:241`, `remix.ts:82`).
- The studio status strip is the header row in `src/components/studio/studio-panel.tsx:42-51`: a "Claude Code" label, a frame-pass hint, and one Cook button whose label flips to "Retry cook" once `started`. No Stop, no elapsed, no pill.
- Publish is `publish = () => inject("/ksa:serve")` (`studio-panel.tsx:28`), sent into the live pty as a slash command. The button is gated by a captured render existing (`disabled={!render}`), but the render asset id is never handed to a publish server action. Publish is coupled to the live session.
- The cook dies on ws close: `ws.on("close", () => { renderWatch.stop(); session?.kill(); })` (`ws.ts:98-101`). No server-side persistence of the cook beyond the socket.
- Migrations live in `drizzle/`, named `NNNN_words.sql`, highest is `0019_deep_nekra.sql`. Apply with `npm run db:migrate` (`tsx src/server/db/migrate.ts`), which backs up first. The next migration is `0020`.
- Approved D1 mockup: `docs/design/mockups/create-run-tracking-preview.html`. It draws five states (idle, running/cooking, complete, failed, canceled) and a status strip with a status pill, elapsed time, a view-run link, Stop (while running), and Retry cook (after a run ends). The E-TIMEOUT variant reads "stopped responding". The mockup does NOT draw the "waiting on you" state (see the wireframe gap below).

## What D1 builds

### 1. The create_runs table (migration 0020)

A real table, unlike sync and remix which reuse existing engine tables. Columns (final names settled in the plan, this is the shape):

- `id` text primary key
- `postId` text, the planned post being cooked
- `slug` text, the sandbox slug
- `status` text: one of `running`, `waiting`, `success`, `failed`, `canceled`
- `startedAt`, `finishedAt` timestamps
- `heartbeatAt` timestamp, for orphan detection (mirrors the sync_jobs pattern)
- `renderAssetId` text null, the persisted render captured for this run
- `errorMessage` text null
- `pid` integer null, the cook process group id, for reconcile and Stop

Add `create` to `RunType`. Write a `fromCreateRun` mapper into `RunSummary`/`RunDetail` so `listRuns` and `getRun` include create runs alongside sync and remix. The unified `RunStatus` gains `waiting` and `canceled` for the create case (the plan decides whether to widen the shared type or map create statuses onto display values; the runs list must render all five create states).

### 2. Server actions and reconcile

- `startCreateRunAction(postId)`: inserts a `running` create_run and returns its id. Called when the cook is launched.
- An internal `updateCreateRun(id, patch)`: moves status, stamps `finishedAt`, records `renderAssetId`, `errorMessage`, `heartbeatAt`. Internal, not a public action.
- Orphan reconcile on boot: on server start, any create_run still `running` or `waiting` whose process is gone (or whose heartbeat is stale) is marked `failed` with a "stopped, server restarted" reason. Mirrors how sync jobs reconcile.

### 3. runs list and detail render the create run

`/runs` and `/runs/[runId]` render a create run the same way they render sync and remix, through the existing `RunsList` and `RunDetail` components. Create runs join the list in the same layer as the others (the mockup calls this Layer 1). A failed create run shows its error in place. The runs stream picks up create-run updates through the same SSE path.

### 4. Studio status strip

Replace the plain header row (`studio-panel.tsx:42-51`) with the status strip from the mockup:

- A status pill: idle, running, waiting, complete, failed, canceled, colored per the mockup (running uses the amber running dot; failed uses destructive; complete uses the positive green).
- Elapsed time, tabular figures, counting while running.
- A "view run" link to `/runs/[runId]` for this cook's create run.
- Stop, shown only while a cook is running. Stop ends the run early (kills the cook via the E1 process-group kill), sets status `canceled`.
- Retry cook, shown once a run has ended (complete, failed, or canceled). Starts a new create run.

### 5. Waiting on you (B1)

The cook has mandatory human gates (AskUserQuestion). While the cook sits at a gate, the run is `waiting`, not `running`, and the gate-aware watchdog does not fire. Detection, cheapest first: track output-idle time and flip the run to `waiting` when output stops at a prompt; a status heartbeat can refine it later. The E1 watchdog is a plain wall-clock timeout; D1 makes it gate-aware by not counting time spent in `waiting` against the timeout.

### 6. Confirmed publish on the persisted render (B2)

Publish moves off the live pty. Instead of injecting `/ksa:serve` into the session, publish runs against the persisted render asset id recorded on the create run, behind a confirm step, so it survives a reload and is not a one-click on a live storyboard. The exact publish mechanism (a server action that runs the serve path against the stored asset, versus a re-attach that injects the command) is settled in the plan; the requirement is that publish depends on the persisted `renderAssetId`, not on the pty still being open.

### 7. Cook survives tab close (B3)

Stop killing the cook on ws close while a cook is running. The pty keeps running server-side; the create run stays `running`/`waiting`. Reopening the studio reattaches to the live session (the run record plus the pty is what makes reattach possible; this is why B3 lives in D1, not E1). A ws close is no longer a cook kill.

## Acceptance criteria

1. Launching a cook creates a `create` run visible in `/runs` with status `running`, and a `view run` link from the studio opens its `/runs/[runId]` detail.
2. Closing the studio tab while a cook runs does not kill the cook. Reopening reattaches to the same live session and the run is still `running` or `waiting`.
3. When the cook sits at a human gate, the run shows `waiting` and the watchdog does not fire.
4. When the render lands, the run goes `success` and records the render asset id.
5. Publish works from the persisted render asset id after a full page reload, without the original pty session being open, behind a confirm.
6. Stop ends a running cook, kills its process group, and sets the run `canceled`.
7. A cook that dies unexpectedly (or a server restart mid-cook) reconciles to `failed` with a reason, not a stuck `running`.
8. The studio status strip matches the approved mockup: pill, elapsed, view-run, Stop while running, Retry cook after end.

## Wireframe gap to close before build

The approved mockup draws idle, running, complete, failed, and canceled. It does not draw the `waiting on you` state, which is locked decision B1 and section 5 of this spec. The D1 wireframe needs the waiting state added (pill treatment, strip copy, and the watchdog-paused behavior) and re-approved before build. Everything else in the mockup stands as approved.

## Open questions to settle in the plan

1. Type unification: widen the shared `RunStatus` to include `waiting` and `canceled`, or keep those on the create_run row and map to display values in `fromCreateRun`. Sync and remix rendering must not regress.
2. Reattach mechanism for B3: how the server holds the live pty across ws reconnects (a session registry keyed by create-run id) and how the client rebinds xterm to it.
3. Publish mechanism for B2: a server action running the serve path against the stored asset, versus a controlled re-inject. Whichever is chosen must not require the original socket.
4. Waiting detection: output-idle threshold value, and whether a status heartbeat from the cook is in D1 or deferred.

## Files touched (anticipated)

- `drizzle/0020_*.sql` (new create_runs table), `src/server/db/schema.ts`
- `src/server/queries/runs.ts` (create RunType, fromCreateRun, listRuns/getRun)
- new: create-run query/action modules (`src/server/queries/create-runs.ts`, `src/server/actions/create-run-actions.ts`)
- `src/server/terminal/ws.ts` (do not kill on close during a cook, session registry, heartbeat, waiting detection)
- `src/components/studio/studio-panel.tsx` and `terminal-pane.tsx` (status strip, Stop, Retry, view-run, reattach)
- a boot reconcile hook (where the server starts sync reconcile today)
