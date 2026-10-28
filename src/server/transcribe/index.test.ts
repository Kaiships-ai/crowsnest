import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "vitest";

// In-memory DB + migrate, same pattern as db/schema.test.ts. `IG_SERVICE_TOKEN` and
// `MEDIA_ROOT` must be set before `@/server/config` is first imported (transitively, via
// `../media/store`) — it validates and freezes the environment at module load, same
// requirement as src/server/media/store.test.ts.
beforeAll(() => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  process.env.IG_SERVICE_TOKEN ??= "test-token";
  process.env.MEDIA_ROOT ??= mkdtempSync(path.join(tmpdir(), "crowsnest-transcribe-"));
});

const ORIGINAL_WHISPER_BIN = process.env.WHISPER_CPP_BIN_PATH;

afterEach(() => {
  if (ORIGINAL_WHISPER_BIN === undefined) delete process.env.WHISPER_CPP_BIN_PATH;
  else process.env.WHISPER_CPP_BIN_PATH = ORIGINAL_WHISPER_BIN;
});

describe("getOrCreateTranscript", () => {
  test("returns the cached row without calling any transcript provider", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { getOrCreateTranscript } = await import("./index");
    migrate();

    const channelId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@demo", trackedSince: nowIso() });
    const videoId = newId();
    await db.insert(tables.videos).values({
      id: videoId,
      channelId,
      platform: "instagram",
      externalId: "cache-test",
      url: "https://example.com/v",
      postedAt: nowIso(),
      firstSeenAt: nowIso(),
    });
    await db.insert(tables.transcripts).values({
      videoId,
      text: "Cached transcript text.",
      source: "whisper-local",
      createdAt: nowIso(),
    });

    // No whisper binary is set up in this test env. If the cache check did not
    // short-circuit, this would fall through to NoTranscriptProviderError instead.
    const result = await getOrCreateTranscript(videoId);
    expect(result).toEqual({ text: "Cached transcript text.", source: "whisper-local", cached: true });
  });

  test("throws NoTranscriptProviderError with the install hint when nothing is cached and whisper is missing", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { getOrCreateTranscript } = await import("./index");
    migrate();

    // Force whisper unavailable deterministically — a dev/CI box may have a real
    // whisper-cli on PATH, so point at a binary name that can never resolve rather
    // than relying on absence of the env override.
    process.env.WHISPER_CPP_BIN_PATH = "definitely-not-a-real-bin-xyz";

    const channelId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@nokeys", trackedSince: nowIso() });
    // A downloaded local video asset — must exist for the provider-availability path to
    // even be reached; getOrCreateTranscript now resolves this before touching a provider.
    const assetId = newId();
    await db.insert(tables.mediaAssets).values({
      id: assetId,
      sha256: "b".repeat(64),
      kind: "video",
      contentType: "video/mp4",
      byteSize: 1024,
      storagePath: "bb/" + "b".repeat(64) + ".mp4",
      downloadedAt: nowIso(),
    });
    const videoId = newId();
    await db.insert(tables.videos).values({
      id: videoId,
      channelId,
      platform: "instagram",
      externalId: "no-provider-test",
      url: "https://example.com/v2",
      videoAssetId: assetId,
      postedAt: nowIso(),
      firstSeenAt: nowIso(),
    });

    await expect(getOrCreateTranscript(videoId)).rejects.toThrow(/brew install whisper-cpp/);
  });

  test("throws VideoNotDownloadedError instead of falling back to a remote URL when the video has no local asset yet", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { getOrCreateTranscript, VideoNotDownloadedError } = await import("./index");
    migrate();

    const channelId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@not-downloaded", trackedSince: nowIso() });
    const videoId = newId();
    await db.insert(tables.videos).values({
      id: videoId,
      channelId,
      platform: "instagram",
      externalId: "not-downloaded-test",
      url: "https://example.com/v3",
      postedAt: nowIso(),
      firstSeenAt: nowIso(),
      // videoAssetId deliberately omitted — sync hasn't downloaded this one yet.
    });

    await expect(getOrCreateTranscript(videoId)).rejects.toThrow(VideoNotDownloadedError);
    await expect(getOrCreateTranscript(videoId)).rejects.toThrow(/not.*downloaded|no downloaded video asset/i);
  });
});
