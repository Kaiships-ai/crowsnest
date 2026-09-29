"use server";

import { revalidatePath } from "next/cache";
import { graphClient, type GraphTokenStatus } from "../graph/client";
import type { GraphErrorCode } from "../graph/errors";
import { measureOwnChannel, toFailure, type MeasureResult } from "../services/own-measure";

/**
 * Server actions backing own-channel Instagram Insights (V1 data contracts §1).
 *
 * Nothing here throws across the action boundary, and every failure carries a `code`
 * so the UI can tell "no token configured" apart from "token rejected" apart from
 * "rate limited". The measurement itself lives in `services/own-measure.ts`, shared
 * with the hourly scheduler.
 */

type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string; code?: GraphErrorCode | "GRAPH_UNKNOWN" };

/** "Measure now": every listed post, plus comments, through the one measurement service.
 *  Waits its turn when a scheduled run holds the lock. */
export async function measureOwnChannelAction(): Promise<MeasureResult> {
  const result = await measureOwnChannel({ scope: "all" });
  if (result.ok) revalidatePath("/");
  return result;
}

/**
 * Cheapest authenticated call, backing the settings token strip and "Test token".
 * `graphClient.checkToken()` is documented to never throw; the try/catch here only
 * guards against a genuine bug in that contract, matching `ig-actions.ts`'s own
 * defensive style. `ok: true` with `status.state: "not_configured"` is the correct,
 * successful answer to "is there a token" — see the contract's note on why `ok: false`
 * here would conflate "no token" with "the check itself broke".
 */
export async function checkGraphTokenAction(): Promise<ActionResult<{ status: GraphTokenStatus }>> {
  try {
    const status = await graphClient.checkToken();
    return { ok: true, status };
  } catch (err) {
    return toFailure(err);
  }
}
