import { registerProvider } from "./registry";
import type { ProfileStats, ProviderCapabilities, SocialProvider, VideoStats } from "./types";

const USER_BY_USERNAME_URL = "https://api.hikerapi.com/v2/user/by/username";
const USER_CLIPS_URL = "https://api.hikerapi.com/v2/user/clips";

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
function unixToIso(v: unknown): string {
  return typeof v === "number" ? new Date(v * 1000).toISOString() : new Date(0).toISOString();
}

/** Thrown when a HikerAPI request returns a non-2xx status. */
export class HikerApiError extends Error {
  readonly status: number;
  constructor(status: number, bodySnippet: string) {
    super(`hikerapi: HTTP ${status} - ${bodySnippet}`);
    this.name = "HikerApiError";
    this.status = status;
  }
}

async function hikerFetch(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "x-access-key": process.env.HIKERAPI_KEY ?? "" } });
  if (!res.ok) {
    const bodySnippet = (await res.text().catch(() => "")).slice(0, 200);
    throw new HikerApiError(res.status, bodySnippet);
  }
  return res.json();
}

/** Maps one HikerAPI `user` object (the `.user` payload of `/v2/user/by/username`) to ProfileStats. */
export function mapHikerUser(item: unknown): ProfileStats {
  const r = asRecord(item);
  const username = str(r.username) ?? "";
  return {
    platform: "instagram",
    handle: `@${username}`,
    externalId: str(r.pk),
    displayName: str(r.full_name),
    followerCount: num(r.follower_count) ?? 0,
    followingCount: num(r.following_count),
    mediaCount: num(r.media_count),
    bio: str(r.biography),
    avatarUrl: str(r.profile_pic_url),
    isVerified: bool(r.is_verified),
    fetchedAt: new Date().toISOString(),
  };
}

/** Maps one HikerAPI clip item (one entry of `/v2/user/clips` `.response.items[]`) to VideoStats. */
export function mapHikerClip(item: unknown): VideoStats {
  const r = asRecord(item);
  const code = str(r.code);
  // plays over views when both exist — same precedence rule as the Apify mapper.
  const viewCount = num(r.play_count) ?? num(r.view_count) ?? null;
  return {
    platform: "instagram",
    id: str(r.pk) ?? code ?? "",
    url: code ? `https://www.instagram.com/reel/${code}/` : "",
    caption: str(r.caption_text),
    postedAt: unixToIso(r.taken_at),
    durationSec: num(r.video_duration),
    thumbnailUrl: str(r.thumbnail_url),
    videoUrl: str(r.video_url),
    viewCount,
    likeCount: num(r.like_count),
    commentCount: num(r.comment_count),
  };
}

export class HikerProvider implements SocialProvider {
  readonly name = "hikerapi";
  readonly capabilities: ProviderCapabilities = {
    supportsThirdPartyMedia: true,
    supportsPlayCounts: true,
    requiresAccountLogin: false,
    requiresAppReview: false,
    maxRecentVideos: 50,
    rateLimitPerHour: undefined,
  };

  async getProfile(handle: string): Promise<ProfileStats> {
    const username = stripAt(handle);
    const data = asRecord(await hikerFetch(`${USER_BY_USERNAME_URL}?username=${encodeURIComponent(username)}`));
    if (!data.user) throw new Error(`hikerapi: no profile data returned for ${handle}`);
    return mapHikerUser(data.user);
  }

  async getRecentVideos(handle: string, limit: number): Promise<VideoStats[]> {
    // Resolve pk via the user call first — the clips endpoint is keyed by user_id, not
    // username — one extra request per channel, same as the plan describes.
    const username = stripAt(handle);
    const profileData = asRecord(await hikerFetch(`${USER_BY_USERNAME_URL}?username=${encodeURIComponent(username)}`));
    const user = asRecord(profileData.user);
    const pk = str(user.pk);
    if (!pk) throw new Error(`hikerapi: could not resolve pk for ${handle}`);

    const clipsData = asRecord(await hikerFetch(`${USER_CLIPS_URL}?user_id=${encodeURIComponent(pk)}&amount=${limit}`));
    const response = asRecord(clipsData.response);
    const items = Array.isArray(response.items) ? response.items : [];
    return items.map(mapHikerClip);
  }
}

registerProvider(new HikerProvider());
