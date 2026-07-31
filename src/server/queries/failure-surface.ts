import { desc, sql } from "drizzle-orm";
import { db, tables } from "../db";
import type { StopReason, SyncGap, SyncJobStatus } from "../services/sync-types";

/**
 * Shapes the shell's failure strip out of the single most recent `sync_jobs` row.
 * Every sync control in the app — the shell strip, the channels screen's per-channel
 * Sync buttons, the header Sync action — reads its disabled state off this one query,
 * so the classification below is the one place that decides what a failed sync means.
 *
 * The rule this file exists to get right, from CONTEXT.md: "Cooldown — the account
 * wide pause after Instagram signals it has had enough. It applies to the Burner, not
 * to one Channel." The same structural point holds for every code below, not only
 * rate limiting: an expired session, a paused sidecar, or a network outage are facts
 * about the ONE Instagram connection this whole app shares, not about whichever
 * channel a channel-by-channel run happened to be visiting when the connection went
 * bad. A run that failed a channel on IG_SERVICE_DOWN must never render as "this
 * channel failed" — it renders as "the sidecar is down", with the channel listed as a
 * casualty of that, never as its cause. That is why `classify` below scans every gap's
 * code (not just the job-level one, which is only ever set when *every* channel
 * failed) for a connection-level code before it ever falls back to a plain "partial".
 */

/**
 * Every code in one of these four sets is a fact about the connection, never about one
 * channel — see the module doc above. Anything outside them (IG_NOT_FOUND, IG_PRIVATE,
 * IG_DRIFT, IG_ASSET_DOWNLOAD, IG_UNKNOWN, ...) is a fact about one post or one channel
 * and must never promote a run to a connection-level state.
 */
const SERVICE_DOWN_CODES = new Set(["IG_SERVICE_DOWN", "IG_SERVICE_UNAUTHORIZED"]);
const SESSION_EXPIRED_CODES = new Set(["IG_AUTH_REQUIRED", "IG_BAD_CREDENTIALS", "IG_TWO_FACTOR", "IG_CHALLENGE", "IG_PROXY_BLOCKED"]);
const COOLDOWN_CODES = new Set(["IG_RATE_LIMITED"]);
const OFFLINE_CODES = new Set(["IG_NETWORK"]);

export type FailureStripKind =
  | "none" // nothing to show: no run has ever happened, or the last one fully succeeded
  | "running" // a run is in flight; the shell shows the progress bar, not this strip
  | "service_down" // the instagrapi sidecar could not be reached
  | "session_expired" // the Instagram session needs a human in Settings
  | "cooldown" // Instagram rate-limited the burner; account wide, and it self-clears
  | "offline" // network calls to Instagram failed
  | "partial" // some channels failed for reasons of their own; the connection is fine
  | "failed"; // every channel failed for a reason that is not connection-level

export interface FailureStripGap {
  channelId: string;
  handle: string;
  error: string;
  code: string | null;
}

export interface FailureStrip {
  kind: FailureStripKind;
  jobId: string | null;
  /** True only while the run is still `running`. Every other field describes the last
   *  FINISHED run — the shell hides this strip and shows the seven-phase progress bar
   *  instead whenever this is true, per the brief's rule that a run in flight is not a
   *  verdict yet. */
  isRunning: boolean;
  finishedAt: string | null;
  stopReason: StopReason | null;
  /** The connection-level or job-level code that decided `kind`. Null for "none",
   *  "running" and "partial", where no single code speaks for the whole run. */
  errorCode: string | null;
  errorMessage: string | null;
  /** Seconds Instagram itself asked us to wait, read from whichever gap's own retry
   *  hint decided the "cooldown" kind. Null whenever no gap carried one — which is
   *  most of the time, since a hint only survives when a channel's retry ladder ran out
   *  on an IG_RATE_LIMITED whose backoff was Instagram's own number, not a guess (see
   *  `SyncGap.retryAfterSec`). A cooldown strip with no countdown is honest; a guessed
   *  one would not be. */
  cooldownRetryAfterSec: number | null;
  /** What the run kept, so a partial or failed strip can say what survived it and not
   *  only what went wrong. Null when the run recorded nothing usable at all (a crash
   *  before the per-channel loop ever finalized), which is different from zero. */
  kept: { itemsCreated: number; itemsUpdated: number; channelsSynced: number | null; channelsTotal: number | null } | null;
  /** One entry per channel this run could not cover. Empty when the run had no gaps —
   *  including when there has never been a run at all. */
  gaps: FailureStripGap[];
}

function noneStrip(): FailureStrip {
  return {
    kind: "none",
    jobId: null,
    isRunning: false,
    finishedAt: null,
    stopReason: null,
    errorCode: null,
    errorMessage: null,
    cooldownRetryAfterSec: null,
    kept: null,
    gaps: [],
  };
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type ParsedGap = SyncGap & { retryAfterSec?: number };

/**
 * Mirrors `parseGaps` in `sync-actions.ts`: a malformed blob degrades to "no gaps"
 * rather than throwing the whole strip away. Kept as its own copy rather than shared
 * because that module is `"use server"` and may only export async functions, so it has
 * nothing a query module could import.
 */
function parseGaps(raw: string | null): ParsedGap[] {
  if (raw === null || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const gaps: ParsedGap[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const g = entry as Record<string, unknown>;
    const channelId = asString(g.channelId);
    if (!channelId) continue; // unnameable, unretryable — not a gap a screen can use
    const retryAfterSec = asNumber(g.retryAfterSec);
    gaps.push({
      channelId,
      handle: asString(g.handle) ?? channelId,
      provider: asString(g.provider) ?? "",
      error: asString(g.error) ?? "",
      code: asString(g.code),
      ...(retryAfterSec !== null ? { retryAfterSec } : {}),
    });
  }
  return gaps;
}

function parseStats(raw: string | null): { channels?: unknown; videos?: unknown } {
  if (raw === null || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as { channels?: unknown; videos?: unknown };
  } catch {
    return {};
  }
}

interface ClassifyInput {
  status: SyncJobStatus;
  errorCode: string | null;
  errorMessage: string | null;
}

interface Classified {
  kind: FailureStripKind;
  errorCode: string | null;
  errorMessage: string | null;
  cooldownRetryAfterSec: number | null;
}

/**
 * Picks the code (and message) that decides the strip's kind.
 *
 * Job-level `errorCode`/`errorMessage` are only ever set by the engine when EVERY
 * channel in the run failed (see `finalizeJob`'s `everythingFailed` branch in
 * sync-engine.ts) — a run where some channels survived carries its connection-level
 * fact, if it has one, only inside its gaps. Both are searched here so a partial
 * cooldown reads exactly as loudly as a total one; scanning gaps first is what stops a
 * connection-wide problem from being reported as though it belonged to whichever
 * channel happened to surface it.
 */
function classify(job: ClassifyInput, gaps: ParsedGap[]): Classified {
  const candidates: { code: string; message: string; retryAfterSec?: number }[] = [];
  for (const g of gaps) {
    if (g.code !== null) candidates.push({ code: g.code, message: g.error, retryAfterSec: g.retryAfterSec });
  }
  if (job.errorCode !== null) candidates.push({ code: job.errorCode, message: job.errorMessage ?? "" });

  const groups: [Set<string>, "service_down" | "session_expired" | "cooldown" | "offline"][] = [
    [SERVICE_DOWN_CODES, "service_down"],
    [SESSION_EXPIRED_CODES, "session_expired"],
    [COOLDOWN_CODES, "cooldown"],
    [OFFLINE_CODES, "offline"],
  ];
  for (const [codes, kind] of groups) {
    const hit = candidates.find((c) => codes.has(c.code));
    if (hit) {
      return {
        kind,
        errorCode: hit.code,
        errorMessage: hit.message.length > 0 ? hit.message : null,
        cooldownRetryAfterSec: kind === "cooldown" ? (hit.retryAfterSec ?? null) : null,
      };
    }
  }

  if (job.status === "failed") {
    return { kind: "failed", errorCode: job.errorCode, errorMessage: job.errorMessage, cooldownRetryAfterSec: null };
  }
  if (gaps.length > 0 || job.status === "partial") {
    return { kind: "partial", errorCode: null, errorMessage: null, cooldownRetryAfterSec: null };
  }
  return { kind: "none", errorCode: null, errorMessage: null, cooldownRetryAfterSec: null };
}

/**
 * The last `sync_jobs` row, shaped into what the shell strip, the channels screen and
 * every sync control need to render their disabled/failed states. Per the query
 * convention this is allowed to throw on a real database error; it never fabricates a
 * result to swallow one.
 */
export async function getFailureStrip(): Promise<FailureStrip> {
  const [row] = await db
    .select({
      id: tables.syncJobs.id,
      status: tables.syncJobs.status,
      finishedAt: tables.syncJobs.finishedAt,
      stopReason: tables.syncJobs.stopReason,
      errorCode: tables.syncJobs.errorCode,
      errorMessage: tables.syncJobs.errorMessage,
      itemsCreated: tables.syncJobs.itemsCreated,
      itemsUpdated: tables.syncJobs.itemsUpdated,
      channelsTotal: tables.syncJobs.channelsTotal,
      // Read as raw text rather than through drizzle's JSON mode: a malformed blob
      // would throw during the SELECT itself and blank the whole strip over one bad
      // row. Same reasoning as `progressColumns` in `sync-actions.ts`.
      statsRaw: sql<string | null>`${tables.syncJobs.stats}`,
      gapsRaw: sql<string | null>`${tables.syncJobs.gaps}`,
    })
    .from(tables.syncJobs)
    .orderBy(desc(tables.syncJobs.startedAt))
    .limit(1);

  if (!row) return noneStrip();

  if (row.status === "running") {
    // The strip's own job is to say nothing while a run is live — the seven-phase
    // progress panel is the surface for that. Rendering this row's half-written
    // counters as though they were a verdict would be exactly the "designed failure
    // surface presenting a mid-flight run as a result" the brief warns against.
    return { ...noneStrip(), kind: "running", jobId: row.id, isRunning: true };
  }

  const gaps = parseGaps(row.gapsRaw);
  const stats = parseStats(row.statsRaw);
  // `status` is a plain text column (see schema.ts) narrowed here the same way
  // `toProgress` in sync-actions.ts narrows it, rather than widening ClassifyInput to
  // accept a bare string and lose the exhaustiveness checking on the "failed"/"partial"
  // branches below.
  const { kind, errorCode, errorMessage, cooldownRetryAfterSec } = classify({ ...row, status: row.status as SyncJobStatus }, gaps);

  return {
    kind,
    jobId: row.id,
    isRunning: false,
    finishedAt: row.finishedAt,
    stopReason: row.stopReason as StopReason | null,
    errorCode,
    errorMessage,
    cooldownRetryAfterSec,
    kept: {
      itemsCreated: row.itemsCreated,
      itemsUpdated: row.itemsUpdated,
      channelsSynced: asNumber(stats.channels),
      channelsTotal: row.channelsTotal,
    },
    gaps: gaps.map((g) => ({ channelId: g.channelId, handle: g.handle, error: g.error, code: g.code })),
  };
}
