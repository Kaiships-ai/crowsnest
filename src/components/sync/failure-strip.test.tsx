/**
 * @vitest-environment jsdom
 *
 * The rest of this repo's component coverage (`sync-progress-panel.test.tsx`) renders
 * through `react-dom/server` because that panel is purely props-driven. This component
 * is not — it calls `useSyncProgress()` itself (see its module doc for why: a stale
 * server-rendered `strip` prop has to defer to a run actually in flight) — so it needs a
 * real DOM and `@testing-library/react`, the same combination `use-sync-progress.test.ts`
 * already uses for the hook itself. The environment is declared per-file for the same
 * reason that file gives: keeping the rest of the suite in node.
 *
 * `@testing-library/jest-dom` isn't a dependency here (see `package.json`), so
 * assertions read straight off the DOM node — `.textContent`, `.getAttribute`,
 * `.disabled` — rather than through matchers like `toBeInTheDocument` that this project
 * doesn't have wired up.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { FailureStrip as FailureStripData } from "@/server/queries/failure-surface";
import type { SyncProgress } from "@/server/services/sync-types";

const mocks = vi.hoisted(() => ({
  getSyncProgressAction: vi.fn(),
  getChannelSyncProgressAction: vi.fn(),
  startSyncAction: vi.fn(),
  cancelSyncAction: vi.fn(),
}));

vi.mock("@/server/actions/sync-actions", () => mocks);

import { FailureStrip } from "./failure-strip";

function strip(overrides: Partial<FailureStripData> = {}): FailureStripData {
  return {
    kind: "partial",
    jobId: "job-1",
    isRunning: false,
    finishedAt: "2026-07-31T10:00:00.000Z",
    stopReason: null,
    errorCode: null,
    errorMessage: null,
    cooldownRetryAfterSec: null,
    kept: { itemsCreated: 4, itemsUpdated: 2, channelsSynced: 3, channelsTotal: 5 },
    gaps: [],
    ...overrides,
  };
}

function ok(progress: SyncProgress | null) {
  return { ok: true as const, progress };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.getSyncProgressAction.mockReset().mockResolvedValue(ok(null));
  mocks.getChannelSyncProgressAction.mockReset();
  mocks.startSyncAction.mockReset().mockResolvedValue({ ok: true, jobId: "job-2" });
  mocks.cancelSyncAction.mockReset();
});

afterEach(() => {
  // Same reasoning as use-sync-progress.test.ts: without an explicit cleanup a hook left
  // mounted from an earlier test keeps polling the shared mock into the next one.
  cleanup();
  vi.useRealTimers();
});

/** Mounts and flushes the poll `useSyncProgress` fires on mount, so assertions see the
 *  settled state rather than whatever rendered before the first effect ran. */
async function mount(props: { strip: FailureStripData }) {
  const utils = render(<FailureStrip {...props} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return utils;
}

describe("kinds that don't render", () => {
  test("none renders nothing", async () => {
    const { container } = await mount({ strip: strip({ kind: "none", errorCode: null }) });
    expect(container.innerHTML).toBe("");
  });

  test("running renders nothing — the live progress panel owns that story", async () => {
    const { container } = await mount({ strip: strip({ kind: "running", jobId: "job-1", isRunning: true }) });
    expect(container.innerHTML).toBe("");
  });

  test("a run actually in flight hides the strip even if the server snapshot says failed", async () => {
    mocks.getSyncProgressAction.mockResolvedValue(
      ok({
        jobId: "job-3",
        status: "running",
        phase: "fetching",
        currentChannelHandle: "@a",
        channelsTotal: 2,
        channelsDone: 0,
        startedAt: "2026-07-31T10:00:00.000Z",
        finishedAt: null,
        heartbeatAt: "2026-07-31T10:00:00.000Z",
        itemsSeen: 0,
        itemsCreated: 0,
        itemsUpdated: 0,
        itemsFailed: 0,
        itemsDeleted: 0,
        assetsDownloaded: 0,
        assetsFailed: 0,
        retries: 0,
        stopReason: null,
        errorCode: null,
        errorMessage: null,
        gaps: [],
        cancelRequested: false,
        lookbackDays: null,
        maxItems: 500,
      }),
    );

    const { container } = await mount({ strip: strip({ kind: "failed", errorCode: "IG_NOT_FOUND" }) });

    expect(container.innerHTML).toBe("");
  });
});

describe("the six visible kinds", () => {
  test("service_down names the sidecar and offers the start command, not a sync retry", async () => {
    await mount({ strip: strip({ kind: "service_down", errorCode: "IG_SERVICE_DOWN" }) });
    expect(screen.getByText(/local service down/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy start command/i })).toBeTruthy();
  });

  test("session_expired links to Settings", async () => {
    await mount({ strip: strip({ kind: "session_expired", errorCode: "IG_AUTH_REQUIRED" }) });
    const link = screen.getByRole("link", { name: /reconnect in settings/i });
    expect(link.getAttribute("href")).toBe("/settings");
  });

  test("offline offers a plain retry", async () => {
    await mount({ strip: strip({ kind: "offline", errorCode: "IG_NETWORK" }) });
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  test("failed reads distinctly from partial and offline", async () => {
    await mount({ strip: strip({ kind: "failed", errorCode: "IG_NOT_FOUND", gaps: [] }) });
    expect(screen.getByText("Sync failed")).toBeTruthy();
  });

  test("partial names the gap count in its headline", async () => {
    await mount({
      strip: strip({
        kind: "partial",
        gaps: [{ channelId: "c1", handle: "@a", error: "private", code: "IG_PRIVATE" }],
      }),
    });
    expect(screen.getByText(/1 channel didn't finish/)).toBeTruthy();
  });

  test("cooldown says the pause is account-wide and never names the channel that surfaced it", async () => {
    await mount({
      strip: strip({
        kind: "cooldown",
        errorCode: "IG_RATE_LIMITED",
        cooldownRetryAfterSec: 90,
        gaps: [{ channelId: "c1", handle: "@throttled", error: "please wait", code: "IG_RATE_LIMITED" }],
      }),
    });
    expect(screen.getByText(/whole connection/)).toBeTruthy();
    expect(screen.queryByText(/@throttled/)).toBeNull();
  });
});

describe("cooldown countdown — real facts, never a guessed duration", () => {
  test("a real retryAfterSec disables the action and shows a countdown", async () => {
    vi.setSystemTime(new Date("2026-07-31T10:00:30.000Z"));
    await mount({ strip: strip({ kind: "cooldown", errorCode: "IG_RATE_LIMITED", finishedAt: "2026-07-31T10:00:00.000Z", cooldownRetryAfterSec: 90 }) });

    expect(screen.getByText(/asked us to wait 1:00 more/)).toBeTruthy();
    const button = screen.getByRole("button", { name: /waiting on the cooldown/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test("no retryAfterSec at all says so instead of inventing a countdown", async () => {
    await mount({ strip: strip({ kind: "cooldown", errorCode: "IG_RATE_LIMITED", cooldownRetryAfterSec: null }) });

    expect(screen.getByText(/no countdown to show/)).toBeTruthy();
    const button = screen.getByRole("button", { name: /try again/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});

describe("detail disclosure", () => {
  test("toggles the gap list without touching the headline", async () => {
    await mount({
      strip: strip({
        kind: "partial",
        gaps: [{ channelId: "c1", handle: "@deadacct", error: "account is private", code: "IG_PRIVATE" }],
      }),
    });

    expect(screen.queryByText("@deadacct")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /what didn't come back/i }));
    expect(screen.getByText("@deadacct")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /hide detail/i }));
    expect(screen.queryByText("@deadacct")).toBeNull();
  });
});

describe("dismiss — only the self-healing kind offers it", () => {
  test("partial can be dismissed", async () => {
    const { container } = await mount({ strip: strip({ kind: "partial" }) });
    fireEvent.click(screen.getByRole("button", { name: /dismiss this notice/i }));
    expect(container.innerHTML).toBe("");
  });

  test("a connection-level kind has no dismiss control", async () => {
    await mount({ strip: strip({ kind: "service_down", errorCode: "IG_SERVICE_DOWN" }) });
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });
});

describe("actions call the same start() the sidebar uses — no new server action", () => {
  test("retrying a partial run's gaps passes exactly those channel ids", async () => {
    await mount({
      strip: strip({
        kind: "partial",
        gaps: [{ channelId: "c1", handle: "@a", error: "x", code: "IG_PRIVATE" }],
      }),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry 1 channel/i }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.startSyncAction).toHaveBeenCalledWith(["c1"]);
  });

  test("offline's 'Try again' starts an unscoped sync", async () => {
    await mount({ strip: strip({ kind: "offline", errorCode: "IG_NETWORK" }) });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.startSyncAction).toHaveBeenCalledWith(undefined);
  });

  test("service_down copies the start command instead of calling startSyncAction", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await mount({ strip: strip({ kind: "service_down", errorCode: "IG_SERVICE_DOWN" }) });
    fireEvent.click(screen.getByRole("button", { name: /copy start command/i }));

    expect(writeText).toHaveBeenCalledWith("npm run ig:service");
    expect(mocks.startSyncAction).not.toHaveBeenCalled();
  });
});
