/**
 * @vitest-environment jsdom
 *
 * feed B-16: the card and the detail page both mark a soft-removed post ("No longer on
 * Instagram"); the quick-preview sheet didn't. Mocks the sheet's data source
 * (`getVideoPreviewAction`) the same way other tests here mock a server action.
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { VideoDetail } from "@/server/queries/video";

const mocks = vi.hoisted(() => ({ getVideoPreviewAction: vi.fn() }));
vi.mock("@/server/queries/preview-action", () => mocks);

import { QuickPreviewSheet } from "./quick-preview-sheet";

afterEach(cleanup);

function detail(overrides: Partial<VideoDetail["item"]> = {}): VideoDetail {
  return {
    item: {
      videoId: "v1",
      url: "https://instagram.com/p/v1",
      caption: "a post",
      mediaType: "video",
      thumbnailAssetId: null,
      videoAssetId: null,
      postedAt: "2026-09-01T00:00:00.000Z",
      durationSec: 10,
      viewCount: 1000,
      outlierScore: 3.2,
      engagementRate: 0.02,
      deleted: false,
      channel: {
        id: "c1",
        handle: "@creator",
        displayName: null,
        avatarAssetId: null,
        followerCount: 500,
        platform: "instagram",
      },
      ...overrides,
    },
    likeCount: 10,
    commentCount: 2,
    children: [],
    deletedAt: null,
    transcript: null,
    analysis: null,
  };
}

describe("QuickPreviewSheet", () => {
  test("marks a soft-removed video the same way the card does", async () => {
    mocks.getVideoPreviewAction.mockResolvedValue(detail({ deleted: true }));
    await act(async () => {
      render(<QuickPreviewSheet id="v1" onClose={() => {}} />);
    });
    await waitFor(() => expect(screen.getByText(/No longer on Instagram/)).toBeTruthy());
  });

  test("shows no marker for a live video", async () => {
    mocks.getVideoPreviewAction.mockResolvedValue(detail({ deleted: false }));
    await act(async () => {
      render(<QuickPreviewSheet id="v1" onClose={() => {}} />);
    });
    await waitFor(() => expect(screen.getByText("a post")).toBeTruthy());
    expect(screen.queryByText(/No longer on Instagram/)).toBeNull();
  });

  // FEED-Q3: a rejected server read must resolve to an error state, not leave the
  // sheet stuck on its placeholder skeletons forever.
  test("shows an error state when the server read fails", async () => {
    mocks.getVideoPreviewAction.mockRejectedValue(new Error("db read failed"));
    const { container } = render(<QuickPreviewSheet id="v1" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/couldn.t be loaded/i)).toBeTruthy(),
    );
    // and it is no longer sitting on the loading skeleton
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
  });
});
