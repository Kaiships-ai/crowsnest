"use server";

import { getIgStatusAction } from "@/server/actions/ig-actions";
import { igSidecar } from "@/server/connectors/ig-sidecar/manifest";
import type { Sample } from "@/server/connectors/types";
import { igClient } from "@/server/ig/client";
import { IgError } from "@/server/ig/errors";
import { sampleFailure, sampleLine, SESSION_EXPIRED_FORM } from "@/server/connectors/ig-sidecar";
import { setConnectorSecret } from "@/server/actions/secrets-actions";
import { clockNow } from "@/server/lib/clock";
import { recordSwitch, sampleConnector } from "@/server/services/connector-status";
import { sidecarPidAlive, startSidecar, stopSidecar } from "@/server/sidecar/control";

type SimpleResult = { ok: true } | { ok: false; error: string };

/** A fresh install's first `uv run` builds the venv before the sidecar answers: measured 7 s
 *  with an empty uv cache and 18 s when uv also downloads Python 3.12, so 60 s leaves about
 *  3x headroom for a slower link. A process that exits fails at once, not at the bound. */
const START_POLL_INTERVAL_MS = 500;
const START_POLL_TIMEOUT_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls health until it answers, the spawned process exits, or the window elapses.
 *  `startSidecar` returns once the child is spawned, so a missing `uv` or a crash on boot
 *  shows up only here, as a dead pid. */
async function waitForHealthy(): Promise<"healthy" | "exited" | "timeout"> {
  const deadline = Date.now() + START_POLL_TIMEOUT_MS;
  for (;;) {
    const status = await getIgStatusAction();
    if (status.ok) return "healthy";
    if (!sidecarPidAlive()) return "exited";
    if (Date.now() >= deadline) return "timeout";
    await sleep(START_POLL_INTERVAL_MS);
  }
}

/** Starts the sidecar unless it already answers its health check, in which case this
 *  is a no-op success, clicking Start twice, or Start after a manual `pnpm run
 *  ig:service`, should never spawn a second process.
 *
 *  A successful `startSidecar()` call only means the process was launched, not that it
 *  came up: nothing here is allowed to report `ok: true` on the strength of that call
 *  alone, so the health check is polled until it answers or the process exits. */
export async function startSidecarAction(): Promise<SimpleResult> {
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
  const outcome = await waitForHealthy();
  if (outcome === "healthy") {
    recordSwitch(igSidecar.id, true);
    return { ok: true };
  }
  if (outcome === "timeout") stopSidecar();
  return {
    ok: false,
    error:
      outcome === "exited"
        ? "sidecar did not start (check that uv is installed and Instagram credentials are set in Settings)"
        : `sidecar did not answer within ${START_POLL_TIMEOUT_MS / 1000} s`,
  };
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
 * Test connection in the session id form: the sidecar tries the pasted id on a throwaway
 * client and pulls the sample. Nothing is saved or adopted, so Cancel leaves the old session.
 */
export async function testSidecarSessionAction(sessionid: string): Promise<Sample> {
  try {
    return { ok: true, line: sampleLine(await igClient.sampleSession(sessionid.trim())) };
  } catch (err) {
    if (err instanceof IgError && err.code === "IG_AUTH_REQUIRED") return { ok: false, message: SESSION_EXPIRED_FORM, retryAfter: null };
    return sampleFailure(err, clockNow());
  }
}

/** Save in the session id form: stores the id, the sidecar adopts it, and the card's sample is recorded. */
export async function saveSidecarSessionAction(sessionid: string): Promise<Sample> {
  const saved = await setConnectorSecret(igSidecar.id, "IG_SESSIONID", sessionid);
  if (!saved.ok) return { ok: false, message: saved.error, retryAfter: null };
  return sampleConnector(igSidecar.id);
}
