/**
 * @vitest-environment jsdom
 *
 * The video's existing idea shows as a status, and nothing on the page generates one
 * (ideas come from the agent over MCP). Fixture pattern (a hand-built `VideoDetail`)
 * copied from quick-preview-sheet.test.tsx.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { VideoDetail as VideoDetailData } from "@/server/queries/video";
import type { FeedNav } from "./video-detail";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const { VideoDetail } = await import("./video-detail");

afterEach(cleanup);

const FEED_NAV: FeedNav = { backHref: "/feed", prevHref: null, nextHref: null, indexLabel: null };

function detail(): VideoDetailData {
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
    },
    likeCount: 10,
    commentCount: 2,
    children: [],
    deletedAt: null,
    transcript: null,
    // Non-null: the Generate-idea control only renders once analysis exists (same gate
    // SaveToVaultDialog uses), so a null analysis would test nothing here.
    analysis: {
      hookType: "curiosity",
      structureSegments: [],
      formatTags: [],
      styleTags: [],
      whyItWorked: "it worked",
      layout: null,
      framesSampled: null,
      frameModel: null,
      framePassAt: null,
      framePassError: null,
      summary: null,
    },
  };
}

function renderDetail(overrides: { existingIdea: { id: string; status: string } | null }) {
  return render(
    <VideoDetail
      detail={detail()}
      medianBasis={null}
      feedNav={FEED_NAV}
      savedPost={null}
      existingIdea={overrides.existingIdea}
    >
      <div />
    </VideoDetail>
  );
}

describe("VideoDetail idea control", () => {
  test("offers no Generate idea button", () => {
    renderDetail({ existingIdea: null });
    expect(screen.queryByText("Generate idea")).toBeNull();
  });

  test("reflects an existing idea as a disabled status", () => {
    renderDetail({ existingIdea: { id: "idea-1", status: "inbox" } });
    const reflected = screen.getByText("Idea in inbox").closest("button");
    expect(reflected?.getAttribute("aria-disabled")).toBe("true");
  });
});
