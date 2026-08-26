# M1 foundation and safety implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the two fresh-checkout snags, close the two frame-pass safety holes, and quiet the test run, so the codebase has a clean baseline before the larger milestones.

**Architecture:** Seven independent tasks, each its own commit. Two are one-file safety fixes (frame-pass data loss, yt-dlp arg separator), two are config or data repairs (lint, migration record), one refactors the Claude subprocess for confinement, one caps a layout value, one quiets logs and documents startup. No task depends on another, so they can run in any order, though the numbering is a sensible sequence. Work on a branch, not main.

**Tech stack:** Next.js 16, TypeScript, drizzle-orm with better-sqlite3, vitest, eslint (flat config), sqlite3 CLI.

## Global constraints

- No new lint or type problem over baseline. tsc must stay clean (`npm run typecheck`), tests green (`npm test`).
- The lint script is bare `eslint`. Warnings do not fail the run; errors do. The bar is zero errors.
- Dev DB is push and bootstrap based. Never run destructive commands against `data/crowsnest.db` without backing it up first with `sqlite3 data/crowsnest.db ".backup <file>"` (never `cp`, which drops the WAL).
- New schema (none in M1) goes through `npm run db:generate`, then the one file is applied by hand and recorded in `__drizzle_migrations`.
- `db:migrate` is `tsx src/server/db/migrate.ts`. `db:backup` is `tsx scripts/backup-db.ts`.
- Prose in docs follows the humanizer rules. Code, identifiers, and quoted output are left as they are.
- Start each task from a clean tree. Commit at the end of each.

---

### Task 1: Record the three hand-applied migrations

The dev DB has migrations 0011 to 0013 applied by hand but not recorded, so `db:migrate` replays from 0011 and dies on "table secrets already exists". A fresh clone is fine; only this local DB needs the three rows. The hashes below are the sha256 of each migration file (verified: the sha256 of `drizzle/0010_fancy_tigra.sql` matches its stored hash, so this is drizzle's method). The created_at values are each migration's `when` from `drizzle/meta/_journal.json`.

**Files:**
- Modify: `data/crowsnest.db` (local, gitignored) via SQL
- Modify: the project memory note `dev-db-not-migration-tracked.md` (already partly corrected; confirm it reflects the record-the-hashes fix)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Back up the dev DB (WAL-safe)**

```bash
sqlite3 data/crowsnest.db ".backup data/crowsnest.db.bak-pre-migrate-record"
```

- [ ] **Step 2: Confirm the current state fails**

```bash
npm run db:migrate
```
Expected: it errors with "table secrets already exists" (or similar). This is the bug being fixed. If it already says up to date, stop, the rows are present and this task is done.

- [ ] **Step 3: Insert the three missing records**

```bash
sqlite3 data/crowsnest.db "
INSERT INTO __drizzle_migrations (hash, created_at) VALUES
 ('16fe6016fd99633bdbe22c322565f78e03cd7af2b5bf7e70ff9821e6089643d1', 1785648829997),
 ('2cbeb50eb7dcdd63220262a4f1f4e6d6f7edf1378df8fb0a8e9e111628320d57', 1785665701588),
 ('976cc776ac20b58e4967f3be2e726bb559fca57d2344e5b82df6555a48376e0c', 1785774436366);
"
```

- [ ] **Step 4: Verify db:migrate is now a no-op**

```bash
npm run db:migrate
```
Expected: it reports up to date and applies nothing, no error.

- [ ] **Step 5: Verify the record count**

```bash
sqlite3 data/crowsnest.db "SELECT count(*) FROM __drizzle_migrations;"
```
Expected: 14.

- [ ] **Step 6: Commit**

Only the memory note is tracked (the DB is gitignored), so this commit records the note update. If the note already reads correctly, skip the commit and note that in the task log.

```bash
git add "/Users/kienbeovl/.claude/projects/-Users-kienbeovl-Desktop-entrepreneur-sandcastle-clone/memory/dev-db-not-migration-tracked.md"
git commit -m "docs(memory): db:migrate is fixed by recording 0011-0013 hashes, not hand-applying"
```

---

### Task 2: Green lint on a clean checkout

`npm run lint` has 4 errors in `channel-card.tsx` from the `react-hooks/refs` rule firing on dnd-kit's `useSortable` values (`setNodeRef`, `isDragging`, `attributes`, `listeners`), which are not React refs, plus errors from linting untracked scratch dirs (`Crowsnest UI Mockups/`, `claude-animation/`). Ignore the scratch dirs and disable the misfiring rule on the one file, with a comment.

**Files:**
- Modify: `eslint.config.mjs`
- Modify: `src/components/channels/channel-card.tsx:1-2`
- Modify: `README.md` (correct the stale typecheck baseline line)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Confirm the failing errors**

```bash
npm run lint 2>&1 | grep -E "error|problems" | head
```
Expected: 4 `react-hooks/refs` errors in channel-card.tsx, plus errors under `Crowsnest UI Mockups/` and `claude-animation/`.

- [ ] **Step 2: Ignore the scratch and vendor dirs**

In `eslint.config.mjs`, add the two dirs to the existing `globalIgnores` list:

```javascript
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Untracked scratch and vendor bundles, not our source:
    "Crowsnest UI Mockups/**",
    "claude-animation/**",
  ]),
```

- [ ] **Step 3: Disable the misfiring rule on channel-card**

At the top of `src/components/channels/channel-card.tsx`, right after the `"use client";` line, add:

```tsx
"use client";

/* eslint-disable react-hooks/refs -- dnd-kit's useSortable returns setNodeRef, attributes,
   listeners and isDragging to be applied in render. They are dnd-kit values, not React refs,
   so this rule misfires here. */
```

- [ ] **Step 4: Correct the README typecheck baseline**

Find the line in `README.md` that claims a known baseline of type errors (the devex report cited README:229) and change it to state that typecheck is clean. Confirm the exact current wording first with:

```bash
grep -n "baseline\|typecheck\|type error" README.md
```
Then edit that line to say typecheck passes clean with no known baseline.

- [ ] **Step 5: Verify lint is green and types are clean**

```bash
npm run lint; echo "lint exit $?"
npm run typecheck
```
Expected: lint exit 0 (warnings allowed, zero errors), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.mjs src/components/channels/channel-card.tsx README.md
git commit -m "fix(lint): green on a clean checkout, ignore scratch dirs, silence dnd-kit ref misfire"
```

---

### Task 3: Confine the frame-pass subprocess

`claude-task.ts` spawns the Claude child with no cwd and no env, so it inherits the Next server's working dir and full environment and can read `.env.local` and `data/crowsnest.db`. Confine it: run with cwd set to the temp frame dir, add that dir explicitly, and hand it an environment with the secrets stripped. The child only has `Read`, so limiting its cwd is what limits which files it can open.

**Files:**
- Modify: `src/server/services/claude-task.ts`
- Modify: `src/server/services/frame-pass-runner.ts:50-52`
- Test: `src/server/services/claude-task.test.ts` (append a describe block; create the file if it does not exist)

**Interfaces:**
- Produces: `scrubClaudeEnv(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv`, `buildClaudeInvocation(prompt: string, opts?: ClaudeTaskOpts): { binary: string; args: string[]; cwd?: string; env: NodeJS.ProcessEnv }`, and an extended `ClaudeTaskOpts` with `cwd?: string; addDirs?: string[]; env?: NodeJS.ProcessEnv`.
- Consumes (runner): `runClaudeTask(prompt, { cwd, addDirs })`.

- [ ] **Step 1: Write the failing tests**

Append to `src/server/services/claude-task.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { scrubClaudeEnv, buildClaudeInvocation } from "./claude-task";

describe("scrubClaudeEnv", () => {
  test("drops secrets, keeps PATH and HOME", () => {
    const out = scrubClaudeEnv({
      PATH: "/usr/bin",
      HOME: "/Users/x",
      IG_PASSWORD: "p",
      IG_SERVICE_TOKEN: "t",
      IG_SESSIONID: "s",
      ANTHROPIC_API_KEY: "k",
    });
    expect(out.PATH).toBe("/usr/bin");
    expect(out.HOME).toBe("/Users/x");
    expect(out.IG_PASSWORD).toBeUndefined();
    expect(out.IG_SERVICE_TOKEN).toBeUndefined();
    expect(out.IG_SESSIONID).toBeUndefined();
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe("buildClaudeInvocation", () => {
  test("adds --add-dir for each dir and keeps --allowedTools last", () => {
    const { args } = buildClaudeInvocation("hi", { addDirs: ["/tmp/frames"], allowedTools: ["Read"] });
    expect(args).toContain("--add-dir");
    expect(args[args.indexOf("--add-dir") + 1]).toBe("/tmp/frames");
    // --allowedTools is variadic, so it must be the last flag in argv.
    expect(args[args.length - 2]).toBe("--allowedTools");
    expect(args[args.length - 1]).toBe("Read");
  });

  test("passes cwd through and scrubs the env by default", () => {
    // setup-env.ts sets IG_SERVICE_TOKEN in process.env for the whole suite.
    const { cwd, env } = buildClaudeInvocation("hi", { cwd: "/tmp/frames" });
    expect(cwd).toBe("/tmp/frames");
    expect(env.IG_SERVICE_TOKEN).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

```bash
npx vitest run src/server/services/claude-task.test.ts -t "scrubClaudeEnv|buildClaudeInvocation"
```
Expected: FAIL, `scrubClaudeEnv`/`buildClaudeInvocation` are not exported.

- [ ] **Step 3: Implement the helpers and rewire the spawn**

In `src/server/services/claude-task.ts`, add the two exports and extend the options. Replace the current `runClaudeTask` argv building and the `run` signature with this:

```ts
export interface ClaudeTaskOpts {
  binaryPath?: string;
  model?: string;
  allowedTools?: string[];
  timeoutMs?: number;
  cwd?: string;
  addDirs?: string[];
  env?: NodeJS.ProcessEnv;
}

/**
 * A copy of `base` with anything that looks like a credential removed. The frame-pass
 * child only has Read, but it should never even see IG_PASSWORD, a token, or the db path
 * in its environment. Keeps PATH, HOME and the rest so the CLI still runs and authenticates
 * from ~/.claude.
 */
export function scrubClaudeEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const SENSITIVE = /(TOKEN|SECRET|PASSWORD|_KEY$|SESSIONID|CROWSNEST_DB_PATH|DATABASE_URL)/i;
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (SENSITIVE.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export function buildClaudeInvocation(
  prompt: string,
  opts: ClaudeTaskOpts = {}
): { binary: string; args: string[]; cwd?: string; env: NodeJS.ProcessEnv } {
  const binary = opts.binaryPath ?? process.env.CLAUDE_BINARY_PATH ?? DEFAULT_BINARY;
  const allowedTools = opts.allowedTools ?? ["Read"];
  if (allowedTools.length === 0) {
    throw new ClaudeTaskError(
      "allowedTools must not be empty: --allowedTools has no way to express \"zero tools\", and omitting the " +
        "flag would silently fall back to the CLI's default permissions, which is wider than what was asked for."
    );
  }
  const addDirArgs = (opts.addDirs ?? []).flatMap((d) => ["--add-dir", d]);
  // --allowedTools is variadic: it greedily consumes every following token. It stays LAST,
  // after --output-format json and any --add-dir pairs, or it swallows them as tool names.
  const args = [
    "-p",
    prompt,
    "--model",
    opts.model ?? "sonnet",
    "--output-format",
    "json",
    ...addDirArgs,
    "--allowedTools",
    ...allowedTools,
  ];
  return { binary, args, cwd: opts.cwd, env: opts.env ?? scrubClaudeEnv() };
}
```

Change `runClaudeTask` to use it, and pass cwd/env down to `run`:

```ts
export async function runClaudeTask(prompt: string, opts: ClaudeTaskOpts = {}): Promise<ClaudeTaskResult> {
  const { binary, args, cwd, env } = buildClaudeInvocation(prompt, opts);
  const { stdout, stderr, code } = await run(binary, args, opts.timeoutMs ?? 600_000, { cwd, env });
  // ... the rest of the function (envelope parsing) is unchanged ...
```

Change `run` to accept and apply cwd/env:

```ts
function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
  spawnOpts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], cwd: spawnOpts.cwd, env: spawnOpts.env });
    // ... the rest of run() is unchanged ...
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
npx vitest run src/server/services/claude-task.test.ts
```
Expected: PASS, including any existing claude-task tests.

- [ ] **Step 5: Wire the runner to confine the child**

In `src/server/services/frame-pass-runner.ts`, import `scrubClaudeEnv` is not needed (the default scrubs). Change the `ask` default (line 52) so the real call is confined to the work dir:

```ts
  const extract = deps.extractFrames ?? ((v, o) => realExtractFrames(v, o));
  const ask =
    deps.runClaudeTask ??
    ((p) => realRunClaudeTask(p, workDir ? { cwd: workDir, addDirs: [workDir] } : {}));
```

Note `workDir` is declared with `let workDir: string | null = null;` a few lines down and assigned before `ask` is ever called, so the closure reads the assigned value at call time. Move the `let workDir` declaration above the `ask` assignment if the linter complains about use-before-declaration.

- [ ] **Step 6: Run the runner tests and typecheck**

```bash
npx vitest run src/server/services/frame-pass-runner.test.ts
npm run typecheck
```
Expected: PASS and clean. The runner tests inject a fake `runClaudeTask`, so they are unaffected by the confinement.

- [ ] **Step 7: Manual confinement check (once, local, real binary)**

This cannot be a unit test (it needs the real claude binary and a Max session). Run it once to confirm the sandbox holds:

```bash
# from a scratch dir, put a fake secret one level up, then confirm a Read-only child
# started with cwd=that dir cannot open the parent file. Record the result in the task log.
```
Expected: the child reports it cannot read the file outside its cwd.

- [ ] **Step 8: Commit**

```bash
git add src/server/services/claude-task.ts src/server/services/claude-task.test.ts src/server/services/frame-pass-runner.ts
git commit -m "fix(security): confine the frame-pass subprocess to the frame dir, strip secrets from its env"
```

---

### Task 4: Cap the layout value length

The anti-fabrication guard checks a value cites frames, but not its size, so a crafted frame could push a large blob into a layout field. Cap each field value length in `persistFramePass`.

**Files:**
- Modify: `src/server/services/frame-pass.ts:66-84`
- Test: `src/server/services/frame-pass.test.ts` (add a test in the `persistFramePass` describe)

**Interfaces:**
- Produces: an exported `MAX_LAYOUT_VALUE_LEN` constant.
- Consumes: the existing `FramePassValidationError`.

- [ ] **Step 1: Write the failing test**

Add inside the `describe("persistFramePass", ...)` block in `src/server/services/frame-pass.test.ts`:

```ts
  test("rejects a field value longer than the cap", async () => {
    const videoId = await seedVideo();
    const huge = layout({ onScreenText: field("x".repeat(5000), [0.5]) });
    await expect(
      persistFramePass({ videoId, layout: huge, framesSampled: 5, frameModel: "claude-code/watch" })
    ).rejects.toBeInstanceOf(FramePassValidationError);
    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
    expect(row).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run src/server/services/frame-pass.test.ts -t "longer than the cap"
```
Expected: FAIL, the huge value is currently accepted (or fails for the wrong reason).

- [ ] **Step 3: Implement the cap**

In `src/server/services/frame-pass.ts`, add the constant near `LAYOUT_FIELDS`:

```ts
/** A layout field is a short phrase ("centered, upper third"). Anything past this is not a
 *  reading, it is a blob, so refuse it rather than store it. */
export const MAX_LAYOUT_VALUE_LEN = 1000;
```

Add the length check inside the existing `for (const key of LAYOUT_FIELDS)` loop in `persistFramePass`, right after the fromFramesSec check:

```ts
    if (field.value !== null && field.value.length > MAX_LAYOUT_VALUE_LEN) {
      throw new FramePassValidationError(
        `Layout field "${key}" is ${field.value.length} chars, over the ${MAX_LAYOUT_VALUE_LEN} cap. A reading is a short phrase, not a dump.`
      );
    }
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx vitest run src/server/services/frame-pass.test.ts
```
Expected: PASS, all persistFramePass tests including the existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/frame-pass.ts src/server/services/frame-pass.test.ts
git commit -m "fix(security): cap frame-pass layout field length so a frame cannot inject a blob"
```

---

### Task 5: Stop a failed re-run deleting the good layout

`recordFramePassFailure` nulls `layout`, `framesSampled`, `frameModel` on its update path, so a failing re-run wipes an existing reading. On update, write only the failure fields. A brand-new failure row still starts with a null layout, which is correct.

**Files:**
- Modify: `src/server/services/frame-pass.ts:121-139`
- Test: `src/server/services/frame-pass.test.ts` (add a test in the `recordFramePassFailure` describe)

**Interfaces:**
- Consumes: existing `persistFramePass`, `recordFramePassFailure`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Add inside the `describe("recordFramePassFailure", ...)` block:

```ts
  test("preserves an existing good layout when a later pass fails", async () => {
    const videoId = await seedVideo();
    await persistFramePass({ videoId, layout: layout(), framesSampled: 12, frameModel: "claude-code/watch" });

    await recordFramePassFailure(videoId, "ffmpeg exploded on the re-run");

    const [row] = await db.select().from(tables.videoAnalyses).where(eq(tables.videoAnalyses.videoId, videoId)).limit(1);
    expect(row.layout?.onScreenText.value).toBe("3 MISTAKES"); // still there
    expect(row.framePassError).toBe("ffmpeg exploded on the re-run");
    expect(row.framePassAt).not.toBeNull();
  });
```

Note this uses `persistFramePass`, which the failure describe does not currently import. Confirm the imports at the top of the file already include it (they do: line 12-13 import both).

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run src/server/services/frame-pass.test.ts -t "preserves an existing good layout"
```
Expected: FAIL, `row.layout` is null because the update path wiped it.

- [ ] **Step 3: Split the update and insert paths**

In `src/server/services/frame-pass.ts`, rewrite the body of `recordFramePassFailure` from the `const now` line down:

```ts
  const now = nowIso();

  const [existing] = await db
    .select({ videoId: tables.videoAnalyses.videoId })
    .from(tables.videoAnalyses)
    .where(eq(tables.videoAnalyses.videoId, videoId))
    .limit(1);

  if (existing) {
    // Do NOT touch layout/framesSampled/frameModel: a re-run that fails must not erase a
    // reading a previous pass already stored. Only the failure fields change.
    await db
      .update(tables.videoAnalyses)
      .set({ framePassAt: now, framePassError: error })
      .where(eq(tables.videoAnalyses.videoId, videoId));
  } else {
    // Brand-new failure row: there is no layout to keep, so null is correct here.
    await db
      .insert(tables.videoAnalyses)
      .values({ videoId, createdAt: now, layout: null, framesSampled: null, frameModel: null, framePassAt: now, framePassError: error });
  }
```

- [ ] **Step 4: Run the tests, verify they pass**

```bash
npx vitest run src/server/services/frame-pass.test.ts
```
Expected: PASS. Both the new preserve test and the existing "leaves layout null (ran, came back empty)" test pass (that one exercises the insert path on a fresh row).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/frame-pass.ts src/server/services/frame-pass.test.ts
git commit -m "fix(frame-pass): a failed re-run keeps the existing layout, only records the error"
```

---

### Task 6: yt-dlp argument separator

A pasted reel URL is passed as the last positional to yt-dlp with no `--`, so a URL beginning with a dash is read as a flag. Add `--` before the URL in both call sites.

**Files:**
- Modify: `src/server/providers/ytdlp.ts:50`
- Modify: `src/server/lib/exec.ts:63`
- Test: `src/server/providers/ytdlp.test.ts` (create if absent)

**Interfaces:**
- Consumes: `fetchReelByUrl`, and the `../lib/exec` module (mocked in the test).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create `src/server/providers/ytdlp.test.ts`:

```ts
import { describe, expect, test, vi, beforeEach } from "vitest";

const execFileP = vi.fn();
const detectBinary = vi.fn();
vi.mock("../lib/exec", () => ({ execFileP, detectBinary }));

import { fetchReelByUrl } from "./ytdlp";

beforeEach(() => {
  execFileP.mockReset();
  detectBinary.mockReset();
  detectBinary.mockResolvedValue("/usr/local/bin/yt-dlp");
  execFileP.mockResolvedValue({ stdout: JSON.stringify({ id: "1", webpage_url: "u", uploader_id: "x", timestamp: 0 }), stderr: "" });
});

describe("fetchReelByUrl", () => {
  test("passes -- before the URL so a dash-leading URL is not read as a flag", async () => {
    await fetchReelByUrl("-oProof");
    const args = execFileP.mock.calls[0][1] as string[];
    expect(args[args.length - 2]).toBe("--");
    expect(args[args.length - 1]).toBe("-oProof");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npx vitest run src/server/providers/ytdlp.test.ts
```
Expected: FAIL, the second-to-last arg is `--no-warnings`, not `--`.

- [ ] **Step 3: Add the separator in both call sites**

In `src/server/providers/ytdlp.ts:50`, change:

```ts
  const { stdout } = await execFileP(bin, ["-J", "--no-warnings", "--", url]);
```

In `src/server/lib/exec.ts:63` (the `downloadToTmp` call), change:

```ts
  await execFileP(bin, ["-o", dest, "--no-warnings", "-f", "mp4/best", "--", url]);
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npx vitest run src/server/providers/ytdlp.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/providers/ytdlp.ts src/server/lib/exec.ts src/server/providers/ytdlp.test.ts
git commit -m "fix(security): pass -- before the yt-dlp URL so a dash-leading URL cannot be a flag"
```

---

### Task 7: Quiet the test logs and document the one-command up

A passing test run prints hundreds of JSON log lines because the code under test calls `log.info/warn`. The logger honors `LOG_LEVEL` (default "info"). Set it to "error" in the test setup so info and warn are suppressed and real errors still show. Separately, document the one-command stack startup in the README.

**Files:**
- Modify: `src/test/setup-env.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the logger's `LOG_LEVEL` env (from `src/server/lib/logger.ts:24-28`).
- Produces: nothing.

- [ ] **Step 1: See the noise**

```bash
npx vitest run src/server/services/frame-pass-runner.test.ts 2>&1 | grep -c '"event":'
```
Expected: a nonzero count of JSON log lines.

- [ ] **Step 2: Silence info and warn in tests**

In `src/test/setup-env.ts`, add one line alongside the existing env defaults:

```ts
process.env.CROWSNEST_DB_PATH ??= ":memory:";
process.env.IG_SERVICE_TOKEN ??= "test-token";
process.env.LOG_LEVEL ??= "error"; // quiet info/warn in tests; a test can override to assert a log line
```

- [ ] **Step 3: Verify the noise is gone**

```bash
npx vitest run src/server/services/frame-pass-runner.test.ts 2>&1 | grep -c '"event":'
```
Expected: 0 (or near 0, only genuine error lines). Tests still pass.

- [ ] **Step 4: Document the one-command up in the README**

Add a short section to `README.md` explaining that `/crowsnest-up` brings the stack up in one step (9router LLM proxy on 20128, the dev server on 3000 in a cmux pane, and a connected browser), and that the dev server must run in a cmux pane because a shell-started one is reaped. Match the README's existing heading style and sentence case. Confirm the current structure first:

```bash
grep -n "^#" README.md | head
```

- [ ] **Step 5: Run the full suite to confirm nothing regressed**

```bash
npm test 2>&1 | tail -5
```
Expected: all tests pass, output is quiet.

- [ ] **Step 6: Commit**

```bash
git add src/test/setup-env.ts README.md
git commit -m "chore(test): quiet info/warn logs in tests; docs: one-command stack up"
```

---

## Final verification

After all seven tasks:

- [ ] `npm run lint; echo $?` is 0 errors.
- [ ] `npm run typecheck` is clean.
- [ ] `npm test` passes and is quiet.
- [ ] `npm run db:migrate` reports up to date.

## Self-review notes

- Spec coverage: M1-U1 (Task 1), M1-U2 (Task 2), M1-U3 subprocess confinement (Task 3) and value cap (Task 4), M1-U4 (Task 5), M1-U5 (Task 6), M1-U6 quiet tests and one-command up (Task 7). All six M1 units are covered.
- The exact hashes and journal timestamps in Task 1 were computed and verified against a recorded migration, not guessed.
- The lint rule name and the four error lines in Task 2 came from running eslint, not from memory.
- Type names used across tasks (`ClaudeTaskOpts`, `scrubClaudeEnv`, `buildClaudeInvocation`, `MAX_LAYOUT_VALUE_LEN`) are defined in the task that introduces them.
- Open item carried from the spec: the frame-pass discoverability gate decision (M2, not M1) and the isolated stale-lock test are not in this milestone.
