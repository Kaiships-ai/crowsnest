/**
 * Deterministic benchmark for the SYNC_CONCURRENCY knob (Goal 3). It is timing based, so
 * it is a script, not a vitest test (a wall-clock assertion would be flaky in CI). Run:
 *
 *   npx tsx scripts/bench-sync-concurrency.ts
 *
 * It syncs a fixed set of stub channels at concurrency 1 and 2 and prints the wall clock
 * and the request count for each, under two models of the sidecar:
 *
 *  - independent: every Instagram call has its own latency and can overlap another
 *    channel's call. This is the UPPER BOUND, the win if the sidecar could serve
 *    channels in parallel.
 *  - serialized:  every Instagram call goes through one shared async lock, exactly as the
 *    real sidecar serializes all Instagram traffic behind session.py's process-global
 *    RLock. This is the honest expectation for today's single-session sidecar.
 *
 * Raising concurrency never produces concurrent Instagram traffic (the lock forbids it);
 * it only overlaps one channel's local async work (asset writes) with another channel's
 * queued fetch. So the serialized model is where the true, modest gain shows, and the gap
 * between the two models is the cost of the single session.
 */
import { performance } from "node:perf_hooks";

process.env.CROWSNEST_DB_PATH = ":memory:";

const CHANNELS = 5;
const ITEMS_PER_CHANNEL = 6;
const IG_LATENCY_MS = 40;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One shared async lock: models the sidecar's single-session RLock, so every Instagram
 *  call serializes against every other, across all workers. */
function makeSidecarLock(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = tail;
    let release!: () => void;
    tail = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

function makeProfile(handle: string) {
  return {
    handle,
    externalId: `ext-${handle}`,
    displayName: `Display ${handle}`,
    followerCount: 100_000,
    followingCount: 100,
    mediaCount: 500,
    bio: "bio",
    isVerified: false,
    isPrivate: false,
    avatarUrl: `https://cdn.example/${handle}/avatar.jpg`,
    raw: { username: handle },
  };
}

function makeMedia(id: string) {
  return {
    externalId: id,
    shortcode: `sc-${id}`,
    mediaType: "video" as const,
    productType: "clips",
    url: `https://www.instagram.com/reel/sc-${id}/`,
    caption: `caption ${id}`,
    takenAt: new Date().toISOString(),
    durationSec: 30,
    viewCount: 10_000,
    likeCount: 100,
    commentCount: 10,
    thumbnailUrl: `https://cdn.example/${id}/thumb.jpg`,
    videoUrl: `https://cdn.example/${id}/video.mp4`,
    children: [],
    raw: { pk: id },
  };
}

/** Builds a stub IgClient whose Instagram calls (profile, medias, download) cost
 *  IG_LATENCY_MS each. In "serialized" mode they all pass through one shared lock. */
function buildClient(mode: "independent" | "serialized") {
  const lock = makeSidecarLock();
  const gated = <T>(fn: () => Promise<T>): Promise<T> => (mode === "serialized" ? lock(fn) : fn());
  const state = { requests: 0 };
  const pageSeen = new Map<string, boolean>();

  const igCall = <T>(value: T): Promise<T> =>
    gated(async () => {
      state.requests += 1;
      await delay(IG_LATENCY_MS);
      return value;
    });

  const client = {
    async profile(handle: string) {
      return igCall(makeProfile(handle));
    },
    async medias(input: { handle: string }) {
      const first = !pageSeen.get(input.handle);
      pageSeen.set(input.handle, true);
      const items = first ? Array.from({ length: ITEMS_PER_CHANNEL }, (_, i) => makeMedia(`${input.handle}-r${i}`)) : [];
      return igCall({ items, nextCursor: null, stopReason: first ? null : ("exhausted" as const) });
    },
    async download(input: { url: string; kind: string }) {
      const sha = Buffer.from(input.url).toString("hex").padEnd(64, "0").slice(0, 64);
      return igCall({
        path: `${sha.slice(0, 2)}/${sha}.jpg`,
        bytes: 2048,
        contentType: "image/jpeg",
        sha256: sha,
        width: 1080,
        height: 1920,
        durationSec: null,
      });
    },
    async fetchMediaStats(pk: string) {
      return igCall({ externalId: pk, mediaType: "video" as const, productType: "clips", viewCount: 10_000, likeCount: 1, commentCount: 1 });
    },
    async resolveMedia(pk: string) {
      return igCall(makeMedia(pk));
    },
    async health() {
      return { status: "ok", loggedIn: true, username: "stub", instagrapiVersion: "0", sessionLoaded: true };
    },
  };
  return { client: client as unknown as import("../src/server/ig/client").IgClient, state };
}

async function main() {
  const { db, tables, newId, nowIso } = await import("../src/server/db");
  const { migrate } = await import("../src/server/db/test-migrate");
  const { runSync } = await import("../src/server/services/sync-engine");
  migrate();

  async function seedChannels(): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < CHANNELS; i++) {
      const id = newId();
      await db.insert(tables.channels).values({
        id,
        platform: "instagram",
        handle: `@bench-${newId().slice(0, 6)}`,
        isVerified: false,
        isPrivate: false,
        trackedSince: nowIso(),
      });
      ids.push(id);
    }
    return ids;
  }

  async function one(mode: "independent" | "serialized", concurrency: number) {
    const channelIds = await seedChannels();
    const { client, state } = buildClient(mode);
    const started = performance.now();
    await runSync({ channelIds, client, concurrency, sleep: () => Promise.resolve() });
    const ms = performance.now() - started;
    return { ms, requests: state.requests };
  }

  const rows: { model: string; c1: number; c2: number; reqs: number }[] = [];
  for (const mode of ["independent", "serialized"] as const) {
    const a = await one(mode, 1);
    const b = await one(mode, 2);
    rows.push({ model: mode, c1: a.ms, c2: b.ms, reqs: a.requests });
    // requests must match across concurrency: same work, only the pacing differs.
    if (a.requests !== b.requests) {
      console.error(`request count differs for ${mode}: ${a.requests} vs ${b.requests}`);
    }
  }

  console.log(`\nSYNC_CONCURRENCY benchmark: ${CHANNELS} channels, ${ITEMS_PER_CHANNEL} items each, ${IG_LATENCY_MS}ms per Instagram call\n`);
  console.log("model         concurrency=1   concurrency=2    speedup   IG requests");
  for (const r of rows) {
    const speedup = (r.c1 / r.c2).toFixed(2);
    console.log(
      `${r.model.padEnd(12)}  ${(r.c1.toFixed(0) + "ms").padStart(12)}  ${(r.c2.toFixed(0) + "ms").padStart(13)}  ${(speedup + "x").padStart(8)}  ${String(r.reqs).padStart(12)}`,
    );
  }
  console.log(
    "\nserialized is the real single-session sidecar; independent is the upper bound if the\nsidecar could serve channels in parallel. Request counts are identical across\nconcurrency, so the work is the same and only the wall clock differs.\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
