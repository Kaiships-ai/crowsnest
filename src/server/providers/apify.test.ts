import { describe, expect, test } from "vitest";
import { mapApifyProfile, mapApifyReel } from "./apify";
import profileFixture from "../../../tests/fixtures/apify-profile.json";
import reelsFixture from "../../../tests/fixtures/apify-reels.json";

describe("mapApifyProfile", () => {
  test("maps a profile item to ProfileStats, adding the @ prefix to handle", () => {
    const stats = mapApifyProfile(profileFixture[0]);
    expect(stats.platform).toBe("instagram");
    expect(stats.handle).toBe("@buildinpublic.daily");
    expect(stats.followerCount).toBe(342000);
    expect(stats.displayName).toBe("Build In Public Daily");
    expect(stats.externalId).toBe("17841400000000001");
    expect(stats.followingCount).toBe(512);
    expect(stats.mediaCount).toBe(480);
    expect(stats.bio).toBe("Shipping daily.");
    expect(stats.avatarUrl).toBe("https://example.com/avatar.jpg");
    expect(stats.isVerified).toBe(false);
    expect(new Date(stats.fetchedAt).toString()).not.toBe("Invalid Date");
  });

  test("missing optional fields map to undefined, no throw", () => {
    const stats = mapApifyProfile({ username: "soloname", followersCount: 10 });
    expect(stats.handle).toBe("@soloname");
    expect(stats.followerCount).toBe(10);
    expect(stats.displayName).toBeUndefined();
    expect(stats.externalId).toBeUndefined();
    expect(stats.followingCount).toBeUndefined();
    expect(stats.mediaCount).toBeUndefined();
    expect(stats.bio).toBeUndefined();
    expect(stats.avatarUrl).toBeUndefined();
    expect(stats.isVerified).toBeUndefined();
  });
});

describe("mapApifyReel", () => {
  test("maps a reel item to VideoStats, preferring videoPlayCount over videoViewCount", () => {
    const stats = mapApifyReel(reelsFixture[0]);
    expect(stats.platform).toBe("instagram");
    expect(stats.id).toBe("3538261234567890123");
    expect(stats.url).toBe("https://www.instagram.com/reel/DEMOAbc123x/");
    expect(stats.caption).toBe("3 mistakes killing your first 1,000 followers");
    expect(stats.viewCount).toBe(2650000);
    expect(stats.durationSec).toBe(34.5);
    expect(stats.thumbnailUrl).toBe("https://example.com/thumb.jpg");
    expect(stats.videoUrl).toBe("https://example.com/video.mp4");
    expect(stats.likeCount).toBe(183000);
    expect(stats.commentCount).toBe(4100);
    expect(new Date(stats.postedAt).toString()).not.toBe("Invalid Date");
    expect(stats.postedAt).toBe("2026-07-18T09:15:00.000Z");
  });

  test("viewCount falls back to videoViewCount when videoPlayCount absent", () => {
    const item = { ...reelsFixture[0] } as Record<string, unknown>;
    delete item.videoPlayCount;
    const stats = mapApifyReel(item);
    expect(stats.viewCount).toBe(2400000);
  });

  test("viewCount null when both count fields missing", () => {
    const item = { ...reelsFixture[0] } as Record<string, unknown>;
    delete item.videoViewCount;
    delete item.videoPlayCount;
    const stats = mapApifyReel(item);
    expect(stats.viewCount).toBeNull();
  });

  test("missing optional fields map to undefined, no throw", () => {
    const stats = mapApifyReel({
      id: "x1",
      url: "https://www.instagram.com/reel/x1/",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(stats.caption).toBeUndefined();
    expect(stats.durationSec).toBeUndefined();
    expect(stats.thumbnailUrl).toBeUndefined();
    expect(stats.videoUrl).toBeUndefined();
    expect(stats.likeCount).toBeUndefined();
    expect(stats.commentCount).toBeUndefined();
    expect(stats.viewCount).toBeNull();
  });
});
