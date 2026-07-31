"use server";

import { getIgStatusAction } from "@/server/actions/ig-actions";
import { sidecarPidAlive, startSidecar, stopSidecar } from "@/server/sidecar/control";

type SimpleResult = { ok: true } | { ok: false; error: string };

/** Starts the sidecar unless it already answers its health check, in which case this
 *  is a no-op success — clicking Start twice, or Start after a manual `npm run
 *  ig:service`, should never spawn a second process. */
export async function startSidecarAction(): Promise<SimpleResult> {
  const status = await getIgStatusAction();
  if (status.ok) return { ok: true };
  try {
    startSidecar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed to start sidecar" };
  }
}

export async function stopSidecarAction(): Promise<SimpleResult> {
  stopSidecar();
  return { ok: true };
}

export async function sidecarProcessAliveAction(): Promise<boolean> {
  return sidecarPidAlive();
}
