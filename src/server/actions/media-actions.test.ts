import { beforeEach, describe, expect, test, vi } from "vitest";

// config.ts validates at module load and throws on a missing IG_SERVICE_TOKEN (that
// refuse-to-start behaviour is deliberate). vi.hoisted, not a plain statement: ESM import
// bindings are evaluated before top-level statements run, so a bare assignment here would
// land *after* config.ts had already thrown.
vi.hoisted(() => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN = "test-token";
});

const sidecar = vi.hoisted(() => ({ resolveMedia: vi.fn(), download: vi.fn() }));
const assets = vi.hoisted(() => ({ ensureAsset: vi.fn() }));

vi.mock("../ig/client", () => ({ igClient: sidecar }));
vi.mock("../ig/assets", () => assets);

import { downloadVideoAction } from "./media-actions";
import type { IgResolvedMedia } from "../ig/client";

/**
 * What `igClient.resolveMedia()` actually resolves to — `IgResolvedMedia`, not the
 * sidecar's snake_case wire body. Typed on purpose: a fixture shaped like the wire format
 * is how a test ends up exercising a path production cannot reach.
 */
function resolved(over: Partial<IgResolvedMedia> = {}): IgResolvedMedia {
  return {
    externalId: "3512345678901234567",
    mediaType: "video",
    thumbnailUrl: "https://cdn.example/thumb.jpg",
    videoUrl: "https://cdn.example/video.mp4",
    children: [],
    raw: {},
    ...over,
  };
}

/** A real `media_assets` row: `videos.video_asset_id` is a foreign key, so a made-up id
 *  fails the constraint rather than the assertion. */
async function seedAsset(id: string): Promise<string> {
  const { db, nowIso, tables } = await import("../db");
  await db.insert(tables.mediaAssets).values({
    id,
    sha256: id.padEnd(64, "0").slice(0, 64),
    kind: "video",
    contentType: "video/mp4",
    byteSize: 1024,
    storagePath: `aa/${id}.mp4`,
    downloadedAt: nowIso(),
  });
  return id;
}

async function seedVideo(mediaType: "video" | "carousel" | "photo"): Promise<string> {
  const { db, newId, nowIso, tables } = await import("../db");
  const { migrate } = await import("../db/test-migrate");
  migrate();

  const channelId = newId();
  await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: `@c-${channelId.slice(0, 6)}`, trackedSince: nowIso() });

  const videoId = newId();
  await db.insert(tables.videos).values({
    id: videoId,
    channelId,
    platform: "instagram",
    externalId: `ext-${videoId.slice(0, 8)}`,
    url: "https://www.instagram.com/reel/x/",
    mediaType,
    postedAt: nowIso(),
    firstSeenAt: nowIso(),
  });
  return videoId;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("downloadVideoAction", () => {
  test("downloads and persists the freshly-resolved URL", async () => {
    const { db, tables } = await import("../db");
    const { eq } = await import("drizzle-orm");
    const videoId = await seedVideo("video");
    sidecar.resolveMedia.mockResolvedValue(resolved());
    assets.ensureAsset.mockResolvedValue(await seedAsset("asset-1"));

    const result = await downloadVideoAction(videoId);

    expect(result).toEqual({ ok: true, assetId: "asset-1" });
    expect(assets.ensureAsset).toHaveBeenCalledWith("https://cdn.example/video.mp4", "video");

    const row = (await db.select().from(tables.videos).where(eq(tables.videos.id, videoId)))[0];
    expect(row.videoAssetId).toBe("asset-1");
  });

  test("a mapper drift is reported as our bug, not as Instagram withholding a URL", async () => {
    const { IgError } = await import("../ig/errors");
    const videoId = await seedVideo("video");
    // What the client now raises when a resolved `video` has no video_url.
    sidecar.resolveMedia.mockRejectedValue(new IgError("IG_DRIFT", "Instagram payload is missing required field \"video_url\""));

    const result = await downloadVideoAction(videoId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // IgError.userMessage for IG_DRIFT — names the mapper, blames nobody else.
      expect(result.error).toMatch(/mapper/i);
      expect(result.error).not.toMatch(/Instagram did not return/i);
    }
  });

  test("a post that resolves as a carousel says so, instead of blaming Instagram", async () => {
    const videoId = await seedVideo("video");
    // Reachable only when our stored media_type and Instagram's disagree: `videoUrl` is
    // legitimately null for a carousel, whose videos live in the slides.
    sidecar.resolveMedia.mockResolvedValue(resolved({ mediaType: "carousel", videoUrl: null }));

    const result = await downloadVideoAction(videoId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/carousel/i);
      expect(result.error).not.toMatch(/Instagram did not return/i);
    }
    expect(assets.ensureAsset).not.toHaveBeenCalled();
  });

  test("a post that resolves as a photo tells the user how to correct it", async () => {
    const videoId = await seedVideo("video");
    sidecar.resolveMedia.mockResolvedValue(resolved({ mediaType: "photo", videoUrl: null }));

    const result = await downloadVideoAction(videoId);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Re-sync/i);
      expect(result.error).not.toMatch(/Instagram did not return/i);
    }
  });

  test("an already-downloaded video is returned without a round-trip to Instagram", async () => {
    const { db, tables } = await import("../db");
    const { eq } = await import("drizzle-orm");
    const videoId = await seedVideo("video");
    await seedAsset("already-here");
    await db.update(tables.videos).set({ videoAssetId: "already-here" }).where(eq(tables.videos.id, videoId));

    const result = await downloadVideoAction(videoId);

    expect(result).toEqual({ ok: true, assetId: "already-here" });
    expect(sidecar.resolveMedia).not.toHaveBeenCalled();
  });
});
