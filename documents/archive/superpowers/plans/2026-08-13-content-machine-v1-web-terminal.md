# Content machine v1, web terminal plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run interactive Claude Code inside the app: a custom server hosts a websocket next to Next, a node-pty spawns claude in a per-post sandbox, and an xterm.js pane relays it. This plan ships the terminal infrastructure and a standalone terminal component. The studio wiring (which post, /ksa:cooking, /ksa:serve) is a later plan.

**Architecture:** A custom `server.ts` replaces `next dev`/`next start`. It wraps Next's request handler and attaches a `ws` WebSocketServer on the same port, delegating unmatched upgrades to `app.getUpgradeHandler()` so Next's own HMR socket keeps working. A terminal service spawns claude in a node-pty with a scrubbed environment and full permission bypass, scoped to a per-post sandbox directory the server computes (never a client-supplied path). The client is an xterm.js React component over the websocket.

**Tech stack:** Next.js 16, node-pty 1.1.0 (prebuilt darwin-arm64), ws, @xterm/xterm + @xterm/addon-fit, tsx (already used for db:migrate), vitest.

**Spike:** the approach is proven end to end. Findings, including the exact working invocations and the load-bearing gotchas, are in `.superpowers/sdd/webterminal-spike-findings.md`. Read it before Task 2 and Task 3.

## Global constraints

- npm and node are not on the Bash PATH. Prefix with `export PATH="/opt/homebrew/bin:$PATH"`.
- This is a modified Next.js. Read node_modules/next/dist/docs/ (custom-server.md) before the server task. The one fix that is NOT in the doc: delegate unmatched upgrades to `app.getUpgradeHandler()` (node_modules/next/dist/server/next.js), or Next's HMR socket dies and the whole app stops hydrating with no error. This is the load-bearing finding.
- Permission posture (decided): the embedded claude runs with `--dangerously-skip-permissions`, contained by the per-post sandbox cwd and a read-only vault. A render needs Write and Bash (hyperframes, ffmpeg, kokoro), and a tool prompt would hang the pty. The spike proved this is the workable posture.
- The claude binary is an absolute path: `process.env.CLAUDE_BINARY_PATH ?? "/Users/kienbeovl/.local/bin/claude"` (the `claude` on PATH is a cmux shim, same reasoning as src/server/services/claude-task.ts).
- The spawned env MUST be scrubbed: reuse the credential scrub in claude-task.ts (scrubClaudeEnv) AND additionally clear every `CLAUDE_CODE_*` var (the spike found the child inherits this session's CLAUDE_CODE_CHILD_SESSION marker and a SessionStart hook fires wrongly).
- The websocket must never take a raw cwd from the client. The client sends a postId; the server computes the sandbox dir via studio/paths.ts sandboxDir(slugify(title)). This is the traversal boundary for the terminal.
- `npm run dev` must keep working exactly as before for the crowsnest-up skill (port from PORT env, default 3000, HMR intact).
- Tests use vitest. Leave the suite green.

## File structure

- Modify: `package.json` (deps, scripts dev/start, postinstall)
- Create: `scripts/fix-node-pty-perms.mjs` (postinstall chmod) and `src/server/terminal/pty-perms.ts` (a testable startup guard)
- Create: `server.ts` (custom server)
- Create: `src/server/terminal/session.ts` (the pty service) + test
- Create: `src/server/terminal/ws.ts` (the websocket handler wiring the pty)
- Create: `src/components/studio/terminal-pane.tsx` (the xterm client)

---

## Task 1: dependencies and the node-pty permission fix

**Files:**
- Modify: `package.json`
- Create: `scripts/fix-node-pty-perms.mjs`
- Create: `src/server/terminal/pty-perms.ts`
- Create: `src/server/terminal/pty-perms.test.ts`

**Interfaces:**
- Produces: `ensurePtyExecutable(prebuildsDir?: string): void` that makes node-pty's `pty.node` and `spawn-helper` executable when they are not, and is a no-op when they already are or are absent. The postinstall script calls it against the real prebuilds dir; the server calls it once at startup.

- [ ] **Step 1: Add the dependencies**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm i ws node-pty @xterm/xterm @xterm/addon-fit && npm i -D @types/ws`
Expected: installed. node-pty 1.1.0 ships a prebuilt darwin-arm64 binary, no native build. Confirm tsx is already a devDependency (db:migrate uses it); if not, add it.

- [ ] **Step 2: Write the failing test for the exec-bit guard**

```ts
// src/server/terminal/pty-perms.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, statSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensurePtyExecutable } from "./pty-perms";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "pty-perms-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("ensurePtyExecutable", () => {
  it("adds the exec bit to pty.node and spawn-helper when missing", () => {
    for (const f of ["pty.node", "spawn-helper"]) {
      const p = path.join(dir, f);
      writeFileSync(p, "x");
      chmodSync(p, 0o644); // no exec bit
    }
    ensurePtyExecutable(dir);
    for (const f of ["pty.node", "spawn-helper"]) {
      expect(statSync(path.join(dir, f)).mode & 0o111).not.toBe(0);
    }
  });
  it("is a no-op when the dir does not exist", () => {
    expect(() => ensurePtyExecutable(path.join(dir, "nope"))).not.toThrow();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/terminal/pty-perms.test.ts`
Expected: FAIL, cannot find module ./pty-perms.

- [ ] **Step 4: Implement the guard**

```ts
// src/server/terminal/pty-perms.ts
import { chmodSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const FILES = ["pty.node", "spawn-helper"];

export function ensurePtyExecutable(prebuildsDir = defaultPrebuildsDir()): void {
  if (!existsSync(prebuildsDir)) return;
  for (const f of FILES) {
    const p = path.join(prebuildsDir, f);
    if (!existsSync(p)) continue;
    const mode = statSync(p).mode;
    if ((mode & 0o111) === 0) chmodSync(p, mode | 0o755);
  }
}

function defaultPrebuildsDir(): string {
  // darwin-arm64 prebuild dir inside node-pty
  return path.join(process.cwd(), "node_modules", "node-pty", "prebuilds", "darwin-arm64");
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/terminal/pty-perms.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the postinstall script**

Create `scripts/fix-node-pty-perms.mjs` that imports and calls the guard:

```js
import { ensurePtyExecutable } from "../src/server/terminal/pty-perms.ts";
ensurePtyExecutable();
```

Wire it in package.json scripts: `"postinstall": "node --import tsx scripts/fix-node-pty-perms.mjs"` (or the project's existing tsx invocation style). If a postinstall already exists, append with `&&`.

- [ ] **Step 7: Full suite, then commit**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run`
Expected: green.

```bash
git add package.json package-lock.json scripts/fix-node-pty-perms.mjs src/server/terminal/pty-perms.ts src/server/terminal/pty-perms.test.ts
git commit -m "feat(terminal): add ws/node-pty/xterm deps and a node-pty exec-bit guard"
```

---

## Task 2: custom server with a delegated websocket upgrade

**Files:**
- Create: `server.ts`
- Modify: `package.json` (scripts dev/start)

**Interfaces:**
- Produces: the app is served by `server.ts`. A websocket at path `/api/terminal/ws` is accepted by a `ws` server; every other upgrade (notably `/_next/webpack-hmr`) is delegated to Next. In this task the ws handler is a temporary echo, proving the delegation; Task 4 replaces the echo with the pty relay.

- [ ] **Step 1: Read the custom-server doc and the spike section 1**

Read node_modules/next/dist/docs/01-app/02-guides/custom-server.md and `.superpowers/sdd/webterminal-spike-findings.md` section 1. The critical piece: `app.getUpgradeHandler()` for unmatched upgrades.

- [ ] **Step 2: Write server.ts**

```ts
// server.ts
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { ensurePtyExecutable } from "./src/server/terminal/pty-perms";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, port });
const handle = app.getRequestHandler();
const upgrade = app.getUpgradeHandler();

app.prepare().then(() => {
  ensurePtyExecutable();
  const server = createServer((req, res) => handle(req, res));
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    // Task 4 replaces this echo with the pty relay.
    ws.on("message", (data) => ws.send(data.toString()));
  });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (url.startsWith("/api/terminal/ws")) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      upgrade(req, socket, head); // Next HMR and everything else, do not destroy
    }
  });

  server.listen(port, () => console.log(`ready on http://localhost:${port}`));
});
```

- [ ] **Step 3: Point the scripts at the custom server**

In package.json: `"dev": "node --import tsx server.ts"`, `"start": "NODE_ENV=production node --import tsx server.ts"`. Keep `build` as `next build`. Match the tsx invocation the repo already uses (check db:migrate's script). `npm run dev` must still bind PORT (default 3000) so crowsnest-up is unaffected.

- [ ] **Step 4: Typecheck**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npx tsc --noEmit`
Expected: clean. (There is no unit test for the server; it is verified at runtime by the controller.)

- [ ] **Step 5: Report for controller runtime verification**

Report DONE_WITH_CONCERNS and state clearly that the controller must verify at runtime (a unit test cannot): start `npm run dev` in a real terminal, confirm the app loads AND hydrates (client interactivity works, HMR connected, no silent white-screen), and a websocket to `/api/terminal/ws` echoes. This is the load-bearing check because a broken delegation silently kills hydration app-wide.

- [ ] **Step 6: Commit**

```bash
git add server.ts package.json
git commit -m "feat(server): custom server hosting a delegated terminal websocket"
```

---

## Task 3: the pty terminal session service

**Files:**
- Create: `src/server/terminal/session.ts`
- Create: `src/server/terminal/session.test.ts`
- Read: `src/server/services/claude-task.ts` (reuse scrubClaudeEnv)

**Interfaces:**
- Produces: `createTerminalSession(opts: { cwd: string }): TerminalSession` where `TerminalSession = { onData(cb: (s: string) => void): void; write(s: string): void; resize(cols: number, rows: number): void; onExit(cb: (code: number) => void): void; kill(): void }`. It spawns claude in a node-pty at `opts.cwd` with `--dangerously-skip-permissions` and a scrubbed env.
- `scrubbedTerminalEnv(): NodeJS.ProcessEnv` removes the credential vars scrubClaudeEnv already removes AND every key matching `/^CLAUDE_CODE_/`.

- [ ] **Step 1: Write the failing test (mock node-pty)**

```ts
// src/server/terminal/session.test.ts
import { describe, expect, it, vi } from "vitest";

const spawn = vi.fn(() => ({ onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), resize: vi.fn(), kill: vi.fn() }));
vi.mock("node-pty", () => ({ spawn }));

describe("createTerminalSession", () => {
  it("spawns the claude binary with bypass, the given cwd, and a scrubbed env", async () => {
    process.env.CLAUDE_CODE_CHILD_SESSION = "parent-marker";
    process.env.SOME_TOKEN = "secret";
    const { createTerminalSession } = await import("./session");
    createTerminalSession({ cwd: "/tmp/sandbox" });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, args, ptyOpts] = spawn.mock.calls[0];
    expect(bin).toMatch(/claude$/);
    expect(args).toContain("--dangerously-skip-permissions");
    expect(ptyOpts.cwd).toBe("/tmp/sandbox");
    expect(ptyOpts.env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(ptyOpts.env.SOME_TOKEN).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/terminal/session.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the service**

Read `scrubClaudeEnv` in `src/server/services/claude-task.ts` and reuse it. Then in session.ts: build `scrubbedTerminalEnv()` = scrubClaudeEnv's result with all `CLAUDE_CODE_*` keys also deleted. `createTerminalSession({ cwd })` calls `pty.spawn(binary, ["--dangerously-skip-permissions"], { name: "xterm-256color", cols: 120, rows: 40, cwd, env: scrubbedTerminalEnv() })` where `binary = process.env.CLAUDE_BINARY_PATH ?? "/Users/kienbeovl/.local/bin/claude"`, and returns the TerminalSession wrapper over the pty (onData, write, resize, onExit, kill).

- [ ] **Step 4: Run the test and watch it pass; full suite; commit**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/terminal/session.test.ts && npm test -- --run`
Expected: pass, suite green.

```bash
git add src/server/terminal/session.ts src/server/terminal/session.test.ts
git commit -m "feat(terminal): pty session spawning claude with a scrubbed env in a sandbox"
```

---

## Task 4: wire the pty into the websocket

**Files:**
- Create: `src/server/terminal/ws.ts`
- Modify: `server.ts` (use the real handler instead of the echo)

**Interfaces:**
- Consumes: `createTerminalSession` (Task 3), `sandboxDir`/`slugify` (studio/paths.ts), `getPlannedPostById` (studio-shell plan) to resolve a postId to a sandbox dir.
- Produces: `attachTerminal(ws, req): Promise<void>`. It reads the `post` query param from the upgrade URL, loads the plan, computes the sandbox dir via `sandboxDir(slugify(plan.title))`, ensures the dir exists (mkdir), creates a terminal session there, and relays the protocol: pty output -> `ws.send(JSON.stringify({ type: "output", data }))`; incoming `{ type: "input", data }` -> `session.write(data)`; `{ type: "resize", cols, rows }` -> `session.resize`; pty exit -> `ws.send({ type: "exit", code })` then close; ws close -> `session.kill()`. If the post is missing, close the socket with a reason. Never derive cwd from a client-supplied path.

- [ ] **Step 1: Implement attachTerminal**

Write `src/server/terminal/ws.ts` with `attachTerminal(ws, req)` per the interface. Parse the URL with `new URL(req.url ?? "", "http://localhost")`. Load the plan with `getPlannedPostById(postId)`; if null, `ws.close(1008, "unknown post")`. Compute `const dir = sandboxDir(slugify(plan.title))`, `mkdirSync(dir, { recursive: true })`, then `createTerminalSession({ cwd: dir })` and relay the JSON protocol above.

- [ ] **Step 2: Use it from server.ts**

Replace the echo `wss.on("connection", ...)` in server.ts with `wss.on("connection", (ws, req) => { void attachTerminal(ws, req); })`.

- [ ] **Step 3: Test the resolution + protocol (mock the session)**

Add a focused test that mocks `createTerminalSession` and `getPlannedPostById`, calls `attachTerminal` with a fake ws + a request whose url is `/api/terminal/ws?post=abc`, and asserts: the session was created with the sandbox dir for that plan's title; an incoming `{type:"input",data:"x"}` calls session.write("x"); a session onData call sends `{type:"output"}`; an unknown post closes the ws. Mock ws as an EventEmitter-like with send/close spies.

- [ ] **Step 4: Run tests; typecheck; commit**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/terminal/ && npx tsc --noEmit`
Expected: green. Note the full end-to-end (real claude in a real pty over a real ws) is a controller runtime check, not a unit test.

```bash
git add src/server/terminal/ws.ts server.ts
git commit -m "feat(terminal): relay a per-post pty session over the websocket"
```

---

## Task 5: the xterm client component

**Files:**
- Create: `src/components/studio/terminal-pane.tsx`

**Interfaces:**
- Produces: `<TerminalPane postId={string} />`, a client component that opens a websocket to `/api/terminal/ws?post=<postId>`, mounts an xterm.js Terminal with the fit addon, relays `term.onData` as `{type:"input"}` and writes `{type:"output"}` messages into the terminal, and tears both down on unmount. This is the component the studio screen's center pane (from the studio-shell plan) will render in place of its placeholder, in the wiring plan.

- [ ] **Step 1: Build the component**

Create `src/components/studio/terminal-pane.tsx` (`"use client"`). In a `useEffect`: `const term = new Terminal({ convertEol: false, fontFamily: "IBM Plex Mono, monospace", theme: { background: "#08080a", foreground: "#f2f2f0" } })`, load `FitAddon`, `term.open(ref.current)`, `fit.fit()`. Open `new WebSocket(`ws://${location.host}/api/terminal/ws?post=${postId}`)`. term.onData -> `ws.send(JSON.stringify({ type: "input", data }))`. ws.onmessage -> parse; `output` -> `term.write(data)`; `exit` -> write a short "session ended" line. Handle resize (ResizeObserver -> fit.fit() -> send `{type:"resize",cols,rows}`). Cleanup: close ws, dispose term. Import `@xterm/xterm/css/xterm.css`.

- [ ] **Step 2: Typecheck and lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npx tsc --noEmit && npx eslint src/components/studio/terminal-pane.tsx`
Expected: clean.

- [ ] **Step 3: Report for controller verification; commit**

No unit test for the xterm mount (browser only). The controller verifies in the wiring plan when it renders in the studio. Commit:

```bash
git add src/components/studio/terminal-pane.tsx
git commit -m "feat(terminal): xterm.js client pane over the terminal websocket"
```

---

## Self-review notes

- Spec coverage: this plan delivers the terminal infrastructure (custom server, pty service, ws relay) and the xterm client, matching the spec's in-page web terminal decision. It does NOT wire the terminal into the studio screen or run /ksa:cooking and /ksa:serve; that is the wiring plan.
- The two spike-flagged hazards are addressed: the getUpgradeHandler delegation (Task 2) and the node-pty exec-bit fix (Task 1). Both are called out as load-bearing.
- Task 2 (custom server) and the full end-to-end have no unit test and require a controller runtime check in a real terminal, stated explicitly. The controller runs this in a cmux pane because a sandboxed Bash server is reaped.
- Security: the terminal cwd is always server-computed from a postId via sandboxDir, never a client path; the env is scrubbed of credentials and CLAUDE_CODE_* markers; claude runs bypassed but contained to the per-post sandbox and a read-only vault.
