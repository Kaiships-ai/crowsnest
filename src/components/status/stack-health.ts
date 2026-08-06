/**
 * The stack health surface (enhancements spec M4-U8): sidecar, model backend, last sync,
 * and any stuck job, readable in one place instead of four.
 *
 * Pure classification only, same split as `dependency-status.ts` next door and for the
 * same reason: this repo's vitest runs in node with no jsdom, so a plain function is the
 * only thing here that gets real coverage.
 *
 * Nothing is re-derived that the app already decides somewhere else. The two dependency
 * rows keep coming from `dependency-status.ts`'s own `classifySidecarStatus` and
 * `classifyLlmStatus` (this module only folds their verdicts into one overall tone), and
 * "stuck" is `runs/sla.ts`'s `evaluateSla` against the same `SYNC_STALL_SECONDS`
 * threshold the Runs list and the sidebar's stalled read already use. A second definition
 * of stuck would be a second answer to the same question.
 */

import { evaluateSla } from "@/server/runs/sla";
import { SYNC_STALL_SECONDS } from "@/server/services/sync-types";

import type { LlmStatus, SidecarStatus } from "./dependency-status";

/** The staleness threshold, shared with the Runs list (`runs-list.tsx`'s own `STALE_MS`)
 *  rather than picked again here. Deliberately not the reaper's much longer lock-steal
 *  timeout: a job can sit dead-but-unreaped for a long while, and that window is exactly
 *  what this view is for. */
export const STACK_STALE_MS = SYNC_STALL_SECONDS * 1000;

export type StackJobKind = "sync" | "frame_pass";

export interface RunningJob {
  jobId: string;
  kind: StackJobKind;
  /** What to call it on screen — the channel handle, "Library sync", "Frame pass". */
  label: string;
  startedAt: string;
  heartbeatAt: string | null;
}

export interface StuckJob extends RunningJob {
  /** How long since the last sign of life. Reported so the panel can say how bad it is
   *  rather than only that it is bad. */
  silentForMs: number;
}

/**
 * Every running job whose last sign of life is older than `staleMs`, worst first.
 *
 * Two deliberate choices about what counts as a sign of life:
 *
 *  - A job with a heartbeat is judged by `evaluateSla`, the shared evaluator, with an
 *    infinite budget so only its `stuck` verdict can fire. Running longer than its SLA is
 *    a different fact, owned by the Runs screen, and a slow-but-alive run has no business
 *    being flagged as stuck here.
 *  - A job that never wrote a heartbeat at all is judged by its start time. `evaluateSla`
 *    reads a null heartbeat as not stuck, which is right for a run that may not have
 *    reached its first flush yet, but wrong for this view once hours have passed: a job
 *    that never beat once is the worst case here, not an exempt one.
 *
 * An unparseable timestamp is never reported as stuck. Nothing on this screen should
 * invent an outage out of a value it could not read.
 */
export function selectStuckJobs(jobs: RunningJob[], now: number, staleMs: number = STACK_STALE_MS): StuckJob[] {
  const stuck: StuckJob[] = [];

  for (const job of jobs) {
    if (job.heartbeatAt !== null) {
      const verdict = evaluateSla({
        status: "running",
        startedAt: job.startedAt,
        heartbeatAt: job.heartbeatAt,
        budgetMs: Number.POSITIVE_INFINITY,
        staleMs,
        now,
      });
      if (!verdict.stuck) continue;
      stuck.push({ ...job, silentForMs: now - Date.parse(job.heartbeatAt) });
      continue;
    }

    const startedAtMs = Date.parse(job.startedAt);
    if (Number.isNaN(startedAtMs)) continue;
    const silentForMs = now - startedAtMs;
    if (silentForMs > staleMs) stuck.push({ ...job, silentForMs });
  }

  return stuck.sort((a, b) => b.silentForMs - a.silentForMs);
}

export type LastSyncState = "never" | "running" | "success" | "partial" | "failed";

/** The newest `sync_jobs` row, narrowed to what this view reads. `status` is a plain text
 *  column narrowed by the caller, the same way `runs.ts` narrows it. */
export interface LastSyncRow {
  jobId: string;
  status: Exclude<LastSyncState, "never">;
  startedAt: string;
  finishedAt: string | null;
  itemsCreated: number;
  itemsUpdated: number;
  channelsDone: number | null;
  channelsTotal: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface LastSyncSummary {
  state: LastSyncState;
  /** When it finished, or when it started if it is still going or never recorded a finish.
   *  Null only when there has never been a run. */
  at: string | null;
  /** What it kept, or why it failed — the job's own words in the failure case. Null while
   *  a run is in flight, since a half-written counter is not a result yet (the same rule
   *  `failure-surface.ts` follows for the shell strip). */
  detail: string | null;
}

export function summarizeLastSync(row: LastSyncRow | null): LastSyncSummary {
  if (row === null) return { state: "never", at: null, detail: null };

  if (row.status === "running") {
    return { state: "running", at: row.startedAt, detail: null };
  }

  const at = row.finishedAt ?? row.startedAt;

  if (row.status === "failed") {
    return { state: "failed", at, detail: row.errorMessage ?? row.errorCode };
  }

  const kept =
    row.channelsTotal != null
      ? `${row.channelsDone ?? 0} of ${row.channelsTotal} channels, ${row.itemsCreated} new, ${row.itemsUpdated} updated`
      : `${row.itemsCreated} new, ${row.itemsUpdated} updated`;

  return { state: row.status, at, detail: kept };
}

export type StackTone = "ok" | "warn" | "bad";

export interface StackToneInput {
  sidecar: SidecarStatus;
  llm: LlmStatus;
  lastSync: LastSyncSummary;
  stuckCount: number;
}

/**
 * One colour for the whole stack, worst signal wins.
 *
 * "ok" is deliberately hard to earn: it means both dependencies verified up, nothing
 * stuck, and a last sync that either succeeded or is still going. Every state that is
 * merely unproven — a proxy that answered without proving it generates, a backend that
 * did not answer in time, nothing synced yet — is a warning, never a green. That is the
 * same false-green rule `dependency-status.ts` was written around, applied to all four
 * signals at once.
 */
export function stackTone({ sidecar, llm, lastSync, stuckCount }: StackToneInput): StackTone {
  if (stuckCount > 0) return "bad";
  if (sidecar.state !== "up") return "bad";
  if (llm.state === "down") return "bad";
  if (lastSync.state === "failed") return "bad";

  if (llm.state !== "up") return "warn";
  if (lastSync.state === "partial" || lastSync.state === "never") return "warn";

  return "ok";
}
