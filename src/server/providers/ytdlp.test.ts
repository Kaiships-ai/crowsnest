import { afterEach, describe, expect, test, vi } from "vitest";
import { mapYtdlpJson } from "./ytdlp";
import { detectBinary } from "../lib/exec";
import reelFixture from "../../../tests/fixtures/ytdlp-reel.json";

describe("mapYtdlpJson", () => {
  test("maps a yt-dlp -J payload to VideoStats + channelHandle", () => {
    const stats = mapYtdlpJson(reelFixture);
    expect(stats.platform).toBe("instagram");
    expect(stats.id).toBe("DEMOAbc123x");
    expect(stats.url).toBe("https://www.instagram.com/reel/DEMOAbc123x/");
    expect(stats.caption).toBe("3 mistakes killing your first 1,000 followers");
    expect(stats.viewCount).toBe(2400000);
    expect(stats.likeCount).toBe(183000);
    expect(stats.commentCount).toBe(4100);
    expect(stats.durationSec).toBe(34);
    expect(stats.thumbnailUrl).toBe("https://example.com/thumb.jpg");
    expect(stats.videoUrl).toBe("https://example.com/video.mp4");
    // channelHandle is @-prefixed per the canonical-handle constraint
    expect(stats.channelHandle).toBe("@buildinpublic.daily");
    // postedAt is the ISO conversion of the unix `timestamp` field
    const expectedIso = new Date(reelFixture.timestamp * 1000).toISOString();
    expect(stats.postedAt).toBe(expectedIso);
    expect(new Date(stats.postedAt).toString()).not.toBe("Invalid Date");
  });

  test("viewCount null when view_count missing", () => {
    const item = { ...reelFixture } as Record<string, unknown>;
    delete item.view_count;
    const stats = mapYtdlpJson(item);
    expect(stats.viewCount).toBeNull();
  });

  test("missing optional fields map to undefined, no throw", () => {
    const stats = mapYtdlpJson({ id: "x1", webpage_url: "https://www.instagram.com/reel/x1/", timestamp: 0 });
    expect(stats.caption).toBeUndefined();
    expect(stats.durationSec).toBeUndefined();
    expect(stats.thumbnailUrl).toBeUndefined();
    expect(stats.videoUrl).toBeUndefined();
    expect(stats.likeCount).toBeUndefined();
    expect(stats.commentCount).toBeUndefined();
    expect(stats.viewCount).toBeNull();
    // no uploader_id at all -> still @-prefixed, just an empty username
    expect(stats.channelHandle).toBe("@");
  });
});

describe("detectBinary", () => {
  test("resolves a real binary on PATH to an absolute path", async () => {
    const resolved = await detectBinary("ls");
    expect(resolved).not.toBeNull();
    expect(resolved?.endsWith("/ls")).toBe(true);
  });

  test("returns null for a binary that doesn't exist", async () => {
    const resolved = await detectBinary("definitely-not-a-real-bin-xyz");
    expect(resolved).toBeNull();
  });
});

describe("fetchReelByUrl", () => {
  // `doMock` rather than `mock` so the stub is scoped to this block's dynamic import —
  // the `detectBinary` tests above need the real module.
  afterEach(() => {
    vi.doUnmock("../lib/exec");
    vi.resetModules();
  });

  test("passes -- before the URL so a dash-leading URL is not read as a flag", async () => {
    const execFileP = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ id: "1", webpage_url: "u", uploader_id: "x", timestamp: 0 }),
      stderr: "",
    });
    const detectBinaryStub = vi.fn().mockResolvedValue("/usr/local/bin/yt-dlp");
    vi.resetModules();
    vi.doMock("../lib/exec", () => ({ execFileP, detectBinary: detectBinaryStub }));

    const { fetchReelByUrl } = await import("./ytdlp");
    await fetchReelByUrl("-oProof");

    const args = execFileP.mock.calls[0][1] as string[];
    expect(args[args.length - 2]).toBe("--");
    expect(args[args.length - 1]).toBe("-oProof");
  });
});
