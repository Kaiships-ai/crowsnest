# M2 frame pass end to end implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make frame pass reachable on any downloaded video, recover cleanly from a missing-file failure, survive a killed pass, and give the exit actions a sticky bar.

**Architecture:** Two workstreams that touch disjoint files, so they can run in parallel. Backend (Tasks 1 to 2) adds a heartbeat reaper to frame-pass-runner.ts. UI (Tasks 3 to 5) moves the Layout section into its own always-present tab, wires the existing downloadVideoAction into the failure state, and makes the bottom action row sticky. No schema change: frame_pass_jobs already has heartbeat_at and a constant lock_key.

**Tech stack:** Next.js 16 (React server components plus "use client" islands, server actions), TypeScript, drizzle-orm with better-sqlite3, vitest, Tailwind, sonner toasts.

## Global constraints

- No new lint or type problem over baseline. tsc clean (`npm run typecheck`), tests green (`npm test`), lint 0 errors (`npm run lint`).
- npm and node are not on the default PATH from the shell. Export `PATH="/opt/homebrew/bin:$PATH"` first.
- This repo does not render-test client components that use useRouter or useState (LayoutSection, AnalysisGate, and CarouselViewer all lack render tests for that reason, see layout-section.test.ts's header comment). So UI tasks unit-test extracted pure helpers, and the JSX wiring is verified by tsc plus a later browser QA pass, not a render test. Do not add a render-testing harness for this milestone.
- Frame pass runs serial, enforced by the partial unique index `frame_pass_jobs_lock_running` on a constant lock_key. Nothing here changes that.
- Prose in docs follows the humanizer rules. Code and identifiers are left as they are.
- Start each task from a clean tree, commit at the end of each.

---

### Task 1: Heartbeat on insert and a reaper for stale running rows

A pass killed mid-run (SIGKILL, a crash) leaves its `frame_pass_jobs` row at status "running", and because lock_key is constant that one row blocks every future pass. The row has a `heartbeat_at` column that nothing reads. Set it on insert, and reap a running row whose heartbeat has gone stale before a new pass tries to acquire the lock.

**Files:**
- Modify: `src/server/services/frame-pass-runner.ts`
- Test: `src/server/services/frame-pass-runner.test.ts`

**Interfaces:**
- Produces: `reapStaleFramePassJobs(now?: number): Promise<number>`, `FRAME_PASS_STALE_MS` constant. The insert at line 56 also starts writing `heartbeatAt`.
- Consumes: existing `db`, `tables`, `nowIso` from `@/server/db`.

- [ ] **Step 1: Write the failing test**

Add to `src/server/services/frame-pass-runner.test.ts` (match the file's existing test-DB setup, an in-memory db with `migrate()` in beforeAll, as the other service tests do):

```ts
import { reapStaleFramePassJobs, FRAME_PASS_STALE_MS } from "./frame-pass-runner";

describe("reapStaleFramePassJobs", () => {
  test("fails a running row whose heartbeat is older than the cutoff", async () => {
    const now = Date.now();
    const stale = new Date(now - FRAME_PASS_STALE_MS - 1000).toISOString();
    const jobId = newId();
    const videoId = await seedVideoWithChannel(); // helper already used in this file's other tests
    await db.insert(tables.framePassJobs).values({ id: jobId, videoId, status: "running", startedAt: stale, heartbeatAt: stale });

    const reaped = await reapStaleFramePassJobs(now);

    expect(reaped).toBe(1);
    const [row] = await db.select().from(tables.framePassJobs).where(eq(tables.framePassJobs.id, jobId)).limit(1);
    expect(row.status).toBe("failed");
    expect(row.errorCode).toBe("FRAME_REAPED");
  });

  test("leaves a fresh running row alone", async () => {
    const now = Date.now();
    const fresh = new Date(now - 1000).toISOString();
    const jobId = newId();
    const videoId = await seedVideoWithChannel();
    await db.insert(tables.framePassJobs).values({ id: jobId, videoId, status: "running", startedAt: fresh, heartbeatAt: fresh });

    const reaped = await reapStaleFramePassJobs(now);

    expect(reaped).toBe(0);
    const [row] = await db.select().from(tables.framePassJobs).where(eq(tables.framePassJobs.id, jobId)).limit(1);
    expect(row.status).toBe("running");
  });
});
```

Note: confirm the exact name of the seed helper in this test file (the frame-pass-runner tests already create a channel and video row). If it is inline rather than a named helper, inline the same two inserts here.

- [ ] **Step 2: Run the test, verify it fails**

```bash
export PATH="/opt/homebrew/bin:$PATH"
node_modules/.bin/vitest run src/server/services/frame-pass-runner.test.ts -t "reapStaleFramePassJobs"
```
Expected: FAIL, `reapStaleFramePassJobs` is not exported.

- [ ] **Step 3: Implement the reaper and set heartbeat on insert**

In `src/server/services/frame-pass-runner.ts`, add the imports `and`, `lt`, `or`, `isNull` from "drizzle-orm" alongside the existing `eq`. Add near the top, after the imports:

```ts
/** A live pass refreshes its heartbeat every FRAME_PASS_HEARTBEAT_MS (Task 2). A running
 *  row whose heartbeat is older than this is a crashed pass holding the global lock, so it
 *  is reaped. The margin is well over the heartbeat interval so a slow-but-alive pass is
 *  never reaped out from under itself. */
export const FRAME_PASS_STALE_MS = 120_000;

/**
 * Fail any "running" frame_pass_jobs row whose heartbeat has gone stale (or was never set),
 * so a crashed pass cannot hold the single-flight lock forever. Returns how many it reaped.
 * Called before a new pass tries to acquire the lock.
 */
export async function reapStaleFramePassJobs(now: number = Date.now()): Promise<number> {
  const cutoff = new Date(now - FRAME_PASS_STALE_MS).toISOString();
  const stale = await db
    .select({ id: tables.framePassJobs.id })
    .from(tables.framePassJobs)
    .where(
      and(
        eq(tables.framePassJobs.status, "running"),
        or(isNull(tables.framePassJobs.heartbeatAt), lt(tables.framePassJobs.heartbeatAt, cutoff))
      )
    );
  if (stale.length === 0) return 0;
  await db
    .update(tables.framePassJobs)
    .set({ status: "failed", finishedAt: nowIso(), errorCode: "FRAME_REAPED", errorMessage: "Reaped: the pass stopped sending a heartbeat (killed or crashed)." })
    .where(
      and(
        eq(tables.framePassJobs.status, "running"),
        or(isNull(tables.framePassJobs.heartbeatAt), lt(tables.framePassJobs.heartbeatAt, cutoff))
      )
    );
  return stale.length;
}
```

Change the insert in `runFramePass` (currently line 56) to set the heartbeat, and reap before it:

```ts
  const jobId = newId();
  await reapStaleFramePassJobs();
  try {
    const startedAt = nowIso();
    await db.insert(tables.framePassJobs).values({ id: jobId, videoId, status: "running", startedAt, heartbeatAt: startedAt });
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
node_modules/.bin/vitest run src/server/services/frame-pass-runner.test.ts
```
Expected: PASS, including the existing 7 runner tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/frame-pass-runner.ts src/server/services/frame-pass-runner.test.ts
git commit -m "fix(frame-pass): reap a stale running job so a killed pass cannot wedge the lock"
```

---

### Task 2: Refresh the heartbeat during the model read

The model read (the `ask(...)` call) is the long part of a pass, tens of seconds. Without a heartbeat during it, a legitimately slow pass could cross the stale cutoff and be reaped by Task 1. Wrap the read in a heartbeat that ticks while it runs.

**Files:**
- Modify: `src/server/services/frame-pass-runner.ts`
- Test: `src/server/services/frame-pass-runner.test.ts`

**Interfaces:**
- Produces: `withHeartbeat<T>(jobId: string, fn: () => Promise<T>, intervalMs?: number): Promise<T>`, `FRAME_PASS_HEARTBEAT_MS` constant.
- Consumes: the job row inserted in Task 1.

- [ ] **Step 1: Write the failing test**

```ts
import { withHeartbeat } from "./frame-pass-runner";

describe("withHeartbeat", () => {
  test("advances the row's heartbeat while the wrapped work runs", async () => {
    const start = new Date(Date.now() - 60_000).toISOString();
    const jobId = newId();
    const videoId = await seedVideoWithChannel();
    await db.insert(tables.framePassJobs).values({ id: jobId, videoId, status: "running", startedAt: start, heartbeatAt: start });

    await withHeartbeat(jobId, () => new Promise((r) => setTimeout(r, 40)), 5);

    const [row] = await db.select().from(tables.framePassJobs).where(eq(tables.framePassJobs.id, jobId)).limit(1);
    expect(row.heartbeatAt).not.toBe(start); // ticked at least once during the 40ms
    expect(new Date(row.heartbeatAt as string).getTime()).toBeGreaterThan(new Date(start).getTime());
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
node_modules/.bin/vitest run src/server/services/frame-pass-runner.test.ts -t "withHeartbeat"
```
Expected: FAIL, `withHeartbeat` is not exported.

- [ ] **Step 3: Implement the wrapper and wrap the read**

In `src/server/services/frame-pass-runner.ts`, add the constant next to `FRAME_PASS_STALE_MS`:

```ts
/** How often a live pass refreshes its heartbeat. Well under FRAME_PASS_STALE_MS so a
 *  running pass never looks stale. */
export const FRAME_PASS_HEARTBEAT_MS = 10_000;
```

Add the wrapper:

```ts
/**
 * Runs `fn` while ticking the job's heartbeat every `intervalMs`, so the reaper (Task 1)
 * does not free a pass that is slow but alive. The interval is cleared whether `fn`
 * resolves or throws. A failed heartbeat write is swallowed: it must not break the pass.
 */
export async function withHeartbeat<T>(jobId: string, fn: () => Promise<T>, intervalMs: number = FRAME_PASS_HEARTBEAT_MS): Promise<T> {
  const timer = setInterval(() => {
    void db
      .update(tables.framePassJobs)
      .set({ heartbeatAt: nowIso() })
      .where(eq(tables.framePassJobs.id, jobId))
      .catch(() => {});
  }, intervalMs);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}
```

Wrap the model read. The current line reads `result = await ask(buildLayoutPrompt(frames));`. Change it to:

```ts
      result = await withHeartbeat(jobId, () => ask(buildLayoutPrompt(frames)));
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
node_modules/.bin/vitest run src/server/services/frame-pass-runner.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/frame-pass-runner.ts src/server/services/frame-pass-runner.test.ts
git commit -m "fix(frame-pass): heartbeat during the model read so a slow pass is not reaped"
```

---

### Task 3: Move the Layout section into its own always-present tab

Today `<LayoutSection>` renders only inside `HookStructureTab`, which only renders when `detail.analysis` exists. So frame pass is reachable on a video only after a text analysis, about 2% of the library. Give Layout its own tab that renders for any video, whether or not an analysis exists. LayoutSection already handles a null analysis.

**Files:**
- Modify: `src/components/video/video-detail.tsx`

**Interfaces:**
- Consumes: existing `LayoutSection` (unchanged signature `{ videoId, analysis }`), the `Tabs` primitives already imported.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Remove LayoutSection from HookStructureTab**

In `src/components/video/video-detail.tsx`, delete the `<LayoutSection ... />` line at the end of `HookStructureTab` (currently line 205) and its now-unused `videoId` prop if nothing else in that component uses it (it does not, confirm). Leave the Hook and Beats blocks.

- [ ] **Step 2: Add a Layout tab trigger**

In the `TabsList` (currently lines 463 to 467), add a fourth trigger after "Why it worked":

```tsx
              <TabsTrigger value="layout">Layout</TabsTrigger>
```

- [ ] **Step 3: Add the Layout tab content, always rendered**

After the closing of the "why" `TabsContent` (currently line 530), add:

```tsx
            <TabsContent value="layout" className="pt-4">
              <LayoutSection videoId={item.videoId} analysis={detail.analysis} />
            </TabsContent>
```

`detail.analysis` may be null here, which LayoutSection already renders as the "no frame pass has run" state. `HookStructureTab` no longer needs `videoId`; if you removed the prop, also drop it from its call site (line 502) and its parameter list.

- [ ] **Step 4: Verify it compiles and nothing regressed**

```bash
export PATH="/opt/homebrew/bin:$PATH"
npm run typecheck
node_modules/.bin/vitest run src/components/video/layout-section.test.ts
npm run lint
```
Expected: tsc clean, the fieldValue tests still pass, lint 0 errors. There is no render test for this move (repo norm); it is verified in the browser during QA.

- [ ] **Step 5: Commit**

```bash
git add src/components/video/video-detail.tsx
git commit -m "feat(frame-pass): give Layout its own tab so frame pass is reachable on any video"
```

---

### Task 4: Wire download recovery and fix the failure copy

When a pass fails because the video has no downloaded file, the only button is "Retry frame pass", which re-fails, and the message points at an env-only setting. `runFramePassAction` already returns the failure `code` to the client (`FramePassResult` carries `code`), and `downloadVideoAction(videoId)` already exists. Branch on the code: on `FRAME_NO_VIDEO_ASSET`, show a Download video button that calls the existing action, and fix the message. Extract the button decision as a pure, testable helper.

**Files:**
- Modify: `src/components/video/layout-section.tsx`
- Test: `src/components/video/layout-section.test.ts`

**Interfaces:**
- Produces: `framePassCta(state: { hasLayout: boolean; lastCode: string | null }): { label: string; kind: "run" | "download" }`.
- Consumes: `downloadVideoAction` from `@/server/actions/media-actions` (returns `{ ok: true; assetId: string } | { ok: false; error: string }`), and the existing `runFramePassAction` (returns `{ ok: true; jobId } | { ok: false; error; code }`).

- [ ] **Step 1: Write the failing test**

Add to `src/components/video/layout-section.test.ts`:

```ts
import { framePassCta } from "./layout-section";

describe("framePassCta", () => {
  test("offers Download when the last failure was a missing file", () => {
    expect(framePassCta({ hasLayout: false, lastCode: "FRAME_NO_VIDEO_ASSET" })).toEqual({ label: "Download video", kind: "download" });
  });

  test("offers Re-run when a reading already exists", () => {
    expect(framePassCta({ hasLayout: true, lastCode: null })).toEqual({ label: "Re-run frame pass", kind: "run" });
  });

  test("offers Run for a never-run video", () => {
    expect(framePassCta({ hasLayout: false, lastCode: null })).toEqual({ label: "Run frame pass", kind: "run" });
  });

  test("a non-file failure still offers a plain run, not download", () => {
    expect(framePassCta({ hasLayout: false, lastCode: "FRAME_MODEL_FAILED" })).toEqual({ label: "Run frame pass", kind: "run" });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
node_modules/.bin/vitest run src/components/video/layout-section.test.ts -t "framePassCta"
```
Expected: FAIL, `framePassCta` is not exported.

- [ ] **Step 3: Add the helper**

In `src/components/video/layout-section.tsx`, export the helper near `fieldValue`:

```tsx
/** Which action the Layout button offers. A missing-file failure is the one case where the
 *  fix is not another pass but downloading the video first, so it gets its own kind. */
export function framePassCta(state: { hasLayout: boolean; lastCode: string | null }): { label: string; kind: "run" | "download" } {
  if (state.lastCode === "FRAME_NO_VIDEO_ASSET") return { label: "Download video", kind: "download" };
  if (state.hasLayout) return { label: "Re-run frame pass", kind: "run" };
  return { label: "Run frame pass", kind: "run" };
}
```

- [ ] **Step 4: Wire the component to the helper and to downloadVideoAction**

In `layout-section.tsx`: import the download action, track the last failure code in state, add a download handler, and drive the button off `framePassCta`.

Add the import:

```tsx
import { downloadVideoAction } from "@/server/actions/media-actions";
```

Add state next to `pending` (line 35):

```tsx
  const [lastCode, setLastCode] = useState<string | null>(null);
```

In `runFramePass`, when the start fails, record the code (replace the current `if (!started.ok)` block, lines 51 to 55):

```tsx
    if (!started.ok) {
      if (mountedRef.current) {
        setPending(false);
        setLastCode(started.code);
      }
      toast.error(started.error);
      return;
    }
    if (mountedRef.current) setLastCode(null);
```

Add a download handler after `runFramePass`:

```tsx
  async function downloadThenHint() {
    setPending(true);
    const res = await downloadVideoAction(videoId);
    if (mountedRef.current) setPending(false);
    if (res.ok) {
      setLastCode(null);
      toast.success("Video downloaded. Run the frame pass now.");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  }
```

Replace the failure message branch (the `failed ?` line, currently 117 to 118) so a missing-file failure reads as something the user can act on:

```tsx
        ) : failed ? (
          lastCode === "FRAME_NO_VIDEO_ASSET" ? (
            <>This video has not been downloaded yet. Download it, then run the frame pass.</>
          ) : (
            <>Last frame pass didn&rsquo;t produce a reading: {analysis?.framePassError}.</>
          )
```

Replace the single Button (lines 128 to 130) with one driven by the helper:

```tsx
      {(() => {
        const cta = framePassCta({ hasLayout: layout !== null, lastCode });
        return (
          <Button
            variant="outline"
            size="sm"
            className="mt-5"
            onClick={cta.kind === "download" ? downloadThenHint : runFramePass}
            disabled={pending}
          >
            {pending ? "Running…" : cta.label}
          </Button>
        );
      })()}
```

- [ ] **Step 5: Run the tests, verify they pass, and typecheck**

```bash
node_modules/.bin/vitest run src/components/video/layout-section.test.ts
npm run typecheck
npm run lint
```
Expected: framePassCta tests and the existing fieldValue tests pass, tsc clean, lint 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/video/layout-section.tsx src/components/video/layout-section.test.ts
git commit -m "feat(frame-pass): download-to-recover on a missing-file failure, honest copy"
```

---

### Task 5: Make the exit action row sticky

The exit actions (Remix, Save to Vault, Copy as prompt) sit at the bottom of a long right column, so on a long transcript they scroll away. Pin the row to the bottom of the viewport while the detail is open.

**Files:**
- Modify: `src/components/video/video-detail.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing.

- [ ] **Step 1: Make the action row sticky**

In `src/components/video/video-detail.tsx`, the exit actions are the `<div className="mt-16 flex items-start gap-4 border-t border-border pt-8">` block (currently line 541). Change its className to stick to the bottom of the scroll container:

```tsx
          <div className="sticky bottom-0 z-10 mt-16 flex items-start gap-4 border-t border-border bg-background/95 pt-8 pb-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
```

The shell's `<main>` is the scroll container (see the comment at line 324 to 328), so `sticky bottom-0` pins this row against the viewport while the right column scrolls behind it. The translucent background keeps the beats readable as they pass under it.

- [ ] **Step 2: Verify it compiles**

```bash
export PATH="/opt/homebrew/bin:$PATH"
npm run typecheck
npm run lint
```
Expected: tsc clean, lint 0. Visual behavior is verified in the browser QA pass, not a unit test.

- [ ] **Step 3: Commit**

```bash
git add src/components/video/video-detail.tsx
git commit -m "feat(video): pin the exit action row so it stays reachable on a long page"
```

---

## Final verification

After all five tasks:

- [ ] `npm run lint` 0 errors, `npm run typecheck` clean, `npm test` green.
- [ ] Browser QA (deferred, needs the dev server): on a video with a downloaded file but no analysis, the Layout tab shows and Run frame pass works. On a video with no file, the Layout tab offers Download video, and after download, Run frame pass. The exit action row stays pinned while the transcript scrolls.

## Self-review notes

- Spec coverage: M2-U1 discoverability (Task 3), M2-U2 error recovery (Task 4), M2-U3 sticky actions (Task 5, the two-column layout the spec described already exists in video-detail.tsx so it is not rebuilt), M2-U4 reaper (Tasks 1 and 2). All four M2 units are covered.
- The spec's "one long scroll" premise for video detail was wrong: the layout is already two columns with tabs. This plan reflects the real code, which is why U3 shrank to a sticky bar.
- Types and names introduced (`reapStaleFramePassJobs`, `FRAME_PASS_STALE_MS`, `withHeartbeat`, `FRAME_PASS_HEARTBEAT_MS`, `framePassCta`) are each defined in the task that introduces them and used consistently.
- No new UI render-test harness, per the repo norm. The functional gates for the JSX changes are tsc, lint, and the browser QA pass.
- Confirm during Task 1: the exact seed-helper name in frame-pass-runner.test.ts (the test file already seeds a channel and video; reuse that pattern rather than inventing a helper name).
- Parallelism for execution: Tasks 1 and 2 (frame-pass-runner.ts) are one workstream; Tasks 3, 4, 5 (video-detail.tsx and layout-section.tsx) are another. The two workstreams touch disjoint files and can run at the same time. Within the UI workstream, Task 3 and Task 5 both edit video-detail.tsx, so one agent runs 3 then 4 then 5 in order.
