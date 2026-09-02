# Logs observability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Tasks are grouped into waves. Every task inside a wave touches a disjoint set of files, so a wave can be run by parallel subagents at the same time. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the logs feature into an operational view of Runs: watch them live, trace one Run end to end, cancel or retry, get notified on failure or SLA breach, and flag Runs that run too slow or go stuck.

**Architecture:** Runs are read from the existing sync_jobs and remix_runs tables, unified by a query layer. log_events gains a run_id column so every line joins its Run. A Node SSE route pushes run status and new log lines to the browser. A notifications table plus the browser Notification API delivers alerts. SLA is two signals: heartbeat staleness (reuse the sync reaper threshold) and a wall clock budget per run type.

**Tech stack:** Next.js 16 (App Router, Turbopack, Node runtime routes), drizzle + better-sqlite3, next-themes (light theme already shipped), vitest.

**Design source of truth:** docs/superpowers/specs/2026-08-02-logs-observability-design.md and the approved mockup at "Crowsnest UI Mockups/logs-observability-mockup.html". UI tasks lift structure and token classes from the mockup, they do not invent a look.

## Global constraints

- Dev db is push based, not migration replay based. Apply new DDL by hand with sqlite3 against data/crowsnest.db. Do not run npm run db:migrate (it replays from 0000 and fails). See memory dev-db-not-migration-tracked.
- Amber (var(--score)) is reserved for the score and one primary action per screen. Run status uses foreground pulse (running), pos (success), muted (partial), destructive (failed/stuck). SLA and failure use the destructive token, never amber. Radius 0, flat, tabular mono for every number. These are enforced by the existing globals.css tokens, reuse them by name.
- Redaction and the token gated ingest path stay exactly as they are (spec 2026-07-31-system-logs-design.md). Do not weaken either.
- Run the dev server in a cmux pane, not the Bash tool (memory sandboxed-bash-reaps-servers). Browse at http://localhost:3000, never 127.0.0.1.
- Verification per task: npm run typecheck, npm run lint (pass bar is no new problems over baseline, the repo has pre-existing lint errors in the mockups dir and channel-card.tsx), and npm run test for tasks that add tests. The final wave is a live browser pass.
- Prose in any doc or comment is plain ASCII, no em or en dashes, straight quotes only (repo humanizer hook blocks .md writes otherwise).

## File ownership map (why the waves are safe to parallelize)

- Wave 0, Task 1: src/server/db/schema.ts, a hand applied DDL file.
- Wave 1 (5 parallel tasks), disjoint files:
  - Task 2: src/server/lib/logger.ts, src/server/logs/store.ts, src/app/api/logs/ingest/route.ts (+ their tests).
  - Task 3: src/server/queries/runs.ts (new, + test).
  - Task 4: src/server/notifications/store.ts (new, + test).
  - Task 5: src/server/runs/sla.ts (new, + test).
  - Task 6: src/server/settings/index.ts, src/server/actions/settings-actions.ts (+ test).
- Wave 2 (5 parallel tasks), disjoint files:
  - Task 7: src/app/api/runs/stream/route.ts (new), src/components/runs/use-run-stream.ts (new).
  - Task 8: src/app/(shell)/runs/page.tsx (new), src/components/runs/runs-list.tsx (new), src/components/layout/nav-items.tsx (edit, adds the Runs entry).
  - Task 9: src/app/(shell)/runs/[runId]/page.tsx (new), src/components/runs/run-detail.tsx (new).
  - Task 10: src/components/layout/topbar.tsx (edit), src/components/notifications/notification-center.tsx (new), src/server/actions/notification-actions.ts (new).
  - Task 11: src/app/(shell)/settings/page.tsx (edit), src/components/settings/runs-alerts-section.tsx (new).
- Wave 3 (sequential):
  - Task 12: src/server/services/sync-engine.ts (single owner of this file).
  - Task 13: browser QA, no edits.

The only shared read dependency across wave boundaries: wave 2 imports from wave 1 modules, so wave 1 must finish before wave 2 starts. Inside a wave, imports point only backward to wave 0/1, never sideways.

---

## Wave 0

### Task 1: Data model

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: `drizzle/manual/2026-08-02-logs-observability.sql` (hand applied, not run through db:migrate)

**Interfaces:**
- Produces: log_events.run_id (nullable text) + index; the notifications table; three app_settings values (syncSlaMinutes, remixSlaMinutes, notifyOnSuccess). Later tasks consume these.

- [ ] **Step 1: Add run_id to the logEvents table in schema.ts**

In the logEvents definition, add the column and an index:

```ts
export const logEvents = sqliteTable(
  "log_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: text("ts").notNull(),
    level: text("level").notNull(),
    source: text("source").notNull(),
    event: text("event").notNull(),
    fields: text("fields").notNull(),
    runId: text("run_id"), // nullable: not every line belongs to a Run (a frontend client error has none)
  },
  (t) => ({
    byLevel: index("log_events_level_id").on(t.level, t.id),
    bySource: index("log_events_source_id").on(t.source, t.id),
    byRun: index("log_events_run_id").on(t.runId, t.id),
  }),
);
```

- [ ] **Step 2: Add the notifications table in schema.ts**

Append near the logEvents table:

```ts
/**
 * One stored alert. Raised when a Run fails, finishes, or breaches its SLA. Survives
 * being missed (unlike a toast), which is the point: an overnight failure is still here
 * in the morning. readAt null means unread.
 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    createdAt: text("created_at").notNull(),
    kind: text("kind").notNull(), // "run_failed" | "run_finished" | "sla_breach"
    runId: text("run_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: text("read_at"),
  },
  (t) => ({
    byUnread: index("notifications_read_created").on(t.readAt, t.id),
  }),
);
```

- [ ] **Step 3: Add the three app_settings values**

Find the app_settings table (or the settings key list in src/server/settings) and add three keys, matching how the existing sync settings are declared: syncSlaMinutes (integer, default 10), remixSlaMinutes (integer, default 3), notifyOnSuccess (integer 0/1, default 0). Follow the exact pattern the file already uses for scoreBaselineWindow or feedDefaultMinScore. Do not invent a new settings mechanism.

- [ ] **Step 4: Write the hand applied DDL**

Create `drizzle/manual/2026-08-02-logs-observability.sql`:

```sql
ALTER TABLE log_events ADD COLUMN run_id TEXT;
CREATE INDEX IF NOT EXISTS log_events_run_id ON log_events (run_id, id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  run_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS notifications_read_created ON notifications (read_at, id);
```

The app_settings additions are key/value rows if that table is a KV store, or columns if it is columnar. Match the existing shape. If columnar, add the ALTER TABLE lines here too.

- [ ] **Step 5: Apply the DDL and verify**

Run: `sqlite3 data/crowsnest.db < drizzle/manual/2026-08-02-logs-observability.sql`
Then: `sqlite3 data/crowsnest.db ".schema log_events" ".schema notifications"`
Expected: run_id present on log_events, notifications table present.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/server/db/schema.ts drizzle/manual/2026-08-02-logs-observability.sql
git commit -m "feat(runs): data model for run tracing, notifications, sla budgets"
```

---

## Wave 1 (run Tasks 2 to 6 in parallel)

### Task 2: Trace plumbing

**Files:**
- Modify: `src/server/logs/store.ts`, `src/server/lib/logger.ts`, `src/app/api/logs/ingest/route.ts`
- Test: `src/server/logs/store.test.ts`, `src/app/api/logs/ingest/route.test.ts`

**Interfaces:**
- Consumes: log_events.run_id (Task 1).
- Produces: LogEventInput gains optional runId; queryLogEvents gains a runId filter; the ingest body accepts runId. A bridge derives run_id from fields.jobId when not passed explicitly, so existing sync emitters need no change (that is Task 12's job).

- [ ] **Step 1: Write failing tests in store.test.ts**

```ts
it("stores run_id and filters by it", () => {
  insertLogEvent({ ts: new Date().toISOString(), level: "info", source: "backend", event: "sync.started", fields: {}, runId: "job_a" });
  insertLogEvent({ ts: new Date().toISOString(), level: "info", source: "backend", event: "other", fields: {} });
  const rows = queryLogEvents({ levels: ["info"], runId: "job_a" });
  expect(rows).toHaveLength(1);
  expect(rows[0].runId).toBe("job_a");
});

it("derives run_id from fields.jobId when runId is not passed", () => {
  insertLogEvent({ ts: new Date().toISOString(), level: "info", source: "backend", event: "sync.finished", fields: { jobId: "job_b" } });
  const rows = queryLogEvents({ levels: ["info"], runId: "job_b" });
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npm run test -- store.test.ts`
Expected: FAIL (runId not on the type, filter not implemented).

- [ ] **Step 3: Implement in store.ts**

Add `runId?: string` to LogEventInput and LogEventRow. Add `runId?: string` to LogQueryFilter. In insertLogEvent, resolve the run id and write it:

```ts
export function insertLogEvent(input: LogEventInput): void {
  const clean = redactLogFields(input.fields ?? {});
  // Bridge: an explicit runId wins, otherwise fall back to a jobId already inside fields,
  // so the many existing sync emitters get a run_id for free without being rewritten.
  const runId = input.runId ?? (typeof input.fields?.jobId === "string" ? input.fields.jobId : null);
  db.insert(logEvents)
    .values({ ts: input.ts, level: input.level, source: input.source, event: input.event, fields: JSON.stringify(clean), runId })
    .run();
  db.run(sql`delete from log_events where id <= (select max(id) - ${RETENTION_MAX} from log_events)`);
}
```

In queryLogEvents, add the filter and map the column:

```ts
if (filter.runId) conds.push(eq(logEvents.runId, filter.runId));
```

and include `runId: r.runId ?? undefined` in the returned row mapping.

- [ ] **Step 4: Thread runId through logger.ts**

Add an optional last argument so a caller can attach a run id. Keep the existing signature working:

```ts
function emit(level: LogLevel, event: string, fields: LogFields = {}, runId?: string): void {
  // ...existing stdout/stderr write unchanged...
  if (level !== "debug") {
    try {
      insertLogEvent({ ts: new Date().toISOString(), level, source: "backend", event, fields, runId });
    } catch { /* a logging sink must never break the caller */ }
  }
}

export const log = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields, runId?: string) => emit("info", event, fields, runId),
  warn: (event: string, fields?: LogFields, runId?: string) => emit("warn", event, fields, runId),
  error: (event: string, fields?: LogFields, runId?: string) => emit("error", event, fields, runId),
};
```

- [ ] **Step 5: Accept runId in the ingest route**

In the zod Body, add `runId: z.string().optional()`. Pass it through to insertLogEvent. Add a test in route.test.ts that a POST with runId stores it. The token gate and redaction stay unchanged.

- [ ] **Step 6: Run tests, typecheck, lint, commit**

Run: `npm run test -- store.test.ts route.test.ts && npm run typecheck && npm run lint`
Expected: tests PASS, typecheck PASS, lint no new problems.

```bash
git add src/server/logs/store.ts src/server/lib/logger.ts src/app/api/logs/ingest/route.ts src/server/logs/store.test.ts src/app/api/logs/ingest/route.test.ts
git commit -m "feat(runs): trace log events by run_id, bridge from fields.jobId"
```

---

### Task 3: Runs query layer

**Files:**
- Create: `src/server/queries/runs.ts`, `src/server/queries/runs.test.ts`

**Interfaces:**
- Consumes: sync_jobs, remix_runs (existing), queryLogEvents (existing, Task 2 not required for read).
- Produces:
  - `type RunSummary = { runId: string; type: "sync" | "remix" | "download"; title: string; sub: string; status: "running" | "success" | "partial" | "failed"; startedAt: string; finishedAt: string | null; heartbeatAt: string | null; durationMs: number; itemsSeen: number; itemsCreated: number; itemsUpdated: number; itemsFailed: number; channelsDone: number | null; channelsTotal: number | null }`
  - `type RunDetail = RunSummary & { events: LogEventRow[] }`
  - `function listRuns(limit?: number): RunSummary[]`
  - `function getRun(runId: string): RunDetail | null`

- [ ] **Step 1: Write failing test**

```ts
import { listRuns, getRun } from "./runs";
it("lists sync jobs as runs, newest first", () => {
  // seed a sync_jobs row via the test db helper the repo already uses in other query tests
  const runs = listRuns();
  expect(Array.isArray(runs)).toBe(true);
});
```

Follow the existing pattern in the repo's other query tests (look at how channels queries are tested) for seeding sync_jobs. If no seed helper exists, insert a row through drizzle directly in the test.

- [ ] **Step 2: Run to verify fail**

Run: `npm run test -- runs.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement listRuns and getRun**

Map a sync_jobs row to RunSummary: type "sync", title is the channel handle or "Library sync" when lockKey is "__library__", sub is a short human line ("N channels" or "M new, K updated" on success, the error on failure). status is the row's status. durationMs is finishedAt minus startedAt, or now minus startedAt while running. Map remix_runs rows to type "remix" with title "Remix: <stage> stage". Union both, sort by startedAt desc, apply limit (default 50). getRun looks the id up in both tables, then attaches events via queryLogEvents({ runId, levels: ["info","warn","error"], limit: 500 }).

Keep this file read only (no writes). Import the drizzle db the same way store.ts does.

- [ ] **Step 4: Run test, typecheck, lint, commit**

Run: `npm run test -- runs.test.ts && npm run typecheck && npm run lint`
Expected: PASS, no new lint.

```bash
git add src/server/queries/runs.ts src/server/queries/runs.test.ts
git commit -m "feat(runs): query layer unifying sync and remix runs"
```

---

### Task 4: Notifications store

**Files:**
- Create: `src/server/notifications/store.ts`, `src/server/notifications/store.test.ts`

**Interfaces:**
- Consumes: notifications table (Task 1).
- Produces:
  - `type NotificationKind = "run_failed" | "run_finished" | "sla_breach"`
  - `type NotificationRow = { id: number; createdAt: string; kind: NotificationKind; runId: string | null; title: string; body: string; readAt: string | null }`
  - `function insertNotification(n: { kind: NotificationKind; runId?: string | null; title: string; body: string }): void`
  - `function listNotifications(limit?: number): NotificationRow[]`
  - `function unreadCount(): number`
  - `function markRead(id: number): void`
  - `function markAllRead(): void`

- [ ] **Step 1: Write failing test**

```ts
it("inserts, counts unread, and marks read", () => {
  insertNotification({ kind: "run_failed", runId: "job_x", title: "Sync failed", body: "boom" });
  expect(unreadCount()).toBe(1);
  const [n] = listNotifications();
  markRead(n.id);
  expect(unreadCount()).toBe(0);
});
```

- [ ] **Step 2: Run to verify fail, then implement**

Run: `npm run test -- notifications/store.test.ts` (FAIL). Implement each function with drizzle against the notifications table. createdAt is new Date().toISOString(). markRead sets readAt to now. unreadCount counts readAt is null. listNotifications orders by id desc, default limit 50.

- [ ] **Step 3: Run test, typecheck, lint, commit**

Run: `npm run test -- notifications/store.test.ts && npm run typecheck && npm run lint`

```bash
git add src/server/notifications/store.ts src/server/notifications/store.test.ts
git commit -m "feat(runs): notifications store"
```

---

### Task 5: SLA evaluation

**Files:**
- Create: `src/server/runs/sla.ts`, `src/server/runs/sla.test.ts`

**Interfaces:**
- Consumes: nothing at runtime (a pure function). The staleness threshold is a passed argument so the caller supplies the reaper's LOCK_STALE_MS.
- Produces:
  - `type SlaInput = { status: string; startedAt: string; heartbeatAt: string | null; budgetMs: number; staleMs: number; now: number }`
  - `type SlaVerdict = { overBudget: boolean; stuck: boolean; breach: boolean }`
  - `function evaluateSla(input: SlaInput): SlaVerdict`

- [ ] **Step 1: Write failing tests**

```ts
import { evaluateSla } from "./sla";
const base = { status: "running", startedAt: new Date(0).toISOString(), heartbeatAt: new Date(0).toISOString(), budgetMs: 600000, staleMs: 90000 };

it("flags over budget", () => {
  const v = evaluateSla({ ...base, now: 700000 }); // 700s elapsed, budget 600s
  expect(v.overBudget).toBe(true);
  expect(v.breach).toBe(true);
});
it("flags stuck when heartbeat is stale", () => {
  const v = evaluateSla({ ...base, heartbeatAt: new Date(0).toISOString(), now: 100000 }); // 100s since heartbeat, stale 90s
  expect(v.stuck).toBe(true);
});
it("finished runs never breach", () => {
  const v = evaluateSla({ ...base, status: "success", now: 999999999 });
  expect(v.breach).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail, then implement**

Run: `npm run test -- sla.test.ts` (FAIL). Implement: only a running run can breach. overBudget = running and (now - startedAt) > budgetMs. stuck = running and heartbeatAt not null and (now - heartbeatAt) > staleMs. breach = overBudget or stuck. Guard against unparseable dates (return all false).

- [ ] **Step 3: Run test, typecheck, lint, commit**

```bash
git add src/server/runs/sla.ts src/server/runs/sla.test.ts
git commit -m "feat(runs): sla evaluation (over budget plus stuck)"
```

---

### Task 6: Settings for budgets and notify

**Files:**
- Modify: `src/server/settings/index.ts` (the AppSettingsView type and defaults), `src/server/actions/settings-actions.ts`
- Test: the existing settings test, or a new one alongside

**Interfaces:**
- Consumes: the three app_settings values (Task 1).
- Produces: AppSettingsView gains syncSlaMinutes, remixSlaMinutes, notifyOnSuccess (typed like the existing numeric/boolean settings). updateAppSettingsAction accepts and validates them.

- [ ] **Step 1: Add the three to AppSettingsView and the read path**

Follow the exact shape the file uses for an existing numeric setting (for example scoreBaselineWindow) and an existing boolean if one exists. syncSlaMinutes default 10, remixSlaMinutes default 3, notifyOnSuccess default false.

- [ ] **Step 2: Validate them in updateAppSettingsAction**

Add zod validation matching the existing fields: minutes are positive integers with a sane max (for example 1 to 240), notifyOnSuccess is a boolean.

- [ ] **Step 3: Test, typecheck, lint, commit**

Run: `npm run test && npm run typecheck && npm run lint`

```bash
git add src/server/settings/index.ts src/server/actions/settings-actions.ts
git commit -m "feat(runs): sla budget and notify-on-success settings"
```

---

## Wave 2 (run Tasks 7 to 11 in parallel, after Wave 1 is merged)

### Task 7: SSE route and client hook

**Files:**
- Create: `src/app/api/runs/stream/route.ts`, `src/components/runs/use-run-stream.ts`

**Interfaces:**
- Consumes: listRuns, getRun (Task 3).
- Produces:
  - Route GET /api/runs/stream (Node runtime) that emits an SSE event every ~2s with the current listRuns() payload, and when given ?runId=, also the latest events for that run. Message shape: `data: {"runs": RunSummary[], "events": LogEventRow[] | null}`.
  - `function useRunStream(runId?: string): { runs: RunSummary[]; events: LogEventRow[]; connected: boolean }` using EventSource with auto reconnect.

- [ ] **Step 1: Write the route**

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { listRuns, getRun } from "@/server/queries/runs";

export async function GET(request: Request): Promise<Response> {
  const runId = new URL(request.url).searchParams.get("runId") ?? undefined;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const tick = () => {
        if (closed) return;
        const payload = { runs: listRuns(), events: runId ? (getRun(runId)?.events ?? []) : null };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      tick();
      const iv = setInterval(tick, 2000);
      request.signal.addEventListener("abort", () => { closed = true; clearInterval(iv); controller.close(); });
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
```

Polling the sqlite db every 2s on the server is the local-first, single-user simple path. It is not a WebSocket and not a client poll.

- [ ] **Step 2: Write the hook**

A client hook that opens an EventSource to /api/runs/stream (with runId when given), parses each message into state, sets connected true/false, and lets the browser EventSource auto reconnect. Include a manual close on unmount.

- [ ] **Step 3: Typecheck, lint, build, commit**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: build compiles (catches a bad route boundary).

```bash
git add src/app/api/runs/stream/route.ts src/components/runs/use-run-stream.ts
git commit -m "feat(runs): sse stream for live run status and log tail"
```

---

### Task 8: Run list page

**Files:**
- Create: `src/app/(shell)/runs/page.tsx`, `src/components/runs/runs-list.tsx`
- Modify: `src/components/layout/nav-items.tsx` (add the Runs entry in the System group)

**Interfaces:**
- Consumes: listRuns (Task 3), useRunStream (Task 7), the existing sync cancel/start actions.
- Produces: the /runs route.

- [ ] **Step 1: Add the nav entry**

Add `{ href: "/runs", label: "Runs", icon: <the runs icon>, group: "System" }` to NAV_ITEMS, matching the existing item shape. Put it in the same group as Settings.

- [ ] **Step 2: Build the page and list component**

The page (server component, force-dynamic) reads listRuns() for the first paint and renders RunsList with it. RunsList is a client component that seeds from the server rows, then subscribes to useRunStream() for live updates. Lift the table structure, columns, status dots, chips, progress bar, and buttons from the mockup screen 1 ("Crowsnest UI Mockups/logs-observability-mockup.html", the Run list section). Use the real UI kit components (Table, Button) and the token classes the mockup uses (dot colors, chip.sla, chip.stuck). A running row shows a Cancel that calls the existing sync cancel action; a failed/partial row shows Retry that calls the existing sync start action with the run's channel scope. A row click routes to /runs/[runId].

Do not hardcode colors. Use the same class names the rest of the app uses (bg-[var(--pos)], text-destructive, etc., exactly as sidebar.tsx does for status dots).

- [ ] **Step 3: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`

```bash
git add "src/app/(shell)/runs/page.tsx" src/components/runs/runs-list.tsx src/components/layout/nav-items.tsx
git commit -m "feat(runs): run list screen with live status and inline cancel/retry"
```

---

### Task 9: Run detail page

**Files:**
- Create: `src/app/(shell)/runs/[runId]/page.tsx`, `src/components/runs/run-detail.tsx`

**Interfaces:**
- Consumes: getRun (Task 3), useRunStream (Task 7).
- Produces: the /runs/[runId] route.

- [ ] **Step 1: Build the page and component**

The page (server, force-dynamic) reads getRun(params.runId); a null result renders a not-found message. RunDetail is a client component seeded from the server RunDetail, then subscribed to useRunStream(runId) so the header status and the log timeline tail update live. Lift the header (status word + dot, run_id, timing row, item-count tiles, Cancel/Follow live) and the trace timeline (expandable rows showing the fields JSON) from mockup screen 2. Level colors use the app's LEVEL_LABEL_CLASS convention already in logs-view.tsx (info muted, warn foreground, error destructive). The SLA chip appears only when the run is over budget or stuck (read from the run's own status plus timing, or from a serialized SLA verdict if the page computes one).

- [ ] **Step 2: Typecheck, lint, commit**

```bash
git add "src/app/(shell)/runs/[runId]/page.tsx" src/components/runs/run-detail.tsx
git commit -m "feat(runs): run detail screen with live trace timeline"
```

---

### Task 10: Notification center

**Files:**
- Create: `src/components/notifications/notification-center.tsx`, `src/server/actions/notification-actions.ts`
- Modify: `src/components/layout/topbar.tsx` (add the bell)

**Interfaces:**
- Consumes: listNotifications, unreadCount, markRead, markAllRead (Task 4).
- Produces: notification-actions.ts server actions wrapping the store; a bell button plus dropdown panel in the topbar.

- [ ] **Step 1: Server actions**

Create notification-actions.ts with "use server" actions: listNotificationsAction, markReadAction(id), markAllReadAction. Thin wrappers over the Task 4 store, same result-shape convention the repo's other actions use.

- [ ] **Step 2: Notification center component**

A client component: a bell button with an unread count badge (raised popover surface, never amber, matching the mockup) that opens a dropdown panel listing notifications. Lift the panel markup from mockup screen 3 (unread mark, kind chip fail/sla/done, title, body, relative time, Mark all read). Clicking a notification marks it read and, when it has a runId, routes to /runs/[runId]. On mount, request browser Notification permission once, and when new unread notifications arrive, fire a Notification for kinds run_failed and sla_breach (and run_finished only if the caller passed a flag, but the gating on success lives server side, so the client just renders what it is given).

- [ ] **Step 3: Mount the bell in the topbar**

Add the NotificationCenter into topbar.tsx's right-side actions, before or after the search pill. Keep the existing search and FailureStrip untouched.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
git add src/components/notifications/notification-center.tsx src/server/actions/notification-actions.ts src/components/layout/topbar.tsx
git commit -m "feat(runs): notification center with bell and browser alerts"
```

---

### Task 11: Settings section

**Files:**
- Create: `src/components/settings/runs-alerts-section.tsx`
- Modify: `src/app/(shell)/settings/page.tsx` (render it + nav item)

**Interfaces:**
- Consumes: the three settings (Task 6), updateAppSettingsAction.
- Produces: a "Runs and alerts" settings section.

- [ ] **Step 1: Build the section**

Follow feed-defaults-section.tsx as the template exactly (same SettingRow, NumberField, Switch, Save button, toast on save). Fields: sync SLA budget (minutes), remix SLA budget (minutes), a read-only heartbeat staleness line ("reuses the reaper threshold, not set here"), a browser-notifications switch, and a notify-on-success switch. Lift the copy and layout from mockup screen 4.

- [ ] **Step 2: Wire into the settings page**

Add `{ id: "runs-alerts", label: "Runs and alerts" }` to SETTINGS_NAV_ITEMS and render the section in its own `<div id="runs-alerts">` block, following the exact border/padding pattern the other sections use. Pass the three values from appSettings (already read in the page's Promise.all).

- [ ] **Step 3: Typecheck, lint, commit**

```bash
git add src/components/settings/runs-alerts-section.tsx "src/app/(shell)/settings/page.tsx"
git commit -m "feat(runs): settings for sla budgets and notify-on-success"
```

---

## Wave 3 (sequential)

### Task 12: Wire runs to notifications and SLA on finish

**Files:**
- Modify: `src/server/services/sync-engine.ts` (single owner of this file, why this is its own sequential task)

**Interfaces:**
- Consumes: insertNotification (Task 4), evaluateSla (Task 5), the reaper's LOCK_STALE_MS (already in this file), the notifyOnSuccess setting (Task 6).

- [ ] **Step 1: Raise a notification when a run finishes**

At the sync finish path (where sync.finished / sync.failed are logged, around the log.info("sync.finished", ...) call), after the job row is written, call insertNotification based on the final status: failed and partial always insert a run_failed notification with the error or the failed-count in the body; success inserts a run_finished only when the notifyOnSuccess setting is true. Use the run's jobId as runId so the notification deep links to /runs/[jobId].

- [ ] **Step 2: Raise an sla_breach notification from the reaper**

At the reaper (where sync.lock.reaped is logged), a reaped run is stuck by definition, so insert an sla_breach notification for it. If the finish path detects the run also went over budget (compute with evaluateSla using LOCK_STALE_MS and the syncSlaMinutes setting), insert an sla_breach there too. Do not auto cancel anything, per the spec.

- [ ] **Step 3: Typecheck, lint, test, build**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: all pass, no new lint.

- [ ] **Step 4: Commit**

```bash
git add src/server/services/sync-engine.ts
git commit -m "feat(runs): raise notifications on run finish and sla breach"
```

---

### Task 13: Live browser QA

**Files:** none (verification).

Bring the stack up with /crowsnest-up (user invoked) and browse http://localhost:3000.

- [ ] **Step 1:** Open /runs. Confirm the run list renders real rows from sync_jobs, statuses read correctly, and a running sync updates live without a manual refresh (start a sync from the sidebar and watch).
- [ ] **Step 2:** Open a run's detail. Confirm the header counts match and the log timeline tails live and expands to fields.
- [ ] **Step 3:** Trigger a failure (for example an unauthorized sidecar) and confirm a notification appears in the bell with an unread badge, and a browser notification fires if permission is granted.
- [ ] **Step 4:** In Settings, set the sync SLA budget low, run a sync that exceeds it, confirm the SLA chip and an sla_breach notification.
- [ ] **Step 5:** Check both dark and light themes on all four screens. Fix any hardcoded color found (there should be none if the token classes were used), commit each fix on its own.

---

## Self review notes

- Spec coverage: traceable (Tasks 1, 2, 3, 9), realtime (Task 7 plus the live wiring in 8 and 9), executable (Task 8 cancel/retry), notification (Tasks 1, 4, 10, 12), sla (Tasks 1, 5, 6, 11, 12). Data model kept as log_events plus run_id, runs read from sync_jobs and remix_runs (Task 3). All covered.
- Parallel safety: within each wave, the file ownership map has no shared file. sync-engine.ts is edited by exactly one task (12), in its own sequential wave, which is why the run_id threading into emitters is not done in Task 2 (the fields.jobId bridge covers it instead).
- Type consistency: RunSummary and RunDetail are defined once in Task 3 and consumed by Tasks 7, 8, 9. NotificationKind and NotificationRow are defined in Task 4 and consumed by Tasks 10, 12. SlaInput/SlaVerdict are defined in Task 5 and consumed by Task 12.
- Open assumption carried from the spec: SLA is treated as both signals. If Kai wants staleness only, drop the budget in Task 6 and the over-budget branch in Tasks 5 and 12.
