# E1 harness hub implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded cook spawn in session.ts with a declared harness profile, and give the cook a lifecycle that survives a stop without leaking child processes.

**Architecture:** A pure HarnessProfile object plus a buildHarnessArgs argv builder describe one cook spawn. session.ts spawns from the profile in its own process group so a stop kills the whole tree. ws.ts assembles the profile from config plus the sandbox dir, runs cooks through a small p-queue, gates the render poll to the in-flight window with one AbortController, and applies a wall-clock watchdog. AssetStore.put streams the sha256 so a big render does not block.

**Tech Stack:** TypeScript, node-pty, ws, Next custom server (tsx server.ts), vitest, p-queue.

**Spec:** docs/superpowers/specs/2026-08-14-e1-harness-hub-spec.md

## Global Constraints

- E1 changes how the cook launches and dies, never what it does. No behavior change to the cook command itself: same `/ksa:cooking`, same sandbox cwd, same render capture at `/api/media/<id>`.
- The profile has a `pluginDir` field but it stays unset in E1. The cook still finds `/ksa:cooking` by cwd-walk into the vault, exactly as today. E3 fills pluginDir in.
- The hooks-off override is scoped to the cook spawn only. It must not disable any hook for the main Crowsnest app session.
- Watchdog in E1 is a plain wall-clock timeout, not gate-aware. Cooks are human-gated (the cook has mandatory AskUserQuestion gates), so the default must be high enough that a human sitting on a gate never trips it. Gate-aware watchdog is D1, out of scope here.
- claude binary is `/Users/kienbeovl/.local/bin/claude`, overridable by `CLAUDE_BINARY_PATH`. CLI version 2.1.231. `--permission-mode` valid choices include `bypassPermissions`. `--settings` accepts a JSON string and loads additional settings.
- Tests run with the project's vitest setup. Run a single test file with `npx vitest run <path>`.
- npm/node are not on the default Bash PATH in this environment; prefix commands with `export PATH="/opt/homebrew/bin:$PATH"`.

## File structure

- Create `src/server/terminal/harness-profile.ts`: the `HarnessProfile` interface, `buildHarnessArgs`, and `buildCookProfile` factory. Pure, no I/O except reading config.
- Create `src/server/terminal/harness-profile.test.ts`: unit tests for the two functions.
- Create `src/server/terminal/cook-queue.ts`: a module-level p-queue wrapper so simultaneous cooks degrade gracefully.
- Modify `src/server/terminal/session.ts`: `createTerminalSession` takes a `HarnessProfile`, spawns with `buildHarnessArgs`, gives the child its own process group, and exposes a tree kill.
- Modify `src/server/terminal/session.test.ts`: cover the new spawn arguments and profile wiring (mock node-pty as the existing tests do).
- Modify `src/server/terminal/ws.ts`: build the profile, run the cook through the queue, gate the render poll and watchdog with one AbortController.
- Modify `src/server/terminal/render-watch.ts`: no behavior change needed inside; the gating lives in ws.ts. Add a prune helper for old render dirs.
- Modify `src/server/media/asset-store.ts`: stream the sha256 in `put`.
- Modify `src/server/config.ts`: add `COOK_CONCURRENCY`, `COOK_WATCHDOG_MS`, `COOK_MODEL` with defaults.
- Modify `package.json`: add `p-queue`.

## Rulings baked into this plan (from the spec's open questions)

1. Permission flag: use `--permission-mode bypassPermissions` and drop `--dangerously-skip-permissions`. Task 2 includes a live check that the cook still runs unattended. Cost if wrong: the cook prompts and stalls; fix is to re-add the old flag, one line.
2. Settings merge: pass `--settings '{"hooks":{"SessionStart":[]}}'`. Task 3 verifies live whether the empty array overrides the inherited SessionStart hooks. Cost if wrong: banners leak into the cook context; fix is documented in Task 3.
3. Process-group kill: give the pty child its own group and kill by negative pid on darwin. Task 2 verifies no orphaned children survive a stop. Cost if wrong: orphaned ffmpeg or kokoro; fix is the group kill this task installs.
4. Defaults (Kai did not answer the wireframe's question 4): COOK_CONCURRENCY = 2, COOK_WATCHDOG_MS = 21600000 (6 hours). The watchdog is a hung-process safety net only, not a cook time limit, because a human gate can sit for a long time and D1 owns gate-awareness. Cost if wrong: a genuinely hung cook takes up to 6 hours to be reaped, or two cooks is too many; both are one-line config changes.

---

### Task 1: HarnessProfile type and argv builder

**Files:**
- Create: `src/server/terminal/harness-profile.ts`
- Test: `src/server/terminal/harness-profile.test.ts`

**Interfaces:**
- Consumes: `scrubbedTerminalEnv` from `./session` (existing export), `config` from `@/server/config`.
- Produces:
  - `interface HarnessProfile { model?: string; cwd: string; pluginDir?: string; permissionMode: "bypassPermissions"; settingsJson: string; env: NodeJS.ProcessEnv }`
  - `function buildHarnessArgs(p: HarnessProfile): string[]`
  - `function buildCookProfile(cwd: string): HarnessProfile`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/terminal/harness-profile.test.ts
import { describe, expect, it } from "vitest";
import { buildHarnessArgs, type HarnessProfile } from "./harness-profile";

const base: HarnessProfile = {
  cwd: "/tmp/sandbox",
  permissionMode: "bypassPermissions",
  settingsJson: '{"hooks":{"SessionStart":[]}}',
  env: {},
};

describe("buildHarnessArgs", () => {
  it("always emits permission mode and settings", () => {
    expect(buildHarnessArgs(base)).toEqual([
      "--permission-mode",
      "bypassPermissions",
      "--settings",
      '{"hooks":{"SessionStart":[]}}',
    ]);
  });

  it("adds model when set", () => {
    expect(buildHarnessArgs({ ...base, model: "minimax" })).toContain("--model");
    expect(buildHarnessArgs({ ...base, model: "minimax" })).toContain("minimax");
  });

  it("adds plugin-dir only when set", () => {
    expect(buildHarnessArgs(base)).not.toContain("--plugin-dir");
    expect(buildHarnessArgs({ ...base, pluginDir: "/plugins/ksa" })).toContain("--plugin-dir");
  });

  it("does not emit the old dangerously-skip flag", () => {
    expect(buildHarnessArgs(base)).not.toContain("--dangerously-skip-permissions");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/terminal/harness-profile.test.ts`
Expected: FAIL, module `./harness-profile` not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/server/terminal/harness-profile.ts
import { config } from "@/server/config";
import { scrubbedTerminalEnv } from "./session";

export interface HarnessProfile {
  /** maps to --model; unset means the CLI default */
  model?: string;
  /** the sandbox dir the cook runs in */
  cwd: string;
  /** maps to --plugin-dir; UNSET in E1, filled by E3 */
  pluginDir?: string;
  /** maps to --permission-mode */
  permissionMode: "bypassPermissions";
  /** serialized object passed to --settings; hooks-off */
  settingsJson: string;
  /** scrubbedTerminalEnv() output */
  env: NodeJS.ProcessEnv;
}

/**
 * The SessionStart override that keeps this app's hooks (ADHD, caveman, superpowers,
 * humanizer, last30days) out of the cook's context. Verified live in Task 3 to override
 * rather than append.
 */
export const HOOKS_OFF_SETTINGS = '{"hooks":{"SessionStart":[]}}';

export function buildHarnessArgs(p: HarnessProfile): string[] {
  const args: string[] = ["--permission-mode", p.permissionMode, "--settings", p.settingsJson];
  if (p.model) args.push("--model", p.model);
  if (p.pluginDir) args.push("--plugin-dir", p.pluginDir);
  return args;
}

export function buildCookProfile(cwd: string): HarnessProfile {
  return {
    cwd,
    permissionMode: "bypassPermissions",
    settingsJson: HOOKS_OFF_SETTINGS,
    model: config.COOK_MODEL,
    env: scrubbedTerminalEnv(),
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/terminal/harness-profile.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/terminal/harness-profile.ts src/server/terminal/harness-profile.test.ts
git commit -m "feat(harness): HarnessProfile and buildHarnessArgs"
```

Note: `buildCookProfile` reads `config.COOK_MODEL`, added in Task 6. Until then it is `undefined`, which is valid (model is optional). The test does not exercise `buildCookProfile`, so Task 1 passes on its own. If the implementer wants to test `buildCookProfile` now, add `COOK_MODEL` to config first (see Task 6 Step 3 for the exact value) or leave it for Task 6.

---

### Task 2: session.ts spawns from a profile, in its own process group

**Files:**
- Modify: `src/server/terminal/session.ts`
- Modify: `src/server/terminal/session.test.ts`

**Interfaces:**
- Consumes: `HarnessProfile`, `buildHarnessArgs` from `./harness-profile`.
- Produces: `createTerminalSession(profile: HarnessProfile): TerminalSession`. The `TerminalSession` interface gains nothing new; `kill()` now kills the whole process group.

Context for the implementer: the current `createTerminalSession({ cwd })` spawns `binary` with `["--dangerously-skip-permissions"]`. node-pty's `spawn` does not take a `detached` option the way `child_process` does; on darwin the pty child is already a session leader, so its pid is also its process-group id. To kill the tree, send the signal to the negative pid: `process.kill(-child.pid, "SIGTERM")`. Guard it: `child.pid` can be undefined, and the group may already be gone (`ESRCH`). Fall back to `child.kill()`.

- [ ] **Step 1: Write the failing test**

The existing `session.test.ts` mocks node-pty. Read it first to match its mock shape. Add a test that `createTerminalSession` passes the profile's argv and cwd to `spawn`:

```ts
it("spawns with the profile's argv, cwd, and env", () => {
  const profile = {
    cwd: "/tmp/sandbox",
    permissionMode: "bypassPermissions" as const,
    settingsJson: '{"hooks":{"SessionStart":[]}}',
    env: { FOO: "bar" },
  };
  createTerminalSession(profile);
  expect(spawnMock).toHaveBeenCalledWith(
    expect.any(String),
    ["--permission-mode", "bypassPermissions", "--settings", '{"hooks":{"SessionStart":[]}}'],
    expect.objectContaining({ cwd: "/tmp/sandbox", env: { FOO: "bar" } }),
  );
});
```

Adapt `spawnMock` to however the existing test captures the node-pty `spawn` mock. If the existing test asserts the old `["--dangerously-skip-permissions"]` argv, update that assertion to the new argv in this step.

- [ ] **Step 2: Run the test, verify it fails**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/terminal/session.test.ts`
Expected: FAIL, the signature or argv does not match.

- [ ] **Step 3: Change the implementation**

Rewrite the spawn and kill in `session.ts`:

```ts
import { spawn } from "node-pty";
import { buildHarnessArgs, type HarnessProfile } from "./harness-profile";
// keep scrubClaudeEnv import and scrubbedTerminalEnv export as they are

export function createTerminalSession(profile: HarnessProfile): TerminalSession {
  const binary = process.env.CLAUDE_BINARY_PATH ?? DEFAULT_BINARY;
  const child = spawn(binary, buildHarnessArgs(profile), {
    name: "xterm-256color",
    cols: 120,
    rows: 40,
    cwd: profile.cwd,
    env: profile.env,
  });

  return {
    onData(cb) { child.onData(cb); },
    write(s) { child.write(s); },
    resize(cols, rows) { child.resize(cols, rows); },
    onExit(cb) { child.onExit(({ exitCode }) => cb(exitCode)); },
    kill() {
      const pid = child.pid;
      if (typeof pid === "number") {
        try {
          // Negative pid signals the whole process group so ffmpeg/kokoro/sub-agent
          // children die with the cook, not orphaned. On darwin the pty child leads
          // its own session, so its pid is its pgid.
          process.kill(-pid, "SIGTERM");
          return;
        } catch {
          // ESRCH (group already gone) or EPERM: fall through to the single kill.
        }
      }
      child.kill();
    },
  };
}
```

Keep `scrubbedTerminalEnv` exported (Task 1's `buildCookProfile` imports it). Keep `DEFAULT_BINARY` and the `CLAUDE_BINARY_PATH` override.

- [ ] **Step 4: Run the test, verify it passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/terminal/session.test.ts src/server/terminal/harness-profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/terminal/session.ts src/server/terminal/session.test.ts
git commit -m "feat(harness): session spawns from a profile and kills the process group"
```

Note on the live checks (rulings 1 and 3): a real cook spawn to confirm unattended run and no orphaned children cannot be unit-tested. The controller runs that smoke check once at the final review (see the spec's acceptance criteria 1 and 4). Do not block this task on it.

---

### Task 3: hooks-off, verified live

**Files:**
- Modify: `src/server/terminal/harness-profile.ts` (only if the live check shows the override does not work; otherwise no code change, just the recorded result)
- No test file change; this task's deliverable is a verified constant plus a recorded result.

Context: `HOOKS_OFF_SETTINGS` is already `'{"hooks":{"SessionStart":[]}}'` from Task 1. This task confirms live that it actually suppresses the inherited SessionStart hooks instead of appending to them.

- [ ] **Step 1: Spawn a throwaway claude with the override and capture output**

Run (from the repo root):

```bash
export PATH="/opt/homebrew/bin:$PATH"
/Users/kienbeovl/.local/bin/claude \
  --permission-mode bypassPermissions \
  --settings '{"hooks":{"SessionStart":[]}}' \
  -p "print the single word READY and nothing else" 2>&1 | head -40
```

- [ ] **Step 2: Check for banner leakage**

Expected: the output shows the model's reply with no `ADHD MODE ACTIVE`, no `CAVEMAN MODE ACTIVE`, no `superpowers` preamble, no `HUMANIZER RULES`, no `last30days` banner. If the banners are absent, the override works: record the result in the report and stop, no code change.

- [ ] **Step 3: Fallback only if banners leak**

If the banners still appear, the empty array appended instead of overriding. Change `HOOKS_OFF_SETTINGS` to also clear the other hook events the app uses and re-run Step 1. If that still leaks, the override form is wrong for this CLI version: record the exact observed behavior in the report, set `HOOKS_OFF_SETTINGS` back to the SessionStart-only form, and flag it for the controller as a real gap (do not silently ship a leaking cook). The controller decides whether to accept the leak for E1 or route to a different mechanism.

- [ ] **Step 4: Commit only if code changed**

```bash
git add src/server/terminal/harness-profile.ts
git commit -m "test(harness): verify SessionStart hooks-off override"
```

If no code changed, skip the commit and report the verified result.

---

### Task 4: cook queue

**Files:**
- Create: `src/server/terminal/cook-queue.ts`
- Create: `src/server/terminal/cook-queue.test.ts`
- Modify: `package.json` (add p-queue)

**Interfaces:**
- Consumes: `config.COOK_CONCURRENCY` (added in Task 6; until then default to 2 inline, see Step 3).
- Produces: `function runOnCookQueue<T>(fn: () => Promise<T>): Promise<T>` backed by a module-level singleton p-queue.

- [ ] **Step 1: Add the dependency**

```bash
export PATH="/opt/homebrew/bin:$PATH"
npm install p-queue
```

- [ ] **Step 2: Write the failing test**

```ts
// src/server/terminal/cook-queue.test.ts
import { describe, expect, it } from "vitest";
import { runOnCookQueue } from "./cook-queue";

describe("runOnCookQueue", () => {
  it("runs a job and returns its value", async () => {
    await expect(runOnCookQueue(async () => 41 + 1)).resolves.toBe(42);
  });

  it("does not run more than the concurrency limit at once", async () => {
    let active = 0;
    let peak = 0;
    const job = () =>
      runOnCookQueue(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active -= 1;
      });
    await Promise.all([job(), job(), job(), job()]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Write the implementation**

```ts
// src/server/terminal/cook-queue.ts
import PQueue from "p-queue";
import { config } from "@/server/config";

// One queue for the whole process so simultaneous cooks degrade gracefully instead of
// thrashing the machine. Concurrency comes from config (Task 6); default 2.
const queue = new PQueue({ concurrency: config.COOK_CONCURRENCY ?? 2 });

export function runOnCookQueue<T>(fn: () => Promise<T>): Promise<T> {
  return queue.add(fn) as Promise<T>;
}
```

If `config.COOK_CONCURRENCY` does not exist yet (Task 6 not done), the `?? 2` keeps this green. When Task 6 lands, the config value takes over.

- [ ] **Step 4: Run the test, verify it passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/terminal/cook-queue.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/terminal/cook-queue.ts src/server/terminal/cook-queue.test.ts package.json package-lock.json
git commit -m "feat(harness): cook concurrency queue"
```

---

### Task 5: gate the render poll and watchdog in ws.ts

**Files:**
- Modify: `src/server/terminal/ws.ts`
- Modify: `src/server/terminal/render-watch.ts` (add a prune helper)
- Test: extend `src/server/terminal/ws.test.ts`

**Interfaces:**
- Consumes: `buildCookProfile` from `./harness-profile`, `runOnCookQueue` from `./cook-queue`, `config.COOK_WATCHDOG_MS`, `pruneOldRenders` from `./render-watch`.
- Produces: no new export; ws.ts internals change.

Context: today ws.ts calls `createTerminalSession({ cwd: dir })` and `watchForRender` at connection time and both run for the whole session. Read the current ws.ts (`attachTerminal`) before editing. The render poll should start when the cook is spawned and stop on render-found or session exit. The watchdog is a single timer that kills the session after `COOK_WATCHDOG_MS`. One `AbortController` per attach owns both timers so a single teardown clears them.

- [ ] **Step 1: Add the prune helper to render-watch.ts with a test**

```ts
// add to src/server/terminal/render-watch.ts
import { readdirSync, rmSync, statSync } from "node:fs";

/**
 * Deletes render dirs older than maxAgeMs so the renders root does not grow without
 * bound. Best-effort: a failure to stat or remove one entry must not throw.
 */
export function pruneOldRenders(maxAgeMs: number, now: number = Date.now()): void {
  const root = rendersRoot();
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const p = path.join(root, entry.name);
    try {
      if (now - statSync(p).mtimeMs > maxAgeMs) rmSync(p, { recursive: true, force: true });
    } catch {
      // ignore a single bad entry
    }
  }
}
```

Add a test in `render-watch.test.ts` (create it if absent) that writes two dirs with different mtimes into a temp renders root and asserts only the old one is removed. Since `rendersRoot()` reads `config.VAULT_PATH`, either set that env for the test or refactor `pruneOldRenders` to accept an explicit root argument. Prefer the explicit-root refactor: `pruneOldRenders(root: string, maxAgeMs: number, now?: number)` and have ws.ts pass `rendersRoot()`. Update the signature in the Interfaces block above if you take this route.

- [ ] **Step 2: Run the prune test, verify it fails then passes**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/terminal/render-watch.test.ts`

- [ ] **Step 3: Rewire ws.ts**

In `attachTerminal`, after `const dir = sandboxDir(slug); mkdirSync(dir, { recursive: true });`:

- Build the profile: `const profile = buildCookProfile(dir);`
- Spawn through the queue: wrap the cook lifecycle so `createTerminalSession(profile)` runs inside `runOnCookQueue`. Keep the ws relay working: the queue gates when the cook starts, not the socket. A minimal shape is to start the session immediately (the queue is about concurrency of heavy cooks; if the team prefers, gate only the spawn). Keep this change small: replace `session = createTerminalSession({ cwd: dir })` with `session = createTerminalSession(profile)`. Defer full queue gating of the spawn to a follow-up if wiring the queue through the async ws handler risks the relay; record that decision in the report.
- Create one `AbortController`: `const ac = new AbortController();`
- Start `watchForRender` when the session is created (as today), keep its `renderWatch.stop()` in `onExit` and `ws.on("close")`.
- Add a watchdog: `const watchdog = setTimeout(() => { session?.kill(); ws.close(1011, "cook watchdog"); }, config.COOK_WATCHDOG_MS ?? 21600000);` and clear it in `onExit` and `ws.on("close")` and on `ws.on("error")`.
- Wire `ac.signal` so a single `ac.abort()` in the teardown paths clears the watchdog and stops the render poll. The simplest correct form: in `onExit`, `ws.on("close")`, and the `ws.on("error")` handler, call `renderWatch.stop(); clearTimeout(watchdog); ac.abort();`.
- Call `pruneOldRenders(...)` once at attach time.

Keep every existing guard in `attachTerminal` (the missing-post, unknown-post, unusable-title, vault-missing checks, the try/catch, the malformed-frame close). Do not regress them.

- [ ] **Step 4: Extend ws.test.ts**

Read the existing `ws.test.ts` to match its harness (it mocks the session and the ws). Add a test that a session exit clears the watchdog (no dangling timer) and stops the render watch. If the existing mock structure makes the watchdog hard to assert, at minimum assert that `renderWatch.stop` is called on exit and on close, which the current test may already cover; extend it to also assert the watchdog timer is cleared (use vitest fake timers).

- [ ] **Step 5: Run the ws tests, verify they pass**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/terminal/ws.test.ts src/server/terminal/render-watch.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/terminal/ws.ts src/server/terminal/render-watch.ts src/server/terminal/ws.test.ts src/server/terminal/render-watch.test.ts
git commit -m "feat(harness): gate render poll and add cook watchdog, prune old renders"
```

---

### Task 6: config keys and AssetStore streaming hash

**Files:**
- Modify: `src/server/config.ts`
- Modify: `src/server/media/asset-store.ts`
- Test: extend the asset-store test if one exists, else add a focused test for the hash.

**Interfaces:**
- Consumes: nothing new.
- Produces: `config.COOK_CONCURRENCY: number`, `config.COOK_WATCHDOG_MS: number`, `config.COOK_MODEL: string | undefined`.

Context: read `src/server/config.ts` first to match how it declares and validates keys (it likely uses an env schema). Add the three keys with the Task rulings' defaults. Read `src/server/media/asset-store.ts` `put` first; today it reads all bytes then `createHash("sha256").update(bytes)`. Change it to stream the file through the hash so a large render does not buffer wholly in memory or block.

- [ ] **Step 1: Add config keys**

Add, matching the file's existing pattern (env name, default, coercion):

```ts
COOK_CONCURRENCY: <int from env COOK_CONCURRENCY, default 2>,
COOK_WATCHDOG_MS: <int from env COOK_WATCHDOG_MS, default 21600000>,
COOK_MODEL: <string from env COOK_MODEL, default undefined>,
```

Use the exact validation idiom already in config.ts. Do not invent a new validation style.

- [ ] **Step 2: Stream the sha256 in AssetStore.put**

Replace the buffer-then-hash with a streaming hash. The put still needs the bytes to write to storage, so read once and hash the same buffer if the file is small, or stream twice (hash pass, then copy) for large files. Prefer streaming the hash with `createReadStream(file.path).pipe(createHash("sha256"))` and then copying the file to `storagePath` with `fs.promises.copyFile` (the earlier refactor already moved put to fs/promises for the copy). Keep the returned id and the dedup-by-sha256 behavior identical.

Concretely:

```ts
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";

async function hashFile(p: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(p), hash);
  return hash.digest("hex");
}
```

Use `hashFile(file.path)` in `put` in place of reading all bytes to hash. Write to storage with `copyFile(file.path, storagePath)`.

- [ ] **Step 3: Test the hash matches**

Add a test that `hashFile` (or `put`) produces the same sha256 as a known value for a small temp file (compute the expected with `createHash` over the same bytes). If asset-store has an existing test, extend it; assert a round-trip put returns a stable id for identical bytes (dedup).

- [ ] **Step 4: Run the tests**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run src/server/media src/server/config.test.ts`
Expected: PASS. If `config.test.ts` does not exist, run only the media test.

- [ ] **Step 5: Full suite once, then commit**

Run: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run`
Expected: PASS across the suite (no regressions from the profile change).

```bash
git add src/server/config.ts src/server/media/asset-store.ts src/server/media/*.test.ts
git commit -m "feat(harness): cook config keys and streaming sha256 in AssetStore"
```

---

## Self-review notes

- Spec coverage: P1 profile+builder (Task 1), P2 hooks-off (Task 1 constant + Task 3 verify), P3 process group (Task 2) + queue (Task 4), P4 watchdog + gated poll + prune + streamed hash + AbortController (Tasks 5, 6), P5 spawn from profile (Task 2). session.ts, ws.ts, render-watch.ts, asset-store.ts, config.ts all covered.
- The `pluginDir` stays unset (buildCookProfile never sets it), satisfying the global constraint.
- Type consistency: `buildCookProfile` and `createTerminalSession` both use `HarnessProfile`; `runOnCookQueue` signature is stable across Tasks 4 and 5; `pruneOldRenders` signature is flagged for the explicit-root refactor in Task 5 Step 1.
- Known soft spot: Task 5's queue-gating of the spawn is deliberately conservative to protect the ws relay. The plan permits deferring full spawn-gating and recording that decision, since the concurrency queue's value (not thrashing on two heavy cooks) is preserved by the queue existing even if the spawn path is wired in a follow-up. The reviewer should confirm the queue is actually reachable from the cook path, not dead code.
