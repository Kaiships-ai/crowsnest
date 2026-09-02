# Crowsnest Phase 2A — Data Pipeline Implementation Plan

> **⚠️ Historical record.** The Apify/HikerAPI provider chain described here was removed on 2026-07-26 and replaced by a local `instagrapi` sidecar. See `docs/design/instagram-sync-brief.md`. Kept unedited as the record of what was built at the time.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real data in: `SocialProvider` implementations (Apify primary, HikerAPI fallback, yt-dlp manual import), transcript pipeline (whisper.cpp local, Groq fallback), and the sync engine that upserts channels/videos, writes snapshots, recomputes outlier scores, and records gaps.

**Architecture:** Everything lives under `src/server/**` (services framework-free, Vitest-tested with fake providers/fixtures; server actions are thin wrappers). Interfaces copied verbatim from `docs/research/DATA.md` §3. Sync strategy implements `DATA.md` §5. Outlier math already exists (`src/server/services/outlier-calc.ts` from phase 1) — consume it, do not reimplement.

**Tech Stack:** apify-client · native `fetch` (HikerAPI, Groq) · `yt-dlp` + `whisper-cli` external binaries via `node:child_process` execFile · Drizzle/SQLite from phase 1.

## Global Constraints

- **File zone (parallel-safety):** this plan may create/modify ONLY `src/server/providers/**`, `src/server/transcribe/**`, `src/server/services/**`, `src/server/actions/**`, `src/server/lib/**`, `tests/fixtures/**`, and the README env-var table. NEVER touch `src/app/**`, `src/components/**`, or `src/server/queries/**` — phase 2B owns those and runs in parallel.
- Shell PATH: node lives at `/Users/kienbeovl/.local/bin`. Start every bash block with `export PATH="/Users/kienbeovl/.local/bin:/opt/homebrew/bin:$PATH"`.
- Interfaces from `docs/research/DATA.md` §3 (`SocialProvider`, `ProfileStats`, `VideoStats`, `ProviderCapabilities`, `TranscriptProvider`, `Platform`) are copied **verbatim** into `src/server/providers/types.ts` — field names are contract for phase 2B/3.
- **Canonical handle format (phase-1 final-review I1):** handles are `@`-prefixed EVERYWHERE in DB rows, `ProfileStats.handle`, `VideoStats`, and `channelHandle` — matching DATA.md §3's `handle // @username` and the seeded rows. Strip `@` ONLY when building outbound provider requests (Apify input, HikerAPI query, yt-dlp nothing). `addChannel`/`importReelByUrl` normalize any user input to `@`-prefixed before lookup/insert — the `channels_platform_handle` unique index is raw text, so a bare-handle insert would silently duplicate a seeded channel.
- Keyless mode always works: with zero env keys, sync reports a clear "no provider configured" gap (never throws), yt-dlp manual import + local whisper still function.
- No live API calls in tests. Providers/binaries are faked; mappers tested against committed fixtures.
- Timestamps ISO-8601 UTC strings. TS strict, no `any`.
- Secrets only via env (`APIFY_TOKEN`, `HIKERAPI_KEY`, `GROQ_API_KEY`); never logged, never committed.
- Every task: `npm run build && npm test` green, then commit (conventional message + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).

---

### Task 1: Provider types + registry

**Files:**
- Create: `src/server/providers/types.ts`, `src/server/providers/registry.ts`, `src/server/providers/registry.test.ts`

**Interfaces:**
- Produces: `types.ts` = DATA.md §3 verbatim (all exports). Registry:

```ts
export function getProviderChain(env?: NodeJS.ProcessEnv): SocialProvider[]  // [apify?, hikerapi?] by key presence, in that order
export function registerProvider(p: SocialProvider): void                    // used by Tasks 2 & 4 at module init; test seam
export function clearProviders(): void                                       // test-only reset
```

- [ ] **Step 1:** Copy `docs/research/DATA.md` §3 code block verbatim into `src/server/providers/types.ts` (both interfaces + all supporting types; keep the comments).
- [ ] **Step 2:** Failing tests in `registry.test.ts`: (a) chain empty when no keys in a passed-in fake env `{}`; (b) fake provider registered with name `"apify-apidojo"` appears in chain when env has `APIFY_TOKEN=x`; (c) order is apify before hikerapi when both keys present (register two fakes with those names); (d) `clearProviders` empties. Use minimal fake objects satisfying `SocialProvider` (capabilities stubbed, `getProfile`/`getRecentVideos` = `throw new Error("not used")`).
- [ ] **Step 3:** Run → FAIL (module missing). Implement `registry.ts`: module-level `Map<string, SocialProvider>`; `getProviderChain` filters registered providers: include `"apify-apidojo"` iff `env.APIFY_TOKEN`, `"hikerapi"` iff `env.HIKERAPI_KEY`, ordered [apify, hikerapi]; `env` defaults to `process.env`.
- [ ] **Step 4:** Run → PASS. Commit: `feat(providers): types (DATA.md contract) + registry with key-gated chain`.

### Task 2: Apify provider

**Files:**
- Create: `src/server/providers/apify.ts`, `src/server/providers/apify.test.ts`, `tests/fixtures/apify-profile.json`, `tests/fixtures/apify-reels.json`

**Interfaces:**
- Consumes: `types.ts`, `registry.ts` (self-registers on import).
- Produces: `export class ApifyProvider implements SocialProvider` (name `"apify-apidojo"`); pure mappers `mapApifyProfile(item: unknown): ProfileStats`, `mapApifyReel(item: unknown): VideoStats` (exported for tests).

- [ ] **Step 1:** `npm i apify-client`. Commit fixtures with the documented item shapes (field names per DATA.md sources; these are the contract until first live run):

`tests/fixtures/apify-profile.json`:
```json
[{ "username": "buildinpublic.daily", "fullName": "Build In Public Daily", "id": "17841400000000001", "followersCount": 342000, "followsCount": 512, "postsCount": 480, "biography": "Shipping daily.", "profilePicUrl": "https://example.com/avatar.jpg", "verified": false }]
```

`tests/fixtures/apify-reels.json`:
```json
[{ "id": "3538261234567890123", "shortCode": "DEMOAbc123x", "url": "https://www.instagram.com/reel/DEMOAbc123x/", "caption": "3 mistakes killing your first 1,000 followers", "timestamp": "2026-07-18T09:15:00.000Z", "videoDuration": 34.5, "displayUrl": "https://example.com/thumb.jpg", "videoUrl": "https://example.com/video.mp4", "videoViewCount": 2400000, "videoPlayCount": 2650000, "likesCount": 183000, "commentsCount": 4100, "ownerUsername": "buildinpublic.daily" }]
```

- [ ] **Step 2:** Failing mapper tests: profile fixture → `ProfileStats` (`handle: "@buildinpublic.daily"` — mappers ADD the `@` prefix per global canonical-handle constraint, `followerCount: 342000`, `platform: "instagram"`, `fetchedAt` is valid ISO); reel fixture → `VideoStats` (`id: "3538261234567890123"`, `viewCount: 2650000` — **rule: `videoPlayCount ?? videoViewCount ?? null`**, plays over views when both exist; `postedAt` ISO; `durationSec: 34.5`; `videoUrl` present). Edge tests: missing both count fields → `viewCount: null`; missing optional fields → undefined, no throw.
- [ ] **Step 3:** Run → FAIL. Implement: mappers as total functions over `unknown` (narrow via a small `pick` helper, no `any`); `ApifyProvider` with `capabilities = { supportsThirdPartyMedia: true, supportsPlayCounts: true, requiresAccountLogin: false, requiresAppReview: false, maxRecentVideos: 30, rateLimitPerHour: undefined }`; `getProfile(handle)` runs actor `process.env.APIFY_ACTOR_ID_IG_PROFILE ?? "apify/instagram-profile-scraper"` with input `{ usernames: [handle] }`; `getRecentVideos(handle, limit)` runs `process.env.APIFY_ACTOR_ID_IG_REEL ?? "apify/instagram-reel-scraper"` with `{ username: [handle], resultsLimit: limit }`; both via `ApifyClient({ token }).actor(id).call(input)` then `dataset(defaultDatasetId).listItems()`, mapped. Strip `@` from handles before sending. Self-register at module bottom.
- [ ] **Step 4:** Run → PASS. Commit: `feat(providers): apify provider + payload mappers`.

### Task 3: yt-dlp manual-import provider

**Files:**
- Create: `src/server/providers/ytdlp.ts`, `src/server/providers/ytdlp.test.ts`, `tests/fixtures/ytdlp-reel.json`, `src/server/lib/exec.ts`

**Interfaces:**
- Produces: `export async function fetchReelByUrl(url: string): Promise<VideoStats & { channelHandle: string }>`; `export async function detectBinary(bin: string): Promise<string | null>` (absolute path or null) in `exec.ts`, plus `export const execFileP` (promisified execFile with 120s timeout, maxBuffer 64MB). NOT part of the sync chain — single-URL import only.

- [ ] **Step 1:** Fixture `ytdlp-reel.json` (subset of `yt-dlp -J` output):
```json
{ "id": "DEMOAbc123x", "webpage_url": "https://www.instagram.com/reel/DEMOAbc123x/", "description": "3 mistakes killing your first 1,000 followers", "timestamp": 1752916500, "duration": 34, "thumbnail": "https://example.com/thumb.jpg", "url": "https://example.com/video.mp4", "view_count": 2400000, "like_count": 183000, "comment_count": 4100, "uploader_id": "buildinpublic.daily", "ext": "mp4" }
```
- [ ] **Step 2:** Failing tests: `mapYtdlpJson(fixture)` → `VideoStats` (`viewCount: 2400000`, `postedAt` = ISO from unix `timestamp`, `channelHandle: "@buildinpublic.daily"` — `@`-prefixed per canonical-handle constraint, platform `"instagram"`); `detectBinary("definitely-not-a-real-bin-xyz")` → null.
- [ ] **Step 3:** Implement: `exec.ts` (`detectBinary` via `command -v` through execFile `/bin/sh -c`; `execFileP`); `ytdlp.ts` exports `mapYtdlpJson` + `fetchReelByUrl` = `detectBinary("yt-dlp")` (error with install hint `brew install yt-dlp` if null) → `execFileP(bin, ["-J", "--no-warnings", url])` → parse → map.
- [ ] **Step 4:** PASS → commit: `feat(providers): yt-dlp single-URL import + exec helpers`.

### Task 4: HikerAPI fallback provider

**Files:**
- Create: `src/server/providers/hikerapi.ts`, `src/server/providers/hikerapi.test.ts`, `tests/fixtures/hikerapi-user.json`, `tests/fixtures/hikerapi-clips.json`

**Interfaces:**
- Consumes: `types.ts`, `registry.ts` (self-registers as `"hikerapi"`).
- Produces: `HikerProvider implements SocialProvider`; mappers `mapHikerUser`, `mapHikerClip` exported.

- [ ] **Step 1:** Fixtures — `hikerapi-user.json`: `{ "user": { "pk": "1400000001", "username": "buildinpublic.daily", "full_name": "Build In Public Daily", "follower_count": 342000, "following_count": 512, "media_count": 480, "biography": "Shipping daily.", "profile_pic_url": "https://example.com/avatar.jpg", "is_verified": false } }`. `hikerapi-clips.json`: `{ "response": { "items": [{ "pk": "3538261234567890123", "code": "DEMOAbc123x", "caption_text": "3 mistakes killing your first 1,000 followers", "taken_at": 1752916500, "play_count": 2650000, "view_count": 2400000, "like_count": 183000, "comment_count": 4100, "video_duration": 34.5, "thumbnail_url": "https://example.com/thumb.jpg", "video_url": "https://example.com/video.mp4" }] } }`
- [ ] **Step 2:** Failing mapper tests mirroring Task 2's (same `play_count ?? view_count ?? null` precedence; `taken_at` unix → ISO; permalink built as `https://www.instagram.com/reel/<code>/`).
- [ ] **Step 3:** Implement: `fetch` GET `https://api.hikerapi.com/v2/user/by/username?username=<h>` and `https://api.hikerapi.com/v2/user/clips?user_id=<pk>&amount=<limit>` (resolve pk via the user call, one extra request) with header `x-access-key: env.HIKERAPI_KEY`; non-2xx → throw `HikerApiError(status, bodySnippet)`. Capabilities same as Apify except `maxRecentVideos: 50`. Self-register.
- [ ] **Step 4:** PASS → commit: `feat(providers): hikerapi fallback provider`.

### Task 5: Transcript pipeline

**Files:**
- Create: `src/server/transcribe/types.ts` (re-export `TranscriptProvider` from providers types), `src/server/transcribe/whispercpp.ts`, `src/server/transcribe/groq.ts`, `src/server/transcribe/index.ts`, tests for each (`*.test.ts`), `tests/fixtures/whisper-output.json`

**Interfaces:**
- Consumes: `exec.ts` from Task 3; `db` + `transcripts` table (phase 1).
- Produces (phase 3 depends on this):

```ts
// src/server/transcribe/index.ts
export async function getOrCreateTranscript(videoId: string): Promise<{ text: string; source: string; cached: boolean }>
export function availableTranscriptProviders(): { name: string; available: boolean; reason?: string }[]
```

- [ ] **Step 1:** Fixture `whisper-output.json`: `{ "transcription": [{ "offsets": { "from": 0, "to": 3400 }, "text": " Stop scrolling if you post reels." }, { "offsets": { "from": 3400, "to": 8200 }, "text": " Here are three mistakes killing your growth." }] }` — the `whisper-cli --output-json` shape.
- [ ] **Step 2:** Failing tests: whispercpp `parseWhisperJson(fixture)` → joined trimmed text + `durationSec: 8.2`; groq provider builds correct request (assert via injected fake `fetch`: URL `https://api.groq.com/openai/v1/audio/transcriptions`, header `Authorization: Bearer <key>`, multipart contains `model=whisper-large-v3-turbo`) and maps `{ "text": "..." }` response; `getOrCreateTranscript` returns cached row without calling any provider when `transcripts` has the videoId (in-memory DB seeded directly in test).
- [ ] **Step 3:** Implement. `whispercpp.ts`: available iff `detectBinary(env.WHISPER_CPP_BIN_PATH ?? "whisper-cli")` and model file exists (`env.WHISPER_MODEL_PATH ?? ~/.cache/whisper/ggml-large-v3-turbo.bin`); `transcribe(path)`: if input is a URL, download first via yt-dlp to `data/tmp/<videoId>.mp4`; extract audio not needed (whisper-cli accepts mp4 when built with ffmpeg — if the run fails, fall back to `ffmpeg -i in.mp4 -ar 16000 -ac 1 out.wav` then retry; ffmpeg missing → unavailable with reason). `groq.ts`: fetch multipart with file stream. `index.ts`: cache check → whisper local → groq → throw `NoTranscriptProviderError` with per-provider reasons; on success upsert `transcripts` row (`source: "whisper-local" | "groq"`), delete tmp file in `finally`.
- [ ] **Step 4:** PASS → commit: `feat(transcribe): local whisper.cpp + groq fallback + cache`.

### Task 6: Sync engine

**Files:**
- Create: `src/server/services/sync-engine.ts`, `src/server/services/sync-engine.test.ts`

**Interfaces:**
- Consumes: `getProviderChain`, `scoreVideos`/`computeChannelMedian` (phase 1), db tables.
- Produces (2B sidebar/Channels + phase 3 depend on):

```ts
export interface SyncResult { jobId: string; channelsSynced: number; videosUpserted: number; gaps: { channelId: string; provider: string; error: string }[] }
export async function runSync(opts?: { channelIds?: string[]; providers?: SocialProvider[] }): Promise<SyncResult>
export async function addChannel(input: { handle: string; platform: Platform }): Promise<{ channelId: string }>
export async function importReelByUrl(url: string): Promise<{ videoId: string; channelId: string }>
```

- [ ] **Step 1:** Failing tests (fake providers passed via `opts.providers`; in-memory DB): 
  - happy path: 2 channels, fake returns profile + 25 videos each → channels updated (followerCount, lastSyncedAt), 50 videos upserted, every video has recomputed `outlierScore`, one `channel_snapshots` + N `video_snapshots` rows written, `sync_jobs` row `status: "success"` with stats `{channels: 2, videos: 50}`
  - re-run with changed viewCounts → same video rows updated (no duplicates; `videos_platform_external` respected), scores recomputed
  - fallback: provider A throws for channel 1, provider B succeeds → no gap, channel synced; both throw → gap recorded `{channelId, provider: "hikerapi", error}`, other channel still syncs, job `status: "partial"`
  - empty chain → every channel gapped with `error: "no provider configured"`, job `"partial"`, no throw
  - `addChannel` with fake chain → inserts channel with profile data; duplicate handle+platform → returns existing id
  - `importReelByUrl` (inject fake fetchReelByUrl via parameter default) → creates channel stub (`syncError: null`, minimal fields) if handle unknown + inserts video with score recomputed
- [ ] **Step 2:** Run → FAIL. Implement per `DATA.md` §5: profiles first then videos; concurrency pool of 3 channels (simple worker loop over a shared queue — no p-limit dep); per-request 300–800ms jitter `await sleep(300 + rand*500)` (inject `sleep` for tests); on provider error try next in chain; retry same provider once on `429`/`5xx`-ish errors with 2s backoff before falling through; upsert videos on `(platform, externalId)`; after each channel: recompute scores for that channel's full video set via `scoreVideos`, write `videos.outlierScore`, one `channel_snapshots` row (followerCount + medianViews), `video_snapshots` for every touched video; finalize `sync_jobs` (`success` | `partial` when gaps | `failed` when thrown before any channel).
- [ ] **Step 3:** PASS → commit: `feat(sync): engine with fallback chain, upserts, snapshots, score recompute`.

### Task 7: Server actions + env docs

**Files:**
- Create: `src/server/actions/sync-actions.ts`
- Modify: `README.md` (env table rows only)

**Interfaces:**
- Produces (2B imports these): `"use server"` exports `syncAllAction()`, `syncChannelAction(channelId: string)`, `addChannelAction(handle: string, platform: Platform)`, `importReelAction(url: string)`, `getLatestSyncJob()` — each returns plain serializable objects `{ ok: true, ... } | { ok: false, error: string }`; no throws across the boundary.

- [ ] **Step 1:** Implement the five wrappers (try/catch → error string; call through to Task 6 exports; `getLatestSyncJob` = newest `sync_jobs` row or null).
- [ ] **Step 2:** Vitest: actions are thin — one test that `syncAllAction` returns `{ ok: false, error }` (not a throw) when engine throws (inject by temporarily passing empty provider chain scenario is enough: expect `ok: true` with gaps — plus a forced-throw path via invalid `channelIds` input guard). Keep it to 2 assertions; the engine itself is already covered.
- [ ] **Step 3:** README env table: add `APIFY_TOKEN`, `APIFY_ACTOR_ID_IG_PROFILE`, `APIFY_ACTOR_ID_IG_REEL`, `HIKERAPI_KEY`, `GROQ_API_KEY`, `WHISPER_CPP_BIN_PATH`, `WHISPER_MODEL_PATH` (+ one line: `brew install yt-dlp whisper-cpp` for keyless local mode).
- [ ] **Step 4:** Full gate `npm run build && npm test` → green. Commit: `feat(sync): server actions + env documentation`.
