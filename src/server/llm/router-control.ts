import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log } from "@/server/lib/logger";

/**
 * Process supervisor for the local 9router LLM proxy — the same shape as
 * `src/server/sidecar/control.ts` (the Instagram sidecar's supervisor), which is this
 * module's template. 9router keeps dying mid-session and takes generation/analysis/
 * remix down with it; this lets the app start it, track it by pid, and stop only the
 * pid it started (never a broad kill).
 *
 * Import surface deliberately matches control.ts's: no better-sqlite3, no secrets
 * store, nothing Next-server-only beyond node builtins and the plain `log` module —
 * 9router has no credentials to inject (unlike the IG sidecar), so there is nothing
 * here that needs the db.
 */

const PID_FILE = "data/9router.pid";

/** `bare 9router` opens a browser tab and exits — `--tray` is the flag that keeps it
 *  running as a persistent server. `--no-browser` skips the tab it would otherwise
 *  open, `--skip-update` skips its self-update check, both of which have no place in
 *  a process this app spawns unattended. */
const ROUTER_ARGS = ["--tray", "--no-browser", "--skip-update"];

const LOG_DIR = path.join(homedir(), ".crowsnest");
const LOG_FILE = path.join(LOG_DIR, "9router.log");

/** How long a single reachability probe waits before giving up. Deliberately shorter
 *  than the LLM generation probe's timeout (`LLM_PING_TIMEOUT_MS`, dependency-
 *  status.ts): this is a plain TCP/HTTP reachability check, not a model call, so it
 *  should fail fast. */
const ROUTER_REACHABLE_TIMEOUT_MS = 3000;

/** Best-effort PATH lookup for a binary name. Never throws: `execFileSync("which", ...)`
 *  exits non-zero (and this mocked-`vi.fn()` default returns `undefined`) when nothing on
 *  PATH matches, which is the common case before a first `npm install -g 9router`. */
function resolveFromPath(bin: string): string | null {
  try {
    const out = execFileSync("which", [bin], { encoding: "utf8" });
    return typeof out === "string" && out.trim() ? out.trim() : null;
  } catch {
    return null;
  }
}

/** Resolves the 9router binary: `ROUTER_BIN` env override wins first (unchanged), then
 *  whatever `which 9router` finds on PATH -- this is what makes `npm install -g 9router`
 *  (the guided keyless-install path) work without also requiring `ROUTER_BIN` to be set
 *  by hand, since npm's global bin directory is on PATH for essentially every shell
 *  setup. The hardcoded Homebrew default from before this change is now the last resort. */
function routerBin(): string {
  return process.env.ROUTER_BIN ?? resolveFromPath("9router") ?? "/opt/homebrew/bin/9router";
}

/** Resolves the health-check URL from `LLM_BASE_URL` (the same env var `getLlm()`
 *  reads, client.ts:236) — never `ANTHROPIC_BASE_URL`, which this app does not use. */
function healthUrl(): string {
  return process.env.LLM_BASE_URL ?? "http://localhost:20128";
}

/** A plain HTTP GET on the health URL. Any response at all — including a redirect or
 *  an error status — counts as reachable; only a connection failure (refused, DNS,
 *  timeout) means the process isn't there. Mirrors the "any non-000 code" reachability
 *  check verified manually against a running 9router (307 when up). */
export async function routerReachable(timeoutMs: number = ROUTER_REACHABLE_TIMEOUT_MS): Promise<boolean> {
  try {
    await fetch(healthUrl(), { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

export type StartRouterResult = { ok: true; alreadyUp: boolean } | { ok: false; error: string };

// Guards against a race that would otherwise break the pid-tracking guarantee this
// whole module exists for: `routerReachable()` and `spawn()` below are not atomic, and
// with no lock, two overlapping callers (e.g. the auto-restart watchdog firing while a
// manual Start click or a second status read is also mid-flight) can each see
// `routerReachable()` return false and each spawn their own child. The second
// `writeFileSync(PID_FILE, ...)` would then silently overwrite the first child's pid,
// leaving it running but untracked, so `stopRouter()` could never kill it again.
//
// The fix is a module-level in-flight promise: the first call starts the real work and
// stores the promise here; any call that arrives before that promise settles reuses it
// instead of starting a second one. Because JS is single-threaded, there is no `await`
// between reading `inFlightStart` and setting it below, so this check-and-set can never
// interleave with another call the way the reachable-check-then-spawn sequence can.
let inFlightStart: Promise<StartRouterResult> | null = null;

/**
 * Idempotent: if 9router already answers, this is a no-op success — Start clicked
 * twice, or Start after 9router was already running from a previous session, must
 * never spawn a second process. Otherwise spawns the tray server detached, with
 * stdout/stderr appended to `~/.crowsnest/9router.log`, and tracks the child's pid in
 * `data/9router.pid`. Concurrent calls collapse onto one spawn — see `inFlightStart`.
 */
export async function startRouter(): Promise<StartRouterResult> {
  if (inFlightStart) return inFlightStart;
  inFlightStart = doStartRouter().finally(() => {
    inFlightStart = null;
  });
  return inFlightStart;
}

async function doStartRouter(): Promise<StartRouterResult> {
  if (await routerReachable()) return { ok: true, alreadyUp: true };
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const logFd = openSync(LOG_FILE, "a");
    const child = spawn(routerBin(), ROUTER_ARGS, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    // Same reasoning as sidecar/control.ts's own `child.on("error", ...)`: the child is
    // detached with its stdio pointed at a log file, so a spawn failure that only shows
    // up after spawn() returns (a missing 9router binary surfaces as ENOENT here) arrives
    // solely as an "error" event. Node treats an unhandled one as fatal in *this*
    // process, so it must be handled even though there's nothing left to do here but
    // log it — startRouterAction's post-spawn health poll, not this handler, decides
    // whether Start actually succeeded.
    child.on("error", (err) => {
      log.error("router.spawn.error", { error: err.message });
    });
    if (child.pid) writeFileSync(PID_FILE, String(child.pid));
    child.unref();
    // Safe to close once spawn() has returned: libuv has already duplicated the fd for
    // the child by then. Closing it here avoids leaking a file descriptor across
    // repeated start/stop cycles in a long-running dev server.
    closeSync(logFd);
    return { ok: true, alreadyUp: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed to start 9router" };
  }
}

/** Whether the pid tracked in `data/9router.pid` still belongs to a live process.
 *  `process.kill(pid, 0)` sends no signal, it only probes for existence/permission —
 *  identical to `sidecarPidAlive()`. */
export function routerPidAlive(): boolean {
  if (!existsSync(PID_FILE)) return false;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Kills only the pid this module tracked itself, then removes the pid file. Never a
 *  broad kill — identical contract to `stopSidecar()`. */
export function stopRouter(): void {
  if (!existsSync(PID_FILE)) return;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  rmSync(PID_FILE, { force: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `routerReachable` until it answers true or the window elapses — the router's
 *  own twin of the sidecar's `waitForHealthy` (sidecar-actions.ts), kept here rather
 *  than in the action layer because "healthy" for 9router is exactly `routerReachable`,
 *  with no richer status object to fetch through another action. */
export async function waitForRouterHealthy(timeoutMs: number, intervalMs: number = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await routerReachable()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}
