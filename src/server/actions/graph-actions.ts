"use server";

import { desc } from "drizzle-orm";
import { db, tables } from "../db";
import { tokenAccount, type GraphTokenStatus } from "../graph/client";
import type { GraphErrorCode } from "../graph/errors";
import { cachedTokenStatus } from "../graph/token-status";
import { clockNow } from "../lib/clock";
import { log } from "../lib/logger";
import type { SimpleResult } from "../lib/action-result";
import { measurePull, TOKEN_REJECTED_FORM } from "../connectors/instagram-graph";
import { instagramGraph } from "../connectors/instagram-graph/manifest";
import { recordPull, recordPullEnd, recordPullProgress, recordPullStart, recordSample, type PullSummary } from "../services/connector-status";
import { measureOwnChannel, messageOf, toFailure, type MeasureResult } from "../services/own-measure";
import { setConnectorSecret } from "./secrets-actions";

/**
 * Server actions backing own-channel Instagram Insights (V1 data contracts §1).
 *
 * Nothing here throws across the action boundary, and every failure carries a `code`
 * so the UI can tell "no token configured" apart from "token rejected" apart from
 * "rate limited". The measurement itself lives in `services/own-measure.ts`, shared
 * with the Instagram Graph connector's pull.
 */

type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string; code?: GraphErrorCode | "GRAPH_UNKNOWN" };

/** "Measure now": every listed post, plus comments, through the one measurement service.
 *  Waits its turn when another run holds the lock. Records the outcome on the Instagram Graph card. A non-Graph throw (a DB error) is logged and
 *  returned as MEASURE_FAILED so the panel can toast it. */
export async function measureOwnChannelAction(): Promise<MeasureResult> {
  try {
    const r = await measureOwnChannel({ scope: "all" });
    recordPull("instagram-graph", measurePull(r));
    return r;
  } catch (err) {
    log.error("graph.measure.unexpected", { error: messageOf(err) });
    return { ok: false, error: messageOf(err), code: "MEASURE_FAILED" };
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

/** Test connection in the token form: /me with the pasted token, nothing saved. */
export async function testGraphTokenAction(token: string): Promise<{ ok: true; username: string | null; userId: string } | { ok: false; message: string }> {
  const me = await tokenAccount(token.trim());
  if (me.ok) return { ok: true, username: me.username, userId: me.id };
  return { ok: false, message: me.code === "GRAPH_AUTH_FAILED" ? TOKEN_REJECTED_FORM : me.message };
}

/** Save in the token form: /me again for the user id, then stores the token and the id and records the card's sample. */
export async function saveGraphTokenAction(token: string): Promise<SimpleResult> {
  const me = await tokenAccount(token.trim());
  if (!me.ok) return { ok: false, error: me.code === "GRAPH_AUTH_FAILED" ? TOKEN_REJECTED_FORM : me.message };
  for (const [field, value] of [["IG_GRAPH_TOKEN", token], ["IG_GRAPH_USER_ID", me.id]] as const) {
    const saved = await setConnectorSecret(instagramGraph.id, field, value);
    if (!saved.ok) return saved;
  }
  recordSample(instagramGraph.id, { ok: true, line: `@${me.username ?? "?"}` });
  return { ok: true };
}

// ponytail: one card pull at a time in the app's one main process, so a module flag is the Stop.
let cardPull: { stop: boolean } | null = null;

async function followers(measuredAt: string): Promise<PullSummary["followers"]> {
  const [now, before] = await db.select({ capturedAt: tables.ownAccountSnapshots.capturedAt, count: tables.ownAccountSnapshots.followerCount }).from(tables.ownAccountSnapshots).orderBy(desc(tables.ownAccountSnapshots.capturedAt)).limit(2);
  if (now?.capturedAt !== measuredAt || now.count === null) return undefined;
  return { count: now.count, delta: before?.count != null ? now.count - before.count : null };
}

/** Pull my channel from the Graph card. Returns once the pull starts; the card reads its progress from the row.
 *  `skipMeasuredSince` is Pull the rest: posts measured since the last pull started are left out. */
export async function startGraphPullAction(opts: { skipMeasuredSince?: string } = {}): Promise<SimpleResult> {
  if (cardPull) return { ok: false, error: "A pull of your channel is already running." };
  const pull = { stop: false };
  cardPull = pull;
  const startedAt = clockNow();
  let last = { done: 0, total: 0 };
  recordPullStart(instagramGraph.id);
  void (async () => {
    let r: MeasureResult = { ok: false, error: "the pull did not finish", code: "MEASURE_FAILED" };
    try {
      r = await measureOwnChannel({
        scope: "all",
        wait: true,
        skipMeasuredSince: opts.skipMeasuredSince,
        shouldStop: () => pull.stop,
        onProgress: (p) => {
          last = p;
          recordPullProgress(instagramGraph.id, p);
        },
      });
    } catch (err) {
      r = { ok: false, error: messageOf(err), code: "MEASURE_FAILED" };
      log.error("graph.card_pull.unexpected", { error: messageOf(err) });
    } finally {
      cardPull = null;
      const ended = clockNow();
      const stop = r.ok ? (r.stoppedEarly === "stopped" ? "stopped" : r.stoppedEarly ? "limited" : null) : null;
      recordPullEnd(
        instagramGraph.id,
        measurePull(r),
        {
          total: last.total,
          done: last.done,
          updated: r.ok ? r.postsMeasured : 0,
          newItems: 0,
          failed: r.ok ? r.postsFailed : 0,
          durationSec: Math.round((ended.getTime() - startedAt.getTime()) / 1000),
          startedAt: startedAt.toISOString(),
          stop,
          items: [],
          followers: r.ok ? await followers(r.measuredAt).catch(() => undefined) : undefined,
        },
        r.ok ? r.retryAfter : null,
      );
    }
  })().catch((err: unknown) => log.error("graph.card_pull.record_failed", { error: messageOf(err) }));
  return { ok: true };
}

/** Stop on the Graph card: the post in hand finishes, then the pull ends as Partial. */
export async function stopGraphPullAction(): Promise<SimpleResult> {
  if (cardPull) cardPull.stop = true;
  return { ok: true };
}
