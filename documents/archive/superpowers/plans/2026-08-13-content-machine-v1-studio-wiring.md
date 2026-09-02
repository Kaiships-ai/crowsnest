# Content machine v1, studio wiring plan (Plan C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the shipped web terminal (Plan B) and studio shell (Plan A) into a working create loop: render the live terminal in the studio, one-click inject /ksa:cooking and /ksa:serve, auto-capture the rendered MP4 into the Output preview, and record the post on the calendar.

**Architecture:** The terminal websocket (src/server/terminal/ws.ts) already owns a per-post pty session. This plan adds a server-side render watcher to that same socket: while a session is open, the server watches the vault renders directory for this post's video.mp4, and when it appears it captures the file through AssetStore.put and pushes a `render` frame to the client over the existing socket. The client TerminalPane gains an imperative `send` handle so studio buttons can type commands into the live session, and an `onRender` callback so the Output pane can show the captured video. Publish is one-click but runs in-session: the Publish button sends /ksa:serve, which does the Graph publish. Crowsnest holds no publish token or hosting code.

**Tech stack:** Next.js 16 (modified, App Router), the custom server.ts from Plan B, node-pty, ws, @xterm/xterm, React 19, drizzle, vitest.

## Global constraints

- npm and node are not on the Bash PATH. Prefix with `export PATH="/opt/homebrew/bin:$PATH"`.
- This is a modified Next.js. Read node_modules/next/dist/docs/ before any router/server change.
- Never run the dev server from the Bash tool (the sandbox reaps it). Use `PORT=3000 npm run dev` via a Bash call with `dangerouslyDisableSandbox: true` (a sandbox-disabled nohup survives), or a cmux pane. The custom server is `dev` = `tsx server.ts`.
- server.ts loads ws.ts once at process start; ws.ts changes need a server restart to take effect at runtime, they do not hot-reload.
- Publish has no token, hosting, or Graph code in Crowsnest. /ksa:serve (run in-session) does the publish. Crowsnest only injects the command and records the result on the calendar.
- The terminal cwd stays server-computed from the postId via sandboxDir(slugify(title)); never a client path. The render watcher path is likewise server-computed from the same slug.
- markPlanPublishedAction(id, ownPostId) is the only way a plan is marked published; `ownPostId: null` is the legal "it went out, not linking it" value.
- Tests use vitest. Leave the suite green.

## What already exists (consume, do not rebuild)

- `src/server/terminal/ws.ts`: `attachTerminal(ws, req)`. Owns the pty session, computes `slug = slugify(title)` and `sandboxDir(slug)`, relays `{type:"output"|"exit"}` out and `{type:"input"|"resize"}` in. This plan extends it.
- `src/server/terminal/session.ts`: `createTerminalSession({ cwd })`.
- `src/server/studio/paths.ts`: `slugify(title)`, `sandboxDir(slug)`, `rendersDir(dateISO, slug)` = `<VAULT_PATH>/Studio/workspace/renders/<dateISO>-<slug>`.
- `src/server/media/asset-store.ts`: `getAssetStore()` returns an `AssetStore` with `put(file: { path }, kind: "video"|"thumbnail", contentType): Promise<string>` (returns the media_assets id) and `publicUrl(id): string` (returns `/api/media/<id>`).
- `src/server/actions/planned-post-actions.ts`: `markPlanPublishedAction(id, ownPostId: string | null): Promise<SimpleResult>`.
- `src/components/studio/terminal-pane.tsx`: `<TerminalPane postId />`. Owns the ws. This plan adds a ref handle and an onRender prop.
- `src/components/studio/studio-screen.tsx`: `<StudioScreen brief />`. Center pane is a "Terminal connects here" placeholder; Output pane has a Preview slot and disabled Publish + Save to calendar. This plan fills all three.
- `src/server/config.ts`: `config.VAULT_PATH`.
- Media is served at `/api/media/<assetId>` (src/app/api/media/[assetId]/route.ts).

## Design notes (read before Task 4 and Task 5)

- Render detection is success-only and best-effort. There is no structured signal from an interactive claude TUI, so Crowsnest cannot reliably detect a render failure or a stalled cook. The failure path is the terminal itself (the operator sees the error) plus an always-available Retry that re-sends /ksa:cooking. Do not build a fabricated "render failed" state that guesses from terminal bytes.
- No 9router banner in this screen. Cooking runs on Claude Max in the session, not on the 9router proxy, so a 9router-down banner here would be misleading. 9router health belongs to Crowsnest's own analysis screens, out of scope for the studio.
- The watcher matches on the slug suffix (`<anything>-<slug>/video.mp4`) under the renders root, so it does not need to know the exact date /ksa:cooking stamps into the directory name.

## File structure

- Create: `src/server/terminal/render-watch.ts` + test. Detects `video.mp4` for a slug under the renders root, calls back with its path once its size is stable.
- Modify: `src/server/media/asset-store.ts`. `put` uses `fs/promises` instead of sync reads/writes (carry-forward minor; big renders should not block the event loop).
- Modify: `src/server/terminal/ws.ts` + test. Guard empty slug and a missing vault; start the render watcher; on a found render, `AssetStore.put` then send `{type:"render", assetId, url}`; stop the watcher on close/exit.
- Modify: `src/components/studio/terminal-pane.tsx`. `forwardRef` with a `send(text)` imperative handle; handle the `render` message and call an `onRender` prop.
- Modify: `src/components/studio/studio-screen.tsx`. Render the terminal in the center pane with a ref; Cook and Publish buttons that inject commands; an Output preview fed by the captured render; Save to calendar via a server action; the empty and render-ready states plus Retry.
- Create: `src/components/studio/studio-panel.tsx` (a client wrapper). StudioScreen is currently a client component that only shows the brief; the interactive wiring (refs, state, transitions) lives in a focused client component this plan adds, keeping the presentational brief separate from the stateful controls.

---

## Task 1: the render watcher

**Files:**
- Create: `src/server/terminal/render-watch.ts`
- Create: `src/server/terminal/render-watch.test.ts`

**Interfaces:**
- Produces: `watchForRender(opts: { slug: string; onFound: (mp4Path: string) => void }): { stop: () => void }`. It ensures the renders root exists, watches it recursively, and when a path matching `<anything>-<slug>/video.mp4` appears and its byte size is stable across two reads ~400ms apart, calls `onFound(mp4Path)` exactly once, then stops watching. `stop()` tears down the watcher and any pending timer. It never throws out of the watch callback.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/terminal/render-watch.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const rendersRoot = () => path.join(vaultDir, "Studio", "workspace", "renders");
let vaultDir: string;

vi.mock("@/server/config", () => ({ config: { get VAULT_PATH() { return vaultDir; } } }));

let watchForRender: typeof import("./render-watch")["watchForRender"];
beforeEach(async () => {
  vaultDir = mkdtempSync(path.join(tmpdir(), "render-watch-"));
  mkdirSync(rendersRoot(), { recursive: true });
  ({ watchForRender } = await import("./render-watch"));
});
afterEach(() => { rmSync(vaultDir, { recursive: true, force: true }); vi.resetModules(); });

describe("watchForRender", () => {
  it("fires onFound once when this slug's video.mp4 lands and its size is stable", async () => {
    const onFound = vi.fn();
    const handle = watchForRender({ slug: "my-post", onFound });
    const dir = path.join(rendersRoot(), "2026-08-13-my-post");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "video.mp4"), "aaaa");
    await vi.waitFor(() => expect(onFound).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onFound.mock.calls[0][0]).toBe(path.join(dir, "video.mp4"));
    handle.stop();
  });

  it("ignores a video.mp4 for a different slug", async () => {
    const onFound = vi.fn();
    const handle = watchForRender({ slug: "my-post", onFound });
    const dir = path.join(rendersRoot(), "2026-08-13-other-post");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "video.mp4"), "aaaa");
    await new Promise((r) => setTimeout(r, 1200));
    expect(onFound).not.toHaveBeenCalled();
    handle.stop();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/terminal/render-watch.test.ts`
Expected: FAIL, cannot find module ./render-watch.

- [ ] **Step 3: Implement the watcher**

```ts
// src/server/terminal/render-watch.ts
import { mkdirSync, statSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { config } from "@/server/config";

interface WatchOpts {
  slug: string;
  onFound: (mp4Path: string) => void;
}

function rendersRoot(): string {
  return path.join(config.VAULT_PATH, "Studio", "workspace", "renders");
}

/**
 * Watches the vault renders root for this post's finished MP4. The render directory is
 * named `<date>-<slug>`, and this only needs the slug, so it matches on the suffix and
 * ignores whatever date /ksa:cooking stamps. Fires onFound once, after the file's size
 * holds steady across two reads, so a half-written file is never captured.
 */
export function watchForRender({ slug, onFound }: WatchOpts): { stop: () => void } {
  const root = rendersRoot();
  mkdirSync(root, { recursive: true });

  let done = false;
  let watcher: FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;

  const matchesSlug = (rel: string): boolean => {
    // rel is like "2026-08-13-my-post/video.mp4" on macOS recursive watch.
    const parts = rel.split(path.sep);
    if (parts.length < 2) return false;
    const dir = parts[parts.length - 2];
    const file = parts[parts.length - 1];
    return file === "video.mp4" && dir.endsWith(`-${slug}`);
  };

  const confirmStableThenFire = (mp4Path: string): void => {
    let last = -1;
    const check = (): void => {
      if (done) return;
      let size: number;
      try {
        size = statSync(mp4Path).size;
      } catch {
        return; // file vanished mid-write, let the next event re-trigger
      }
      if (size > 0 && size === last) {
        done = true;
        stop();
        onFound(mp4Path);
        return;
      }
      last = size;
      timer = setTimeout(check, 400);
    };
    check();
  };

  const stop = (): void => {
    if (watcher) { watcher.close(); watcher = null; }
    if (timer) { clearTimeout(timer); timer = null; }
  };

  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (done || filename === null) return;
      const rel = filename.toString();
      if (matchesSlug(rel)) confirmStableThenFire(path.join(root, rel));
    });
  } catch {
    // If the platform cannot watch (or the root disappeared), the watcher stays null and
    // the studio simply never auto-captures; the operator can still work in the terminal.
  }

  return { stop };
}
```

- [ ] **Step 4: Run the test and watch it pass; full suite**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/terminal/render-watch.test.ts && npm test -- --run`
Expected: pass, suite green.

- [ ] **Step 5: Commit**

```bash
git add src/server/terminal/render-watch.ts src/server/terminal/render-watch.test.ts
git commit -m "feat(studio): watch the vault renders dir for a post's finished mp4"
```

---

## Task 2: AssetStore.put async I/O

**Files:**
- Modify: `src/server/media/asset-store.ts`
- Test: `src/server/media/asset-store.test.ts` (add one case if the file exists; otherwise create it)

**Interfaces:**
- Produces: unchanged public shape. `put(file, kind, contentType): Promise<string>` now reads and writes with `fs/promises` so a large render does not block the event loop. Behavior (sha256 dedup, returned id) is identical.

- [ ] **Step 1: Confirm the current test and add an async-path assertion**

Run: `export PATH="/opt/homebrew/bin:$PATH"; ls src/server/media/asset-store.test.ts` (note whether it exists). Read the existing put test if present. Add or write a test that puts a real temp file and asserts the returned id resolves through `get` to a path whose bytes match:

```ts
// in src/server/media/asset-store.test.ts
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// ...existing imports/setup for the store...

it("put ingests a file and get returns a path with the same bytes", async () => {
  const store = getAssetStore();
  const dir = mkdtempSync(path.join(tmpdir(), "asset-put-"));
  const src = path.join(dir, "v.mp4");
  writeFileSync(src, "hello-bytes");
  const id = await store.put({ path: src }, "video", "video/mp4");
  const got = await store.get(id);
  expect(got).not.toBeNull();
  expect((await readFile(got!.path)).toString()).toBe("hello-bytes");
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run it (it should pass against the current sync impl too)**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/media/asset-store.test.ts`
Expected: PASS (this test is behavior, the refactor keeps it green).

- [ ] **Step 3: Switch put to fs/promises**

In `src/server/media/asset-store.ts`, change the imports and `put` body. Replace the `readFileSync`/`writeFileSync`/`existsSync`/`mkdirSync` used inside `put` with the async equivalents. Keep `get` and `publicUrl` as they are.

```ts
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { assetUrl, getAsset, recordAsset, resolveAssetPath, storagePathFor, type MediaKind } from "@/server/media/store";
```

```ts
  async put(file: { path: string }, kind: "video" | "thumbnail", contentType: string): Promise<string> {
    if (!KIND_ALLOWED.includes(kind)) {
      throw new Error(`LocalAssetStore.put: unsupported kind ${JSON.stringify(kind)}`);
    }

    const bytes = await readFile(file.path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storagePath = storagePathFor(sha256, contentType);
    const destination = resolveAssetPath(storagePath);

    if (!existsSync(destination)) {
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }

    const row = await recordAsset({ sha256, kind, contentType, byteSize: bytes.length, storagePath });
    return row.id;
  }
```

- [ ] **Step 4: Run the test and the full suite**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/media/asset-store.test.ts && npm test -- --run`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/server/media/asset-store.ts src/server/media/asset-store.test.ts
git commit -m "refactor(media): AssetStore.put uses fs/promises so big renders do not block"
```

---

## Task 3: capture the render over the terminal websocket

**Files:**
- Modify: `src/server/terminal/ws.ts`
- Modify: `src/server/terminal/ws.test.ts`

**Interfaces:**
- Consumes: `watchForRender` (Task 1), `getAssetStore` (Task 2), `config.VAULT_PATH`.
- Produces: while a session is open, the server sends `{type:"render", assetId: string, url: string}` on the socket once this post's `video.mp4` is captured. Adds two guards: an empty slug (a title that slugifies to "") closes `1008 "unusable post title"`; a missing vault directory closes `1011 "vault missing"`.

- [ ] **Step 1: Add the guards, the watcher, and the render frame**

Edit `attachTerminal` in `src/server/terminal/ws.ts`. Keep the existing structure (the closed-over `session`, the `ws.on("error")`, the setup `try/catch`, the message/close handlers). Inside the `try`, after resolving `title` and before `mkdirSync(dir)`, compute the slug once and add the guards; after `createTerminalSession`, start the watcher; stop it on close and on exit.

```ts
import { existsSync, mkdirSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { config } from "@/server/config";
import { getAssetStore } from "@/server/media/asset-store";
import { sandboxDir, slugify } from "@/server/studio/paths";
import { getPlannedPostTitleById } from "./resolve-post";
import { watchForRender } from "./render-watch";
import { createTerminalSession } from "./session";
```

Within the `try`, after the `title === null` check:

```ts
    const slug = slugify(title);
    if (slug === "") {
      ws.close(1008, "unusable post title");
      return;
    }
    if (!existsSync(config.VAULT_PATH)) {
      ws.close(1011, "vault missing");
      return;
    }

    const dir = sandboxDir(slug);
    mkdirSync(dir, { recursive: true });

    session = createTerminalSession({ cwd: dir });
```

After the `session.onExit(...)` block, start the watcher and make sure it stops on both exit and close:

```ts
    const renderWatch = watchForRender({
      slug,
      onFound: (mp4Path) => {
        void (async () => {
          try {
            const assetId = await getAssetStore().put({ path: mp4Path }, "video", "video/mp4");
            const url = getAssetStore().publicUrl(assetId);
            ws.send(JSON.stringify({ type: "render", assetId, url }));
          } catch (err) {
            console.error("render capture failed", err);
          }
        })();
      },
    });
```

Then in the existing `session.onExit` callback and the `ws.on("close")` handler, also call `renderWatch.stop()`. The exit handler becomes:

```ts
    session.onExit((code) => {
      renderWatch.stop();
      ws.send(JSON.stringify({ type: "exit", code }));
      ws.close();
    });
```

and the close handler:

```ts
    ws.on("close", () => {
      renderWatch.stop();
      session?.kill();
    });
```

Because `renderWatch` is declared after `session` but referenced inside `session.onExit`, declare `renderWatch` with `const` before `session.onData`/`session.onExit` are wired, or hoist a `let renderWatch: { stop: () => void } | null = null` above and assign it. Use whichever keeps the exit/close handlers able to see it; the simplest is to create the watcher immediately after `createTerminalSession` and wire onData/onExit afterward.

- [ ] **Step 2: Extend the ws test**

Add cases to `src/server/terminal/ws.test.ts`. Mock `./render-watch` and `@/server/media/asset-store`, plus `@/server/config` for VAULT_PATH and `node:fs` existsSync. Assert:
- a title that slugifies to "" (e.g. mock `getPlannedPostTitleById` to return "!!!") closes the ws `1008` and never creates a session.
- when `config.VAULT_PATH` does not exist (mock existsSync false), the ws closes `1011` and no session is created.
- when the watcher's `onFound` is invoked, `getAssetStore().put` is called with `{path: <mp4>}, "video", "video/mp4"` and the ws receives a message whose parsed `type` is `"render"` carrying `assetId` and `url`.
- `renderWatch.stop` is called when the ws `close` fires.

Mock shape example:

```ts
const stop = vi.fn();
let capturedOnFound: ((p: string) => void) | undefined;
vi.mock("./render-watch", () => ({
  watchForRender: vi.fn((opts: { slug: string; onFound: (p: string) => void }) => {
    capturedOnFound = opts.onFound;
    return { stop };
  }),
}));
vi.mock("@/server/media/asset-store", () => ({
  getAssetStore: () => ({ put: vi.fn(async () => "asset-1"), publicUrl: (id: string) => `/api/media/${id}` }),
}));
```

Drive `capturedOnFound("/tmp/x/video.mp4")` after connecting, await a tick, and assert the `render` frame was sent.

- [ ] **Step 3: Run the terminal tests and typecheck**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run src/server/terminal/ && npx tsc --noEmit`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/server/terminal/ws.ts src/server/terminal/ws.test.ts
git commit -m "feat(studio): capture the finished render and push it over the terminal socket"
```

- [ ] **Step 5: Controller runtime note**

Report DONE_WITH_CONCERNS. The controller must restart the dev server (ws.ts is loaded once at process start) and confirm, after cooking produces a real video.mp4, that a `render` frame reaches a connected client and the asset resolves at `/api/media/<id>`. This is a controller check; there is no unit test for the real file-to-socket path.

---

## Task 4: TerminalPane send handle and render callback

**Files:**
- Modify: `src/components/studio/terminal-pane.tsx`

**Interfaces:**
- Produces: `<TerminalPane postId onRender? ref? />`. `ref` exposes `{ send(text: string): void }` (writes `{type:"input",data:text}` to the socket when open). `onRender?: (payload: { assetId: string; url: string }) => void` fires when a `render` frame arrives. Existing output/exit behavior is unchanged.

- [ ] **Step 1: Add the render message type and the imperative handle**

Rewrite `src/components/studio/terminal-pane.tsx` to `forwardRef`. Keep the xterm mount, the StrictMode `cleanedUp` guard, the resize observer, and the output/exit handling. Add: a `TerminalRenderMessage` type, an `onRender` prop, a ref that holds the live `WebSocket`, and `useImperativeHandle` exposing `send`.

```tsx
"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export interface TerminalHandle {
  send: (text: string) => void;
}

interface TerminalPaneProps {
  postId: string;
  onRender?: (payload: { assetId: string; url: string }) => void;
}

interface TerminalOutputMessage { type: "output"; data: string }
interface TerminalExitMessage { type: "exit"; code: number }
interface TerminalRenderMessage { type: "render"; assetId: string; url: string }
type TerminalServerMessage = TerminalOutputMessage | TerminalExitMessage | TerminalRenderMessage;

function isTerminalServerMessage(value: unknown): value is TerminalServerMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const type = (value as { type: unknown }).type;
  return type === "output" || type === "exit" || type === "render";
}

export const TerminalPane = forwardRef<TerminalHandle, TerminalPaneProps>(function TerminalPane(
  { postId, onRender },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onRenderRef = useRef(onRender);
  onRenderRef.current = onRender;

  useImperativeHandle(ref, () => ({
    send: (text: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data: text }));
      }
    },
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let cleanedUp = false;

    const term = new Terminal({
      convertEol: false,
      fontFamily: "IBM Plex Mono, monospace",
      theme: { background: "#08080a", foreground: "#f2f2f0" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    const ws = new WebSocket(`ws://${location.host}/api/terminal/ws?post=${postId}`);
    wsRef.current = ws;

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });

    ws.onmessage = (event) => {
      let parsed: unknown;
      try { parsed = JSON.parse(event.data as string); } catch { return; }
      if (!isTerminalServerMessage(parsed)) return;
      if (parsed.type === "output") term.write(parsed.data);
      else if (parsed.type === "render") onRenderRef.current?.({ assetId: parsed.assetId, url: parsed.url });
      else term.write("\r\nsession ended\r\n");
    };

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    });
    resizeObserver.observe(container);

    return () => {
      if (cleanedUp) return;
      cleanedUp = true;
      resizeObserver.disconnect();
      ws.close();
      wsRef.current = null;
      term.dispose();
    };
  }, [postId]);

  return <div ref={containerRef} className="h-full w-full" />;
});
```

- [ ] **Step 2: Typecheck and lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npx tsc --noEmit && npx eslint src/components/studio/terminal-pane.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/studio/terminal-pane.tsx
git commit -m "feat(studio): TerminalPane exposes a send handle and a render callback"
```

---

## Task 5: wire the studio panel (terminal, buttons, preview, publish)

**Files:**
- Create: `src/components/studio/studio-panel.tsx`
- Modify: `src/components/studio/studio-screen.tsx`

**Interfaces:**
- Consumes: `TerminalPane`, `TerminalHandle` (Task 4), `markPlanPublishedAction` (existing).
- Produces: the center pane hosts the live terminal; Cook and Publish buttons inject `/ksa:cooking\r` and `/ksa:serve\r`; the Output pane shows the captured render and a Save to calendar control.

- [ ] **Step 1: Build the interactive panel**

Create `src/components/studio/studio-panel.tsx`. It owns the terminal ref, the captured render state, and the transitions. It renders the center terminal and the Output pane controls; the brief stays in `studio-screen.tsx`.

```tsx
"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { markPlanPublishedAction } from "@/server/actions/planned-post-actions";
import { TerminalPane, type TerminalHandle } from "@/components/studio/terminal-pane";

interface CapturedRender { assetId: string; url: string }

export function StudioPanel({ postId, hasFramePass }: { postId: string; hasFramePass: boolean }) {
  const termRef = useRef<TerminalHandle>(null);
  const [render, setRender] = useState<CapturedRender | null>(null);
  const [started, setStarted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const inject = (cmd: string) => termRef.current?.send(`${cmd}\r`);
  const cook = () => { setStarted(true); inject("/ksa:cooking"); };
  const publish = () => inject("/ksa:serve");
  const saveToCalendar = () => {
    setSaveError(null);
    startTransition(async () => {
      const res = await markPlanPublishedAction(postId, null);
      if (res.ok) setSaved(true);
      else setSaveError(res.error);
    });
  };

  return (
    <>
      {/* Center: live terminal + command controls */}
      <div className="flex flex-1 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <span className="font-mono text-2xs tracking-wide text-faint uppercase">Claude Code</span>
          <div className="ml-auto flex items-center gap-2">
            {!hasFramePass && (
              <span className="font-mono text-2xs text-muted-foreground">frame pass not run</span>
            )}
            <Button type="button" variant="secondary" onClick={cook}>
              {started ? "Retry cook" : "Cook"}
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 p-2">
          <TerminalPane ref={termRef} postId={postId} onRender={setRender} />
        </div>
      </div>

      {/* Right: output */}
      <div className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto p-6">
        <span className="font-mono text-2xs tracking-wide text-faint uppercase">Output</span>
        {render ? (
          <video src={render.url} controls className="aspect-[9/16] w-full border border-border bg-black" />
        ) : (
          <div className="flex aspect-[9/16] w-full items-center justify-center border border-border bg-card px-4 text-center text-xs text-muted-foreground">
            {started ? "Cooking. The render appears here when it finishes." : "Run Cook to start the session."}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Button type="button" variant="secondary" disabled={!render} onClick={publish} className="w-full">
            Publish
          </Button>
          <p className="text-xs text-muted-foreground">
            Publish runs /ksa:serve in the session (official Graph API). It unlocks once a render exists.
          </p>
          <Button type="button" variant="outline" disabled={!render || pending || saved} onClick={saveToCalendar} className="w-full">
            {saved ? "Saved to calendar" : "Save to calendar"}
          </Button>
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Render the panel from the studio screen**

In `src/components/studio/studio-screen.tsx`, keep the Brief pane exactly as it is. Replace the center placeholder pane AND the right Output pane (the two blocks after the Brief `div`) with a single `<StudioPanel postId={plan.id} hasFramePass={layout !== null} />`. Import `StudioPanel`. The outer `<div className="flex h-full">` and the Brief pane are unchanged; StudioPanel returns the center and right panes as a fragment.

After the swap the Brief pane no longer uses `Button` (only the moved Output pane did), so drop the `Button` import from studio-screen.tsx. Keep `ScoreBadge` and `LayoutField`; the Brief pane still uses them.

- [ ] **Step 3: Typecheck and lint**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npx tsc --noEmit && npx eslint src/components/studio/studio-panel.tsx src/components/studio/studio-screen.tsx`
Expected: clean. `src/server/actions/planned-post-actions.ts` already starts with `"use server"`, and client components in this repo import its actions directly and await them (see `src/components/mine/mine-calendar.tsx` and `src/components/mine/plan-dialog.tsx`). So the direct `import { markPlanPublishedAction }` plus `await markPlanPublishedAction(postId, null)` in Step 1 is the established pattern; no wrapper is needed.

- [ ] **Step 4: Full suite, then commit**

Run: `export PATH="/opt/homebrew/bin:$PATH"; npm test -- --run`
Expected: green.

```bash
git add src/components/studio/studio-panel.tsx src/components/studio/studio-screen.tsx
git commit -m "feat(studio): wire the terminal, cook/publish, and render preview into the studio"
```

- [ ] **Step 5: Controller runtime verification**

Report DONE_WITH_CONCERNS. The controller restarts the dev server and, in the browser at `/mine/<postId>/studio`, confirms: the terminal renders and is interactive; Cook writes `/ksa:cooking` into the session; a finished render shows in the Output preview and enables Publish; Publish writes `/ksa:serve`; Save to calendar marks the plan published. Browser-only, no unit test covers the mounted flow.

---

## Self-review notes

- Spec coverage: this plan delivers the create loop's remaining pieces (terminal in the studio, one-click cook/serve, render capture, calendar record), completing the spec's Create studio and Publish sections. Publish stays in-session (/ksa:serve), so no Graph token or hosting code enters Crowsnest, matching the locked decision that supersedes the older spec's "Crowsnest one-click publish via ig_publish" wording.
- Carry-forwards folded in: empty-slug guard and VAULT_PATH existence check (Task 3), AssetStore.put async I/O (Task 2).
- Honest scope on failure states: render-fail and 9router-down are not auto-detected. There is no structured signal from an interactive TUI, and cooking runs on Claude Max not 9router, so those states would be fabricated or misleading here. Failures surface in the terminal, and Retry (re-cook) is always available. This is a deliberate narrowing of the mockup's wishlist, flagged for review.
- Two controller runtime checks (Task 3 file-to-socket, Task 5 browser flow) have no unit test and need a restarted dev server, stated explicitly.
- Security: the terminal cwd and the render watch path are both server-computed from the postId, never client input. Publish carries no credentials in Crowsnest.
