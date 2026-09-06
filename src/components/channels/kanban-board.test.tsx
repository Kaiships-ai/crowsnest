/**
 * @vitest-environment jsdom
 *
 * Bulk select + Sync selected (ig-sync 03-feature-description, "Sync several channels at
 * once"). Renders the real board, ticks two cards, and asserts Sync selected starts one
 * run scoped to exactly those two channel ids through the existing `startSyncAction`
 * seam. `@testing-library/jest-dom` isn't wired up here, so assertions read straight off
 * the DOM node, the same as `failure-strip.test.tsx`.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { KanbanBoard as KanbanBoardData, ChannelRow } from "@/server/queries/channels";

const mocks = vi.hoisted(() => ({
  getSyncProgressAction: vi.fn(),
  getChannelSyncProgressAction: vi.fn(),
  startSyncAction: vi.fn(),
  cancelSyncAction: vi.fn(),
}));

vi.mock("@/server/actions/sync-actions", () => mocks);
vi.mock("@/server/actions/fleet-actions", () => ({
  moveChannelsAction: vi.fn(),
  reorderFleetsAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ChannelsKanban } from "./kanban-board";
import { NavigationBlockerProvider } from "@/components/layout/navigation-blocker";

function channel(id: string, handle: string): ChannelRow {
  return {
    id, handle, displayName: null, avatarAssetId: null, platform: "instagram",
    followerCount: 1000, medianViews: 100, outliers30d: 0,
    lastSyncedAt: "2026-09-01T00:00:00.000Z", syncError: null, fleets: [], isOwn: false,
  };
}

function board(): KanbanBoardData {
  const channels = [channel("c1", "@one"), channel("c2", "@two"), channel("c3", "@three")];
  return {
    fleets: [],
    channels,
    placement: { c1: null, c2: null, c3: null },
    sampleSizeById: { c1: 50, c2: 50, c3: 50 },
  };
}

function renderBoard() {
  return render(
    <NavigationBlockerProvider>
      <ChannelsKanban board={board()} />
    </NavigationBlockerProvider>
  );
}

beforeEach(() => {
  mocks.getSyncProgressAction.mockResolvedValue({ ok: true, progress: null });
  mocks.startSyncAction.mockResolvedValue({ ok: true, jobId: "job-1" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("bulk select + sync selected", () => {
  test("ticking two channels syncs exactly those two ids", async () => {
    renderBoard();

    // No selection bar until something is ticked.
    expect(screen.queryByTestId("channels-selection-count")).toBeNull();

    const checks = screen.getAllByTestId("channel-select");
    await act(async () => { fireEvent.click(checks[0]); });
    await act(async () => { fireEvent.click(checks[1]); });

    expect(screen.getByTestId("channels-selection-count").textContent).toBe("2");

    await act(async () => { fireEvent.click(screen.getByTestId("channels-sync-selected")); });

    expect(mocks.startSyncAction).toHaveBeenCalledTimes(1);
    const ids = mocks.startSyncAction.mock.calls[0][0] as string[];
    expect([...ids].sort()).toEqual(["c1", "c2"]);

    // Selection clears once the run starts.
    expect(screen.queryByTestId("channels-selection-count")).toBeNull();
  });

  test("Sync selected passes only explicit ids, never an empty library sweep", async () => {
    renderBoard();
    // With nothing ticked, there is no Sync selected button to press at all.
    expect(screen.queryByTestId("channels-sync-selected")).toBeNull();
    expect(mocks.startSyncAction).not.toHaveBeenCalled();
  });
});
