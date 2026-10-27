import { beforeEach, expect, test } from "vitest";

import { db, tables } from "@/server/db";
import { migrate } from "@/server/db/test-migrate";
import { saveAgentAnalysis } from "@/server/services/analyze";
import { getRivalsBoard } from "./rivals-board";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeEach(async () => {
  migrate();
  for (const t of [tables.videoAnalyses, tables.videos, tables.fleetChannels, tables.channels]) await db.delete(t);
});

async function seed(): Promise<void> {
  const channel = (id: string, handle: string, isOwn: boolean) => ({ id, platform: "instagram", handle, followerCount: 5000, trackedSince: daysAgo(60), lastSyncedAt: daysAgo(0.1), isOwn });
  await db.insert(tables.channels).values([channel("own", "@kai", true), channel("riv-b", "@bravo", false), channel("riv-a", "@alpha", false)]);
  const video = (id: string, channelId: string, score: number, age: number) => ({
    id, channelId, platform: "instagram", externalId: id, url: `https://www.instagram.com/reel/${id}/`, postedAt: daysAgo(age), firstSeenAt: daysAgo(age), viewCount: 1000, outlierScore: score,
  });
  await db.insert(tables.videos).values([
    video("a-top", "riv-a", 6, 2), video("a-mid", "riv-a", 3, 3), video("a-low", "riv-a", 1, 4), video("a-old", "riv-a", 9, 40),
    video("a-2", "riv-a", 2.5, 5), video("a-3", "riv-a", 2.2, 6), video("own-1", "own", 8, 1),
  ]);
  const analysis = (videoId: string, createdAt: string) => ({ videoId, hookType: "curiosity-gap", formatTags: ["talking-head"], styleTags: null, whyItWorked: "Shows the result first.", summary: "s", model: "m", createdAt });
  await db.insert(tables.videoAnalyses).values([analysis("a-mid", daysAgo(1)), analysis("a-top", daysAgo(0.5)), analysis("own-1", daysAgo(0.2))]);
}

test("lists rival channels without the own one, each with its top 3 outliers of the last 30 days", async () => {
  await seed();
  const { channels } = await getRivalsBoard();
  expect(channels.map((c) => c.handle)).toEqual(["@alpha", "@bravo"]);
  expect(channels[0].outliers.map((o) => o.videoId)).toEqual(["a-top", "a-mid", "a-2"]);
  expect(channels[0].outliers30d).toBe(4);
  expect(channels[1].outliers).toEqual([]);
});

test("evidence is each rival post's analysis, newest first, with the post's original URL", async () => {
  await seed();
  const { evidence } = await getRivalsBoard();
  expect(evidence.map((e) => [e.post.videoId, e.post.url, e.post.channel.handle])).toEqual([
    ["a-top", "https://www.instagram.com/reel/a-top/", "@alpha"],
    ["a-mid", "https://www.instagram.com/reel/a-mid/", "@alpha"],
  ]);
  expect(evidence[0].analysis).toMatchObject({ hookType: "curiosity-gap", formatTags: ["talking-head"], styleTags: [], whyItWorked: "Shows the result first." });
});

test("the tag an agent saves with an analysis files the card under it, and a re-save without one keeps it", async () => {
  await seed();
  const fields = { hookType: "curiosity-gap", structureSegments: [], formatTags: [], styleTags: [], whyItWorked: "Offer right under the gift." };
  expect(await saveAgentAnalysis("a-low", { ...fields, tag: "take" })).toEqual({ ok: true });
  expect(await saveAgentAnalysis("a-mid", { ...fields, tag: "avoid" })).toEqual({ ok: true });
  expect(await saveAgentAnalysis("a-mid", fields)).toEqual({ ok: true });
  expect((await saveAgentAnalysis("a-top", { ...fields, tag: "copy" })).ok).toBe(false);
  const tags = Object.fromEntries((await getRivalsBoard()).evidence.map((e) => [e.post.videoId, e.analysis.tag]));
  expect(tags).toEqual({ "a-low": "take", "a-mid": "avoid", "a-top": null });
});
