import { db, newId, nowIso, tables } from "./index";
import { mulberry32, SEED_CHANNELS, CAPTION_POOL, PLANTED_OUTLIERS } from "./seed-data";
import { computeChannelMedian, scoreVideos, type VideoForCalc } from "@/server/services/outlier-calc";

type AppDb = typeof db;
type Platform = "instagram" | "tiktok" | "youtube_shorts";

const SIGMA = 0.6; // Box–Muller lognormal sigma
const VIDEOS_PER_CHANNEL = 20;
const SPAN_DAYS = 90; // videos spread across the last ~90 days
const DAY_MS = 86_400_000;

// One platform per SEED_CHANNELS entry (index-aligned) — gives the demo
// Platform filter (All/IG/TikTok/YT) something real to filter across.
const PLATFORMS: Platform[] = ["instagram", "youtube_shorts", "tiktok", "instagram"];

// Within each channel's 20 videos, PLANTED_OUTLIERS' two entries per channel land on
// these two fixed video indexes: a channel's first PLANTED_OUTLIERS entry overwrites
// video index PLANT_VIDEO_INDEXES[0] (=2), its second entry overwrites index [1] (=15).
const PLANT_VIDEO_INDEXES: [number, number] = [2, 15];

// likeCount = 2-6% of (final) viewCount; commentCount = 1-4% of likeCount.
const LIKE_RATIO_MIN = 0.02;
const LIKE_RATIO_SPAN = 0.04;
const COMMENT_RATIO_MIN = 0.01;
const COMMENT_RATIO_SPAN = 0.03;

interface GenVideo {
  id: string;
  channelIndex: number;
  videoIndex: number;
  externalId: string;
  url: string;
  caption: string;
  postedAt: string;
  durationSec: number;
  viewCount: number;
  outlierScore: number | null;
  likeCount: number;
  commentCount: number;
}

interface Plant {
  channelIndex: number;
  videoIndex: number;
  multiplier: number;
  videoId: string;
  caption: string;
}

/** Standard Box–Muller transform (basic/cos variant): 2 uniforms in, 1 standard-normal out. */
function boxMullerGaussian(rng: () => number): number {
  let u1 = 0;
  while (u1 === 0) u1 = rng(); // avoid log(0)
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function platformUrl(platform: Platform, handle: string, externalId: string): string {
  switch (platform) {
    case "tiktok":
      return `https://www.tiktok.com/${handle}/video/${externalId}`;
    case "youtube_shorts":
      return `https://www.youtube.com/shorts/${externalId}`;
    default:
      return `https://www.instagram.com/reel/${externalId}/`;
  }
}

function toCalc(v: GenVideo): VideoForCalc {
  return { id: v.id, viewCount: v.viewCount, postedAt: v.postedAt };
}

function fakeTranscript(caption: string): string {
  return (
    `Hook: "${caption}." Here's exactly what I mean — I tried this myself and the difference showed up almost immediately. ` +
    `Most people skip this step because it feels too simple, but that's exactly why it works. ` +
    `If you want the full breakdown, stick around to the end and save this one for later.`
  );
}

/** Deletes all rows from every table, children before parents, so re-seeding never hits a unique/FK conflict. */
async function wipeAll(dbInstance: AppDb): Promise<void> {
  await dbInstance.delete(tables.fleetChannels);
  await dbInstance.delete(tables.videoSnapshots);
  await dbInstance.delete(tables.channelSnapshots);
  await dbInstance.delete(tables.transcripts);
  await dbInstance.delete(tables.videoAnalyses);
  await dbInstance.delete(tables.remixSessions);
  await dbInstance.delete(tables.scripts);
  await dbInstance.delete(tables.vaultItems);
  await dbInstance.delete(tables.syncJobs);
  await dbInstance.delete(tables.videos);
  await dbInstance.delete(tables.fleets);
  await dbInstance.delete(tables.channels);
  await dbInstance.delete(tables.savedFilters);
  await dbInstance.delete(tables.appSettings);
}

/**
 * Wipes and repopulates `dbInstance` with a deterministic demo dataset: 4 channels,
 * 20 videos each (80 total, view counts drawn from a per-channel lognormal, with
 * likeCount/commentCount derived from each video's final view count), 8 planted
 * outliers with pinned multipliers, 2 fleets, 2 system saved filters, 6 vault items,
 * 2 demo scripts, transcripts for the planted outliers, and one app_settings row.
 *
 * Deterministic: the PRNG is re-seeded (mulberry32(1337)) on every call, so two calls —
 * even two calls in the same process — produce identical view/like/comment counts and
 * scores. Returns a one-line summary string (also what `npm run db:seed` prints).
 */
export async function seedDatabase(dbInstance: AppDb): Promise<string> {
  await wipeAll(dbInstance);

  const rng = mulberry32(1337);
  const now = nowIso();
  const nowMs = new Date(now).getTime();
  const daysAgoIso = (days: number) => new Date(nowMs - days * DAY_MS).toISOString();

  // ---- channels ----
  const channelIds = SEED_CHANNELS.map(() => newId());
  await dbInstance.insert(tables.channels).values(
    SEED_CHANNELS.map((c, ch) => ({
      id: channelIds[ch],
      platform: PLATFORMS[ch],
      handle: c.handle,
      displayName: c.displayName,
      followerCount: c.followerCount,
      trackedSince: daysAgoIso(SPAN_DAYS + 30),
      lastSyncedAt: now,
    }))
  );

  // ---- videos: raw lognormal generation (view counts not yet plant-adjusted) ----
  const allVideos: GenVideo[] = [];
  for (let ch = 0; ch < SEED_CHANNELS.length; ch++) {
    const channel = SEED_CHANNELS[ch];
    for (let i = 0; i < VIDEOS_PER_CHANNEL; i++) {
      const lognormal = Math.exp(SIGMA * boxMullerGaussian(rng));
      const viewCount = Math.round(channel.baseViews * lognormal);
      const daysAgo = Math.round((i * SPAN_DAYS) / (VIDEOS_PER_CHANNEL - 1)); // 0..90, ~4-5 day steps
      const durationSec = 15 + Math.floor(rng() * 76); // 15..90 inclusive
      const caption = CAPTION_POOL[i % CAPTION_POOL.length];
      const externalId = `demo-${ch}-${i}`;
      allVideos.push({
        id: newId(),
        channelIndex: ch,
        videoIndex: i,
        externalId,
        url: platformUrl(PLATFORMS[ch], channel.handle, externalId),
        caption,
        postedAt: daysAgoIso(daysAgo),
        durationSec,
        viewCount,
        outlierScore: null,
        likeCount: 0, // placeholder — set from the *final* (post-plant) viewCount below
        commentCount: 0,
      });
    }
  }

  // ---- resolve PLANTED_OUTLIERS to concrete (channel, videoIndex) slots ----
  const plants: Plant[] = [];
  const occurrenceByChannel = new Map<number, number>();
  for (const [channelIndex, multiplier] of PLANTED_OUTLIERS) {
    const occurrence = occurrenceByChannel.get(channelIndex) ?? 0;
    occurrenceByChannel.set(channelIndex, occurrence + 1);
    const videoIndex = PLANT_VIDEO_INDEXES[occurrence];
    const video = allVideos.find((v) => v.channelIndex === channelIndex && v.videoIndex === videoIndex);
    if (!video) throw new Error(`seed: no video found for planted outlier ch=${channelIndex} idx=${videoIndex}`);
    plants.push({ channelIndex, videoIndex, multiplier, videoId: video.id, caption: video.caption });
  }

  // ---- two-pass planted-outlier overwrite (per channel) ----
  // Pass 1 overwrites using the pre-plant median; overwriting shifts the median
  // slightly (the plant's original value may have sat inside the middle window),
  // so pass 2 recomputes the median against the once-overwritten data and
  // re-scales — this converges in one corrective pass (the plants, being several
  // multiples of the median, land outside the middle-ranked window after pass 1).
  for (let ch = 0; ch < SEED_CHANNELS.length; ch++) {
    const channelVideos = allVideos.filter((v) => v.channelIndex === ch);
    const channelPlants = plants.filter((p) => p.channelIndex === ch);
    for (let pass = 0; pass < 2; pass++) {
      const median = computeChannelMedian(channelVideos.map(toCalc), VIDEOS_PER_CHANNEL);
      if (median === null) continue; // unreachable with 20 usable videos, but keeps TS strict-safe
      for (const plant of channelPlants) {
        const video = channelVideos[plant.videoIndex];
        video.viewCount = Math.round(plant.multiplier * median);
      }
    }
  }

  // ---- final per-channel scoring + engagement counts (persisted alongside the insert) ----
  // Engagement is derived from the *final* (post-plant) viewCount, drawn from the same
  // mulberry32 stream (2 more rng() calls per video, after all view/duration draws above)
  // so determinism holds end to end. shareCount is left null — no UI consumes it yet.
  for (let ch = 0; ch < SEED_CHANNELS.length; ch++) {
    const channelVideos = allVideos.filter((v) => v.channelIndex === ch);
    const scores = scoreVideos(channelVideos.map(toCalc), VIDEOS_PER_CHANNEL);
    for (const v of channelVideos) {
      v.outlierScore = scores.get(v.id) ?? null;
      const likeRatio = LIKE_RATIO_MIN + rng() * LIKE_RATIO_SPAN; // 2-6% of views
      v.likeCount = Math.round(v.viewCount * likeRatio);
      const commentRatio = COMMENT_RATIO_MIN + rng() * COMMENT_RATIO_SPAN; // 1-4% of likes
      v.commentCount = Math.round(v.likeCount * commentRatio);
    }
  }

  await dbInstance.insert(tables.videos).values(
    allVideos.map((v) => ({
      id: v.id,
      channelId: channelIds[v.channelIndex],
      platform: PLATFORMS[v.channelIndex],
      externalId: v.externalId,
      url: v.url,
      caption: v.caption,
      postedAt: v.postedAt,
      durationSec: v.durationSec,
      thumbnailUrl: null,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      shareCount: null,
      outlierScore: v.outlierScore,
      firstSeenAt: now,
      lastRefreshedAt: now,
    }))
  );

  // ---- fleets ----
  const fleetIds = [newId(), newId()];
  await dbInstance.insert(tables.fleets).values([
    { id: fleetIds[0], name: "AI Niche", createdAt: now },
    { id: fleetIds[1], name: "Craft References", createdAt: now },
  ]);
  await dbInstance.insert(tables.fleetChannels).values([
    { fleetId: fleetIds[0], channelId: channelIds[0] },
    { fleetId: fleetIds[0], channelId: channelIds[1] },
    { fleetId: fleetIds[0], channelId: channelIds[2] },
    { fleetId: fleetIds[1], channelId: channelIds[3] },
  ]);

  // ---- saved filters (system presets) ----
  await dbInstance.insert(tables.savedFilters).values([
    { id: newId(), name: "Balanced", criteria: { minScore: 5, sinceDays: 30 }, isSystem: true },
    { id: newId(), name: "High Conviction", criteria: { minScore: 10, sinceDays: 14, minViews: 500_000 }, isSystem: true },
  ]);

  // ---- vault items (3 hooks + 3 styles), some sourced from planted-outlier videos ----
  const hookIds = [newId(), newId(), newId()];
  const styleIds = [newId(), newId(), newId()];
  await dbInstance.insert(tables.vaultItems).values([
    {
      id: hookIds[0],
      type: "hook",
      sourceVideoId: plants[0].videoId, // channel 0, 12.4x
      title: "Negative Warning Hook",
      templateText: "you're falling behind because nobody's talking about this {topic} tool (yet)",
      tags: ["warning", "curiosity"],
      createdAt: now,
    },
    {
      id: hookIds[1],
      type: "hook",
      sourceVideoId: plants[2].videoId, // channel 1, 38.0x
      title: "Curiosity Gap Hook",
      templateText: "the {topic} tool nobody is talking about (yet)",
      tags: ["curiosity"],
      createdAt: now,
    },
    {
      id: hookIds[2],
      type: "hook",
      sourceVideoId: null,
      title: "Results-First Hook",
      templateText: "how this {format} got {result} in {timeframe}",
      tags: ["proof", "results"],
      createdAt: now,
    },
    {
      id: styleIds[0],
      type: "style",
      sourceVideoId: plants[4].videoId, // channel 2, 22.4x
      title: "Fast-Cut Listicle",
      templateText: "Fast-cut listicle, 5 beats, CTA at end",
      tags: ["editing", "listicle"],
      createdAt: now,
    },
    {
      id: styleIds[1],
      type: "style",
      sourceVideoId: plants[6].videoId, // channel 3, 9.1x
      title: "Talking-Head Teardown",
      templateText: "Single-shot talking head, on-screen text callouts every 3-4s, soft zoom push, CTA overlay in final 2s",
      tags: ["talking-head"],
      createdAt: now,
    },
    {
      id: styleIds[2],
      type: "style",
      sourceVideoId: null,
      title: "Screen-Record Walkthrough",
      templateText: "Screen-record demo with voiceover, chapter captions per step, end card with recap + CTA",
      tags: ["screen-record", "tutorial"],
      createdAt: now,
    },
  ]);

  // ---- demo scripts ----
  await dbInstance.insert(tables.scripts).values([
    {
      id: newId(),
      title: "AI Tool Nobody's Talking About — Script Draft",
      content:
        "HOOK: the AI tool nobody is talking about (yet)\n" +
        "BUILD: I found it digging through a niche subreddit — here's what it actually does and why most creators miss it.\n" +
        "PAYOFF: side-by-side before/after of my workflow, showing the time saved.\n" +
        "CTA: follow for the exact prompt I used, dropping it in part 2.",
      sourceVideoId: plants[2].videoId,
      hookVaultItemId: hookIds[1],
      styleVaultItemId: styleIds[0],
      status: "draft",
      createdAt: daysAgoIso(1),
      updatedAt: now,
    },
    {
      id: newId(),
      title: "The Tool Everyone's Sleeping On — Script Final",
      content:
        "HOOK: you're falling behind because nobody's talking about this AI tool (yet)\n" +
        "BEAT 1: I almost scrolled past it — buried in a random thread, zero hype.\n" +
        "BEAT 2: it does in one prompt what used to take me an hour of manual editing.\n" +
        "BEAT 3: the creators already using it aren't posting about it — that's exactly why it still works.\n" +
        "CTA: save this before everyone else finds out.",
      sourceVideoId: plants[0].videoId,
      hookVaultItemId: hookIds[0],
      styleVaultItemId: styleIds[1],
      status: "final",
      createdAt: daysAgoIso(3),
      updatedAt: daysAgoIso(2),
    },
  ]);

  // ---- transcripts for the 8 planted outliers ----
  await dbInstance.insert(tables.transcripts).values(
    plants.map((p) => ({
      videoId: p.videoId,
      text: fakeTranscript(p.caption),
      language: "en",
      durationSec: allVideos.find((v) => v.id === p.videoId)?.durationSec ?? null,
      source: "whisper-local",
      createdAt: now,
    }))
  );

  // ---- app settings ----
  await dbInstance.insert(tables.appSettings).values([
    { key: "niche_profile", value: "AI tools and building-in-public for solo founders (kaiships.ai)" },
  ]);

  return `${SEED_CHANNELS.length} channels · ${allVideos.length} videos · ${plants.length} planted outliers`;
}

if (process.argv[1]?.endsWith("seed.ts")) {
  // No top-level await: tsx transpiles this entry script as CJS (no "type": "module"
  // in package.json), which rejects top-level await at the esbuild transform step.
  seedDatabase(db)
    .then((summary) => console.log(summary))
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
