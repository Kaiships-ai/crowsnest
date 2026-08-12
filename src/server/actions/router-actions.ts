"use server";

import { errorMessage, type SimpleResult } from "@/server/lib/action-result";
import { log } from "@/server/lib/logger";
import { probeLlmGeneration } from "@/server/llm/generation-probe";
import { routerPidAlive, routerReachable, startRouter, stopRouter, waitForRouterHealthy } from "@/server/llm/router-control";
import { getSetting } from "@/server/settings";

/**
 * Driver actions for the 9router supervisor (`router-control.ts`), mirroring
 * `sidecar-actions.ts`'s relationship to `sidecar/control.ts`.
 */

// Same real-world poll cadence as sidecar-actions.ts's START_POLL_INTERVAL_MS/
// START_POLL_TIMEOUT_MS, exposed as default parameters so tests can pass a
// millisecond-scale window instead of waiting out the real one.
const START_POLL_INTERVAL_MS = 500;
const START_POLL_TIMEOUT_MS = 5000;

/**
 * Starts 9router (a no-op success if it already answers — see `startRouter`'s own
 * idempotency), then polls `waitForRouterHealthy` for a few seconds before reporting
 * success, same reasoning as `startSidecarAction`: a spawned-but-not-yet-listening
 * process, or one that fails moments after spawn() returns (a missing binary surfaces
 * as ENOENT only on the child's "error" event), must not be reported as started on the
 * strength of `spawn()` alone.
 */
export async function startRouterAction(
  intervalMs: number = START_POLL_INTERVAL_MS,
  timeoutMs: number = START_POLL_TIMEOUT_MS,
): Promise<SimpleResult> {
  const result = await startRouter();
  if (!result.ok) return { ok: false, error: result.error };
  if (result.alreadyUp) return { ok: true };

  const healthy = await waitForRouterHealthy(timeoutMs, intervalMs);
  if (healthy) return { ok: true };
  return {
    ok: false,
    error: "9router did not start (check the binary path — ROUTER_BIN if overridden, otherwise /opt/homebrew/bin/9router — and $HOME/.crowsnest/9router.log)",
  };
}

export async function stopRouterAction(): Promise<SimpleResult> {
  try {
    stopRouter();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export interface RouterStatus {
  /** Whether the pid this app tracks in `data/9router.pid` is still alive. False if
   *  9router is running but this app never started it (e.g. launched by hand). */
  pidAlive: boolean;
  /** Whether 9router itself answers an HTTP request at all. */
  reachable: boolean;
  /** Whether a real generation call through the configured client actually returned
   *  text — the honesty upgrade over "reachable": a proxy that answers but whose model
   *  route is dead reports `reachable: true, generationOk: false`. */
  generationOk: boolean;
}

// Guards the auto-restart attempt against a hot loop: at most one spawn attempt per
// window, however often the status is read (every Settings page load, every poll).
// In-memory and per-process by design — this is a local single-user dev tool, and a
// server restart resetting the cooldown is an acceptable, honest trade for not
// building a separate timer/cron subsystem the brief explicitly says not to build.
const AUTO_RESTART_COOLDOWN_MS = 30_000;
let lastAutoRestartAttemptAt = 0;

/**
 * Wrapped in its own try/catch so it can never throw: `getRouterStatusAction`'s "Never
 * throws" guarantee below covers `routerReachable`/`probeLlmGeneration` catching their own
 * failures, but `getSetting` is a plain async DB read with no such guard. A DB failure
 * here is treated the same as "do not auto-restart" — the safe default — rather than
 * rejecting a status read that would otherwise have succeeded.
 */
async function maybeAutoRestart(reachable: boolean): Promise<void> {
  try {
    if (reachable) return;
    const autoManage = await getSetting("routerAutoManage");
    if (!autoManage) return;
    const now = Date.now();
    if (now - lastAutoRestartAttemptAt < AUTO_RESTART_COOLDOWN_MS) return;
    lastAutoRestartAttemptAt = now;
    const result = await startRouter();
    if (!result.ok) {
      log.error("router.auto_restart.failed", { error: result.error });
    }
  } catch (err) {
    log.error("router.auto_restart.errored", { error: errorMessage(err) });
  }
}

/**
 * The Settings panel's live status read. Also the app's one auto-restart hook (spec
 * requirement 5): when `routerAutoManage` is on and 9router isn't reachable, this
 * makes a single guarded restart attempt, cooldown-gated so repeated status reads
 * (e.g. a page left open) can never hot-loop spawns. When the toggle is off, this
 * function only observes — it never calls `startRouter`.
 *
 * Never throws: `routerReachable` and `probeLlmGeneration` each catch their own
 * failures and report them as `false`/`"down"` rather than propagating.
 */
export async function getRouterStatusAction(): Promise<RouterStatus> {
  const [pidAlive, reachable] = await Promise.all([Promise.resolve(routerPidAlive()), routerReachable()]);

  await maybeAutoRestart(reachable);

  const generation = await probeLlmGeneration();
  return { pidAlive, reachable, generationOk: generation.state === "up" };
}
