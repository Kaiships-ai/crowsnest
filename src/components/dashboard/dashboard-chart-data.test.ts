import { describe, expect, test } from "vitest";

import type { ChannelRow } from "@/server/queries/channels";
import type { FeedItem } from "@/server/queries/feed";
import {
  buildCoverage,
  buildOutlierTimeline,
  buildProducerDonut,
  buildScatterPoints,
  rankableItems,
  rankingRows,
  TIMELINE_WINDOW_DAYS,
  viewScalePosition,
} from "./dashboard-chart-data";

function item(overrides: Omit<Partial<FeedItem>, "channel"> & { channel?: Partial<FeedItem["channel"]> } = {}): FeedItem {
  const { channel, ...rest } = overrides;
  return {
    videoId: "v1",
    url: "https://instagram.com/p/v1",
    caption: "a caption",
    mediaType: "video",
    thumbnailAssetId: null,
    videoAssetId: null,
    postedAt: "2026-07-24T00:00:00.000Z",
    durationSec: 30,
    viewCount: 100_000,
    outlierScore: 1.5,
    engagementRate: 0.05,
    deleted: false,
    channel: {
      id: "c1",
      handle: "@creator",
      displayName: null,
      avatarAssetId: null,
      followerCount: 50_000,
      platform: "instagram",
      ...channel,
    },
    ...rest,
  };
}

function channel(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "c1",
    handle: "@creator",
    displayName: null,
    avatarAssetId: null,
    platform: "instagram",
    followerCount: 50_000,
    medianViews: 80_000,
    outliers30d: 1,
    lastSyncedAt: "2026-07-30T00:00:00.000Z",
    syncError: null,
    fleets: [],
    isOwn: false,
    ...overrides,
  };
}

describe("buildProducerDonut", () => {
  test("only tallies posts that beat their channel (score >= 1)", () => {
    const items = [
      item({ videoId: "a", outlierScore: 2.3 }),
      item({ videoId: "b", outlierScore: 0.5 }),
      item({ videoId: "c", outlierScore: null }),
    ];
    const donut = buildProducerDonut(items);
    expect(donut.outlierTotal).toBe(1);
    expect(donut.postTotal).toBe(3);
    expect(donut.slices).toEqual([{ channelId: "c1", handle: "@creator", count: 1, pct: 100 }]);
  });

  test("a single producer still gets an honest 100% slice, not a hidden chart", () => {
    const items = [item({ videoId: "a", outlierScore: 10.1 }), item({ videoId: "b", outlierScore: 1.1 })];
    const donut = buildProducerDonut(items);
    expect(donut.slices).toHaveLength(1);
    expect(donut.slices[0].pct).toBe(100);
  });

  test("zero outliers is an empty slice list, not a fabricated one", () => {
    const donut = buildProducerDonut([item({ outlierScore: 0.4 })]);
    expect(donut.slices).toEqual([]);
    expect(donut.outlierTotal).toBe(0);
  });

  test("ranks multiple producers by count, descending", () => {
    const items = [
      item({ videoId: "a", outlierScore: 2, channel: { id: "c1", handle: "@one" } }),
      item({ videoId: "b", outlierScore: 2, channel: { id: "c2", handle: "@two" } }),
      item({ videoId: "c", outlierScore: 2, channel: { id: "c2", handle: "@two" } }),
    ];
    const donut = buildProducerDonut(items);
    expect(donut.slices.map((s) => s.handle)).toEqual(["@two", "@one"]);
    expect(donut.slices[0].pct).toBe(67);
  });
});

describe("buildScatterPoints", () => {
  test("drops posts missing either dimension and counts them", () => {
    const items = [
      item({ videoId: "a", outlierScore: 1.2, viewCount: 1000 }),
      item({ videoId: "b", outlierScore: null, viewCount: 1000 }),
      item({ videoId: "c", outlierScore: 1.2, viewCount: null }),
      item({ videoId: "d", outlierScore: 1.2, viewCount: 0 }),
    ];
    const { points, omitted } = buildScatterPoints(items);
    expect(points).toHaveLength(1);
    expect(points[0].videoId).toBe("a");
    expect(omitted).toBe(3);
  });

  test("beat flag matches the >= 1 baseline rule", () => {
    const { points } = buildScatterPoints([
      item({ videoId: "a", outlierScore: 1, viewCount: 1000 }),
      item({ videoId: "b", outlierScore: 0.99, viewCount: 1000 }),
    ]);
    expect(points.find((p) => p.videoId === "a")?.beat).toBe(true);
    expect(points.find((p) => p.videoId === "b")?.beat).toBe(false);
  });
});

describe("viewScalePosition", () => {
  test("clamps to 0 and 1 at the scale bounds", () => {
    expect(viewScalePosition(100)).toBe(0);
    expect(viewScalePosition(100_000_000)).toBe(1);
  });

  test("is monotonic between the bounds", () => {
    expect(viewScalePosition(10_000)).toBeLessThan(viewScalePosition(1_000_000));
  });
});

describe("buildOutlierTimeline", () => {
  const now = new Date("2026-07-31T12:00:00.000Z").getTime();

  test("buckets a post into the day it was posted, and marks the day a hit at score >= 1", () => {
    const items = [item({ videoId: "a", postedAt: "2026-07-24T00:00:00.000Z", outlierScore: 1.1 })];
    const { days, hitDays } = buildOutlierTimeline(items, now);
    expect(days).toHaveLength(TIMELINE_WINDOW_DAYS);
    expect(hitDays).toBe(1);
    const hit = days.find((d) => d.beat);
    expect(hit?.bestScore).toBe(1.1);
  });

  test("drops posts older than the window rather than clipping them into day 0", () => {
    const items = [item({ videoId: "a", postedAt: "2026-06-01T00:00:00.000Z", outlierScore: 5 })];
    const { hitDays } = buildOutlierTimeline(items, now);
    expect(hitDays).toBe(0);
  });

  test("a day with two posts keeps the best score, not the last one seen", () => {
    const items = [
      item({ videoId: "a", postedAt: "2026-07-24T01:00:00.000Z", outlierScore: 0.5 }),
      item({ videoId: "b", postedAt: "2026-07-24T02:00:00.000Z", outlierScore: 3 }),
    ];
    const { days } = buildOutlierTimeline(items, now);
    const bucket = days.find((d) => d.bestScore !== null);
    expect(bucket?.bestScore).toBe(3);
  });

  test("an unscored post never fills a bucket", () => {
    const items = [item({ postedAt: "2026-07-24T00:00:00.000Z", outlierScore: null })];
    const { hitDays, days } = buildOutlierTimeline(items, now);
    expect(hitDays).toBe(0);
    expect(days.every((d) => d.bestScore === null)).toBe(true);
  });
});

describe("rankableItems", () => {
  test("excludes null scores and counts them as unranked", () => {
    const items = [item({ videoId: "a", outlierScore: 3 }), item({ videoId: "b", outlierScore: null })];
    const { ranked, unranked } = rankableItems(items);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].outlierScore).toBe(3);
    expect(unranked).toBe(1);
  });
});

describe("rankingRows", () => {
  test("projects only the fields the list renders, drops unscored, counts them", () => {
    const items = [
      item({
        videoId: "a",
        outlierScore: 5,
        caption: "hi",
        channel: { id: "c1", handle: "@x", platform: "instagram" },
      }),
      item({ videoId: "b", outlierScore: null }),
    ];
    const { rows, unranked } = rankingRows(items);
    expect(unranked).toBe(1);
    expect(rows).toEqual([
      { videoId: "a", score: 5, caption: "hi", handle: "@x", platform: "instagram", deleted: false },
    ]);
  });
});

describe("buildCoverage", () => {
  test("never-synced channels are marked, not counted as zero posts among live channels", () => {
    const channels = [channel({ id: "c1", handle: "@synced" }), channel({ id: "c2", handle: "@never", lastSyncedAt: null })];
    const items = [item({ videoId: "a", channel: { id: "c1", handle: "@synced" } })];
    const rows = buildCoverage(channels, items);
    expect(rows.find((r) => r.channelId === "c1")).toMatchObject({ neverSynced: false, liveCount: 1 });
    expect(rows.find((r) => r.channelId === "c2")).toMatchObject({ neverSynced: true, liveCount: 0 });
  });

  test("a removed post doesn't count toward live coverage", () => {
    const channels = [channel({ id: "c1" })];
    const items = [item({ videoId: "a", deleted: true }), item({ videoId: "b", deleted: false })];
    const rows = buildCoverage(channels, items);
    expect(rows[0].liveCount).toBe(1);
  });
});
