# M4a runs observability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the runs SSE resending an unchanged payload every 2 seconds, and land the run detail on its first error instead of the top of a long trace.

**Architecture:** Two tasks on disjoint files, so they can run in parallel. Task 1 dedupes the SSE stream (src/app/api/runs/stream/route.ts) so an idle run sends nothing after the first payload. Task 2 adds a first-error callout to the run detail (src/components/runs/run-detail.tsx) driven by a pure helper. This is the runs half of milestone 4. The run_id threading through the sync engine (M4-U1) is a separate broad change, planned on its own.

**Tech stack:** Next.js 16 (a Node streaming route, one "use client" component), TypeScript, vitest.

## Global constraints

- No new lint or type problem over baseline. tsc clean, lint 0 errors, tests green.
- npm and node are not on the default PATH from the shell. Export `PATH="/opt/homebrew/bin:$PATH"` first. Run tests with `node_modules/.bin/vitest`.
- This repo does not render-test client components that use hooks. run-detail.tsx is verified through an exported pure helper plus a browser QA pass, not a render test, the same way layout-section.tsx exports and tests `fieldValue`.
- The SSE route is a streaming Node route, hard to unit test in isolation; its dedupe is verified by watching the network (no repeat frames on an idle run), the same class as an infra change.
- Commit with an explicit pathspec (`git commit -- <paths>`), not `git add` then commit.
- Prose in docs follows the humanizer rules. Code and identifiers are left as they are.
- Start each task from a clean tree, commit at the end of each.

---

### Task 1: Send the runs SSE only on change

The stream builds `{ runs, events }` and enqueues it every 2 seconds whether or not it changed, so an idle run sends about 18.7 KB every tick for no reason (Perf-runtime measured about 32.9 MB per hour per open tab). Serialize the payload, compare to the last one sent, and skip the enqueue when it is identical. Keep a periodic comment ping so an idle connection is not dropped by a proxy.

**Files:**
- Modify: `src/app/api/runs/stream/route.ts`

**Interfaces:**
- Consumes: existing `listRuns`, `getRun`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Dedupe consecutive identical payloads**

In `src/app/api/runs/stream/route.ts`, inside `start(controller)`, add a `lastSent` string and a tick counter, and change `tick` to only enqueue on change, with a keep-alive comment every 15 ticks (30 seconds):

```ts
    start(controller) {
      let closed = false;
      let lastSent: string | null = null;
      let ticks = 0;

      const tick = () => {
        if (closed) return;
        try {
          const payload = {
            runs: listRuns(),
            events: runId ? (getRun(runId)?.events ?? []) : null,
          };
          const data = JSON.stringify(payload);
          ticks += 1;
          if (data !== lastSent) {
            lastSent = data;
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } else if (ticks % 15 === 0) {
            // Nothing changed, but a long-idle SSE connection can be dropped by a proxy.
            // A comment line (starts with ":") is ignored by EventSource and keeps it open.
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          }
        } catch {
          // A read failure must not kill the stream. The client keeps the last good
          // payload on screen and the next tick retries.
        }
      };
```

The first tick always sends (lastSent starts null), so first paint is unaffected. The rest of the route (the `stop`, the interval, the response headers) is unchanged.

- [ ] **Step 2: Typecheck and lint**

```bash
export PATH="/opt/homebrew/bin:$PATH"
npm run typecheck
npm run lint
```
Expected: tsc clean, lint 0.

- [ ] **Step 3: Verify on the network (deferred, needs the dev server)**

With the dev server up, open a run with no activity and watch the EventSource in the browser network panel: one data frame on open, then only a `: keepalive` comment every 30 seconds, no repeated data frames. Record the result in the task log.

- [ ] **Step 4: Commit**

```bash
git commit -- "src/app/api/runs/stream/route.ts" -m "perf(runs): send the SSE only on change, keep-alive when idle"
```

---

### Task 2: Land the run detail on its first error

A failed run shows its trace top-first, so the reason for "Failed" can be far down a long log. Add a callout above the trace naming the first error event, driven by a pure helper, and auto-expand that event's fields.

**Files:**
- Modify: `src/components/runs/run-detail.tsx`
- Test: `src/components/runs/run-detail.test.ts` (create it)

**Interfaces:**
- Produces: `firstErrorEvent(events: LogEventRow[]): LogEventRow | null`.
- Consumes: the existing `LogEventRow` type and the `displayEvents`/`openId` state already in the component.

- [ ] **Step 1: Write the failing test**

Create `src/components/runs/run-detail.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { LogEventRow } from "@/server/logs/store";
import { firstErrorEvent } from "./run-detail";

function ev(id: number, level: LogEventRow["level"], event: string): LogEventRow {
  return { id, level, event, ts: "2026-08-06T00:00:00.000Z", source: "backend", fields: {} };
}

describe("firstErrorEvent", () => {
  test("returns the earliest error by id, ignoring info and warn", () => {
    const events = [ev(3, "error", "sync.enrich.write_failed"), ev(1, "info", "sync.started"), ev(2, "warn", "sync.retry")];
    expect(firstErrorEvent(events)?.id).toBe(3);
  });
  test("returns null when there is no error", () => {
    expect(firstErrorEvent([ev(1, "info", "sync.started"), ev(2, "warn", "sync.retry")])).toBeNull();
  });
  test("picks the lowest-id error when several exist", () => {
    expect(firstErrorEvent([ev(5, "error", "b"), ev(2, "error", "a")])?.event).toBe("a");
  });
});
```

Note the events arrive newest-first from the query (ordered by id desc), so "first error" means the lowest id, the earliest one chronologically.

- [ ] **Step 2: Run the test, verify it fails**

```bash
node_modules/.bin/vitest run src/components/runs/run-detail.test.ts
```
Expected: FAIL, `firstErrorEvent` is not exported.

- [ ] **Step 3: Add the helper**

In `src/components/runs/run-detail.tsx`, export the helper near the top (after the imports, before the component):

```tsx
/** The earliest error event in a trace, by id (events arrive newest-first, so the lowest
 *  id is the earliest). Null when the run logged no error. Drives the failure-first
 *  callout, so a failed run points at its cause instead of the top of a long trace. */
export function firstErrorEvent(events: LogEventRow[]): LogEventRow | null {
  let earliest: LogEventRow | null = null;
  for (const e of events) {
    if (e.level === "error" && (earliest === null || e.id < earliest.id)) earliest = e;
  }
  return earliest;
}
```

- [ ] **Step 4: Render the callout and auto-open the error**

In the component body, after `displayEvents` is computed (around line 113), derive the first error:

```tsx
  const firstError = firstErrorEvent(displayEvents);
```

Change the trace `openId` initial state so the first error is open by default when the run is not running. Replace `const [openId, setOpenId] = useState<number | null>(null);` (line 125) with a lazy initial that opens the first error:

```tsx
  const [openId, setOpenId] = useState<number | null>(() => firstErrorEvent(run.events)?.id ?? null);
```

Add the callout above the trace block. Right before the trace `<div>` at line 239 (the one holding the "Trace" label), insert:

```tsx
      {firstError && liveRun.status !== "running" && (
        <button
          type="button"
          onClick={() => setOpenId(firstError.id)}
          className="flex w-full items-start gap-2 border border-destructive/45 bg-[var(--destructive-wash)] px-4 py-3 text-left"
        >
          <span className="mt-0.5 font-mono text-2xs text-destructive uppercase">First error</span>
          <span className="font-mono text-xs text-destructive">{firstError.event}</span>
        </button>
      )}
```

- [ ] **Step 5: Run the test, typecheck, lint**

```bash
node_modules/.bin/vitest run src/components/runs/run-detail.test.ts
npm run typecheck
npm run lint
```
Expected: the helper tests pass, tsc clean, lint 0. The callout and auto-open are verified in the browser QA pass.

- [ ] **Step 6: Commit**

```bash
git commit -- src/components/runs/run-detail.tsx src/components/runs/run-detail.test.ts -m "feat(runs): surface a failed run's first error above the trace"
```

---

## Final verification

- [ ] `npm run lint` 0 errors, `npm run typecheck` clean, `npm test` green.
- [ ] Browser QA (deferred): an idle run's SSE sends no repeat data frames; a failed run shows the first-error callout and opens that event.

## Self-review notes

- Spec coverage: this is M4-U2 (the change-only SSE and the failure-first view). M4-U1 (run_id threading through the sync engine) is a separate plan: the log store already threads run_id (it bridges an explicit runId or a jobId in the fields), so U1 is about the sync engine passing the run's jobId through roughly fifteen of its thirty log calls, a broad mechanical change that earns its own pass.
- Task 1 is a streaming route, verified by the network rather than a unit test, which is why it has no failing-test step. Task 2's logic is an exported pure helper with tests, the JSX is browser-verified.
- The two tasks touch disjoint files (the route and the component), so they can run as two parallel panes.
