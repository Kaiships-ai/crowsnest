"use server";

import { getIgStatusAction } from "@/server/actions/ig-actions";
import { igSidecar } from "@/server/connectors/ig-sidecar/manifest";
import type { Sample } from "@/server/connectors/types";
import { igClient } from "@/server/ig/client";
import { sampleFailure } from "@/server/connectors/ig-sidecar";
import { clockNow } from "@/server/lib/clock";
import { recordSample, recordSwitch, sampleConnector } from "@/server/services/connector-status";
import { sidecarPidAlive, startSidecar, stopSidecar } from "@/server/sidecar/control";

type SimpleResult = { ok: true } | { ok: false; error: string };

/** Real-world poll cadence for confirming a freshly spawned sidecar actually came up:
 *  check every half second, give up after five. Exposed as default parameters (not
 *  hardcoded constants) so tests can pass a millisecond-scale window instead of
 *  actually waiting five seconds. */
const START_POLL_INTERVAL_MS = 500;
const START_POLL_TIMEOUT_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls health until it answers healthy or the window elapses. `startSidecar` returns
 *  as soon as the child process is spawned, which is not the same as the sidecar being
 *  up: a missing `uv` binary or a crash on boot only shows up a moment later, on the
 *  next health check, and `startSidecar` itself has no way to observe that (see its
 *  `child.on("error", ...)` handler, which only logs). This is what actually confirms
 *  success before the action reports one. */
async function waitForHealthy(intervalMs: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await getIgStatusAction();
    if (status.ok) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

/** Starts the sidecar unless it already answers its health check, in which case this
 *  is a no-op success, clicking Start twice, or Start after a manual `pnpm run
 *  ig:service`, should never spawn a second process.
 *
 *  A successful `startSidecar()` call only means the process was launched, not that it
 *  came up: nothing here is allowed to report `ok: true` on the strength of that call
 *  alone, so the health check is polled for a few seconds before this returns. */
export async function startSidecarAction(
  intervalMs: number = START_POLL_INTERVAL_MS,
  timeoutMs: number = START_POLL_TIMEOUT_MS,
): Promise<SimpleResult> {
  const status = await getIgStatusAction();
  if (status.ok) {
    recordSwitch(igSidecar.id, true);
    return { ok: true };
  }
  try {
    startSidecar();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed to start sidecar" };
  }
  const healthy = await waitForHealthy(intervalMs, timeoutMs);
  if (healthy) {
    recordSwitch(igSidecar.id, true);
    return { ok: true };
  }
  return { ok: false, error: "sidecar did not start (check that uv is installed and Instagram credentials are set in Settings)" };
}

export async function stopSidecarAction(): Promise<SimpleResult> {
  stopSidecar();
  recordSwitch(igSidecar.id, false);
  return { ok: true };
}

export async function sidecarProcessAliveAction(): Promise<boolean> {
  return sidecarPidAlive();
}

/**
 * Test connection in the session id form: the sidecar adopts the pasted id, then pulls the
 * sample. The sidecar has no dry run, so a passing test is already the saved session.
 */
export async function testSidecarSessionAction(sessionid: string): Promise<Sample> {
  try {
    const { status } = await igClient.loginBySession(sessionid.trim());
    if (status !== "ok") return { ok: false, message: `Instagram asks for ${status.replace(/_/g, " ")}. Finish it on instagram.com, then copy a new session id.`, retryAfter: null };
  } catch (err) {
    return recordSample(igSidecar.id, sampleFailure(err, clockNow()));
  }
  return sampleConnector(igSidecar.id);
}
