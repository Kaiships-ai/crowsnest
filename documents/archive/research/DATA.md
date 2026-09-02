# Instagram Data Acquisition — Research & Recommendation (2026)

> ## ⚠️ SUPERSEDED 2026-07-26 — historical record, not current architecture
>
> This document recommended a **paid-vendor** route (Apify primary, HikerAPI fallback)
> and explicitly rejected self-hosted `instagrapi` on ban-risk grounds. That
> recommendation has been **reversed by direction**: Crowsnest now acquires Instagram
> data exclusively through `instagrapi`, running in a local Python sidecar
> (`services/ig/`), with no paid scraping vendor anywhere in the stack.
>
> The ban-risk analysis below was not wrong and has not been refuted — the risk is now
> **accepted and disclosed** rather than outsourced to a vendor. See:
> - `docs/design/instagram-sync-brief.md` — the approved replacement design
> - `README.md` → "Instagram access: read this before connecting an account"
> - `services/ig/README.md` — operational detail and recovery procedures
>
> Everything below is kept as the reasoning trail for *why* the vendor route was chosen
> first. Its cost figures, actor IDs and provider comparisons no longer describe the
> running system.

Research for: personal-use IG outlier/remix tool. Scale: ~50 tracked public creator
accounts, weekly sync, latest ~30 reels/channel + profile stats. Hard requirement:
**per-reel play/view counts for OTHER people's accounts** — outlier score = views ÷
channel median views. No view counts, no product.

> **Headline finding:** the one channel that is fully sanctioned by Meta — the official
> Graph API's Business Discovery endpoint — **cannot give you this**. It returns
> `like_count` and `comments_count` for another creator's media, but video view/play
> counts and all `/insights` metrics are restricted to the token owner's own linked
> account, not accounts you're merely "discovering." That disqualifies it as a
> standalone solution regardless of how much app-review effort you put in. Everything
> below assumes that constraint.

---

## 1. Comparison table

Scale used for cost math: 50 profiles + 50×30=1,500 reel-reads per week ≈ **6,700
billable items/month** (profiles refreshed weekly too, since follower counts feed the
product).

| Method | Profile stats | Reels list (30/ch) | 3rd-party play/view counts | Cost at our scale | Reliability | Ban/ToS risk | Setup friction |
|---|---|---|---|---|---|---|---|
| **Official Graph API — Business Discovery** | ✅ followers, bio, media_count | ✅ recent media, paginated | ❌ **Not available** — `view_count`/`play_count`/insights are owner-account-only, not exposed via `business_discovery` for other users' media [[1]](#sources)[[2]](#sources) | Free API, but see friction | High when in-scope (Meta SLA, 200 calls/user/hour) [[3]](#sources) | **Lowest** — fully sanctioned | **Very high**: Business Verification + App Review (2–6 weeks), Live-mode app, target must be Business/Creator account [[4]](#sources)[[5]](#sources) |
| **Apify actors** (apidojo / apify Instagram Scraper, Reel Scraper, Profile Scraper) | ✅ | ✅ | ✅ `videoViewCount` / `videoPlayCount` fields confirmed on reel actor [[6]](#sources) | **~$5–17/mo** ($5/mo free credit + $1.00–2.60/1,000 results depending on actor & your Apify plan tier) [[7]](#sources)[[8]](#sources)[[9]](#sources) | Good — actively-updated marketplace actors, but individual actors do break when IG changes markup and wait on maintainer patches | Medium — scraping infra/proxies absorb ToS exposure; **no personal IG login required** | **Low** — sign up, grab API token, pick an actor |
| **HikerAPI** (hosted, built on the instagrapi/aiograpi codebase, same author) | ✅ | ✅ | ✅ | Pay-per-request, **$0.02 → $0.0006/request** as prepaid balance tier rises (rate locks in permanently once unlocked); at our volume expect roughly **$10–30/mo** until you've built up balance history — exact tier thresholds weren't fully published, confirm at signup [[10]](#sources)[[11]](#sources) | Good — commercial SLA, purpose-built for this exact use case | Medium — same bucket as Apify, no personal account exposure | **Low** — API key only |
| **ScrapeCreators** | ✅ | ✅ | ✅ (claimed; field-level docs thinner than HikerAPI's) | **$0 (100 free credits) → $47/25k ($1.88/1k) → $497/500k ($0.99/1k)**; credits **never expire** [[12]](#sources)[[13]](#sources) | Decent, less granular public documentation of exact IG fields than HikerAPI/Apify | Medium — same bucket | **Low** — API key only |
| **RapidAPI Instagram wrappers** (marketplace of many small unofficial APIs) | ⚠️ varies by listing | ⚠️ varies | ⚠️ inconsistent — some listings expose it, quality/schema varies wildly | $0.10–$1/1,000 on cheap listings; free tiers as small as 30 req/month [[14]](#sources) | **Low** — dozens of competing unofficial wrappers, no SLA, breaks unpredictably when IG changes anything, "not endorsed by Meta" [[14]](#sources) | Medium | Low, but must shop/vet each listing individually |
| **instagrapi / aiograpi self-hosted** (Python, log into a real/burner IG account) | ✅ | ✅ | ✅ | Library free; real cost is residential proxy (~$/GB) + your engineering time for session/device/challenge handling | Fragile in production — private-API emulation breaks on IG app changes; maintainers explicitly recommend a hosted provider (HikerAPI) over self-hosting for production [[15]](#sources) | **Highest** — the account you log in with can be flagged, challenged, or permanently banned; confirmed real risk even behind paid proxies [[16]](#sources)[[17]](#sources) | **High** — session/device-id persistence, proxy plumbing, challenge_required flows, IP hygiene |
| **yt-dlp manual/keyless** (paste a reel/profile URL) | ⚠️ no clean "profile stats" object; bulk `/username/reels` listing currently flagged unstable in yt-dlp itself [[18]](#sources) | ⚠️ works per single reel URL; bulk listing unreliable | ✅ `view_count` extracted per single reel via `video_view_count` field mapping [[19]](#sources) | **Free** | Medium — actively maintained (daily-ish releases), but Instagram-specific extraction breaks often; community patches fast [[20]](#sources) | **Lowest practical risk** — keyless, no sustained crawling, looks like a normal video download | **Very low** — `pip install yt-dlp`, paste URL |

---

## 2. Recommendation

**Primary: Apify** (start with `apidojo`'s Instagram Scraper + Reel Scraper + Profile
Scraper actors, or the official `apify/instagram-reel-scraper` / `instagram-profile-scraper`).
Reasons: only option that (a) actually returns third-party play counts, (b) needs no
personal IG login so there's no personal-account ban risk, (c) has a real free tier
that covers a meaningful slice of our volume, (d) setup is an API token, not a 6-week
Meta review, and (e) the actor also hands back a downloadable mp4 URL, which we reuse
for local Whisper transcription instead of paying for a separate transcript scraper.

**Fallback: HikerAPI.** Same technology class as self-hosted instagrapi (same author,
literally sells it as a hosted service) but without the personal-account risk or
proxy/session engineering. Use it when a specific Apify actor breaks, rate-limits, or
returns bad data for a channel this week — swap providers per-channel without changing
the app's data model (see `SocialProvider` below). ScrapeCreators is an equally valid
alternate-fallback and its non-expiring credits are nicer for irregular usage, though
our workload is steady weekly volume so that advantage doesn't matter much here.

**Manual escape hatch: yt-dlp,** keyless, for one-off "check this specific reel right
now" without waiting for the weekly batch, or as a spot-check when a provider's number
looks wrong.

**Not recommended:**
- Official Graph API alone — fails the hard requirement (no 3rd-party view counts).
- Self-hosted instagrapi/aiograpi with a real logged-in account — for a personal tool
  at this scale, the ban risk and engineering overhead aren't worth it when HikerAPI
  sells the same underlying capability hosted, without that risk.
- RapidAPI marketplace wrappers — too inconsistent for a weekly-sync product; fine only
  for quick ad-hoc prototyping.

**Estimated monthly cost, all-in: ~$10–25/month** — Apify likely lands near its $5 free
credit most weeks (~$5–17/mo raw usage at our volume), plus small reserved headroom for
HikerAPI fallback calls on weeks something breaks. This is a rough estimate from public
per-unit pricing, not a quote — see gaps noted in the table.

---

## 3. `SocialProvider` interface sketch

```typescript
// SocialProvider.ts
// Common contract every data source (Apify, HikerAPI, ScrapeCreators, yt-dlp,
// a future TikTok/YouTube-Shorts provider) implements identically, so the sync
// job and outlier math never know which vendor answered.

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
  readonly name: string;             // "apify-apidojo" | "hikerapi" | "scrapecreators" | "yt-dlp" | ...
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

// Transcripts are a separate concern from data acquisition — kept as its own
// interface so "local whisper.cpp" and "hosted Groq" are interchangeable too.
export interface TranscriptProvider {
  readonly name: string;   // "whisper-cpp-local" | "groq-whisper"
  transcribe(videoUrlOrPath: string): Promise<{
    text: string;
    language?: string;
    durationSec: number;
  }>;
}
```

---

## 4. Env keys / config per option

| Provider | Env keys |
|---|---|
| Official Graph API | `IG_APP_ID`, `IG_APP_SECRET`, `IG_BUSINESS_ACCOUNT_ID`, `IG_ACCESS_TOKEN` (long-lived), `FB_PAGE_ID` |
| Apify | `APIFY_TOKEN`, `APIFY_ACTOR_ID_IG_REEL`, `APIFY_ACTOR_ID_IG_PROFILE`, (future: `APIFY_ACTOR_ID_TIKTOK`) |
| HikerAPI | `HIKERAPI_KEY` |
| ScrapeCreators | `SCRAPECREATORS_API_KEY` |
| RapidAPI wrappers | `RAPIDAPI_KEY`, `RAPIDAPI_HOST` (per listing) |
| instagrapi/aiograpi self-hosted | `IG_SESSION_USERNAME`, `IG_SESSION_PASSWORD` or `IG_SESSIONID`, `IG_PROXY_URL`, `IG_DEVICE_STATE_PATH` |
| yt-dlp | none required (keyless); optional `YTDLP_COOKIES_FILE` for private/edge cases |
| Whisper local | `WHISPER_MODEL` (e.g. `large-v3-turbo`), `WHISPER_CPP_BIN_PATH` |
| Groq (transcript fallback) | `GROQ_API_KEY` |

---

## 5. Sync + rate-limit strategy

1. **Cadence:** weekly cron (e.g., Sunday 03:00 local). Not per-hour — the product is a
   weekly digest, so there's no reason to hammer any provider daily.
2. **Order:** fetch all 50 profiles first (cheap, fast feedback if a handle got
   renamed/deleted/private), then fetch 30 reels per channel.
3. **Concurrency:** small pool (3–5 channels in flight), with jitter between requests
   and exponential backoff on 429/5xx — Apify runs are queued jobs so this mostly
   matters for HikerAPI/ScrapeCreators direct HTTP calls.
4. **Provider fallback chain per channel:** Apify → on failure/rate-limit/garbage data,
   retry that channel via HikerAPI this cycle → log a gap rather than blocking the
   whole sync on one broken channel. This is exactly why `SocialProvider` is an
   interface, not a hard dependency.
5. **Dedup/upsert:** key media by `(platform, externalId)`. Every weekly run re-reads
   the same latest-30 window and **upserts** view/like/comment counts (they keep
   climbing after publish — re-reading old reels is a feature, not waste), while new
   reels get inserted. Keep historical rows for trend lines even after a reel ages out
   of a channel's "latest 30."
6. **Caching:** cache raw provider responses for the day, so a manual re-run (e.g., "I
   added a new channel, sync just that one") doesn't re-burn a full week's Apify/HikerAPI
   budget. ScrapeCreators also gives cached lookups back at 0 credits, so this pairs
   well if it's ever used as primary.
7. **Median freshness:** compute each channel's outlier median from the same sync pass
   so scores never mix stale and fresh view-count reads.
8. **Backfill vs. delta:** onboarding a new channel does a full 30-reel pull; steady
   state just re-syncs the same rolling window.

---

## 6. Honest ToS-risk ranking — pick your tolerance

**Scraping Instagram outside its official, permissioned API is against Instagram's
Terms of Service, full stop**, regardless of which vendor or library does it on your
behalf. None of the commercial scrapers below are "authorized" by Meta — they're
tolerated-until-blocked, and Meta has a documented history of pursuing scrapers who
scale. Ranking from lowest to highest practical risk *to you personally*, for a
personal-use, modest-volume tool:

1. **Official Graph API (Business Discovery)** — zero ToS risk, fully sanctioned. (Doesn't
   meet the product's requirements on its own, hence not usable as-is.)
2. **yt-dlp keyless, low-volume, manual paste** — closest to "a person clicked save
   video." No login, no sustained automated crawl pattern, easiest to justify as
   personal use.
3. **Apify / HikerAPI / ScrapeCreators / RapidAPI (hosted 3rd-party scrapers)** — you
   never log into your own or a burner IG account, so there is no personal-account ban
   exposure. The ToS violation and infrastructure risk live with the vendor, who has
   built a business around absorbing it (proxies, IP rotation, patching). Practically
   the lowest-friction "medium" option; risk to *you* is closer to "vendor could shut
   down" than "you get banned."
4. **Self-hosted instagrapi/aiograpi with your own or a burner account** — **highest
   personal risk.** You are logging a real credentialed session into Instagram's
   private mobile API surface; the community's own maintainers report real,
   confirmed-in-production ban/challenge rates even behind paid residential proxies.
   If an account you care about is the one doing the scraping, don't use this path —
   use a fully disposable account if you insist on self-hosting at all.

Choose based on what you're actually risking: a personal tool with no logged-in IG
account (options 2–3) has no downside beyond "a vendor's API might go down." Logging
in your own account (option 4) puts that account itself on the line.

---

## 7. Transcripts

| Method | Verdict | Why |
|---|---|---|
| **Scraping IG's own captions/auto-subtitles** (via niche Apify "transcript extractor" actors) | ❌ Not recommended as primary | These are small, unverified indie Apify actors (e.g. `linen_snack`, `crawlerbros`, `bulletproof`) — added cost and fragility for something we can do ourselves once we already have the reel's mp4 from the Reel Scraper actor or yt-dlp. |
| **Local Whisper on Apple Silicon — `whisper.cpp` (Metal + Core ML)** | ✅ **Primary** | With Metal/Core ML acceleration, `large-v3-turbo` hits roughly **10–21× real-time** on an M2 Pro — a 60-second reel transcribes in **~3–6 seconds**, locally, for free [[21]](#sources)[[22]](#sources). |
| **Local Whisper — `faster-whisper`** | ⚠️ Skip on Mac | Has **no Metal support on Apple Silicon** — runs CPU-only, ~3× real-time for `large-v3`, meaningfully slower than whisper.cpp on the same hardware [[21]](#sources). Fine on Linux/NVIDIA, not the right pick here. |
| **Hosted — Groq Whisper API** (`whisper-large-v3-turbo`) | ✅ **Fallback** | Free tier: no credit card, rate-limited (~2,000 requests/day noted for Whisper specifically); paid is **$0.04/audio-hour**, claimed ~228× real-time on Groq's LPU hardware [[23]](#sources)[[24]](#sources). Use for batch backfill, or when running off Apple Silicon (e.g., a cloud box). |

**Recommendation:** transcribe on-demand from the mp4 URL Apify/yt-dlp already hands
back — no separate transcript-scraping product needed. Default to local `whisper.cpp`;
fall back to Groq when doing a large batch backfill or running somewhere without a
Mac GPU.

---

## 8. Extending to TikTok / YouTube Shorts later

The `SocialProvider` abstraction extends cleanly:

- **TikTok:** Apify has direct equivalents — `clockworks/tiktok-scraper` (~$1.70/1k,
  full metadata) and a cheaper `apidojo` TikTok scraper (~$0.30/1k) [[25]](#sources).
  ScrapeCreators/HikerAPI-style vendors also bundle TikTok under the same account and
  credit pool as Instagram, so the fallback-chain design doesn't change.
- **YouTube Shorts:** actually *easier* than Instagram — the **official, free YouTube
  Data API v3** returns public view counts for any video by ID with no
  business-discovery-style restriction on third-party content, so this platform may
  not need a scraper at all, just an official API key.
- Net: same interface, same fallback-chain pattern, just new `Platform` values and new
  actor/endpoint IDs — no architecture change required.

---

## Sources

1. [Instagram Graph API 2026: Dev Questions Meta's Docs Leave Open — Zernio](https://zernio.com/blog/instagram-graph-api)
2. [Business Discovery — Instagram Platform, Meta for Developers](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery/)
3. [Instagram API Rate Limits 2026: 200 Calls/Hour — Phyllo](https://www.getphyllo.com/post/instagram-api-rate-limits-explained----and-how-to-scale-beyond-them-2026)
4. [Instagram API Advanced Access Approval Guide (2026) — Singh Amandeep](https://singhamandeep.com/instagram-api-advanced-access-approval/)
5. [Overview of the Instagram API — Meta for Developers](https://developers.facebook.com/docs/instagram-platform/overview/)
6. [Instagram Reel Scraper (Latest) — Apify](https://apify.com/apify/instagram-reel-scraper)
7. [Apify pricing — plans for data collection at any scale](https://apify.com/pricing)
8. [🏯 Instagram Scraper (Pay Per Result) — Apify (apidojo)](https://apify.com/apidojo/instagram-scraper)
9. [Apify Free Tier Pricing 2026 — Use Apify](https://use-apify.com/docs/what-is-apify/apify-free-plan)
10. [Instagram API Pricing & Cost 2026: From $0.0006/Request — HikerAPI](https://hikerapi.com/pricing)
11. [HikerAPI vs Scrape Creators — HikerAPI](https://hikerapi.com/help/hikerapi-vs-scrape-creators)
12. [Is Scrape Creators Worth $10? I Tested It (2026) — FahimAI](https://www.fahimai.com/scrape-creators)
13. [Pay-As-You-Go Scraping APIs (No Monthly Minimum) — ScrapeCreators Blog](https://scrapecreators.com/blog/pay-as-you-go-scraping)
14. [Instagram APIs — RapidAPI marketplace](https://rapidapi.com/search/instagram)
15. [GitHub — subzeroid/instagrapi](https://github.com/subzeroid/instagrapi)
16. [Is There a Real Risk of Getting Banned When Using instagrapi? — GitHub Discussion #2224](https://github.com/subzeroid/instagrapi/discussions/2224)
17. [[BUG] instagram suspends the account even after paid proxy use — Issue #1806](https://github.com/subzeroid/instagrapi/issues/1806)
18. [[instagram:user:reels] Add support for `/{username}/reels` URLs — yt-dlp Issue #16257](https://github.com/yt-dlp/yt-dlp/issues/16257)
19. [yt_dlp/extractor/instagram.py — yt-dlp source](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/instagram.py)
20. [Release yt-dlp 2026.06.09](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.06.09)
21. [faster-whisper vs whisper.cpp vs OpenAI Whisper (2026) — Codersera](https://codersera.com/blog/faster-whisper-vs-whisper-cpp-speech-to-text-2026/)
22. [Whisper benchmark on Apple Silicon: M1 → M4 (2026 results) — JustVoice](https://justvoice.ai/blog/whisper-benchmark-apple-silicon-m3-m4)
23. [Groq API Free Tier Limits in 2026 — Grizzly Peak Software](https://www.grizzlypeaksoftware.com/articles/p/groq-api-free-tier-limits-in-2026-what-you-actually-get-uwysd6mb)
24. [Groq API Pricing 2026 — TokenMix](https://tokenmix.ai/blog/groq-api-pricing)
25. [Best TikTok Scrapers on Apify (2026) — Use Apify](https://use-apify.com/docs/best-apify-actors/best-tiktok-scrapers)

*Note on confidence: pricing and exact field availability changes fast in this space
(multiple sources above flag mid-2026 changes). Numbers here are best-effort from
public docs/pricing pages as of this research pass — re-verify exact tier thresholds
(especially HikerAPI's balance-unlock table and Apify per-actor rates) at signup before
committing to a budget.*
