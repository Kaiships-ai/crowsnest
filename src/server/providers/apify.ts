import { ApifyClient } from "apify-client";
import { registerProvider } from "./registry";
import type { ProfileStats, ProviderCapabilities, SocialProvider, VideoStats } from "./types";

const DEFAULT_PROFILE_ACTOR = "apify/instagram-profile-scraper";
const DEFAULT_REEL_ACTOR = "apify/instagram-reel-scraper";

function stripAt(handle: string): string {
  return handle.startsWith("@") ? handle.slice(1) : handle;
}

// ---- unknown-narrowing helpers (no `any`, total — never throw on odd payloads) ----
function asRecord(item: unknown): Record<string, unknown> {
  return typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** Maps one apify/instagram-profile-scraper (or apidojo equivalent) dataset item to ProfileStats. */
export function mapApifyProfile(item: unknown): ProfileStats {
  const r = asRecord(item);
  const username = str(r.username) ?? "";
  return {
    platform: "instagram",
    handle: `@${username}`,
    externalId: str(r.id),
    displayName: str(r.fullName),
    followerCount: num(r.followersCount) ?? 0,
    followingCount: num(r.followsCount),
    mediaCount: num(r.postsCount),
    bio: str(r.biography),
    avatarUrl: str(r.profilePicUrl),
    isVerified: bool(r.verified),
    fetchedAt: new Date().toISOString(),
  };
}

/** Maps one apify/instagram-reel-scraper (or apidojo equivalent) dataset item to VideoStats. */
export function mapApifyReel(item: unknown): VideoStats {
  const r = asRecord(item);
  const shortCode = str(r.shortCode);
  // plays over views when both exist — plays reflect autoplay/loop replays IG surfaces
  // most prominently and is the closer analog to "view" on other short-form platforms.
  const viewCount = num(r.videoPlayCount) ?? num(r.videoViewCount) ?? null;
  return {
    platform: "instagram",
    id: str(r.id) ?? shortCode ?? "",
    url: str(r.url) ?? (shortCode ? `https://www.instagram.com/reel/${shortCode}/` : ""),
    caption: str(r.caption),
    postedAt: str(r.timestamp) ?? new Date(0).toISOString(),
    durationSec: num(r.videoDuration),
    thumbnailUrl: str(r.displayUrl),
    videoUrl: str(r.videoUrl),
    viewCount,
    likeCount: num(r.likesCount),
    commentCount: num(r.commentsCount),
  };
}

export class ApifyProvider implements SocialProvider {
  readonly name = "apify-apidojo";
  readonly capabilities: ProviderCapabilities = {
    supportsThirdPartyMedia: true,
    supportsPlayCounts: true,
    requiresAccountLogin: false,
    requiresAppReview: false,
    maxRecentVideos: 30,
    rateLimitPerHour: undefined,
  };

  private client(): ApifyClient {
    return new ApifyClient({ token: process.env.APIFY_TOKEN });
  }

  async getProfile(handle: string): Promise<ProfileStats> {
    const actorId = process.env.APIFY_ACTOR_ID_IG_PROFILE ?? DEFAULT_PROFILE_ACTOR;
    const client = this.client();
    const run = await client.actor(actorId).call({ usernames: [stripAt(handle)] });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const first = items[0];
    if (!first) throw new Error(`apify: no profile data returned for ${handle}`);
    return mapApifyProfile(first);
  }

  async getRecentVideos(handle: string, limit: number): Promise<VideoStats[]> {
    const actorId = process.env.APIFY_ACTOR_ID_IG_REEL ?? DEFAULT_REEL_ACTOR;
    const client = this.client();
    const run = await client.actor(actorId).call({ username: [stripAt(handle)], resultsLimit: limit });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    return items.map(mapApifyReel);
  }
}

registerProvider(new ApifyProvider());
