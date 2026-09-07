/**
 * @vitest-environment jsdom
 *
 * ONB-4: `FirstSyncStep` reads `useSyncProgress()`, which by design reflects the LAST
 * `sync_jobs` row anywhere in the app (so a run started elsewhere shows up in the sidebar
 * and Settings). Mounted here, that meant a pre-existing terminal or running job — the
 * likely case for Settings > Replay first run on any used install — hid the "Run first
 * sync" button and made "Open Crowsnest" clickable before this step had ever synced the
 * channels just added. `started`/`onStarted` are lifted to `onboarding-flow.tsx` so the
 * step only trusts the hook's progress once IT has launched a run.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { SyncProgress } from "@/server/services/sync-types";

const mocks = vi.hoisted(() => ({
  getSyncProgressAction: vi.fn(),
  getChannelSyncProgressAction: vi.fn(),
  startSyncAction: vi.fn(),
  cancelSyncAction: vi.fn(),
}));

vi.mock("@/server/actions/sync-actions", () => mocks);
vi.mock("@/server/actions/settings-actions", () => ({ updateAppSettingsAction: vi.fn().mockResolvedValue({ ok: true }) }));

import { FirstSyncStep } from "./first-sync-step";

function progress(overrides: Partial<SyncProgress> = {}): SyncProgress {
  return {
    jobId: "job-old",
    status: "success",
    phase: "finalizing",
    currentChannelHandle: null,
    channelsTotal: 3,
    channelsDone: 3,
    startedAt: "2026-07-28T10:00:00.000Z",
    finishedAt: "2026-07-28T10:05:00.000Z",
    heartbeatAt: "2026-07-28T10:05:00.000Z",
    itemsSeen: 40,
    itemsCreated: 40,
    itemsUpdated: 0,
    itemsFailed: 0,
    itemsDeleted: 0,
    assetsDownloaded: 40,
    assetsFailed: 0,
    retries: 0,
    stopReason: "lookback",
    errorCode: null,
    errorMessage: null,
    gaps: [],
    cancelRequested: false,
    lookbackDays: 90,
    maxItems: 500,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.getSyncProgressAction.mockReset();
  mocks.getChannelSyncProgressAction.mockReset();
  mocks.startSyncAction.mockReset();
  mocks.cancelSyncAction.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("FirstSyncStep, an unrelated pre-existing job (Replay first run on a used install)", () => {
  test("ONB-4: does not skip the run — 'Run first sync' still renders and Open Crowsnest is not clickable", async () => {
    mocks.getSyncProgressAction.mockResolvedValue({ ok: true, progress: progress({ status: "success", jobId: "job-old" }) });

    render(
      <FirstSyncStep channelIds={["ch-1", "ch-2"]} started={false} onStarted={() => {}} onOpenCrowsnest={() => {}} />
    );
    await flush();

    expect(screen.getByRole("button", { name: /run first sync/i })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /open crowsnest/i })).toBeNull();
  });

  test("ONB-4: pressing 'Run first sync' marks the step started and starts a run scoped to the channels just added", async () => {
    mocks.getSyncProgressAction.mockResolvedValue({ ok: true, progress: progress({ status: "success", jobId: "job-old" }) });
    mocks.startSyncAction.mockResolvedValue({ ok: true, jobId: "job-new" });
    const onStarted = vi.fn();

    const { rerender } = render(
      <FirstSyncStep channelIds={["ch-1", "ch-2"]} started={false} onStarted={onStarted} onOpenCrowsnest={() => {}} />
    );
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /run first sync/i }));
      await flush();
    });

    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(mocks.startSyncAction).toHaveBeenCalledWith(["ch-1", "ch-2"]);

    // The parent lifts `started` on the flag this step just raised — simulate the
    // re-render that would trigger, the same way it does in onboarding-flow.tsx.
    rerender(<FirstSyncStep channelIds={["ch-1", "ch-2"]} started onStarted={onStarted} onOpenCrowsnest={() => {}} />);
    await flush();

    // Once this step's own run is tracked, a terminal status is trusted again.
    expect(screen.getByRole("button", { name: /open crowsnest/i })).not.toBeNull();
  });
});

test("ONB-4: once started, a running job's panel and Open Crowsnest gating behave as before", async () => {
  mocks.getSyncProgressAction.mockResolvedValue({ ok: true, progress: progress({ status: "running" }) });

  render(<FirstSyncStep channelIds={["ch-1"]} started onStarted={() => {}} onOpenCrowsnest={() => {}} />);
  await flush();

  expect(screen.queryByRole("button", { name: /run first sync/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /open crowsnest/i })).toBeNull();
  expect(screen.getByRole("region", { name: "Sync progress" })).not.toBeNull();
});
