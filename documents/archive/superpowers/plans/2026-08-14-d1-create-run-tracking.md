# D1 create-run tracking implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a cook a tracked run: a create_run record that starts with the cook, updates as it moves, survives a tab close, shows in /runs and the studio status strip, folds in a waiting state, a decoupled publish, and reattach.

**Architecture:** A real create_runs table (unlike sync and remix, which reuse engine tables). A query/action layer writes and reads it. runs.ts gains a create RunType so the existing /runs list and detail render it. The studio status strip reads the run and gains Stop and Retry. ws.ts holds the pty in a per-post registry so a closed tab does not kill a running cook, and a reopened tab reattaches. Output-idle detection flips the run to waiting and pauses the watchdog. Publish gates on the persisted render asset id, not the live socket.

**Tech Stack:** TypeScript, drizzle-orm + better-sqlite3, Next server actions, React client components, node-pty + ws, vitest.

**Spec:** docs/superpowers/specs/2026-08-14-d1-create-run-tracking-spec.md

**Branch:** feat/d1-create-run-tracking, stacked on feat/e1-harness-hub (E1 must be in the branch history). E1 gives buildCookProfile, createTerminalSession(profile), runOnCookQueue, the AbortController-based watchdog in ws.ts, and the process-group kill.

## Global Constraints

- No `runs` table exists; a Run is a unified read in src/server/queries/runs.ts over sync_jobs and remix_runs. D1 adds create_runs as a real table and a `create` RunType. Do not break sync or remix rendering.
- Migrations: drizzle/NNNN_words.sql, highest today is 0019. Generate with `npm run db:generate` (drizzle-kit), never hand-write the SQL. Apply with `npm run db:migrate` (it backs up first). Reading migrations is fine; the generator writes 0020.
- The dev DB is data/crowsnest.db. Migration 0011-0013 were hand-applied historically, so db:migrate can trip on "table already exists"; if it does, that is a known dev-DB desync, not a plan defect. Run migrations against a throwaway/temp DB for the test, or note the desync and continue.
- npm/node are not on the default PATH; prefix commands with `export PATH="/opt/homebrew/bin:$PATH"`.
- The verification gate for every task is BOTH `npm run typecheck` and the task's vitest files. typecheck over the whole repo is required; vitest alone missed real type errors on the E1 branch.
- RunStatus is currently `"running" | "success" | "partial" | "failed"`. Widen it to add `"waiting"` and `"canceled"`. fromSyncJob casts `row.status as RunStatus` and fromRemixRun computes only success/failed, so widening the union does not change their output.
- The studio ws is keyed by `?post=<postId>` (terminal-pane.tsx:71). One cook per post. The session registry is keyed by postId.
- Cook lifecycle stays inside the E1 harness: createTerminalSession(buildCookProfile(dir)), runOnCookQueue, process-group kill. Do not re-implement the spawn.

## Approved UI (the mockup)

docs/design/mockups/create-run-tracking-preview.html is the approved status strip. States: idle, running, waiting on you (added, see the approved D1 wireframe d1-e2-e3-specs.html), complete (success), failed, canceled. Pill colors: running amber dot, waiting blue, complete green (--pos), failed destructive. Elapsed uses tabular figures. Stop shows only while running; Retry cook shows once a run has ended. A view-run link opens /runs/[runId].

---

### Task 1: create_runs table and migration

**Files:**
- Modify: `src/server/db/schema.ts` (add the table near syncJobs/remixRuns)
- Create: `drizzle/0020_*.sql` (generated, do not hand-write)
- Test: `src/server/db/schema.test.ts` if one exists, else a small migration-applies test

**Interfaces:**
- Produces: `tables.createRuns` with `$inferSelect` shape below.

- [ ] **Step 1: Add the table to schema.ts**

Follow the `syncJobs` pattern (schema.ts:424). Add:

```ts
export const createRuns = sqliteTable("create_runs", {
  id: text("id").primaryKey(),
  postId: text("post_id").notNull(),
  slug: text("slug").notNull(),
  status: text("status").notNull(), // "running" | "waiting" | "success" | "failed" | "canceled"
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  heartbeatAt: text("heartbeat_at"),
  renderAssetId: text("render_asset_id"),
  errorMessage: text("error_message"),
  pid: integer("pid"),
}, (t) => [
  index("create_runs_post").on(t.postId),
  index("create_runs_started").on(t.startedAt),
]);
```

Match the file's import list (sqliteTable, text, integer, index are already imported for syncJobs). Export it the same way syncJobs is exported and confirm it is reachable as `tables.createRuns` (check how src/server/db/index.ts aggregates `tables`).

- [ ] **Step 2: Generate the migration**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npm run db:generate`
Expected: a new `drizzle/0020_*.sql` creating `create_runs`. Read it; confirm it creates the table and the two indexes and touches nothing else.

- [ ] **Step 3: Verify it applies to a fresh DB**

Apply against a temp DB so the dev-DB desync does not interfere:
Run: `export PATH="/opt/homebrew/bin:$PATH" && CROWSNEST_DB_PATH=data/tmp/d1-test.db npm run db:migrate`
Expected: migrations apply cleanly through 0020, no error. Delete the temp DB after. If db:migrate cannot target a temp path cleanly, instead write a vitest that opens an in-memory or temp better-sqlite3, runs the drizzle migrator against `./drizzle`, and asserts a `create_runs` table exists (follow any existing migration test; if none, this is the test to add).

- [ ] **Step 4: typecheck**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema.ts drizzle/
git commit -m "feat(create-runs): create_runs table and migration 0020"
```

---

### Task 2: create-runs query and actions

**Files:**
- Create: `src/server/queries/create-runs.ts` (reads)
- Create: `src/server/actions/create-run-actions.ts` (server actions)
- Test: `src/server/queries/create-runs.test.ts`

**Interfaces:**
- Consumes: `tables.createRuns`, `db` from `@/server/db`.
- Produces:
  - `type CreateRunStatus = "running" | "waiting" | "success" | "failed" | "canceled"`
  - `getCreateRun(id: string): CreateRunSelect | null`
  - `getLatestCreateRunForPost(postId: string): CreateRunSelect | null`
  - `startCreateRunAction(input: { postId: string; slug: string }): Promise<ActionResult<{ runId: string }>>` (inserts a `running` row, returns its id)
  - `updateCreateRun(id: string, patch: Partial<{ status: CreateRunStatus; finishedAt: string; heartbeatAt: string; renderAssetId: string; errorMessage: string; pid: number }>): void` (internal, not a public action; a plain exported function the ws layer calls)
  - `reconcileOrphanCreateRuns(now?: number): number` (marks any running/waiting row whose process is gone or heartbeat is stale as failed with a reason; returns count)

- [ ] **Step 1: Write the failing test**

Cover: startCreateRunAction inserts a running row and returns an id; updateCreateRun moves status and stamps fields; getCreateRun / getLatestCreateRunForPost read back; reconcileOrphanCreateRuns marks a stale running row failed. Use the repo's db test harness (look at how create-runs' sibling tests set up a temp/in-memory db, e.g. an existing `*.test.ts` under src/server/queries or src/server/services that hits the db). Match `ActionResult` shape from the existing actions (see `startSyncAction` in src/server/actions/sync-actions.ts and its `ActionResult<T>` type; import the same type).

- [ ] **Step 2: Run it, verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/queries/create-runs.test.ts`

- [ ] **Step 3: Implement the reads (create-runs.ts) and actions (create-run-actions.ts)**

Reads mirror runs.ts's select style (`db.select().from(tables.createRuns).where(eq(...)).get()`). startCreateRunAction generates an id (match how sync generates ids, e.g. crypto.randomUUID or the repo's id helper) and inserts `{ id, postId, slug, status: "running", startedAt: new Date().toISOString() }`. updateCreateRun does `db.update(tables.createRuns).set(patch).where(eq(tables.createRuns.id, id)).run()`. reconcileOrphanCreateRuns selects running/waiting rows and, for each whose pid is absent or `process.kill(pid, 0)` throws ESRCH, sets status failed with errorMessage "stopped, server restarted". Read the actions file's "use server" and ActionResult conventions first and match them exactly.

- [ ] **Step 4: Run the test, verify it passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/queries/create-runs.test.ts`
Then `export PATH="/opt/homebrew/bin:$PATH" && npm run typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/queries/create-runs.ts src/server/actions/create-run-actions.ts src/server/queries/create-runs.test.ts
git commit -m "feat(create-runs): query layer, actions, orphan reconcile"
```

---

### Task 3: runs.ts integration (create RunType)

**Files:**
- Modify: `src/server/queries/runs.ts`
- Test: extend/create `src/server/queries/runs.test.ts`

**Interfaces:**
- Consumes: `tables.createRuns`, the CreateRun select type.
- Produces: RunType includes `"create"`; RunStatus includes `"waiting"` and `"canceled"`; listRuns and getRun include create rows.

- [ ] **Step 1: Write the failing test**

Assert: listRuns includes a create_run row mapped with `type: "create"`, correct title/sub/status, and sorted by startedAt among sync/remix; getRun(createRunId) returns a RunDetail for a create run. Insert a create_run row directly in the test db.

- [ ] **Step 2: Run it, verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/queries/runs.test.ts`

- [ ] **Step 3: Implement**

- Change line 17: `export type RunType = "sync" | "remix" | "download" | "create";`
- Change line 18: `export type RunStatus = "running" | "waiting" | "success" | "partial" | "failed" | "canceled";`
- Add `fromCreateRun(row: CreateRunSelect, now: number): RunSummary` mirroring fromSyncJob: `type: "create"`, `title: "Create: <slug>"` (or a nicer title from the post), `sub` a short status line ("cooking", "waiting on you", the errorMessage on failure), `status: row.status as RunStatus`, durationMs via durationOf, item counts 0, channels null, `renderAssetId` is not part of RunSummary so it is not surfaced here (it is read directly from the create_run where needed).
- In listRuns: also `db.select().from(tables.createRuns).orderBy(desc(...startedAt)).limit(limit).all()` and merge into `runs` before the sort/slice.
- In getRun: after the sync/remix lookup falls through, try `getCreateRun(runId)` and map with fromCreateRun; keep the events/itemsEnriched tail (create runs have no enrich events, itemsEnriched null).

- [ ] **Step 4: Verify**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/queries/runs.test.ts && npm run typecheck`
Expected: pass and clean. Also run the existing runs SSE/list component tests if any, to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add src/server/queries/runs.ts src/server/queries/runs.test.ts
git commit -m "feat(runs): create RunType, fromCreateRun, list and detail include create runs"
```

---

### Task 4: studio status strip, Stop, Retry, start the run on cook

**Files:**
- Modify: `src/components/studio/studio-panel.tsx`
- Modify: `src/components/studio/terminal-pane.tsx` (expose the create-run id and a status callback if needed)
- Modify: `src/server/terminal/ws.ts` (start a create_run when the cook launches; send its id to the client)
- Test: a component test for the strip states if the repo tests components; otherwise a server test for the run-start wiring

**Interfaces:**
- Consumes: startCreateRunAction, getLatestCreateRunForPost, the create-run id.
- Produces: the status strip renders pill + elapsed + view-run + Stop/Retry.

Design note on where the run starts: the cook is launched by injecting `/ksa:cooking` from studio-panel.tsx:27, but the pty and render capture live server-side in ws.ts. Start the create_run server-side in ws.ts when the cook actually spawns (so the run's pid is the cook's pid, needed for Stop and reconcile), and push the run id to the client over the ws as a new server message `{ type: "run", runId, status }`. The client stores it, renders the strip, and updates status on later `run` messages (running -> waiting -> success/failed). Add `run` to the ws server-message union in terminal-pane.tsx.

- [ ] **Step 1: Add the `run` server message and a status pill component**

In terminal-pane.tsx add `interface TerminalRunMessage { type: "run"; runId: string; status: string }` to the union and the type guard, and an `onRun?: (m: { runId: string; status: string }) => void` prop called when such a message arrives. In studio-panel.tsx add state `const [run, setRun] = useState<{ runId: string; status: string } | null>(null)` and pass `onRun={setRun}`.

- [ ] **Step 2: Render the strip**

Replace the header row (studio-panel.tsx:42-51). Keep the "Claude Code" label. Add, when `run` is set: a status pill (map status to label+color per the mockup: running amber, waiting blue "waiting on you", success green "complete", failed destructive, canceled muted), an elapsed timer (a small useEffect ticking every second from run start; read startedAt from the run message or track locally from when the first running arrived), a "view run" link `<a href={`/runs/${run.runId}`}>view run</a>`, and the action button: Stop while `status === "running" || status === "waiting"`, else Retry cook. Keep the existing Cook button behavior as the idle-state action.

- [ ] **Step 3: Wire Stop**

Stop calls a `stopCreateRunAction(runId)` (add it to create-run-actions.ts in this task or Task 2; if added here, note it) that kills the cook process group by the stored pid (reuse the E1 kill approach: `process.kill(-pid, "SIGTERM")` guarded) and sets status canceled. The client also closes/or leaves the terminal; the run pill flips to canceled via a `run` message or optimistic local state.

- [ ] **Step 4: Start the run in ws.ts on cook spawn**

In ws.ts, when the cook session is created (inside the runOnCookQueue task), call startCreateRunAction({ postId, slug }); on success, `updateCreateRun(runId, { pid: <cook pid>, heartbeatAt })` and `ws.send({ type: "run", runId, status: "running" })`. On session exit with a captured render, `updateCreateRun(runId, { status: "success", finishedAt, renderAssetId })` and send a `run` message; on exit without a render, mark failed; on watchdog kill, failed. Keep every existing guard.

- [ ] **Step 5: Verify**

typecheck clean; run the ws tests and any studio-panel test. Add or extend a test that a cook spawn calls startCreateRunAction and sends a `run` message (mock the action). Manual UI check is deferred to the live smoke.

- [ ] **Step 6: Commit**

```bash
git add src/components/studio/studio-panel.tsx src/components/studio/terminal-pane.tsx src/server/terminal/ws.ts src/server/actions/create-run-actions.ts
git commit -m "feat(studio): create-run status strip, Stop, Retry, run started on cook"
```

---

### Task 5: cook survives tab close, reattach on reopen (B3)

**Files:**
- Modify: `src/server/terminal/ws.ts`
- Create: `src/server/terminal/session-registry.ts`
- Test: `src/server/terminal/session-registry.test.ts` and extend ws.test.ts

**Interfaces:**
- Produces: a module-level registry `getLiveSession(postId)`, `putLiveSession(postId, session)`, `dropLiveSession(postId)`.

Design: today ws.ts kills the session on ws close. B3: while a cook is running, a ws close must NOT kill it. Instead the session lives in a per-post registry. On a new ws connection for a postId, if a live session exists, reattach (rebind onData/onExit to the new ws, replay is out of scope, just forward new output) instead of spawning. The session is removed from the registry only on real exit (onExit) or Stop.

- [ ] **Step 1: The registry**

```ts
// src/server/terminal/session-registry.ts
import type { TerminalSession } from "./session";
const live = new Map<string, TerminalSession>();
export function getLiveSession(postId: string): TerminalSession | undefined { return live.get(postId); }
export function putLiveSession(postId: string, s: TerminalSession): void { live.set(postId, s); }
export function dropLiveSession(postId: string): void { live.delete(postId); }
```

Test: put/get/drop round-trip.

- [ ] **Step 2: Reattach in ws.ts**

At attach, after resolving postId/slug, check `getLiveSession(postId)`. If present, bind the existing session's onData to this ws, bind ws input to session.write, do NOT spawn a new cook, do NOT start a new create_run, and send the current run status (`{ type: "run", runId, status }` looked up via getLatestCreateRunForPost). If absent, spawn as today and `putLiveSession(postId, session)` after creation.

- [ ] **Step 3: Do not kill on close during a running cook**

Change `ws.on("close")`: it must stop forwarding to this (now-dead) ws but must NOT call session.kill() while the run is still running/waiting. Only clear the ws-scoped listeners. The session stays in the registry. On real session exit (onExit), dropLiveSession(postId), mark the run terminal, and clear timers. Stop (Task 4) kills and drops. The watchdog still guards a truly hung cook.

Careful: the E1 code centralizes teardown in an AbortController abort listener that both stops the poll and kills the session. For B3 you must separate "this ws went away" (do not kill) from "the cook ended" (kill/drop). Restructure so ws close aborts only the ws-scoped forwarding, while the watchdog and render poll stay tied to the session lifetime in the registry, not the socket.

- [ ] **Step 4: Verify**

typecheck clean; ws.test.ts must still pass and gain a test that a close during a running cook does NOT kill the session (assert session.kill not called on close while a run is active) and that a second attach for the same postId reattaches to the existing session (assert createTerminalSession called once across two attaches).

- [ ] **Step 5: Commit**

```bash
git add src/server/terminal/session-registry.ts src/server/terminal/ws.ts src/server/terminal/session-registry.test.ts src/server/terminal/ws.test.ts
git commit -m "feat(studio): cook survives tab close, reattach on reopen"
```

---

### Task 6: waiting-on-you detection and gate-aware watchdog (B1)

**Files:**
- Modify: `src/server/terminal/ws.ts`
- Test: extend ws.test.ts (fake timers)

Design: the cook produces output while working and goes quiet at a human gate. Cheapest detection: an output-idle timer. Reset it on every pty data frame. If no output for `WAITING_IDLE_MS` (a new config key, default 20000), flip the run to waiting (updateCreateRun status waiting, send a `run` message). Any new output flips back to running. The watchdog must not fire while waiting: when the run is waiting, pause the watchdog (clear it); when it returns to running, restart it. So a human sitting at a gate never trips the 6h watchdog.

- [ ] **Step 1: Add config key**

Add `WAITING_IDLE_MS: intWithDefault(20_000, 2_000, 600_000)` to config.ts (cook harness group).

- [ ] **Step 2: Implement idle detection in ws.ts**

On session.onData: mark lastOutputAt = now, and if the run was waiting, flip it back to running (update + `run` message) and restart the watchdog. A recurring timer (every few seconds) checks `now - lastOutputAt > WAITING_IDLE_MS`; if so and the run is running, flip to waiting (update + `run` message) and clear the watchdog. Tie both timers to the session lifetime and clear them on exit/drop.

- [ ] **Step 3: Verify**

typecheck clean; add a fake-timer test: feed output, advance past WAITING_IDLE_MS with no output, assert the run went waiting and the watchdog was cleared; feed output again, assert it went running and the watchdog restarted.

- [ ] **Step 4: Commit**

```bash
git add src/server/terminal/ws.ts src/server/config.ts src/server/terminal/ws.test.ts
git commit -m "feat(studio): waiting-on-you detection, gate-aware watchdog"
```

---

### Task 7: decoupled publish on the persisted render (B2)

**Files:**
- Modify: `src/components/studio/studio-panel.tsx`
- Modify: `src/server/actions/create-run-actions.ts` (or a new publish action)
- Test: the action test

Design: today publish injects `/ksa:serve` into the live session and gates on the ephemeral client `render` state. B2: publish must survive a reload and depend on the persisted render asset id. Minimal coherent D1 form:

- On mount, studio-panel loads the latest create_run for the post (a server action `getPublishStateAction(postId)` returning `{ runId, renderAssetId } | null`). If renderAssetId is set, the Publish button is enabled after a reload with no live session.
- Publish shows a confirm (a simple window.confirm or a small dialog) before acting.
- Publish action: if a live session is reattached, inject `/ksa:serve` as today; if not, the action reattaches/spawns a harness session in the sandbox (reuse the E1 spawn) and injects `/ksa:serve` there. Gate strictly on the persisted renderAssetId, not the client `render`.

Ruling for this plan: keep publish injecting `/ksa:serve` (the serve command still runs in a claude session, unchanged, per the global constraint that E1/D1 do not change the cook or serve commands). The B2 change is (1) gate on the persisted renderAssetId so it survives reload, and (2) a confirm step. Spawning a fresh session purely for publish when none is live is deferred to E3 (where the command moves into Crowsnest and a server-run serve path becomes clean). Record this scope in the report: D1 publish survives reload and is confirmed, but still needs a live/reattached session to inject into; a fully headless publish is E3.

- [ ] **Step 1: Add getPublishStateAction and load it on mount**

`getPublishStateAction(postId): Promise<ActionResult<{ runId: string; renderAssetId: string } | null>>` reads getLatestCreateRunForPost and returns its renderAssetId if set. studio-panel loads it in a useEffect and enables Publish when renderAssetId exists (in addition to the live `render`).

- [ ] **Step 2: Confirm step**

Wrap publish() in a confirm ("Publish this render to Instagram?"). Only inject on confirm.

- [ ] **Step 3: Verify**

typecheck clean; test getPublishStateAction returns the persisted renderAssetId. Manual UI reload check deferred to live smoke.

- [ ] **Step 4: Commit**

```bash
git add src/components/studio/studio-panel.tsx src/server/actions/create-run-actions.ts src/server/actions/create-run-actions.test.ts
git commit -m "feat(studio): publish gated on the persisted render, confirmed"
```

---

## Global reconcile wiring

reconcileOrphanCreateRuns must run on server boot, next to wherever sync reconcile runs today. Find the boot hook (grep for where sync jobs reconcile on start, likely server.ts or a db bootstrap) and call reconcileOrphanCreateRuns there. If no such hook exists, add the call in server.ts after the db is ready. Fold this into Task 2's commit or Task 5's, and note where it landed.

## Self-review notes

- Spec coverage: create_runs table (T1), actions + reconcile (T2), runs.ts create type (T3), status strip + Stop + Retry + run-start (T4), survive-close + reattach (T5), waiting + gate-aware watchdog (T6), decoupled publish (T7).
- Known scope cut, recorded: T7 publish still injects /ksa:serve into a live/reattached session; a headless publish (no session) is E3. This honors the global constraint that D1 does not change the serve command.
- Risk: T5 (reattach) and T6 (waiting) both restructure ws.ts's E1 teardown, which centralizes kill + poll-stop in one AbortController. The hard part is separating "socket closed" (do not kill) from "cook ended" (kill + drop). The reviewer must confirm no path leaves a session orphaned in the registry forever, and no path kills a running cook on a mere socket close.
- RunStatus widening is safe for sync/remix (verified against fromSyncJob/fromRemixRun).
