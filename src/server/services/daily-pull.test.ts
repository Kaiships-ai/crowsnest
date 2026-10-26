import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Connector } from "@/server/connectors/types";
import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import type { PullResult } from "@/server/lib/pull-result";
import { MAX_PULL_ATTEMPTS, pullAgain, pullSlotDate, RETRY_AFTER_MS, runDailyPull, startDailyPullScheduler } from "./daily-pull";

const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);

function fake(id: string, pull?: () => Promise<PullResult<unknown, unknown>>): Connector & { pulls: () => number } {
  let pulls = 0;
  const adapter = pull === undefined ? null : { testConnection: async () => ({ ok: true, message: null }), pull: () => ((pulls += 1), pull()) };
  return { manifest: { id, label: id, auth: "api-key", secrets: [], feeds: [] }, adapter, pulls: () => pulls };
}

const complete = async () => ({ kind: "complete" as const, rows: null });

beforeEach(async () => {
  migrate();
  await db.delete(tables.dailyPulls);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("pullSlotDate", () => {
  test("before 05:00 a time belongs to yesterday's slot, from 05:00 to today's", () => {
    expect(pullSlotDate(at(27, 4, 59))).toBe("2026-10-26");
    expect(pullSlotDate(at(27, 5, 0))).toBe("2026-10-27");
    expect(pullSlotDate(at(1, 3))).toBe("2026-09-30");
  });
});

describe("daily pull scheduler", () => {
  async function runFor(start: Date, minutes: number, registry: Connector[]) {
    vi.setSystemTime(start);
    const stop = startDailyPullScheduler({ registry });
    await vi.advanceTimersByTimeAsync(minutes * 60_000);
    stop();
  }

  test("the 05:00 run fires once", async () => {
    const source = fake("source", complete);
    await runDailyPull(at(26, 9), [source]);
    await runFor(at(27, 4, 58), 10, [source]);
    expect(source.pulls()).toBe(2);
    const today = db.select().from(tables.dailyPulls).all().find((r) => r.slot === "2026-10-27");
    expect(today).toMatchObject({ outcome: "complete" });
    expect(new Date(today?.startedAt ?? 0).getTime()).toBeGreaterThanOrEqual(at(27, 5).getTime());
  });

  test("a missed 05:00 runs once on the next start, and a second start that day does not rerun it", async () => {
    const source = fake("source", complete);
    await runDailyPull(at(25, 9), [source]);
    await runFor(at(27, 9), 5, [source]);
    expect(source.pulls()).toBe(2);
    await runFor(at(27, 18), 5, [source]);
    expect(source.pulls()).toBe(2);
  });
});

describe("a slot that did not succeed", () => {
  const row = (id: string) => db.select().from(tables.dailyPulls).all().find((r) => r.connectorId === id);

  test("a row an earlier process left unfinished is pulled again; one this process is running is not", async () => {
    const source = fake("source", complete);
    const running = fake("running", complete);
    db.insert(tables.dailyPulls).values([
      { slot: "2026-10-27", connectorId: "source", startedAt: "2026-01-01T00:00:00.000Z" },
      { slot: "2026-10-27", connectorId: "running", startedAt: "2999-01-01T00:00:00.000Z" },
    ]).run();
    expect(await runDailyPull(at(27, 9), [source, running])).toEqual([{ connectorId: "source", outcome: "complete", detail: null }]);
    expect(row("source")).toMatchObject({ outcome: "complete", attempts: 2 });
    expect(running.pulls()).toBe(0);
  });

  test("a source skipped at 05:00 pulls on the next tick after it connects; one still not connected is left alone", async () => {
    const late = fake("late");
    const off = fake("off");
    await runDailyPull(at(27, 5), [late, off]);
    expect(row("late")).toMatchObject({ outcome: "skipped" });
    const offBefore = row("off");
    late.adapter = { testConnection: async () => ({ ok: true, message: null }), pull: complete };
    expect(await runDailyPull(at(27, 9), [late, off])).toEqual([{ connectorId: "late", outcome: "complete", detail: null }]);
    expect(row("late")).toMatchObject({ outcome: "complete", attempts: 1 });
    expect(row("off")).toEqual(offBefore);
  });

  test(`a failed pull retries after ${RETRY_AFTER_MS / 60_000} minutes, at most ${MAX_PULL_ATTEMPTS} attempts in a slot`, async () => {
    const results = ["sync lock busy", "network", "network", "network"];
    const flaky = fake("flaky", async () => ({ kind: "failed", reason: results.shift() }));
    const pulls = async (h: number, m: number) => {
      vi.setSystemTime(at(27, h, m));
      await runDailyPull(at(27, h, m), [flaky]);
      return flaky.pulls();
    };
    expect(await pulls(5, 0)).toBe(1);
    expect(await pulls(5, 2)).toBe(1);
    expect(await pulls(5, 6)).toBe(2);
    expect(await pulls(5, 12)).toBe(3);
    expect(await pulls(6, 0)).toBe(3);
    expect(row("flaky")).toMatchObject({ outcome: "failed", attempts: 3, detail: "network" });
  });
});

describe("runDailyPull", () => {
  test("skips and reports a source that is not connected, marks a partial pull partial and a thrown pull failed", async () => {
    const off = fake("off");
    const partial = fake("partial", async () => ({ kind: "partial", rows: [], missing: "page 2", reason: "rate limited" }));
    const broken = fake("broken", async () => {
      throw new Error("sidecar down");
    });
    expect(await runDailyPull(at(27, 6), [off, partial, broken])).toEqual([
      { connectorId: "off", outcome: "skipped", detail: "not-connected" },
      { connectorId: "partial", outcome: "partial", detail: "missing page 2: rate limited" },
      { connectorId: "broken", outcome: "failed", detail: "sidecar down" },
    ]);
    expect(db.select({ id: tables.dailyPulls.connectorId, outcome: tables.dailyPulls.outcome }).from(tables.dailyPulls).all()).toEqual([
      { id: "off", outcome: "skipped" },
      { id: "partial", outcome: "partial" },
      { id: "broken", outcome: "failed" },
    ]);
  });

  test("pull again runs a source the slot already pulled, without touching the slot", async () => {
    const source = fake("source", complete);
    await runDailyPull(at(27, 6), [source]);
    expect(await pullAgain("source", [source])).toEqual({ connectorId: "source", outcome: "complete", detail: null });
    expect(source.pulls()).toBe(2);
    expect(db.select().from(tables.dailyPulls).all()).toHaveLength(1);
    await expect(pullAgain("nope", [source])).rejects.toThrow("no connector nope");
  });
});
