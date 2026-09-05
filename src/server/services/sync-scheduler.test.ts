import { describe, expect, test, vi } from "vitest";
import { log } from "@/server/lib/logger";
import { runDueSync } from "./sync-scheduler";

const iso = (ms: number, base = Date.UTC(2026, 0, 1)) => new Date(base + ms).toISOString();

describe("runDueSync (fake deps)", () => {
  test("disabled when cadence is 0", async () => {
    const startSweep = vi.fn(async () => {});
    const r = await runDueSync(new Date(iso(0)), {
      cadenceMinutes: async () => 0,
      latestJob: async () => null,
      startSweep,
    });
    expect(r).toEqual({ started: false, reason: "disabled" });
    expect(startSweep).not.toHaveBeenCalled();
  });

  test("skips while a sync is running", async () => {
    const startSweep = vi.fn(async () => {});
    const r = await runDueSync(new Date(iso(60 * 60_000)), {
      cadenceMinutes: async () => 30,
      latestJob: async () => ({ status: "running", startedAt: iso(0) }),
      startSweep,
    });
    expect(r).toEqual({ started: false, reason: "running" });
    expect(startSweep).not.toHaveBeenCalled();
  });

  test("not due when the last run is inside the cadence window", async () => {
    const startSweep = vi.fn(async () => {});
    const r = await runDueSync(new Date(iso(10 * 60_000)), {
      cadenceMinutes: async () => 30,
      latestJob: async () => ({ status: "success", startedAt: iso(0) }),
      startSweep,
    });
    expect(r).toEqual({ started: false, reason: "not_due" });
    expect(startSweep).not.toHaveBeenCalled();
  });

  test("starts a sweep when due, passing the cadence as the skip window", async () => {
    const startSweep = vi.fn(async () => {});
    const r = await runDueSync(new Date(iso(31 * 60_000)), {
      cadenceMinutes: async () => 30,
      latestJob: async () => ({ status: "success", startedAt: iso(0) }),
      startSweep,
    });
    expect(r).toEqual({ started: true, reason: "started" });
    expect(startSweep).toHaveBeenCalledWith(30);
  });

  test("starts a sweep on a fresh install with no prior job", async () => {
    const startSweep = vi.fn(async () => {});
    const r = await runDueSync(new Date(iso(0)), {
      cadenceMinutes: async () => 30,
      latestJob: async () => null,
      startSweep,
    });
    expect(r).toEqual({ started: true, reason: "started" });
    expect(startSweep).toHaveBeenCalledWith(30);
  });

  test("never throws when startSweep rejects", async () => {
    // startSweep is fire-and-forget (unawaited, with a .catch) so the sweep can run for
    // minutes without holding the reentrancy guard. That means runDueSync resolves with
    // {started: true} immediately, before the rejection has a chance to settle — so we
    // assert the swallowed failure via a log.error spy after a setTimeout(0) tick rather
    // than on the tick's own return value (per the task brief's documented fallback).
    const errorSpy = vi.spyOn(log, "error").mockImplementation(() => {});
    const startSweep = vi.fn(async () => {
      throw new Error("boom");
    });
    const r = await runDueSync(new Date(iso(31 * 60_000)), {
      cadenceMinutes: async () => 30,
      latestJob: async () => ({ status: "success", startedAt: iso(0) }),
      startSweep,
    });
    // The tick itself never throws and reports that it attempted a start.
    expect(r).toEqual({ started: true, reason: "started" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errorSpy).toHaveBeenCalledWith("sync_scheduler.start_sweep_failed", { error: "boom" });
    errorSpy.mockRestore();
  });
});
