/**
 * @vitest-environment jsdom
 *
 * feed B-12: the Generate-idea control did not gate on the same LLM-availability
 * signal (`hasLlmKey`) its sibling generation controls use (stage-hook.tsx,
 * stage-style.tsx, stage-prompt.tsx), and it offered a blind re-generate even when an
 * idea already existed for the video instead of reflecting that state. Fixture pattern
 * (a hand-built `VideoDetail`) copied from quick-preview-sheet.test.tsx.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { VideoDetail as VideoDetailData } from "@/server/queries/video";
import type { FeedNav } from "./video-detail";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const mocks = vi.hoisted(() => ({ generateIdeaAction: vi.fn() }));
vi.mock("@/server/actions/idea-actions", () => mocks);

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

function renderDetail(overrides: { hasLlmKey: boolean; existingIdea: { id: string; status: string } | null }) {
  return render(
    <VideoDetail
      detail={detail()}
      medianBasis={null}
      feedNav={FEED_NAV}
      savedPost={null}
      hasLlmKey={overrides.hasLlmKey}
      existingIdea={overrides.existingIdea}
    >
      <div />
    </VideoDetail>
  );
}

describe("VideoDetail Generate idea control", () => {
  test("disables Generate idea when no LLM key/proxy is available", () => {
    renderDetail({ hasLlmKey: false, existingIdea: null });
    const button = screen.getByText("Generate idea").closest("button");
    expect(button).toBeTruthy();
    // The underlying primitive stays focusable-when-disabled (so a tooltip can explain
    // why), so it renders aria-disabled rather than the native `disabled` attribute.
    expect(button?.getAttribute("aria-disabled")).toBe("true");
  });

  test("reflects an existing idea instead of offering a blind re-generate", () => {
    renderDetail({ hasLlmKey: true, existingIdea: { id: "idea-1", status: "inbox" } });
    expect(screen.queryByText("Generate idea")).toBeNull();
    const reflected = screen.getByText("Idea in inbox").closest("button");
    expect(reflected).toBeTruthy();
    // Not a blind re-generate trigger: clicking it must never fire generateIdeaAction.
    expect(reflected?.getAttribute("aria-disabled")).toBe("true");
  });
});
