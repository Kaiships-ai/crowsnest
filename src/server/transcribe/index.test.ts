import { afterEach, beforeAll, describe, expect, test } from "vitest";

// In-memory DB + migrate, same pattern as db/schema.test.ts.
beforeAll(() => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
});

const ORIGINAL_GROQ_KEY = process.env.GROQ_API_KEY;
const ORIGINAL_WHISPER_BIN = process.env.WHISPER_CPP_BIN_PATH;

afterEach(() => {
  if (ORIGINAL_GROQ_KEY === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = ORIGINAL_GROQ_KEY;
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

    // No GROQ_API_KEY / whisper binary is set up in this test env — if the cache check
    // didn't short-circuit, this would fall through to NoTranscriptProviderError instead.
    const result = await getOrCreateTranscript(videoId);
    expect(result).toEqual({ text: "Cached transcript text.", source: "whisper-local", cached: true });
  });

  test("throws NoTranscriptProviderError when nothing is cached and no provider is available", async () => {
    const { db, newId, nowIso, tables } = await import("../db");
    const { migrate } = await import("../db/test-migrate");
    const { getOrCreateTranscript } = await import("./index");
    migrate();

    delete process.env.GROQ_API_KEY;
    // Force whisper unavailable deterministically — a dev/CI box may have a real
    // whisper-cli on PATH, so point at a binary name that can never resolve rather
    // than relying on absence of the env override.
    process.env.WHISPER_CPP_BIN_PATH = "definitely-not-a-real-bin-xyz";

    const channelId = newId();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@nokeys", trackedSince: nowIso() });
    const videoId = newId();
    await db.insert(tables.videos).values({
      id: videoId,
      channelId,
      platform: "instagram",
      externalId: "no-provider-test",
      url: "https://example.com/v2",
      postedAt: nowIso(),
      firstSeenAt: nowIso(),
    });

    await expect(getOrCreateTranscript(videoId)).rejects.toThrow(/no transcript provider/i);
  });
});
