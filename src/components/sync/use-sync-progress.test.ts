/**
 * @vitest-environment jsdom
 *
 * The environment is declared per-file on purpose. The rest of this suite runs in node
 * and must keep doing so — flipping the whole project to jsdom to serve one file would
 * put a DOM under 460-odd server tests that have never needed one.
 *
 * What is covered here is exactly the wiring that pure functions cannot reach: that the
 * interval really fires at the cadence `pollIntervalMs` chooses, that a hidden tab really
 * stops and a shown one resumes at once, that unmount really clears up, and — the one
 * that matters most — that a slow response which lands after a fast one is really
 * dropped. A stale poll overwriting fresh progress is invisible in review and obvious to
 * the user, so it is asserted rather than reasoned about.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { SyncProgress } from "@/server/services/sync-types";

/**
 * This factory replaces the module wholesale, so any action the hook starts calling must
 * be added here too — otherwise it is `undefined` at runtime and the failure reads like a
 * hook bug rather than a missing mock entry.
 */
const mocks = vi.hoisted(() => ({
  getSyncProgressAction: vi.fn(),
  getChannelSyncProgressAction: vi.fn(),
  startSyncAction: vi.fn(),
  cancelSyncAction: vi.fn(),
}));

vi.mock("@/server/actions/sync-actions", () => mocks);

import { ACTIVE_POLL_MS, IDLE_POLL_MS } from "./sync-progress-view";
import { useSyncProgress } from "./use-sync-progress";

const START = "2026-07-28T10:00:00.000Z";

function progress(overrides: Partial<SyncProgress> = {}): SyncProgress {
  return {
    jobId: "job-1",
    status: "running",
    phase: "fetching",
    currentChannelHandle: "@hormozi",
    channelsTotal: 4,
    channelsDone: 1,
    startedAt: START,
    finishedAt: null,
    heartbeatAt: START,
    itemsSeen: 120,
    itemsCreated: 40,
    itemsUpdated: 8,
    itemsFailed: 0,
    itemsDeleted: 0,
    assetsDownloaded: 38,
    assetsFailed: 2,
    retries: 0,
    stopReason: null,
    errorCode: null,
    errorMessage: null,
    gaps: [],
    cancelRequested: false,
    lookbackDays: 90,
    maxItems: 500,
    ...overrides,
  };
}

function ok(value: SyncProgress | null) {
  return { ok: true as const, progress: value };
}

/** What `getChannelSyncProgressAction` returns: progress plus how the run relates to the
 *  channel that was asked about. */
function covered(value: SyncProgress | null, coverage: "channel" | "library" | null) {
  return { ok: true as const, progress: value, coverage };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A promise that never settles — used to make a poll's answer irrelevant so an
 *  assertion can only be satisfied by the response under test. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

function pollCount(): number {
  return mocks.getSyncProgressAction.mock.calls.length;
}

/** Advance fake timers inside `act` so both the timer callbacks and the promise
 *  resolutions they trigger are flushed before the next assertion. */
async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  mocks.getSyncProgressAction.mockReset();
  mocks.getChannelSyncProgressAction.mockReset();
  mocks.startSyncAction.mockReset();
  mocks.cancelSyncAction.mockReset();
});

afterEach(() => {
  // Explicit, and load-bearing. Testing Library only registers its own auto-cleanup when
  // the test framework exposes `afterEach` as a global, and this project imports its
  // vitest helpers by name instead. Without this, every hook mounted by an earlier test
  // stays subscribed to `visibilitychange`, and the next test's visibility event makes
  // all of them poll the shared mock at once — which is exactly how this file first
  // "failed": eight phantom polls attributed to a hook that had behaved correctly.
  cleanup();
  vi.useRealTimers();
  // Hand `visibilityState` back to jsdom's own prototype getter.
  Reflect.deleteProperty(document, "visibilityState");
});

async function setVisibility(next: "visible" | "hidden"): Promise<void> {
  hidden = next === "hidden";
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("poll cadence", () => {
  test("idle: polls once on mount, then only every IDLE_POLL_MS", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(null));

    renderHook(() => useSyncProgress());
    await tick();
    expect(pollCount()).toBe(1);

    await tick(IDLE_POLL_MS - 1);
    expect(pollCount()).toBe(1);

    await tick(1);
    expect(pollCount()).toBe(2);
  });

  test("idle still polls at all — a run started by the scheduler or another tab is found", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(null));
    const { result } = renderHook(() => useSyncProgress());
    await tick();

    // Nothing in this tab started anything, yet the run appears.
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress({ jobId: "started-elsewhere" })));
    await tick(IDLE_POLL_MS);

    expect(result.current.progress?.jobId).toBe("started-elsewhere");
    expect(result.current.isRunning).toBe(true);
  });

  test("running: polls every ACTIVE_POLL_MS, an order of magnitude faster than idle", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress()));

    renderHook(() => useSyncProgress());
    await tick();

    const settled = pollCount();
    await tick(ACTIVE_POLL_MS - 1);
    expect(pollCount()).toBe(settled);

    await tick(1);
    expect(pollCount()).toBe(settled + 1);

    await tick(ACTIVE_POLL_MS);
    expect(pollCount()).toBe(settled + 2);
  });

  test("a run going terminal drops the hook back to the idle cadence", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress()));
    const { result } = renderHook(() => useSyncProgress());
    await tick();

    mocks.getSyncProgressAction.mockResolvedValue(ok(progress({ status: "success", finishedAt: START })));
    await tick(ACTIVE_POLL_MS);
    expect(result.current.isRunning).toBe(false);

    const settled = pollCount();
    await tick(ACTIVE_POLL_MS);
    expect(pollCount()).toBe(settled);

    await tick(IDLE_POLL_MS);
    expect(pollCount()).toBe(settled + 1);
  });
});

describe("tab visibility", () => {
  test("a hidden tab stops polling entirely", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress()));
    renderHook(() => useSyncProgress());
    await tick();

    const settled = pollCount();
    await setVisibility("hidden");

    // Thirty seconds that would have been thirty requests.
    await tick(30_000);
    expect(pollCount()).toBe(settled);
  });

  test("showing the tab again polls immediately rather than waiting out an interval", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress()));
    renderHook(() => useSyncProgress());
    await tick();
    await setVisibility("hidden");
    await tick(30_000);

    const beforeShow = pollCount();
    await setVisibility("visible");

    // No timer has been advanced past the visibility event itself.
    expect(pollCount()).toBe(beforeShow + 1);
  });

  test("and resumes the fast cadence afterwards", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress()));
    renderHook(() => useSyncProgress());
    await tick();
    await setVisibility("hidden");
    await setVisibility("visible");

    const resumed = pollCount();
    await tick(ACTIVE_POLL_MS);
    expect(pollCount()).toBe(resumed + 1);
  });
});

describe("cleanup", () => {
  test("unmount clears the interval — no polling continues", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress()));
    const { unmount } = renderHook(() => useSyncProgress());
    await tick();

    unmount();
    const atUnmount = pollCount();

    await tick(60_000);
    expect(pollCount()).toBe(atUnmount);
  });

  test("a poll that resolves after unmount updates nothing and logs nothing", async () => {
    const inFlight = deferred<ReturnType<typeof ok>>();
    mocks.getSyncProgressAction.mockReturnValueOnce(inFlight.promise).mockResolvedValue(ok(null));

    const { unmount } = renderHook(() => useSyncProgress());
    await tick();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    unmount();

    // The request that was already in flight when the component went away.
    await act(async () => {
      inFlight.resolve(ok(progress()));
      await vi.advanceTimersByTimeAsync(0);
    });
    await tick(60_000);

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("out-of-order responses", () => {
  test("a slow poll landing after a fast one is dropped, not rendered", async () => {
    const slow = deferred<ReturnType<typeof ok>>();
    const fast = deferred<ReturnType<typeof ok>>();
    mocks.getSyncProgressAction
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
      // Every later poll never settles, so only the two responses under test can
      // possibly satisfy the assertions below.
      .mockReturnValue(never());

    const { result } = renderHook(() => useSyncProgress());
    await tick();
    expect(pollCount()).toBe(1);

    await tick(IDLE_POLL_MS);
    expect(pollCount()).toBe(2);

    // The second request answers first, with newer progress.
    await act(async () => {
      fast.resolve(ok(progress({ channelsDone: 3 })));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.progress?.channelsDone).toBe(3);

    // The first request finally answers, with what is now stale progress.
    await act(async () => {
      slow.resolve(ok(progress({ channelsDone: 1 })));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.progress?.channelsDone).toBe(3);
  });

  test("in-order responses both apply — the guard is sequence-based, not first-write-wins", async () => {
    const first = deferred<ReturnType<typeof ok>>();
    const second = deferred<ReturnType<typeof ok>>();
    mocks.getSyncProgressAction.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValue(never());

    const { result } = renderHook(() => useSyncProgress());
    await tick();
    await tick(IDLE_POLL_MS);

    await act(async () => {
      first.resolve(ok(progress({ channelsDone: 1 })));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.progress?.channelsDone).toBe(1);

    await act(async () => {
      second.resolve(ok(progress({ channelsDone: 3 })));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.progress?.channelsDone).toBe(3);
  });
});

describe("a failing poll", () => {
  test("keeps the last good progress on screen and surfaces the error", async () => {
    mocks.getSyncProgressAction.mockResolvedValueOnce(ok(progress({ channelsDone: 2 })));
    const { result } = renderHook(() => useSyncProgress());
    await tick();
    expect(result.current.progress?.channelsDone).toBe(2);

    mocks.getSyncProgressAction.mockResolvedValue({ ok: false as const, error: "database is locked" });
    await tick(ACTIVE_POLL_MS);

    expect(result.current.progress?.channelsDone).toBe(2);
    expect(result.current.error).toBe("database is locked");
  });

  test("a thrown request is caught rather than left unhandled", async () => {
    mocks.getSyncProgressAction.mockResolvedValueOnce(ok(progress({ channelsDone: 2 })));
    const { result } = renderHook(() => useSyncProgress());
    await tick();

    mocks.getSyncProgressAction.mockRejectedValue(new Error("Failed to fetch"));
    await tick(ACTIVE_POLL_MS);

    expect(result.current.progress?.channelsDone).toBe(2);
    expect(result.current.error).toBe("Failed to fetch");
  });

  test("recovering clears the error without a remount", async () => {
    mocks.getSyncProgressAction.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValue(ok(progress()));
    const { result } = renderHook(() => useSyncProgress());
    await tick();
    expect(result.current.error).toBe("Failed to fetch");

    await tick(IDLE_POLL_MS);
    expect(result.current.error).toBeNull();
  });
});

describe("commands", () => {
  test("retrying only the gapped channels is start(ids) — the path the panel actually uses", async () => {
    // This replaces two tests over a `retryFailed()` wrapper that nothing called. The
    // panel is presentational and cannot reach the hook, so every consumer arrives here
    // through `onRetry` -> `start(ids)`; that is the path worth covering.
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress({ status: "partial", finishedAt: START })));
    mocks.startSyncAction.mockResolvedValue({ ok: true as const, jobId: "job-2" });

    const { result } = renderHook(() => useSyncProgress());
    await tick();

    await act(async () => {
      await result.current.start(["chan-1", "chan-2"]);
    });

    expect(mocks.startSyncAction).toHaveBeenCalledWith(["chan-1", "chan-2"]);
  });

  test("start() with no arguments syncs only the hook's channel when it has one", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(null));
    mocks.startSyncAction.mockResolvedValue({ ok: true as const, jobId: "job-2" });

    const { result } = renderHook(() => useSyncProgress({ channelId: "chan-9" }));
    await tick();

    await act(async () => {
      await result.current.start();
    });

    expect(mocks.startSyncAction).toHaveBeenCalledWith(["chan-9"]);
  });

  test("a refused start surfaces the reason and still shows the run that refused it", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(null));
    const { result } = renderHook(() => useSyncProgress());
    await tick();

    mocks.startSyncAction.mockResolvedValue({ ok: false as const, error: "A sync is already running", code: "SYNC_ALREADY_RUNNING" });
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress({ jobId: "the-run-holding-the-lock" })));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toBe("A sync is already running");
    expect(result.current.progress?.jobId).toBe("the-run-holding-the-lock");
  });

  test("a refused start survives the polls that follow it — the click never looks like a no-op", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(null));
    const { result } = renderHook(() => useSyncProgress());
    await tick();

    mocks.startSyncAction.mockResolvedValue({ ok: false as const, error: "A sync is already running", code: "SYNC_ALREADY_RUNNING" });
    // The refusal itself makes a run visible, which flips the hook to the fast cadence
    // and fires an immediate poll. That poll used to wipe the message within
    // milliseconds; a successful poll proves polling works, not that the start worked.
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress()));

    await act(async () => {
      await result.current.start();
    });
    await tick(ACTIVE_POLL_MS * 5);

    expect(result.current.error).toBe("A sync is already running");
    expect(result.current.isRunning).toBe(true);
  });

  test("but trying again clears the previous refusal", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(null));
    mocks.startSyncAction.mockResolvedValue({ ok: false as const, error: "A sync is already running" });
    const { result } = renderHook(() => useSyncProgress());
    await tick();

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.error).toBe("A sync is already running");

    mocks.startSyncAction.mockResolvedValue({ ok: true as const, jobId: "job-2" });
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toBeNull();
  });

  test("a command failure is not erased by a healthy poll, and vice versa", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress({ jobId: "job-live" })));
    mocks.cancelSyncAction.mockResolvedValue({ ok: false as const, error: "job already finished" });

    const { result } = renderHook(() => useSyncProgress());
    await tick();

    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.error).toBe("job already finished");

    await tick(ACTIVE_POLL_MS * 3);
    expect(result.current.error).toBe("job already finished");
  });

  test("cancel asks about the job actually on screen, then re-reads it", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress({ jobId: "job-live" })));
    mocks.cancelSyncAction.mockResolvedValue({ ok: true as const });

    const { result } = renderHook(() => useSyncProgress());
    await tick();

    const before = pollCount();
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress({ jobId: "job-live", cancelRequested: true })));

    await act(async () => {
      await result.current.cancel();
    });

    expect(mocks.cancelSyncAction).toHaveBeenCalledWith("job-live");
    // Re-polled at once, so "cancelling…" is driven by the real column.
    expect(pollCount()).toBeGreaterThan(before);
    expect(result.current.progress?.cancelRequested).toBe(true);
  });

  test("cancel with no job in sight asks nothing", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(null));
    const { result } = renderHook(() => useSyncProgress());
    await tick();

    await act(async () => {
      await result.current.cancel();
    });

    expect(mocks.cancelSyncAction).not.toHaveBeenCalled();
  });
});

describe("channel scoping", () => {
  test("a channel-scoped hook asks the channel-scoped action, by channel and not by job id", async () => {
    mocks.getChannelSyncProgressAction.mockResolvedValue(covered(progress(), "channel"));

    const { result } = renderHook(() => useSyncProgress({ channelId: "chan-9" }));
    await tick();

    expect(mocks.getChannelSyncProgressAction).toHaveBeenCalledWith("chan-9");
    expect(mocks.getSyncProgressAction).not.toHaveBeenCalled();
    expect(result.current.coverage).toBe("channel");

    // Still keyed on the channel once a run is live — never re-pinned to a job id.
    await tick(ACTIVE_POLL_MS);
    for (const call of mocks.getChannelSyncProgressAction.mock.calls) {
      expect(call).toEqual(["chan-9"]);
    }
  });

  test("a library-wide run covering this channel is reported as library, not as its own", async () => {
    mocks.getChannelSyncProgressAction.mockResolvedValue(covered(progress({ currentChannelHandle: "@someone-else" }), "library"));

    const { result } = renderHook(() => useSyncProgress({ channelId: "chan-9" }));
    await tick();

    expect(result.current.coverage).toBe("library");
    expect(result.current.isRunning).toBe(true);
  });

  test("a run scoped to a different channel is invisible here", async () => {
    mocks.getChannelSyncProgressAction.mockResolvedValue(covered(null, null));

    const { result } = renderHook(() => useSyncProgress({ channelId: "chan-9" }));
    await tick();

    expect(result.current.progress).toBeNull();
    expect(result.current.coverage).toBeNull();
    expect(result.current.isRunning).toBe(false);
  });

  test("coverage during phase `starting`, before the run has named any channel", async () => {
    // The handle-comparison workaround this replaces got exactly this case wrong: a
    // null handle had to be guessed at, and the guess was wrong for a sub-second on
    // every run. The channel_id column answers it with no guessing.
    mocks.getChannelSyncProgressAction.mockResolvedValue(
      covered(progress({ phase: "starting", currentChannelHandle: null, channelsTotal: null, channelsDone: 0 }), "channel"),
    );

    const { result } = renderHook(() => useSyncProgress({ channelId: "chan-9" }));
    await tick();

    expect(result.current.coverage).toBe("channel");
  });

  test("the global path keeps its old behaviour and reports no coverage", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(ok(progress()));

    const { result } = renderHook(() => useSyncProgress());
    await tick();

    expect(mocks.getSyncProgressAction).toHaveBeenCalled();
    expect(mocks.getChannelSyncProgressAction).not.toHaveBeenCalled();
    expect(result.current.coverage).toBeNull();
    expect(result.current.isRunning).toBe(true);
  });

  test("a failed channel poll keeps the last good coverage rather than reading as 'not busy'", async () => {
    mocks.getChannelSyncProgressAction.mockResolvedValueOnce(covered(progress(), "library"));
    const { result } = renderHook(() => useSyncProgress({ channelId: "chan-9" }));
    await tick();
    expect(result.current.coverage).toBe("library");

    mocks.getChannelSyncProgressAction.mockRejectedValue(new Error("Failed to fetch"));
    await tick(ACTIVE_POLL_MS);

    // Dropping to null here would re-enable a button whose sync is going to be refused.
    expect(result.current.coverage).toBe("library");
    expect(result.current.error).toBe("Failed to fetch");
  });
});

describe("states the engine can actually produce", () => {
  test("a run where every channel failed arrives as failed, not partial", async () => {
    // Engine audit F11: zero successes with gaps now records `failed`, with errorCode
    // and errorMessage taken from the first gap.
    const gaps = [
      { channelId: "chan-1", handle: "@hormozi", provider: "instagram", error: "session expired", code: "IG_AUTH_REQUIRED" },
      { channelId: "chan-2", handle: "@garyvee", provider: "instagram", error: "session expired", code: "IG_AUTH_REQUIRED" },
    ];
    mocks.getSyncProgressAction.mockResolvedValue(
      ok(
        progress({
          status: "failed",
          finishedAt: START,
          channelsDone: 0,
          stopReason: "error",
          errorCode: "IG_AUTH_REQUIRED",
          errorMessage: "session expired",
          gaps,
        }),
      ),
    );

    const { result } = renderHook(() => useSyncProgress());
    await tick();

    expect(result.current.progress?.status).toBe("failed");
    expect(result.current.isRunning).toBe(false);
    expect(result.current.stalled).toBe(false);
    // Still retryable per channel, which is what the gaps are for.
    expect(result.current.progress?.gaps).toHaveLength(2);
  });
});

describe("stalled", () => {
  test("is derived from the heartbeat, not from how long the run has been going", async () => {
    const startedLongAgo = new Date(Date.now() - 3_600_000).toISOString();
    mocks.getSyncProgressAction.mockResolvedValue(
      // An hour of work with a heartbeat from a second ago is healthy, not stalled.
      ok(progress({ startedAt: startedLongAgo, heartbeatAt: new Date(Date.now() - 1_000).toISOString() })),
    );

    const { result } = renderHook(() => useSyncProgress());
    await tick();

    expect(result.current.isRunning).toBe(true);
    expect(result.current.stalled).toBe(false);
  });

  test("a quiet heartbeat on a running row is stalled", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(
      ok(progress({ startedAt: new Date(Date.now() - 200_000).toISOString(), heartbeatAt: new Date(Date.now() - 120_000).toISOString() })),
    );

    const { result } = renderHook(() => useSyncProgress());
    await tick();

    expect(result.current.stalled).toBe(true);
  });
});
