"use server";

import { revalidatePath } from "next/cache";
import type { GraphTokenStatus } from "../graph/client";
import type { GraphErrorCode } from "../graph/errors";
import { cachedTokenStatus } from "../graph/token-status";
import { log } from "../lib/logger";
import { measureOwnChannel, messageOf, toFailure, type MeasureResult } from "../services/own-measure";

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
 *  Waits its turn when a scheduled run holds the lock. Revalidates even on a failure: rows
 *  written before it stay, and the token state may have changed. A non-Graph throw (a DB
 *  error) is logged and returned as MEASURE_FAILED so the panel can toast it. */
export async function measureOwnChannelAction(): Promise<MeasureResult> {
  try {
    return await measureOwnChannel({ scope: "all" });
  } catch (err) {
    log.error("graph.measure.unexpected", { error: messageOf(err) });
    return { ok: false, error: messageOf(err), code: "MEASURE_FAILED" };
  } finally {
    revalidatePath("/");
  }
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
    // Always live (Check connection, Test token); the result refreshes the cache. A
    // remembered permission refusal is kept: /me cannot see the insights permission.
    const status = await cachedTokenStatus(Date.now(), { live: true });
    return { ok: true, status };
  } catch (err) {
    return toFailure(err);
  }
}
