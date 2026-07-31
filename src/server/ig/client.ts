import { config } from "../config";
import { log } from "../lib/logger";
import { fromEnvelope, IgError } from "./errors";

/**
 * HTTP client for the Python instagrapi sidecar (design brief §3).
 *
 * Why a sidecar at all: instagrapi is Python and its `Client` holds the authenticated
 * session, the pinned device profile and the cookie jar. A process-per-call design would
 * re-authenticate constantly, and a storm of logins is precisely what gets an Instagram
 * account challenged.
 *
 * Two rules this module exists to enforce:
 *  1. EVERY outbound call has a timeout. A hung sidecar must not hang a sync forever.
 *  2. A failure is never an empty result. Callers get a typed `IgError` and decide;
 *     nothing here returns `[]` on error.
 */

export interface IgProfile {
  handle: string;
  externalId: string;
  displayName: string | null;
  /**
   * Null means Instagram did not disclose it — NOT zero. This was `number`, and the
   * mapper manufactured a `0` to satisfy it, which is the only reason the fabrication
   * existed. Every consumer downstream (`channels.follower_count`,
   * `channel_snapshots.follower_count`, the feed's band filter) already models it
   * nullable, so the client was the lone layer insisting on a number it did not have.
   */
  followerCount: number | null;
  followingCount: number | null;
  mediaCount: number | null;
  bio: string | null;
  isVerified: boolean;
  isPrivate: boolean;
  avatarUrl: string | null; // consumed only by the download step, never sent to a browser
  raw: Record<string, unknown>;
}

export interface IgChild {
  position: number;
  externalId: string;
  mediaType: "photo" | "video";
  thumbnailUrl: string | null;
  videoUrl: string | null;
  raw: Record<string, unknown>;
}

export interface IgMedia {
  externalId: string;
  shortcode: string | null;
  mediaType: "photo" | "video" | "carousel";
  productType: string | null;
  url: string;
  caption: string | null;
  takenAt: string;
  durationSec: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  children: IgChild[];
  raw: Record<string, unknown>;
}

/**
 * What `/resolve-media` actually returns: currently-valid asset URLs for ONE media, and
 * nothing else. Deliberately NOT `IgMedia`.
 *
 * `IgMedia` is the type `upsertVideo` persists, and its `takenAt` maps to
 * `videos.posted_at`, which is NOT NULL. The resolve endpoint has no `taken_at` to give,
 * so borrowing `IgMedia` meant returning `takenAt: ""` and `url: ""` on a value the type
 * system would happily let someone hand to `upsertVideo` — writing `posted_at = ""`,
 * which sorts before every real date and quietly breaks the lookback boundary and every
 * date filter. Nothing does that today; a separate type means nothing can.
 */
export interface IgResolvedMedia {
  externalId: string;
  mediaType: IgMedia["mediaType"];
  thumbnailUrl: string | null;
  videoUrl: string | null;
  children: IgChild[];
  raw: Record<string, unknown>;
}

export interface IgMediasPage {
  items: IgMedia[];
  nextCursor: string | null;
  /** null means "this page ended for pagination reasons, keep going". */
  stopReason: "lookback" | "cap" | "exhausted" | null;
}

// ---------------------------------------------------------------- wire mapping
//
// The sidecar speaks snake_case and, for profiles, entirely different field names
// (`pk`/`username`/`full_name` rather than `externalId`/`handle`/`displayName`).
// Casting the JSON to the TypeScript interface — which is what this module did at
// first — compiles perfectly and produces `undefined` for every field at runtime.
// These mappers are the boundary where the wire format is actually converted, and
// where a missing REQUIRED field becomes a loud IG_DRIFT instead of a silent null.

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** For fields the sidecar declares with a default (`bool = False`), where absence really
 *  does mean false. Never use it for a field the contract makes mandatory. */
function bool(v: unknown): boolean {
  return v === true;
}

/**
 * A boolean the sidecar's contract makes mandatory (no default): absent is drift, not
 * false.
 *
 * This is the one coercion where degrading is genuinely undetectable downstream. A missing
 * `status` collapses to `"unknown"` and a missing `instagrapi_version` to `null` — both
 * implausible values that a caller can spot, and `ig-actions.ts` deliberately uses exactly
 * those two as its drift detectors. `logged_in` has no such tell: absent becomes a
 * perfectly ordinary `false`, so "the sidecar stopped sending this" and "the user is
 * signed out" arrive as the same value, and Settings tells the user to reconnect an
 * account that is connected fine.
 */
function requiredBool(payload: Record<string, unknown>, field: string, raw: unknown): boolean {
  const value = payload[field];
  if (typeof value !== "boolean") {
    throw new IgError("IG_DRIFT", `Instagram payload is missing required field "${field}"`, {
      detail: { field, payload: raw },
    });
  }
  return value;
}

/** Like `num`, but treats 0 as absent. Instagram uses 0 to mean "count withheld"
 *  on other creators' media, and a withheld count is not the same as zero views. */
function nonZero(v: unknown): number | null {
  const n = num(v);
  return n === null || n === 0 ? null : n;
}

function required(value: string | null, field: string, payload: unknown): string {
  if (value === null) {
    throw new IgError("IG_DRIFT", `Instagram payload is missing required field "${field}"`, {
      detail: { field, payload },
    });
  }
  return value;
}

/**
 * A count the sidecar's DTO declares as `int | None`: the KEY must be there, the value
 * may legitimately be null.
 *
 * The distinction matters and is why this is not just `required()`. FastAPI serialises
 * nulls explicitly (no `exclude_none` anywhere in `app.py`), so the key is always present
 * unless the contract itself changed — an absent key is real drift and says so. A present
 * null is the sidecar correctly reporting "Instagram didn't tell me", and turning that
 * into IG_DRIFT would fail the whole channel — profile failure means a gap, which means
 * zero posts synced — over a vanity metric.
 */
function optionalCount(payload: Record<string, unknown>, field: string, raw: unknown): number | null {
  if (!(field in payload)) {
    throw new IgError("IG_DRIFT", `Instagram payload is missing required field "${field}"`, {
      detail: { field, payload: raw },
    });
  }
  return num(payload[field]);
}

function mediaTypeOf(v: unknown, payload: unknown): IgMedia["mediaType"] {
  if (v === "photo" || v === "video" || v === "carousel") return v;
  throw new IgError("IG_DRIFT", `Unexpected media_type ${JSON.stringify(v)}`, { detail: { payload } });
}

function mapChild(raw: unknown, index: number): IgChild {
  const c = rec(raw);
  const type = c.media_type === "video" ? "video" : "photo";
  return {
    position: num(c.position) ?? index,
    externalId: required(str(c.pk), "children[].pk", raw),
    mediaType: type,
    thumbnailUrl: str(c.thumbnail_url),
    videoUrl: str(c.video_url),
    raw: rec(c.raw),
  };
}

export function mapMedia(raw: unknown): IgMedia {
  const m = rec(raw);
  const code = str(m.code);
  return {
    externalId: required(str(m.pk), "pk", raw),
    shortcode: code,
    mediaType: mediaTypeOf(m.media_type, raw),
    productType: str(m.product_type),
    url: str(m.permalink) ?? (code ? `https://www.instagram.com/p/${code}/` : ""),
    caption: str(m.caption),
    takenAt: required(str(m.taken_at), "taken_at", raw),
    durationSec: num(m.duration_sec),
    // Instagram reports plays and views separately and inconsistently; plays is the
    // closer analogue of a "view" on other short-form platforms, so it wins when both
    // are present. Outlier maths depends on this being one consistent number.
    //
    // A ZERO is treated as "not disclosed", not as a real measurement. Instagram
    // returns play_count: 0 / view_count: 0 for other creators' reels in many
    // contexts, and taking that literally overwrote genuine counts (a 2.27M-view
    // reel became 0) and would drive every outlier score to zero.
    viewCount: nonZero(m.play_count) ?? nonZero(m.view_count),
    likeCount: num(m.like_count),
    commentCount: num(m.comment_count),
    thumbnailUrl: str(m.thumbnail_url),
    videoUrl: str(m.video_url),
    children: Array.isArray(m.children) ? m.children.map(mapChild) : [],
    raw: rec(m.raw),
  };
}

export function mapProfile(raw: unknown): IgProfile {
  const p = rec(raw);
  const username = required(str(p.username), "username", raw);
  return {
    handle: `@${username}`,
    externalId: required(str(p.pk), "pk", raw),
    displayName: str(p.full_name),
    // NEVER `?? 0`. A fabricated zero is persisted twice — onto `channels` and as a
    // permanent point in the `channel_snapshots` follower time series that no later sync
    // corrects — and it silently refiles the channel into the `nano` follower band, which
    // changes which posts the user is shown in their own feed.
    followerCount: optionalCount(p, "follower_count", raw),
    followingCount: num(p.following_count),
    mediaCount: num(p.media_count),
    bio: str(p.biography),
    isVerified: bool(p.is_verified),
    isPrivate: bool(p.is_private),
    avatarUrl: str(p.profile_pic_url),
    raw: rec(p.raw),
  };
}

function mapMediasPage(raw: unknown): IgMediasPage {
  const r = rec(raw);
  const stop = r.stop_reason;
  return {
    items: Array.isArray(r.items) ? r.items.map(mapMedia) : [],
    nextCursor: str(r.next_cursor),
    // "page" means the sidecar simply reached the end of a page — not a stop condition.
    stopReason: stop === "lookback" || stop === "cap" || stop === "exhausted" ? stop : null,
  };
}

function mapHealth(raw: unknown): IgHealth {
  const h = rec(raw);
  return {
    // `status` and `instagrapi_version` deliberately DEGRADE rather than throw: they are
    // mandatory in HealthResponse too, but they collapse to values no real response
    // carries ("unknown" / null), and `ig-actions.ts` uses precisely that to report
    // whole-shape drift as an actionable Settings message instead of an exception.
    status: str(h.status) ?? "unknown",
    instagrapiVersion: str(h.instagrapi_version),
    username: str(h.username),
    cooldownUntil: str(h.cooldown_until),
    // The three mandatory booleans have no such tell — see `requiredBool`.
    loggedIn: requiredBool(h, "logged_in", raw),
    sessionLoaded: requiredBool(h, "session_loaded", raw),
    canLogin: requiredBool(h, "can_login", raw),
  };
}

function mapDownload(raw: unknown): IgDownloadResult {
  const d = rec(raw);
  return {
    path: required(str(d.path), "path", raw),
    bytes: num(d.bytes) ?? 0,
    contentType: str(d.content_type) ?? "application/octet-stream",
    sha256: required(str(d.sha256), "sha256", raw),
    width: num(d.width),
    height: num(d.height),
    durationSec: num(d.duration_sec),
  };
}

export interface IgHealth {
  status: string;
  loggedIn: boolean;
  username: string | null;
  instagrapiVersion: string | null;
  sessionLoaded: boolean;
  /** Both IG_USERNAME and IG_PASSWORD are configured on the sidecar. This is what
   *  separates "no credentials yet" from "credentials present but logged out" — two
   *  states Settings must not conflate. */
  canLogin: boolean;
  /** Set while a rate-limit backoff is in effect; sync should not be attempted before it. */
  cooldownUntil: string | null;
}

export interface IgDownloadResult {
  path: string; // relative to MEDIA_ROOT
  bytes: number;
  contentType: string;
  sha256: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
}

export type IgLoginStatus = "ok" | "two_factor_required" | "challenge_required";

interface RequestOpts {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

function buildUrl(path: string, query: RequestOpts["query"]): string {
  const url = new URL(path, config.IG_SERVICE_URL);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? config.IG_REQUEST_TIMEOUT_MS;
  const url = buildUrl(path, opts.query);
  const startedAt = Date.now();

  // AbortSignal.timeout gives us a hard ceiling per call — the old provider layer had
  // no timeout at all, so a stalled vendor request stalled the whole sync.
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        "X-IG-Token": config.IG_SERVICE_TOKEN,
        ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const code = timedOut ? "IG_NETWORK" : "IG_SERVICE_DOWN";
    log.error("ig.request.failed", { path, code, timedOut, ms: Date.now() - startedAt });
    throw new IgError(code, timedOut ? `Instagram service timed out after ${timeoutMs}ms` : "Instagram service is unreachable", {
      cause: err,
      detail: { path },
    });
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // A non-JSON error body is itself informative; fall through with null and let
      // fromEnvelope produce IG_UNKNOWN rather than pretending the call succeeded.
    }
    // A 401 comes from the sidecar's own auth guard, which answers with FastAPI's
    // `{detail: ...}` rather than our error envelope. Without this branch it degraded to
    // IG_UNKNOWN and read like an Instagram problem, when it is actually a mismatched
    // shared secret between two of our own processes.
    const error =
      res.status === 401
        ? new IgError("IG_SERVICE_UNAUTHORIZED", "Instagram service rejected the shared secret", { detail: { path } })
        : fromEnvelope(body, `Instagram service returned HTTP ${res.status}`);
    log.warn("ig.request.error", { path, status: res.status, code: error.code, ms: Date.now() - startedAt });
    throw error;
  }

  log.debug("ig.request.ok", { path, ms: Date.now() - startedAt });
  return (await res.json()) as T;
}

export const igClient = {
  async health(): Promise<IgHealth> {
    return mapHealth(await request<unknown>("/health", { timeoutMs: 5_000 }));
  },

  login(input: { username?: string; password?: string; verificationCode?: string } = {}): Promise<{ status: IgLoginStatus; detail?: unknown }> {
    return request("/login", { method: "POST", body: input, timeoutMs: 120_000 });
  },

  /** Adopts a browser's already-signed-in session instead of a password login (design
   *  brief §3). Performs no password authentication, so it never adds to the
   *  failed-login count Instagram uses to checkpoint an account. */
  loginBySession(sessionid: string): Promise<{ status: IgLoginStatus; detail?: unknown }> {
    return request("/login-by-session", { method: "POST", body: { sessionid }, timeoutMs: 120_000 });
  },

  resolveChallenge(input: { choice?: "email" | "sms"; code?: string }): Promise<{ status: IgLoginStatus }> {
    return request("/challenge/resolve", { method: "POST", body: input, timeoutMs: 120_000 });
  },

  submitTwoFactor(code: string): Promise<{ status: IgLoginStatus }> {
    return request("/two-factor", { method: "POST", body: { code }, timeoutMs: 120_000 });
  },

  logout(): Promise<{ status: string }> {
    return request("/logout", { method: "POST" });
  },

  async profile(handle: string): Promise<IgProfile> {
    return mapProfile(await request<unknown>("/profile", { query: { handle } }));
  },

  async medias(input: { handle: string; sinceIso: string; maxItems: number; cursor?: string }): Promise<IgMediasPage> {
    return mapMediasPage(
      await request<unknown>("/medias", {
        query: { handle: input.handle, since_iso: input.sinceIso, max_items: input.maxItems, cursor: input.cursor },
      })
    );
  },

  /** Re-resolves a single media's currently-valid asset URLs. Needed because IG URLs
   *  expire within hours and video download is on-demand (brief §5).
   *
   *  The sidecar's /resolve-media returns a trimmed shape (no taken_at/code), so this
   *  maps the fields it does return rather than going through mapMedia, which would
   *  raise IG_DRIFT for legitimately-absent ones. */
  async resolveMedia(pk: string): Promise<IgResolvedMedia> {
    const raw = await request<unknown>("/resolve-media", { method: "POST", body: { pk } });
    const r = rec(raw);
    const mediaType = mediaTypeOf(r.media_type, raw);
    return {
      externalId: required(str(r.pk), "pk", raw),
      mediaType,
      thumbnailUrl: str(r.thumbnail_url),
      // A fresh video_url is the entire purpose of this endpoint, so for a video it is a
      // required field like any other. Degrading to null instead made the mapper's own
      // drift surface to the user as "Instagram did not return a video URL for this
      // post." — blaming Instagram for our bug, on a path with no other signal.
      // A carousel or photo legitimately has none: the videos live in `children`.
      videoUrl: mediaType === "video" ? required(str(r.video_url), "video_url", raw) : str(r.video_url),
      children: Array.isArray(r.children) ? r.children.map(mapChild) : [],
      raw: rec(r.raw),
    };
  },

  async download(input: { url: string; kind: "thumbnail" | "video" | "avatar"; mediaPk?: string }): Promise<IgDownloadResult> {
    return mapDownload(
      await request<unknown>("/download", {
        method: "POST",
        body: { url: input.url, kind: input.kind, media_pk: input.mediaPk },
        timeoutMs: config.IG_DOWNLOAD_TIMEOUT_MS,
      })
    );
  },
};

export type IgClient = typeof igClient;
