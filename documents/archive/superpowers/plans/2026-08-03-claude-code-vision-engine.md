# Claude Code vision engine implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Run frame pass" button work by having Crowsnest extract video frames itself and spawn Claude Code as a read-only subprocess that reads them and returns layout JSON.

**Architecture:** Three stages with hard boundaries. Stage 1 shells out to the claude-video plugin's `watch.py` to turn an mp4 into JPEGs plus timestamps. Stage 2 spawns the `claude` binary in print mode with `--allowedTools Read`, so the subprocess can look at those JPEGs and nothing else. Stage 3 hands the parsed result to the existing `persistFramePass`, which already rejects any value that cites no frame. A `frame_pass_jobs` row carries the run so the UI can poll instead of holding a request open.

**Tech Stack:** Next.js 16 server actions, drizzle-orm over better-sqlite3, vitest, Node `child_process`, Python 3 (the bundled watch.py), the local Claude Code CLI.

## Global constraints

- Read `node_modules/next/dist/docs/` before writing anything Next-specific. This Next.js has breaking changes from what you may expect.
- The Claude binary is at `/Users/kienbeovl/.local/bin/claude`. Do NOT resolve `claude` from `PATH`: on this machine PATH holds a cmux shim that exits with "claude not found in PATH". Binary path must be injectable for tests.
- watch.py lives at `/Users/kienbeovl/.claude/plugins/cache/claude-video/watch/0.2.0/skills/watch/scripts/watch.py`. Path must be injectable for tests.
- Pass `--model sonnet`. Proven adequate in the proof pass, where it read one video better than a hand pass over the same frames.
- Pass `--no-whisper` to watch.py. No transcript in the subprocess context means a layout field cannot be laundered out of spoken words.
- Every child process gets `stdio: ["ignore", "pipe", "pipe"]`. A child that inherited stdin ate a byte of a shell loop's input during rehearsal and silently corrupted a video id.
- Do not commit without the orchestrator coordinating it. This checkout is shared with another agent on the same branch, and a commit moves HEAD under them. Do the `git add`, then ask before `git commit`.
- Do not run DDL against `data/crowsnest.db` without announcing to the orchestrator first. The dev database is push based, not migration tracked.
- Tests set `process.env.CROWSNEST_DB_PATH = ":memory:"` in `beforeAll` BEFORE any dynamic import of `@/server/db`. Copy the pattern from `src/server/services/frame-pass.test.ts`.
- Prose in `.md` files must avoid em dashes, en dashes, and curly quotes. Plans under `docs/superpowers/plans/` are exempt from the enforcing hook (see CLAUDE.md) because they quote code verbatim, but write the prose to the same standard anyway.

## File structure

| File | Responsibility |
|---|---|
| `src/server/services/watch-frames.ts` (create) | Stage 1. Run watch.py, parse its report into frames. Knows nothing about Claude or layouts. |
| `src/server/services/claude-task.ts` (create) | Stage 2 transport. Spawn the Claude binary, return its text result. Knows nothing about videos. |
| `src/server/services/frame-pass-prompt.ts` (create) | The layout prompt and the parser for what comes back. Pure functions, no IO. |
| `src/server/services/frame-pass-runner.ts` (create) | Orchestrates the three stages against one video and one job row. |
| `src/server/db/schema.ts` (modify) | Add the `framePassJobs` table. |
| `drizzle/0013_frame_pass_jobs.sql` (create) | The migration for that table. |
| `src/server/actions/analyze-actions.ts` (modify) | `runFramePassAction` starts a job. New `getFramePassJobAction` polls one. |
| `src/components/video/layout-section.tsx` (modify) | Poll the job and refresh when it lands. |

`frame-pass.ts` is NOT modified. Its validation is the guard this whole feature leans on and it already works.

---

### Task 1: Stage 1, frame extraction

**Files:**
- Create: `src/server/services/watch-frames.ts`
- Test: `src/server/services/watch-frames.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export interface SampledFrame { path: string; timestampSeconds: number; reason: string }`, `export function parseWatchReport(stdout: string): SampledFrame[]`, `export class WatchExtractError extends Error`, `export async function extractFrames(videoPath: string, outDir: string, opts?: { scriptPath?: string; maxFrames?: number; timeoutMs?: number }): Promise<SampledFrame[]>`.

- [ ] **Step 1: Write the failing test**

Create `src/server/services/watch-frames.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { parseWatchReport } from "./watch-frames";

const REPORT = `
# watch: video report

- **Duration:** 00:19 (19.4s)
- **Frames:** 3 selected from 3 candidates (scene, full range, budget 19, cap 100)

## Frames

Frames live at: \`/tmp/w/frames\`

- \`/tmp/w/frames/frame_0001.jpg\` (t=00:00, reason=first-frame)
- \`/tmp/w/frames/frame_0002.jpg\` (t=00:03, reason=scene-change)
- \`/tmp/w/frames/frame_0003.jpg\` (t=01:07, reason=scene-change)

## Transcript

_No transcript available._
`;

describe("parseWatchReport", () => {
  test("reads path, seconds and reason from each frame line", () => {
    const frames = parseWatchReport(REPORT);
    expect(frames).toEqual([
      { path: "/tmp/w/frames/frame_0001.jpg", timestampSeconds: 0, reason: "first-frame" },
      { path: "/tmp/w/frames/frame_0002.jpg", timestampSeconds: 3, reason: "scene-change" },
      { path: "/tmp/w/frames/frame_0003.jpg", timestampSeconds: 67, reason: "scene-change" },
    ]);
  });

  test("returns an empty list when the report lists no frames", () => {
    expect(parseWatchReport("# watch: video report\n\n## Frames\n\n_No frames extracted._\n")).toEqual([]);
  });

  test("ignores the 'Frames live at' line, which is not a frame", () => {
    const frames = parseWatchReport(REPORT);
    expect(frames.every((f) => f.path.endsWith(".jpg"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/services/watch-frames.test.ts`
Expected: FAIL, cannot find module `./watch-frames`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/services/watch-frames.ts`:

```ts
import { spawn } from "node:child_process";

/**
 * Stage 1 of the frame pass. Turns an mp4 into JPEGs plus the timestamp each was taken
 * at, by shelling out to the claude-video plugin's watch.py (yt-dlp plus ffmpeg, no
 * model involved). Deliberately knows nothing about Claude or about layouts.
 */
export interface SampledFrame {
  path: string;
  timestampSeconds: number;
  reason: string;
}

export class WatchExtractError extends Error {}

const DEFAULT_SCRIPT =
  "/Users/kienbeovl/.claude/plugins/cache/claude-video/watch/0.2.0/skills/watch/scripts/watch.py";

/** Frame lines look like: - `/abs/frame_0002.jpg` (t=00:03, reason=scene-change) */
const FRAME_LINE = /^- `([^`]+\.jpg)` \(t=([0-9:]+), reason=([^)]+)\)/;

function toSeconds(clock: string): number {
  const parts = clock.split(":").map(Number);
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

export function parseWatchReport(stdout: string): SampledFrame[] {
  const frames: SampledFrame[] = [];
  for (const line of stdout.split("\n")) {
    const m = FRAME_LINE.exec(line.trim());
    if (!m) continue;
    frames.push({ path: m[1], timestampSeconds: toSeconds(m[2]), reason: m[3] });
  }
  return frames;
}

export async function extractFrames(
  videoPath: string,
  outDir: string,
  opts: { scriptPath?: string; maxFrames?: number; timeoutMs?: number } = {}
): Promise<SampledFrame[]> {
  const script = opts.scriptPath ?? process.env.WATCH_SCRIPT_PATH ?? DEFAULT_SCRIPT;
  const args = [script, videoPath, "--no-whisper", "--out-dir", outDir];
  if (opts.maxFrames) args.push("--max-frames", String(opts.maxFrames));

  const { stdout, stderr, code } = await run("python3", args, opts.timeoutMs ?? 120_000);
  if (code !== 0) {
    throw new WatchExtractError(`watch.py exited ${code}: ${stderr.trim().slice(-400)}`);
  }
  const frames = parseWatchReport(stdout);
  if (frames.length === 0) {
    throw new WatchExtractError("watch.py produced no frames for this video");
  }
  return frames;
}

function run(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    // stdin is ignored, never inherited: a child that shares our stdin can consume bytes
    // the caller still needs. That silently corrupted a video id during rehearsal.
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new WatchExtractError(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new WatchExtractError(`${cmd} failed to start: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/services/watch-frames.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Stage the change, then ask before committing**

```bash
git add src/server/services/watch-frames.ts src/server/services/watch-frames.test.ts
```

Ask the orchestrator to coordinate the commit. Message: `feat(frame-pass): parse watch.py reports into sampled frames`

---

### Task 2: Stage 2 transport, the Claude subprocess

**Files:**
- Create: `src/server/services/claude-task.ts`
- Test: `src/server/services/claude-task.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export class ClaudeTaskError extends Error`, `export interface ClaudeTaskResult { text: string; costUsd: number | null; turns: number | null; durationMs: number | null }`, `export async function runClaudeTask(prompt: string, opts?: { binaryPath?: string; model?: string; allowedTools?: string[]; timeoutMs?: number }): Promise<ClaudeTaskResult>`.

- [ ] **Step 1: Write the failing test**

Create `src/server/services/claude-task.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runClaudeTask, ClaudeTaskError } from "./claude-task";

let dir: string;

/** A stand-in for the real CLI: prints one canned --output-format json envelope. */
function fakeBinary(name: string, body: string, exitCode = 0): string {
  const p = path.join(dir, name);
  writeFileSync(p, `#!/usr/bin/env bash\ncat <<'EOF'\n${body}\nEOF\nexit ${exitCode}\n`);
  chmodSync(p, 0o755);
  return p;
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "claude-task-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("runClaudeTask", () => {
  test("returns the result text and the usage numbers from the envelope", async () => {
    const bin = fakeBinary(
      "ok",
      JSON.stringify({ is_error: false, result: "hello", total_cost_usd: 0.25, num_turns: 3, duration_ms: 900 })
    );
    const out = await runClaudeTask("say hello", { binaryPath: bin });
    expect(out.text).toBe("hello");
    expect(out.costUsd).toBe(0.25);
    expect(out.turns).toBe(3);
  });

  test("throws when the envelope reports is_error", async () => {
    const bin = fakeBinary("err", JSON.stringify({ is_error: true, result: "rate limited" }));
    await expect(runClaudeTask("x", { binaryPath: bin })).rejects.toThrow(ClaudeTaskError);
  });

  test("throws when stdout is not the JSON envelope at all", async () => {
    const bin = fakeBinary("junk", "not json");
    await expect(runClaudeTask("x", { binaryPath: bin })).rejects.toThrow(ClaudeTaskError);
  });

  test("throws a clear error when the binary does not exist", async () => {
    await expect(runClaudeTask("x", { binaryPath: path.join(dir, "nope") })).rejects.toThrow(ClaudeTaskError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/services/claude-task.test.ts`
Expected: FAIL, cannot find module `./claude-task`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/services/claude-task.ts`:

```ts
import { spawn } from "node:child_process";

/**
 * Stage 2 transport for the frame pass. Spawns the local Claude Code CLI in print mode
 * and returns whatever text it produced.
 *
 * The tool allowlist is the security boundary of this whole feature. With
 * `--allowedTools Read` the child can open the files we name and nothing else: no shell,
 * no writes, no database handle. Widening this default is a security decision, not a
 * convenience one.
 *
 * Deliberately knows nothing about videos, frames or layouts. It is a function from a
 * prompt to text, which is the seam a second consumer would reuse.
 */
export class ClaudeTaskError extends Error {}

export interface ClaudeTaskResult {
  text: string;
  costUsd: number | null;
  turns: number | null;
  durationMs: number | null;
}

/**
 * Absolute on purpose. `claude` on PATH here is a cmux shim that exits with
 * "claude not found in PATH", so resolving from PATH fails in a confusing way.
 */
const DEFAULT_BINARY = "/Users/kienbeovl/.local/bin/claude";

export async function runClaudeTask(
  prompt: string,
  opts: { binaryPath?: string; model?: string; allowedTools?: string[]; timeoutMs?: number } = {}
): Promise<ClaudeTaskResult> {
  const binary = opts.binaryPath ?? process.env.CLAUDE_BINARY_PATH ?? DEFAULT_BINARY;
  const args = [
    "-p",
    prompt,
    "--model",
    opts.model ?? "sonnet",
    "--allowedTools",
    ...(opts.allowedTools ?? ["Read"]),
    "--output-format",
    "json",
  ];

  const { stdout, stderr, code } = await run(binary, args, opts.timeoutMs ?? 600_000);

  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new ClaudeTaskError(
      `claude did not return a JSON envelope (exit ${code}): ${(stdout || stderr).trim().slice(0, 300)}`
    );
  }
  if (envelope.is_error) {
    throw new ClaudeTaskError(`claude reported an error: ${String(envelope.result ?? "").slice(0, 300)}`);
  }

  return {
    text: String(envelope.result ?? ""),
    costUsd: typeof envelope.total_cost_usd === "number" ? envelope.total_cost_usd : null,
    turns: typeof envelope.num_turns === "number" ? envelope.num_turns : null,
    durationMs: typeof envelope.duration_ms === "number" ? envelope.duration_ms : null,
  };
}

function run(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new ClaudeTaskError(`claude timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new ClaudeTaskError(`could not run ${cmd}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/services/claude-task.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Stage the change, then ask before committing**

```bash
git add src/server/services/claude-task.ts src/server/services/claude-task.test.ts
```

Message: `feat(frame-pass): add read-only claude subprocess transport`

---

### Task 3: The layout prompt and its parser

Both rules below came out of the proof pass over the real library. Neither was predictable from reading source, so do not simplify them away.

**Files:**
- Create: `src/server/services/frame-pass-prompt.ts`
- Test: `src/server/services/frame-pass-prompt.test.ts`

**Interfaces:**
- Consumes: `SampledFrame` from Task 1.
- Produces: `export function buildLayoutPrompt(frames: SampledFrame[]): string`, `export class LayoutParseError extends Error`, `export function parseLayoutResult(text: string): VideoLayout`.

- [ ] **Step 1: Write the failing test**

Create `src/server/services/frame-pass-prompt.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildLayoutPrompt, parseLayoutResult, LayoutParseError } from "./frame-pass-prompt";
import type { SampledFrame } from "./watch-frames";

const FRAMES: SampledFrame[] = [
  { path: "/tmp/f/frame_0001.jpg", timestampSeconds: 0, reason: "first-frame" },
  { path: "/tmp/f/frame_0002.jpg", timestampSeconds: 3, reason: "scene-change" },
];

describe("buildLayoutPrompt", () => {
  test("names every frame path with its timestamp", () => {
    const p = buildLayoutPrompt(FRAMES);
    expect(p).toContain("/tmp/f/frame_0001.jpg");
    expect(p).toContain("/tmp/f/frame_0002.jpg");
    expect(p).toContain("t=0s");
    expect(p).toContain("t=3s");
  });

  test("asks for a short citation, which is what stops the output truncating", () => {
    expect(buildLayoutPrompt(FRAMES)).toContain("2 to 5");
  });
});

describe("parseLayoutResult", () => {
  const good = JSON.stringify({
    onScreenText: { value: "Claude", fromFramesSec: [3, 0, 3] },
    textPosition: { value: null, fromFramesSec: [] },
    cutRhythm: { value: "hard cut every 2s", fromFramesSec: [0, 3] },
    framing: { value: "close-up talking head", fromFramesSec: [0] },
  });

  test("parses a bare JSON object", () => {
    expect(parseLayoutResult(good).onScreenText.value).toBe("Claude");
  });

  test("parses JSON wrapped in a markdown fence", () => {
    expect(parseLayoutResult("```json\n" + good + "\n```").framing.value).toBe("close-up talking head");
  });

  test("dedupes and sorts fromFramesSec", () => {
    expect(parseLayoutResult(good).onScreenText.fromFramesSec).toEqual([0, 3]);
  });

  test("keeps a genuine null field as null", () => {
    const out = parseLayoutResult(good);
    expect(out.textPosition.value).toBeNull();
    expect(out.textPosition.fromFramesSec).toEqual([]);
  });

  test("throws on truncated JSON rather than storing half a reading", () => {
    expect(() => parseLayoutResult('{"onScreenText":{"value":"x","fromFramesSec":[0,1,2')).toThrow(LayoutParseError);
  });

  test("throws when the shape is not a VideoLayout", () => {
    expect(() => parseLayoutResult('{"onScreenText":"just a string"}')).toThrow(LayoutParseError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/services/frame-pass-prompt.test.ts`
Expected: FAIL, cannot find module `./frame-pass-prompt`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/services/frame-pass-prompt.ts`:

```ts
import { VideoLayoutSchema, type VideoLayout } from "@/server/llm/schemas";
import type { SampledFrame } from "./watch-frames";

export class LayoutParseError extends Error {}

const LAYOUT_KEYS = ["onScreenText", "textPosition", "cutRhythm", "framing"] as const;

/**
 * The prompt handed to the read-only Claude subprocess.
 *
 * The "2 to 5 representative" citation rule is load-bearing and came from a failed pass,
 * not from taste. Left to choose, the model cited every sampled frame in all four fields;
 * on a 27 frame video that repetition ran long enough that the JSON came back truncated
 * mid-array and the pass failed outright. The short citation is also the more honest one,
 * since a field claiming all 27 frames as its source is not really citing anything.
 */
export function buildLayoutPrompt(frames: SampledFrame[]): string {
  const list = frames.map((f) => `${f.path} at t=${f.timestampSeconds}s`).join("\n");
  return `You are reading ${frames.length} still frames sampled from one vertical short-form video.

${list}

Read EVERY frame listed above.

Then report the video's LAYOUT as JSON only. No prose, no markdown fence.

Fields:
  onScreenText - what the burned-in caption text says. Summarise if it changes across the video.
  textPosition - where that text sits in frame, e.g. "centered, upper third".
  cutRhythm    - how often the shot cuts, e.g. "hard cut about every 2s".
  framing      - shot type, e.g. "close-up talking head", "split screen, screen recording above".

Rules that matter more than completeness:
- fromFramesSec cites 2 to 5 REPRESENTATIVE timestamps in seconds that best evidence that value. Do NOT list every frame.
- If you cannot read a field from the frames, set value to null and fromFramesSec to [].
- Never state a value you did not see. A value with no backing frame is rejected on write.

Output exactly this shape:
{"onScreenText":{"value":null,"fromFramesSec":[]},"textPosition":{"value":null,"fromFramesSec":[]},"cutRhythm":{"value":null,"fromFramesSec":[]},"framing":{"value":null,"fromFramesSec":[]}}`;
}

/**
 * Pull a VideoLayout out of whatever the model printed. Tolerates a markdown fence and
 * surrounding chatter, refuses anything that is not a complete, well-shaped layout.
 *
 * Timestamps are deduped and sorted because observed output repeated them, for example
 * [0, 1, 1, 5, 9, 11, 11, 14]. Valid, but noise we should not store.
 */
export function parseLayoutResult(text: string): VideoLayout {
  const stripped = text.replace(/```(?:json)?/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new LayoutParseError(`no JSON object in model output: ${stripped.slice(0, 200)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stripped.slice(start, end + 1));
  } catch (err) {
    throw new LayoutParseError(`model output was not parseable JSON (likely truncated): ${(err as Error).message}`);
  }

  const parsed = VideoLayoutSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LayoutParseError(`model output is not a VideoLayout: ${parsed.error.issues[0]?.message ?? "bad shape"}`);
  }

  const layout = parsed.data;
  for (const key of LAYOUT_KEYS) {
    layout[key].fromFramesSec = [...new Set(layout[key].fromFramesSec)].sort((a, b) => a - b);
  }
  return layout;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/services/frame-pass-prompt.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Stage the change, then ask before committing**

```bash
git add src/server/services/frame-pass-prompt.ts src/server/services/frame-pass-prompt.test.ts
```

Message: `feat(frame-pass): add layout prompt and result parser`

---

### Task 4: The frame_pass_jobs table

**ANNOUNCE TO THE ORCHESTRATOR BEFORE RUNNING STEP 5.** It is DDL against a database shared with another agent.

**Files:**
- Modify: `src/server/db/schema.ts` (append after the `syncJobs` block, which starts at line 378)
- Modify: `src/server/db/index.ts` (export the new table on `tables`)
- Create: `drizzle/0013_frame_pass_jobs.sql`
- Test: `src/server/services/frame-pass-job.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `tables.framePassJobs` with columns `id, videoId, lockKey, status, startedAt, finishedAt, heartbeatAt, framesSampled, errorCode, errorMessage, cancelRequested`.

- [ ] **Step 1: Write the failing test**

Create `src/server/services/frame-pass-job.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  migrate();
});

async function seedVideo(): Promise<string> {
  const channelId = newId();
  const videoId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@j-${channelId}`, trackedSince: now });
  await db.insert(tables.videos).values({
    id: videoId, channelId, platform: "instagram", externalId: `j-${videoId}`,
    url: "https://example.com/reel", postedAt: now, firstSeenAt: now,
  });
  return videoId;
}

describe("frame_pass_jobs", () => {
  test("accepts a running job", async () => {
    const videoId = await seedVideo();
    await db.insert(tables.framePassJobs).values({
      id: newId(), videoId, status: "running", startedAt: nowIso(),
    });
    const rows = await db.select().from(tables.framePassJobs);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("refuses a second running job, so passes stay serial", async () => {
    const videoId = await seedVideo();
    await expect(
      db.insert(tables.framePassJobs).values({ id: newId(), videoId, status: "running", startedAt: nowIso() })
    ).rejects.toThrow();
  });

  test("allows many finished jobs side by side", async () => {
    const videoId = await seedVideo();
    const now = nowIso();
    await db.insert(tables.framePassJobs).values({ id: newId(), videoId, status: "success", startedAt: now, finishedAt: now });
    await db.insert(tables.framePassJobs).values({ id: newId(), videoId, status: "failed", startedAt: now, finishedAt: now });
    const done = await db.select().from(tables.framePassJobs);
    expect(done.filter((r) => r.status !== "running").length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/services/frame-pass-job.test.ts`
Expected: FAIL, `tables.framePassJobs` is undefined.

- [ ] **Step 3: Add the table to schema.ts**

Append to `src/server/db/schema.ts`, after the `syncJobs` block:

```ts
/**
 * One row per frame pass attempt. A pass takes tens of seconds (the read costs about one
 * model turn per frame), far too long to hold a server action open, so the UI starts a
 * job and polls this row.
 *
 * `lockKey` is NOT NULL and constant for the same reason it is on syncJobs: SQLite treats
 * NULLs as DISTINCT in a unique index, so a partial unique index over a nullable column
 * does not actually lock anything. A constant NOT NULL key makes the partial index below
 * a real single-flight lock, which is what keeps passes serial against the Max plan's
 * rate limits.
 */
export const framePassJobs = sqliteTable("frame_pass_jobs", {
  id: text("id").primaryKey(),
  videoId: text("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  lockKey: text("lock_key").notNull().default("__frame_pass__"),
  status: text("status").notNull(), // "running" | "success" | "failed"
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  heartbeatAt: text("heartbeat_at"),
  framesSampled: integer("frames_sampled"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
}, (t) => [
  uniqueIndex("frame_pass_jobs_lock_running").on(t.lockKey).where(sql`${t.status} = 'running'`),
  index("frame_pass_jobs_video_started").on(t.videoId, t.startedAt),
]);
```

Then add `framePassJobs` to the `tables` object in `src/server/db/index.ts`, next to `syncJobs`.

- [ ] **Step 4: Write the migration and run the test**

Create `drizzle/0013_frame_pass_jobs.sql`:

```sql
CREATE TABLE `frame_pass_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`lock_key` text DEFAULT '__frame_pass__' NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`heartbeat_at` text,
	`frames_sampled` integer,
	`error_code` text,
	`error_message` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `frame_pass_jobs_lock_running` ON `frame_pass_jobs` (`lock_key`) WHERE "frame_pass_jobs"."status" = 'running';
--> statement-breakpoint
CREATE INDEX `frame_pass_jobs_video_started` ON `frame_pass_jobs` (`video_id`,`started_at`);
```

Run: `npx vitest run src/server/services/frame-pass-job.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Apply to the dev database, AFTER announcing**

`npm run db:migrate` replays from 0000 and fails on this database, which is push based rather than migration tracked. Apply the one file directly:

```bash
sqlite3 data/crowsnest.db < drizzle/0013_frame_pass_jobs.sql
sqlite3 data/crowsnest.db ".schema frame_pass_jobs"
```

Expected: the schema prints back. Then stage and ask before committing.

```bash
git add src/server/db/schema.ts src/server/db/index.ts drizzle/0013_frame_pass_jobs.sql src/server/services/frame-pass-job.test.ts
```

Message: `feat(frame-pass): add frame_pass_jobs table with single-flight lock`

---

### Task 5: The runner, wiring the three stages together

**Files:**
- Create: `src/server/services/frame-pass-runner.ts`
- Test: `src/server/services/frame-pass-runner.test.ts`

**Interfaces:**
- Consumes: `extractFrames`, `SampledFrame` (Task 1). `runClaudeTask`, `ClaudeTaskResult` (Task 2). `buildLayoutPrompt`, `parseLayoutResult`, `LayoutParseError` (Task 3). `tables.framePassJobs` (Task 4). `resolveVideoFile`, `persistFramePass`, `recordFramePassFailure` from the existing `./frame-pass`.
- Produces: `export interface FramePassDeps`, `export interface FramePassRunResult { ok: boolean; jobId: string; framesSampled: number | null; errorCode: string | null }`, `export async function runFramePass(videoId: string, deps?: Partial<FramePassDeps>): Promise<FramePassRunResult>`.

Dependencies are injected so the test never spawns a real subprocess.

- [ ] **Step 1: Write the failing test**

Create `src/server/services/frame-pass-runner.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let runFramePass: typeof import("./frame-pass-runner")["runFramePass"];

const GOOD_JSON = JSON.stringify({
  onScreenText: { value: "Claude", fromFramesSec: [0] },
  textPosition: { value: "centered", fromFramesSec: [0] },
  cutRhythm: { value: "every 2s", fromFramesSec: [0, 3] },
  framing: { value: "talking head", fromFramesSec: [0] },
});

const FRAMES = [{ path: "/tmp/f/frame_0001.jpg", timestampSeconds: 0, reason: "first-frame" }];
const OK_TASK = { text: GOOD_JSON, costUsd: null, turns: null, durationMs: null };

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ runFramePass } = await import("./frame-pass-runner"));
  migrate();
});

async function seedVideoWithFile(): Promise<string> {
  const channelId = newId();
  const videoId = newId();
  const assetId = newId();
  const now = nowIso();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@r-${channelId}`, trackedSince: now });
  await db.insert(tables.mediaAssets).values({ id: assetId, kind: "video", storagePath: "ab/test.mp4", sha256: newId(), createdAt: now });
  await db.insert(tables.videos).values({
    id: videoId, channelId, platform: "instagram", externalId: `r-${videoId}`,
    url: "https://example.com/reel", postedAt: now, firstSeenAt: now, videoAssetId: assetId,
  });
  return videoId;
}

describe("runFramePass", () => {
  test("writes the layout and marks the job successful", async () => {
    const videoId = await seedVideoWithFile();
    const out = await runFramePass(videoId, {
      extractFrames: async () => FRAMES,
      runClaudeTask: async () => OK_TASK,
    });

    expect(out.ok).toBe(true);
    const [analysis] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(analysis.layout).not.toBeNull();
    expect(analysis.framesSampled).toBe(1);
    const [job] = await db.select().from(tables.framePassJobs).where(eq(tables.framePassJobs.id, out.jobId));
    expect(job.status).toBe("success");
    expect(job.finishedAt).not.toBeNull();
  });

  test("records a failure and closes the job when extraction dies", async () => {
    const videoId = await seedVideoWithFile();
    const out = await runFramePass(videoId, {
      extractFrames: async () => {
        throw new Error("ffmpeg exploded");
      },
      runClaudeTask: async () => OK_TASK,
    });

    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe("FRAME_EXTRACT_FAILED");
    const [analysis] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId));
    expect(analysis.framePassError).toContain("ffmpeg exploded");
    const [job] = await db.select().from(tables.framePassJobs).where(eq(tables.framePassJobs.id, out.jobId));
    expect(job.status).toBe("failed");
  });

  test("records a failure when the model returns unusable JSON", async () => {
    const videoId = await seedVideoWithFile();
    const out = await runFramePass(videoId, {
      extractFrames: async () => FRAMES,
      runClaudeTask: async () => ({
        text: '{"onScreenText":{"value":"x","fromFramesSec":[0,1',
        costUsd: null, turns: null, durationMs: null,
      }),
    });
    expect(out.errorCode).toBe("FRAME_PARSE_FAILED");
  });

  test("fails before spawning anything when the video has no downloaded file", async () => {
    const channelId = newId();
    const videoId = newId();
    const now = nowIso();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@n-${channelId}`, trackedSince: now });
    await db.insert(tables.videos).values({
      id: videoId, channelId, platform: "instagram", externalId: `n-${videoId}`,
      url: "https://example.com/reel", postedAt: now, firstSeenAt: now,
    });

    let spawned = false;
    const out = await runFramePass(videoId, {
      extractFrames: async () => {
        spawned = true;
        return FRAMES;
      },
      runClaudeTask: async () => OK_TASK,
    });

    expect(out.errorCode).toBe("FRAME_NO_VIDEO_ASSET");
    expect(spawned).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/services/frame-pass-runner.test.ts`
Expected: FAIL, cannot find module `./frame-pass-runner`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/services/frame-pass-runner.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db, newId, nowIso, tables } from "@/server/db";
import { log } from "@/server/lib/logger";
import { extractFrames as realExtractFrames, type SampledFrame } from "./watch-frames";
import { runClaudeTask as realRunClaudeTask, type ClaudeTaskResult } from "./claude-task";
import { buildLayoutPrompt, parseLayoutResult, LayoutParseError } from "./frame-pass-prompt";
import { persistFramePass, recordFramePassFailure, resolveVideoFile } from "./frame-pass";

/**
 * Orchestrates one frame pass: extract frames, have a read-only Claude subprocess read
 * them, write the result through the existing validator.
 *
 * The validator is not re-implemented here on purpose. `persistFramePass` already refuses
 * any field carrying a value while citing no frames, and that check was written for a
 * human doing this by hand. It applies to a model without changes, which is what makes
 * the anti-fabrication rule structural rather than a polite request in a prompt.
 */
export interface FramePassDeps {
  extractFrames: (videoPath: string, outDir: string) => Promise<SampledFrame[]>;
  runClaudeTask: (prompt: string) => Promise<ClaudeTaskResult>;
}

export interface FramePassRunResult {
  ok: boolean;
  jobId: string;
  framesSampled: number | null;
  errorCode: string | null;
}

const MODEL_LABEL = "claude-code/watch+sonnet";

export async function runFramePass(videoId: string, deps: Partial<FramePassDeps> = {}): Promise<FramePassRunResult> {
  const extract = deps.extractFrames ?? ((v, o) => realExtractFrames(v, o));
  const ask = deps.runClaudeTask ?? ((p) => realRunClaudeTask(p));

  const jobId = newId();
  await db.insert(tables.framePassJobs).values({ id: jobId, videoId, status: "running", startedAt: nowIso() });

  let workDir: string | null = null;
  try {
    const resolved = await resolveVideoFile(videoId);
    if (!resolved.ok) {
      return await fail(jobId, videoId, "FRAME_NO_VIDEO_ASSET", resolved.reason);
    }

    workDir = mkdtempSync(path.join(tmpdir(), "crowsnest-frames-"));

    let frames: SampledFrame[];
    try {
      frames = await extract(resolved.path, workDir);
    } catch (err) {
      return await fail(jobId, videoId, "FRAME_EXTRACT_FAILED", (err as Error).message);
    }
    await db.update(tables.framePassJobs)
      .set({ heartbeatAt: nowIso(), framesSampled: frames.length })
      .where(eq(tables.framePassJobs.id, jobId));

    let result: ClaudeTaskResult;
    try {
      result = await ask(buildLayoutPrompt(frames));
    } catch (err) {
      return await fail(jobId, videoId, "FRAME_MODEL_FAILED", (err as Error).message);
    }

    let layout;
    try {
      layout = parseLayoutResult(result.text);
    } catch (err) {
      const code = err instanceof LayoutParseError ? "FRAME_PARSE_FAILED" : "FRAME_UNKNOWN";
      return await fail(jobId, videoId, code, (err as Error).message);
    }

    try {
      await persistFramePass({ videoId, layout, framesSampled: frames.length, frameModel: MODEL_LABEL });
    } catch (err) {
      // Includes the anti-fabrication rejection. A model that invented a reading lands
      // here, and that is the guard working, not a bug to route around.
      return await fail(jobId, videoId, "FRAME_PARSE_FAILED", (err as Error).message);
    }

    await db.update(tables.framePassJobs)
      .set({ status: "success", finishedAt: nowIso() })
      .where(eq(tables.framePassJobs.id, jobId));

    log.info("frame_pass.succeeded", { videoId, jobId, frames: frames.length, costUsd: result.costUsd, turns: result.turns });
    return { ok: true, jobId, framesSampled: frames.length, errorCode: null };
  } finally {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  }
}

async function fail(jobId: string, videoId: string, code: string, message: string): Promise<FramePassRunResult> {
  await recordFramePassFailure(videoId, message);
  await db.update(tables.framePassJobs)
    .set({ status: "failed", finishedAt: nowIso(), errorCode: code, errorMessage: message })
    .where(eq(tables.framePassJobs.id, jobId));
  log.warn("frame_pass.failed", { videoId, jobId, code, message });
  return { ok: false, jobId, framesSampled: null, errorCode: code };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/services/frame-pass-runner.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Stage the change, then ask before committing**

```bash
git add src/server/services/frame-pass-runner.ts src/server/services/frame-pass-runner.test.ts
```

Message: `feat(frame-pass): orchestrate extract, read and write in a job`

---

### Task 6: Wire the server actions

**Files:**
- Modify: `src/server/actions/analyze-actions.ts`, the doc comment at lines 60 to 80 and the body of `runFramePassAction` at 81 to 91
- Test: `src/server/actions/analyze-actions.test.ts` (create)

**Interfaces:**
- Consumes: `runFramePass` (Task 5), `tables.framePassJobs` (Task 4).
- Produces: `runFramePassAction(videoId): Promise<FramePassResult<{ jobId: string }>>`, `getFramePassJobAction(jobId): Promise<{ status: "running" | "success" | "failed"; error: string | null }>`.

- [ ] **Step 1: Replace the stale doc comment**

The comment at `analyze-actions.ts:60-80` says a frame pass cannot run and calls a `claude` subprocess bridge out of scope. That is now false. Replace it with:

```ts
/**
 * Starts a frame pass for one video and returns its job id. The work happens in
 * `frame-pass-runner.ts`: frames come from watch.py, the reading comes from a Claude Code
 * subprocess limited to `--allowedTools Read`, and the result is written through
 * `persistFramePass`, which rejects any value that cites no frame.
 *
 * A pass costs roughly one model turn per frame and runs for tens of seconds, so the
 * client polls `getFramePassJobAction` rather than holding this action open.
 *
 * Only one pass runs at a time. That is enforced by a partial unique index on
 * `frame_pass_jobs`, not by the check below, so a double click cannot race past it.
 */
```

- [ ] **Step 2: Write the failing test**

Create `src/server/actions/analyze-actions.test.ts`:

```ts
import { beforeAll, describe, expect, test } from "vitest";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let getFramePassJobAction: typeof import("./analyze-actions")["getFramePassJobAction"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ getFramePassJobAction } = await import("./analyze-actions"));
  migrate();
});

describe("getFramePassJobAction", () => {
  test("reports a failed job with its message", async () => {
    const channelId = newId();
    const videoId = newId();
    const jobId = newId();
    const now = nowIso();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@a-${channelId}`, trackedSince: now });
    await db.insert(tables.videos).values({
      id: videoId, channelId, platform: "instagram", externalId: `a-${videoId}`,
      url: "https://example.com/reel", postedAt: now, firstSeenAt: now,
    });
    await db.insert(tables.framePassJobs).values({
      id: jobId, videoId, status: "failed", startedAt: now, finishedAt: now,
      errorCode: "FRAME_EXTRACT_FAILED", errorMessage: "ffmpeg exploded",
    });

    const out = await getFramePassJobAction(jobId);
    expect(out.status).toBe("failed");
    expect(out.error).toBe("ffmpeg exploded");
  });

  test("reports an unknown job id as failed rather than pretending it runs", async () => {
    const out = await getFramePassJobAction(newId());
    expect(out.status).toBe("failed");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/server/actions/analyze-actions.test.ts`
Expected: FAIL, `getFramePassJobAction` is not exported.

- [ ] **Step 4: Replace the action body**

Replace `runFramePassAction` (currently lines 81 to 91) with:

```ts
export async function runFramePassAction(videoId: string): Promise<FramePassResult<{ jobId: string }>> {
  const { db, tables } = await import("../db");
  const { eq } = await import("drizzle-orm");

  const [running] = await db
    .select({ id: tables.framePassJobs.id })
    .from(tables.framePassJobs)
    .where(eq(tables.framePassJobs.status, "running"))
    .limit(1);
  if (running) {
    return { ok: false, error: "A frame pass is already running. Passes run one at a time.", code: "FRAME_ALREADY_RUN" };
  }

  const { runFramePass } = await import("../services/frame-pass-runner");
  try {
    const result = await runFramePass(videoId);
    if (!result.ok) {
      return {
        ok: false,
        error: "The frame pass ran but produced no reading. The Layout section shows why.",
        code: (result.errorCode ?? "FRAME_UNKNOWN") as FramePassCode,
      };
    }
    return { ok: true, jobId: result.jobId };
  } catch (err) {
    log.error("frame_pass.crashed", { videoId, error: (err as Error).message });
    return { ok: false, error: (err as Error).message, code: "FRAME_UNKNOWN" };
  }
}

/** Poll one job. An id we cannot find reads as failed, never as still running, so a lost
 *  job cannot leave the UI spinning forever. */
export async function getFramePassJobAction(
  jobId: string
): Promise<{ status: "running" | "success" | "failed"; error: string | null }> {
  const { db, tables } = await import("../db");
  const { eq } = await import("drizzle-orm");
  const [job] = await db
    .select({ status: tables.framePassJobs.status, errorMessage: tables.framePassJobs.errorMessage })
    .from(tables.framePassJobs)
    .where(eq(tables.framePassJobs.id, jobId))
    .limit(1);
  if (!job) return { status: "failed", error: "That frame pass job no longer exists." };
  return { status: job.status as "running" | "success" | "failed", error: job.errorMessage ?? null };
}
```

Remove `FRAME_NO_VISION_MODEL` from the `FramePassCode` union at line 43, then find every other reference:

```bash
grep -rn "FRAME_NO_VISION_MODEL" src/
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/server/actions/analyze-actions.test.ts`
Expected: PASS, 2 tests.

Then the whole suite, to catch anything that asserted on the old refusal:

Run: `npx vitest run`
Expected: PASS. If a test asserts `FRAME_NO_VISION_MODEL`, update it to the new behavior rather than restoring the old code.

- [ ] **Step 6: Stage the change, then ask before committing**

```bash
git add src/server/actions/analyze-actions.ts src/server/actions/analyze-actions.test.ts
```

Message: `feat(frame-pass): make runFramePassAction actually run a pass`

---

### Task 7: The Layout section stops refusing

**Files:**
- Modify: `src/components/video/layout-section.tsx`, the doc comment at lines 22 to 34, `runFramePass` at 39 to 51, and the copy at 92 to 97

**Interfaces:**
- Consumes: `runFramePassAction`, `getFramePassJobAction` (Task 6).
- Produces: no new exports. `fieldValue` stays exactly as it is.

- [ ] **Step 1: Replace the stale doc comment**

Lines 28 to 33 claim the action always refuses. Replace that paragraph with:

```
 * The pass runs out of process: watch.py samples frames, a Claude Code subprocess limited
 * to Read looks at them, and the result is written through the validator that rejects a
 * value citing no frames. It takes tens of seconds, so this polls the job rather than
 * awaiting the action.
```

- [ ] **Step 2: Replace runFramePass with the polling version**

Add `getFramePassJobAction` to the import on line 8, then:

```tsx
  async function runFramePass() {
    setPending(true);
    const started = await runFramePassAction(videoId);
    if (!started.ok) {
      setPending(false);
      toast.error(started.error);
      return;
    }

    // One model turn per frame means a pass can run for a minute or more. Poll rather
    // than hold the action open, and give up after 5 minutes so the button cannot stick.
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const job = await getFramePassJobAction(started.jobId);
      if (job.status === "running") continue;
      setPending(false);
      if (job.status === "success") {
        toast.success("Frame pass complete");
      } else {
        toast.error(job.error ?? "The frame pass produced no reading.");
      }
      router.refresh();
      return;
    }
    setPending(false);
    toast.error("Frame pass is taking unusually long. Reload to see where it landed.");
  }
```

- [ ] **Step 3: Replace the "no vision model" copy**

Lines 92 to 97 tell the user no vision model exists. Replace that branch with:

```tsx
          <>
            No frame pass has run for this video yet. Running one samples frames and reads
            on-screen text, its position, cut rhythm, and framing from them. Nothing above
            is a guess standing in for a reading.
          </>
```

- [ ] **Step 4: Verify in the running app**

```bash
npm run dev
```

Open `http://localhost:3001`. Use localhost, never 127.0.0.1, or Next 16 silently blocks Server Actions. Go to a video that has a downloaded file and click Run frame pass.

Expected: the button reads "Running...", and within about a minute the four fields fill in with a caption naming the frame count and `claude-code/watch+sonnet`.

These six have files on disk:

```
a0ed7179-1b66-4f2e-90c9-03e81429f9fc   @kallaway, 111s
ed0022ae-4f75-4393-832c-c3cb88be8f26   @nateherkai, 40s
68b5556c-bb3f-40b4-b838-c6ae10014b5d   @nateherkai, 19s (fastest to test)
deb3d8f6-82e8-41d2-89d9-61e622169eb6   @nick_saraev, 42s
74391e37-7a84-4748-a3a5-91e6baa82680   @nick_saraev, 32s
d247d5e4-4097-4dd0-babf-3a33c4929bf5   @nateherkai, 27s
```

Also click the button on a video with no downloaded file. Expected: a failure message, and the Layout section says the pass ran and came back empty rather than never run.

- [ ] **Step 5: Stage the change, then ask before committing**

```bash
git add src/components/video/layout-section.tsx
```

Message: `feat(frame-pass): poll the job and fill the Layout section`

---

### Task 8: Correct the workflow doc

**Files:**
- Modify: `docs/product/frame-pass-workflow.md`

- [ ] **Step 1: Fix the false claim**

Line 95 says no video file has been downloaded yet. Six have. Rewrite the "What is proven and what is not" section to say the pass runs in the app, and reframe the manual CLI procedure as the fallback for when the automated pass fails.

This file is NOT exempt from the humanizer hook. No em dashes, no en dashes, no curly quotes, or the write is rejected.

- [ ] **Step 2: Verify the hook accepts it**

```bash
grep -n "—\|–" docs/product/frame-pass-workflow.md
```

Expected: no output.

- [ ] **Step 3: Stage the change, then ask before committing**

```bash
git add docs/product/frame-pass-workflow.md
```

Message: `docs(frame-pass): the pass runs in-app now, CLI is the fallback`

---

## Self-review notes

Checked against `docs/superpowers/specs/2026-08-03-claude-code-vision-engine-design.md`:

- Stage 1 extract is Task 1. Stage 2 read is Tasks 2 and 3. Stage 3 write is Task 5, reusing `persistFramePass` unchanged as the spec requires.
- Module layout matches, with one split the spec did not name: the prompt and parser live in `frame-pass-prompt.ts` rather than inside the runner, so they are testable without spawning anything.
- Job model is Task 4, including the NOT NULL lock key the spec called for.
- All five spec failure modes have a test or an explicit code. No mp4 is Task 5 test 4. Extraction dies is Task 5 test 2. Binary missing is Task 2 test 4. Unusable JSON is Task 3 plus Task 5 test 3. A value citing no frames is delegated to `persistFramePass`, already covered by the existing `frame-pass.test.ts`.
- Both prompt findings from the proof pass are encoded: the 2 to 5 citation rule in `buildLayoutPrompt` with a test asserting it, and dedupe plus sort in `parseLayoutResult` with its own test.
- Out-of-scope items stay out. No per-frame timeline, no batch runs, no passes on videos without files.

Type consistency checked: `SampledFrame` is produced in Task 1 and consumed by name in Tasks 3 and 5. `ClaudeTaskResult` is produced in Task 2 and consumed in Task 5. `runFramePass` returns `FramePassRunResult` in Task 5 and Task 6 reads `.ok`, `.jobId` and `.errorCode` off it. `getFramePassJobAction` returns the same shape the Task 7 poller destructures.

Known gap, deliberate: `cancelRequested` and `heartbeatAt` exist as columns but nothing reads `cancelRequested` yet. They are there because adding columns to this database later is the awkward part, not because a cancel button is in scope. Do not build the cancel UI as part of these tasks.
