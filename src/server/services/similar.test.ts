import { beforeAll, describe, expect, test } from "vitest";
import type { TagSet } from "./similar";

let db: typeof import("@/server/db")["db"];
let tables: typeof import("@/server/db")["tables"];
let newId: typeof import("@/server/db")["newId"];
let nowIso: typeof import("@/server/db")["nowIso"];
let migrate: typeof import("@/server/db/test-migrate")["migrate"];
let scoreSimilarity: typeof import("./similar")["scoreSimilarity"];
let getSimilarOutliers: typeof import("./similar")["getSimilarOutliers"];

beforeAll(async () => {
  process.env.CROWSNEST_DB_PATH = ":memory:";
  ({ db, tables, newId, nowIso } = await import("@/server/db"));
  ({ migrate } = await import("@/server/db/test-migrate"));
  ({ scoreSimilarity, getSimilarOutliers } = await import("./similar"));
});

describe("scoreSimilarity", () => {
  const base: TagSet = { hookType: "curiosity-gap", structureLabels: ["Hook", "Build"], formatTags: ["talking-head"], styleTags: ["fast-cut"] };

  test("hookType exact match alone scores 3", () => {
    const other: TagSet = { hookType: "curiosity-gap", structureLabels: [], formatTags: [], styleTags: [] };
    expect(scoreSimilarity(base, other)).toBe(3);
  });

  test("each shared structure label scores 1", () => {
    const other: TagSet = { hookType: "", structureLabels: ["Hook", "Build"], formatTags: [], styleTags: [] };
    expect(scoreSimilarity(base, other)).toBe(2);
  });

  test("each shared format tag scores 1, style tags don't cross-match format tags", () => {
    const other: TagSet = { hookType: "", structureLabels: [], formatTags: ["talking-head"], styleTags: ["talking-head"] };
    // "talking-head" only appears as a formatTag on `base`, so only the format term matches (1),
    // not the style term too, even though `other` happens to also list it as a style tag.
    expect(scoreSimilarity(base, other)).toBe(1);
  });

  test("each shared style tag scores 1", () => {
    const other: TagSet = { hookType: "", structureLabels: [], formatTags: [], styleTags: ["fast-cut"] };
    expect(scoreSimilarity(base, other)).toBe(1);
  });

  test("combined overlaps sum: hookType(3) + 2 structure labels(2) + 1 format tag(1) + 1 style tag(1) = 7", () => {
    const other: TagSet = {
      hookType: "curiosity-gap",
      structureLabels: ["Hook", "Build"],
      formatTags: ["talking-head"],
      styleTags: ["fast-cut"],
    };
    expect(scoreSimilarity(base, other)).toBe(7);
  });

  test("empty overlap scores 0", () => {
    const other: TagSet = { hookType: "negative-warning", structureLabels: ["Payoff"], formatTags: ["screen-record"], styleTags: ["b-roll"] };
    expect(scoreSimilarity(base, other)).toBe(0);
  });

  test("both sides empty scores 0 (no hookType match on empty strings)", () => {
    const empty: TagSet = { hookType: "", structureLabels: [], formatTags: [], styleTags: [] };
    expect(scoreSimilarity(empty, empty)).toBe(0);
  });

  test("duplicate labels on one side are only counted once", () => {
    const withDupes: TagSet = { hookType: "", structureLabels: ["Hook", "Hook", "Build"], formatTags: [], styleTags: [] };
    const other: TagSet = { hookType: "", structureLabels: ["Hook", "Payoff"], formatTags: [], styleTags: [] };
    expect(scoreSimilarity(withDupes, other)).toBe(1);
  });
});

describe("getSimilarOutliers", () => {
  test("ranks by score desc then outlierScore desc, excludes self, only considers analyzed videos", async () => {
    migrate();
    const channelId = newId();
    const now = nowIso();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@similar-test", trackedSince: now });

    async function makeVideo(label: string, outlierScore: number) {
      const videoId = newId();
      await db.insert(tables.videos).values({
        id: videoId,
        channelId,
        platform: "instagram",
        externalId: `similar-${label}-${videoId}`,
        url: `https://example.com/${label}`,
        caption: label,
        postedAt: now,
        outlierScore,
        firstSeenAt: now,
      });
      return videoId;
    }

    async function analyze(videoId: string, tags: TagSet) {
      await db.insert(tables.videoAnalyses).values({
        videoId,
        hookType: tags.hookType,
        structureSegments: tags.structureLabels.map((label) => ({ label, startSec: 0, endSec: 1, note: "" })),
        formatTags: tags.formatTags,
        styleTags: tags.styleTags,
        whyItWorked: "because",
        model: "claude-sonnet-5",
        createdAt: now,
      });
    }

    // Source: hookType curiosity-gap, structure [Hook, Build, Payoff], format [talking-head], style [fast-cut]
    const sourceId = await makeVideo("source", 1);
    await analyze(sourceId, { hookType: "curiosity-gap", structureLabels: ["Hook", "Build", "Payoff"], formatTags: ["talking-head"], styleTags: ["fast-cut"] });

    // A: hookType match(3) + 2 shared labels(2) + 1 shared format(1) = 6, outlierScore 5
    const videoA = await makeVideo("A", 5);
    await analyze(videoA, { hookType: "curiosity-gap", structureLabels: ["Hook", "Build"], formatTags: ["talking-head"], styleTags: ["b-roll"] });

    // B: 1 shared label(1) + 1 shared style(1) = 2, outlierScore 20
    const videoB = await makeVideo("B", 20);
    await analyze(videoB, { hookType: "negative-warning", structureLabels: ["Hook"], formatTags: ["screen-record"], styleTags: ["fast-cut"] });

    // C: hookType match only = 3, outlierScore 3 (tie with D on score)
    const videoC = await makeVideo("C", 3);
    await analyze(videoC, { hookType: "curiosity-gap", structureLabels: [], formatTags: [], styleTags: [] });

    // D: hookType match only = 3, outlierScore 50 (tie with C on score, wins on outlierScore)
    const videoD = await makeVideo("D", 50);
    await analyze(videoD, { hookType: "curiosity-gap", structureLabels: [], formatTags: [], styleTags: [] });

    // E: zero overlap = 0, outlierScore 100 (highest raw outlierScore, but ranked last on score)
    const videoE = await makeVideo("E", 100);
    await analyze(videoE, { hookType: "pattern-interrupt", structureLabels: ["Unrelated"], formatTags: ["unrelated-format"], styleTags: ["unrelated-style"] });

    // F: no analysis at all — must never appear in results
    await makeVideo("F", 1000);

    const result = await getSimilarOutliers(sourceId, 10);

    expect(result.map((v) => v.videoId)).toEqual([videoA, videoD, videoC, videoB, videoE]);
    expect(result.some((v) => v.videoId === sourceId)).toBe(false);
  });

  test("limit caps the number of results returned", async () => {
    migrate();
    const channelId = newId();
    const now = nowIso();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@similar-limit-test", trackedSince: now });

    async function seedAnalyzed(caption: string, outlierScore: number) {
      const videoId = newId();
      await db.insert(tables.videos).values({
        id: videoId, channelId, platform: "instagram", externalId: `limit-${caption}-${videoId}`,
        url: `https://example.com/${caption}`, caption, postedAt: now, outlierScore, firstSeenAt: now,
      });
      await db.insert(tables.videoAnalyses).values({
        videoId, hookType: "curiosity-gap", structureSegments: [], formatTags: [], styleTags: [],
        whyItWorked: "because", model: "claude-sonnet-5", createdAt: now,
      });
      return videoId;
    }

    const sourceId = await seedAnalyzed("source2", 1);
    await seedAnalyzed("cand1", 10);
    await seedAnalyzed("cand2", 20);
    await seedAnalyzed("cand3", 30);

    const result = await getSimilarOutliers(sourceId, 2);
    expect(result).toHaveLength(2);
  });

  test("returns [] when the source video has no analysis yet", async () => {
    migrate();
    const channelId = newId();
    const videoId = newId();
    const now = nowIso();
    await db.insert(tables.channels).values({ id: channelId, platform: "instagram", handle: "@similar-noanalysis", trackedSince: now });
    await db.insert(tables.videos).values({
      id: videoId, channelId, platform: "instagram", externalId: `noanalysis-${videoId}`,
      url: "https://example.com/noanalysis", postedAt: now, firstSeenAt: now,
    });

    const result = await getSimilarOutliers(videoId);
    expect(result).toEqual([]);
  });
});
