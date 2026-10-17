import { describe, expect, test } from "vitest";

import {
  STACK_STALE_MS,
  selectStuckJobs,
  stackTone,
  summarizeLastSync,
  type LastSyncRow,
  type RunningJob,
} from "./stack-health";
import type { GraphStatus, SidecarStatus } from "./dependency-status";

const NOW = Date.parse("2026-08-06T12:00:00.000Z");

function isoAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

function job(overrides: Partial<RunningJob> = {}): RunningJob {
  return {
    jobId: "job-1",
    kind: "sync",
    label: "Library sync",
    startedAt: isoAgo(10_000),
    heartbeatAt: isoAgo(5_000),
    ...overrides,
  };
}

function syncRow(overrides: Partial<LastSyncRow> = {}): LastSyncRow {
  return {
    jobId: "sync-1",
    status: "success",
    startedAt: isoAgo(600_000),
    finishedAt: isoAgo(500_000),
    itemsCreated: 4,
    itemsUpdated: 7,
    channelsDone: 3,
    channelsTotal: 3,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

const SIDECAR_UP: SidecarStatus = { state: "up", detail: null };

function graph(state: GraphStatus["state"]): GraphStatus {
  return { state, detail: null };
}

describe("selectStuckJobs", () => {
  test("a job beating inside the threshold is not stuck", () => {
    expect(selectStuckJobs([job()], NOW)).toEqual([]);
  });

  test("a heartbeat older than the threshold is stuck, with how long it has been silent", () => {
    const silent = STACK_STALE_MS + 30_000;
    const [stuck] = selectStuckJobs([job({ heartbeatAt: isoAgo(silent) })], NOW);
    expect(stuck.jobId).toBe("job-1");
    expect(stuck.silentForMs).toBe(silent);
  });

  test("exactly at the threshold is not yet stuck, one millisecond past it is", () => {
    expect(selectStuckJobs([job({ heartbeatAt: isoAgo(STACK_STALE_MS) })], NOW)).toEqual([]);
    expect(selectStuckJobs([job({ heartbeatAt: isoAgo(STACK_STALE_MS + 1) })], NOW)).toHaveLength(1);
  });

  /**
   * The one place this deliberately parts company with `evaluateSla`, which reads a null
   * heartbeat as "not stuck". A run that never wrote a single heartbeat is the worst case
   * this view exists to catch, not an exempt one, so the start time stands in as the last
   * sign of life.
   */
  test("a job that never beat at all falls back to its start time", () => {
    const fresh = selectStuckJobs([job({ heartbeatAt: null, startedAt: isoAgo(1_000) })], NOW);
    expect(fresh).toEqual([]);

    const [stuck] = selectStuckJobs([job({ heartbeatAt: null, startedAt: isoAgo(STACK_STALE_MS * 4) })], NOW);
    expect(stuck.silentForMs).toBe(STACK_STALE_MS * 4);
  });

  test("a run that has been going for hours is not stuck while its heartbeat is fresh", () => {
    expect(selectStuckJobs([job({ startedAt: isoAgo(4 * 3_600_000), heartbeatAt: isoAgo(2_000) })], NOW)).toEqual([]);
  });

  test("an unparseable timestamp is never reported as stuck", () => {
    expect(selectStuckJobs([job({ heartbeatAt: "not a date" })], NOW)).toEqual([]);
    expect(selectStuckJobs([job({ heartbeatAt: null, startedAt: "not a date" })], NOW)).toEqual([]);
  });

  test("frame pass jobs are judged by the same rule as sync jobs", () => {
    const jobs = [
      job({ jobId: "s", kind: "sync", heartbeatAt: isoAgo(STACK_STALE_MS + 1) }),
      job({ jobId: "f", kind: "frame_pass", label: "Frame pass", heartbeatAt: isoAgo(STACK_STALE_MS + 1) }),
      job({ jobId: "ok", kind: "frame_pass", label: "Frame pass", heartbeatAt: isoAgo(1_000) }),
    ];
    expect(selectStuckJobs(jobs, NOW).map((j) => j.jobId)).toEqual(["s", "f"]);
  });

  test("the longest-silent job is listed first", () => {
    const jobs = [
      job({ jobId: "recent", heartbeatAt: isoAgo(STACK_STALE_MS + 10_000) }),
      job({ jobId: "oldest", heartbeatAt: isoAgo(STACK_STALE_MS + 900_000) }),
    ];
    expect(selectStuckJobs(jobs, NOW).map((j) => j.jobId)).toEqual(["oldest", "recent"]);
  });
});

describe("summarizeLastSync", () => {
  test("no run at all reads as never, not as a failure", () => {
    expect(summarizeLastSync(null)).toEqual({ state: "never", at: null, detail: null });
  });

  test("a finished run reports what it kept, timed off when it finished", () => {
    expect(summarizeLastSync(syncRow())).toEqual({
      state: "success",
      at: isoAgo(500_000),
      detail: "3 of 3 channels, 4 new, 7 updated",
    });
  });

  test("a run with no channel total still reports its items", () => {
    expect(summarizeLastSync(syncRow({ channelsDone: null, channelsTotal: null })).detail).toBe("4 new, 7 updated");
  });

  test("a partial run keeps its own state and still says what survived", () => {
    const summary = summarizeLastSync(syncRow({ status: "partial" }));
    expect(summary.state).toBe("partial");
    expect(summary.detail).toBe("3 of 3 channels, 4 new, 7 updated");
  });

  test("a failed run reports its own message, never a guess", () => {
    const summary = summarizeLastSync(
      syncRow({ status: "failed", errorMessage: "The Instagram service isn't running.", errorCode: "IG_SERVICE_DOWN" }),
    );
    expect(summary).toEqual({
      state: "failed",
      at: isoAgo(500_000),
      detail: "The Instagram service isn't running.",
    });
  });

  test("a failed run with only a code falls back to the code", () => {
    expect(summarizeLastSync(syncRow({ status: "failed", errorMessage: null, errorCode: "IG_RATE_LIMITED" })).detail).toBe(
      "IG_RATE_LIMITED",
    );
  });

  test("a run still going is timed off its start, and reports no verdict yet", () => {
    expect(summarizeLastSync(syncRow({ status: "running", finishedAt: null }))).toEqual({
      state: "running",
      at: isoAgo(600_000),
      detail: null,
    });
  });

  test("a finished run missing its finish time falls back to when it started", () => {
    expect(summarizeLastSync(syncRow({ finishedAt: null })).at).toBe(isoAgo(600_000));
  });
});

describe("stackTone", () => {
  const healthy = { sidecar: SIDECAR_UP, graph: graph("up"), lastSync: summarizeLastSync(syncRow()), stuckCount: 0 };

  test("everything up and a clean last sync is the only ok", () => {
    expect(stackTone(healthy)).toBe("ok");
  });

  test("a stuck job is bad even when every dependency is up", () => {
    expect(stackTone({ ...healthy, stuckCount: 1 })).toBe("bad");
  });

  test("a sidecar that is not up is bad", () => {
    expect(stackTone({ ...healthy, sidecar: { state: "down", detail: "x" } })).toBe("bad");
    expect(stackTone({ ...healthy, sidecar: { state: "error", detail: "x" } })).toBe("bad");
  });

  test("a failed last sync is bad, a partial one is a warning", () => {
    expect(stackTone({ ...healthy, lastSync: summarizeLastSync(syncRow({ status: "failed" })) })).toBe("bad");
    expect(stackTone({ ...healthy, lastSync: summarizeLastSync(syncRow({ status: "partial" })) })).toBe("warn");
  });

  test("an unproven Graph API warns rather than passing as healthy", () => {
    for (const state of ["not_configured", "unknown"] as const) {
      expect(stackTone({ ...healthy, graph: graph(state) })).toBe("warn");
    }
    expect(stackTone({ ...healthy, graph: graph("down") })).toBe("bad");
  });

  test("never having synced is a warning, not a failure", () => {
    expect(stackTone({ ...healthy, lastSync: summarizeLastSync(null) })).toBe("warn");
  });

  test("a run in flight does not colour the stack", () => {
    expect(stackTone({ ...healthy, lastSync: summarizeLastSync(syncRow({ status: "running", finishedAt: null })) })).toBe("ok");
  });
});
