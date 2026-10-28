// SocialProvider.ts
// Legacy shared types for data acquisition. The vendor-chain abstraction this file was
// built around is gone: Instagram data now comes from one place, the instagrapi sidecar
// (src/server/ig/*), which has its own richer contract including carousels and raw
// payloads.
//
// What survives here is the small shape `providers/ytdlp.ts` still speaks — the keyless
// "paste a reel URL" import, which was never part of the sync chain. `Platform` also
// remains the canonical union for the `platform` column.

export type Platform = "instagram" | "tiktok" | "youtube_shorts";

export interface ProfileStats {
  platform: Platform;
  handle: string;              // @username, the stable lookup key
  externalId?: string;         // platform-native id, if the provider exposes one
  displayName?: string;
  followerCount: number;
  followingCount?: number;
  mediaCount?: number;
  bio?: string;
  avatarUrl?: string;
  isVerified?: boolean;
  fetchedAt: string;           // ISO timestamp — freshness matters for the median calc
}

export interface VideoStats {
  platform: Platform;
  id: string;                  // platform-native media id / shortcode
  url: string;                 // permalink
  caption?: string;
  postedAt: string;            // ISO timestamp
  durationSec?: number;
  thumbnailUrl?: string;
  videoUrl?: string;           // direct mp4 if the provider supplies one (needed for local Whisper)
  viewCount: number | null;    // REQUIRED for outlier math; null = provider couldn't get it
  likeCount?: number | null;
  commentCount?: number | null;
  shareCount?: number | null;
  transcript?: string | null;  // filled in later by a TranscriptProvider, not here
}

export interface ProviderCapabilities {
  /** Can this provider return another creator's media at all? */
  supportsThirdPartyMedia: boolean;
  /** Does viewCount ever get populated for third-party media? The make-or-break flag. */
  supportsPlayCounts: boolean;
  /** Requires holding a logged-in end-user IG session (personal ban-risk surface) */
  requiresAccountLogin: boolean;
  /** Needs Meta App Review / Business Verification before use */
  requiresAppReview: boolean;
  maxRecentVideos: number | null;  // provider-side cap on "recent media" lookback
  rateLimitPerHour?: number;
}

export interface SocialProvider {
  readonly name: string;             // "yt-dlp"
  readonly capabilities: ProviderCapabilities;

  getProfile(handle: string): Promise<ProfileStats>;

  /** Latest N videos/reels for a public creator, newest first. */
  getRecentVideos(handle: string, limit: number): Promise<VideoStats[]>;

  /** Cheap re-check of view/like/comment counts for already-known media ids,
   *  without re-crawling the whole recent-media list. Optional — not every
   *  provider supports a targeted refresh. */
  refreshVideoStats?(
    ids: string[]
  ): Promise<Pick<VideoStats, "id" | "viewCount" | "likeCount" | "commentCount">[]>;
}

// Transcripts are a separate concern from data acquisition, kept as its own interface.
export interface TranscriptProvider {
  readonly name: string;   // "whisper-cpp-local"
  transcribe(videoUrlOrPath: string): Promise<{
    text: string;
    language?: string;
    durationSec: number;
  }>;
}
