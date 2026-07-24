import { describe, expect, test } from "vitest";
import { mapHikerUser, mapHikerClip } from "./hikerapi";
import userFixture from "../../../tests/fixtures/hikerapi-user.json";
import clipsFixture from "../../../tests/fixtures/hikerapi-clips.json";

describe("mapHikerUser", () => {
  test("maps a user item to ProfileStats, adding the @ prefix to handle", () => {
    const stats = mapHikerUser(userFixture.user);
    expect(stats.platform).toBe("instagram");
    expect(stats.handle).toBe("@buildinpublic.daily");
    expect(stats.externalId).toBe("1400000001");
    expect(stats.followerCount).toBe(342000);
    expect(stats.displayName).toBe("Build In Public Daily");
    expect(stats.followingCount).toBe(512);
    expect(stats.mediaCount).toBe(480);
    expect(stats.bio).toBe("Shipping daily.");
    expect(stats.avatarUrl).toBe("https://example.com/avatar.jpg");
    expect(stats.isVerified).toBe(false);
    expect(new Date(stats.fetchedAt).toString()).not.toBe("Invalid Date");
  });

  test("missing optional fields map to undefined, no throw", () => {
    const stats = mapHikerUser({ username: "soloname", follower_count: 10 });
    expect(stats.handle).toBe("@soloname");
    expect(stats.followerCount).toBe(10);
    expect(stats.externalId).toBeUndefined();
    expect(stats.displayName).toBeUndefined();
    expect(stats.followingCount).toBeUndefined();
    expect(stats.mediaCount).toBeUndefined();
    expect(stats.bio).toBeUndefined();
    expect(stats.avatarUrl).toBeUndefined();
    expect(stats.isVerified).toBeUndefined();
  });
});

describe("mapHikerClip", () => {
  test("maps a clip item to VideoStats, preferring play_count over view_count, permalink from code", () => {
    const stats = mapHikerClip(clipsFixture.response.items[0]);
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
    const expectedIso = new Date(clipsFixture.response.items[0].taken_at * 1000).toISOString();
    expect(stats.postedAt).toBe(expectedIso);
  });

  test("viewCount falls back to view_count when play_count absent", () => {
    const item = { ...clipsFixture.response.items[0] } as Record<string, unknown>;
    delete item.play_count;
    const stats = mapHikerClip(item);
    expect(stats.viewCount).toBe(2400000);
  });

  test("viewCount null when both count fields missing", () => {
    const item = { ...clipsFixture.response.items[0] } as Record<string, unknown>;
    delete item.view_count;
    delete item.play_count;
    const stats = mapHikerClip(item);
    expect(stats.viewCount).toBeNull();
  });

  test("missing optional fields map to undefined, no throw", () => {
    const stats = mapHikerClip({ pk: "x1", code: "x1", taken_at: 0 });
    expect(stats.caption).toBeUndefined();
    expect(stats.durationSec).toBeUndefined();
    expect(stats.thumbnailUrl).toBeUndefined();
    expect(stats.videoUrl).toBeUndefined();
    expect(stats.likeCount).toBeUndefined();
    expect(stats.commentCount).toBeUndefined();
    expect(stats.viewCount).toBeNull();
  });
});
