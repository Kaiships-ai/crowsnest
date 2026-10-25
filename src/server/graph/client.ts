import { config } from "../config";
import { log } from "../lib/logger";
import { getSecret } from "../secrets/store";
import type { PullResult } from "../lib/pull-result";
import { GraphApiError, type GraphErrorCode } from "./errors";

/**
 * Instagram Graph API client for own-channel Insights (V1 data contracts §1).
 *
 * Ported from `Kai-Official-OS/.claude/commands/ksa/serve/ig_stats.py`, proven against
 * the real account. Kept as a TypeScript module rather than a Python sidecar because,
 * unlike the instagrapi burner account, the Graph API needs no persistent session, no
 * device fingerprint and no login flow — every call here is a single stateless
 * authenticated GET. There is nothing a second process buys that `fetch()` from inside
 * the server action does not already provide, and a module keeps the metric strings and
 * the token-redaction rule in the same file a reviewer is already looking at, instead of
 * splitting them across a Node/Python IPC hop like the sidecar needs for its session
 * state.
 *
 * Three rules this file exists to enforce, carried over from the contract:
 *
 *  1. The token never leaves this module in any error, string, log line or thrown
 *     value. Every message that can reach a caller or a log line is passed through
 *     `redactToken` first.
 *  2. A pull of several calls returns a `PullResult`, never throws a per-item failure:
 *     auth and rate-limit failures come back as its reason, which must end the run.
 *  3. This client never touches the instagrapi sidecar's credentials or transport
 *     (`src/server/ig/`), and the sidecar never touches this token. Separate transports,
 *     separate tables, separate code paths — including a separate error hierarchy
 *     (`./errors.ts`, not `../ig/errors.ts`).
 */

const HOST = "https://graph.instagram.com";
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------- public shapes
// Byte-for-byte the own-insights interface (documents/architecture/external-services.md), so a
// caller written against the contract compiles against this without translation.

export interface GraphAccount {
  id: string;
  username: string;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
}

export interface GraphPostInsights {
  reach: number | null;
  saved: number | null;
  shares: number | null;
  totalInteractions: number | null;
  comments: number | null;
  likes: number | null;
  views: number | null;
  /** profile_visits and follows, requested in the feed extended set only (Meta does not
   *  report them for reels). watchTimeSec is never requested (the reel watch time lands in
   *  avgWatchTimeMs/totalWatchTimeMs). */
  profileVisits: number | null;
  followsFromPost: number | null;
  watchTimeSec: number | null;
  reposts: number | null;
  /** reels_skip_rate, passed through untouched (Meta marks it in development). */
  skipRate: number | null;
  /** Milliseconds, as the API returns them. */
  avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null;
  bioLinkTaps: number | null;
}

export interface GraphMedia {
  externalId: string;
  permalink: string;
  mediaType: string;
  productType: string | null;
  format: "Reel" | "Carousel" | string;
  caption: string | null;
  postedAt: string;
  likeCount: number | null;
  commentsCount: number | null;
  thumbnailUrl: string | null;
}

export interface GraphBreakdownRow {
  metric: string;
  dimension: string;
  key: string;
  value: number;
  timeframe: string | null;
}

/** Two pulls: the follower split (views by follower_type, one call) and the engaged
 *  audience demographics (age, country, gender). Each failed reason is the call's error;
 *  an auth or rate-limit reason must end the run. When the split is that stop, the
 *  audience was never asked and carries the same reason. */
export interface GraphAccountBreakdowns {
  split: PullResult<GraphBreakdownRow[], GraphApiError>;
  audience: PullResult<GraphBreakdownRow[], GraphApiError>;
}

export interface GraphComment {
  externalId: string;
  permalink: string;
  author: string | null;
  text: string;
  postedAt: string | null;
  kind: "organic" | "self-test" | "bot-reply" | "bot-or-self-reply" | "own-comment";
}

export interface GraphTokenStatus {
  configured: boolean;
  /** Resolved by calling the account fields edge, so the screen names the real account
   *  rather than trusting a label. Null when the call failed. */
  username: string | null;
  state: "ok" | "not_configured" | "auth_failed" | "permission_denied" | "rate_limited" | "network" | "unknown";
  message: string | null;
  checkedAt: string;
}

export interface GraphClient {
  fetchAccount(): Promise<GraphAccount>;
  fetchMedia(limit?: number): Promise<GraphMedia[]>;
  /** One post's insights. Partial when a reel's metrics landed and its profile_activity
   *  call was then stopped. A reason that is auth, rate limit or a token-wide permission
   *  refusal must end the run. Calls are counted by the transport (graphCallLedger). */
  fetchPostInsights(media: GraphMedia): Promise<PullResult<GraphPostInsights, GraphApiError>>;
  fetchAccountBreakdowns(): Promise<GraphAccountBreakdowns>;
  /** Comments for the given media (the run's own media list), one call per post with
   *  comments. Partial when any post's call failed after another landed; `missing` lists
   *  the media ids whose comments never came back. */
  fetchComments(accountUsername: string, media: Pick<GraphMedia, "externalId" | "permalink" | "commentsCount">[]): Promise<PullResult<GraphComment[], GraphApiError>>;
  /** Cheapest authenticated call. Used by the settings token strip and "Test token".
   *  Never throws. */
  checkToken(): Promise<GraphTokenStatus>;
}

// ---------------------------------------------------------------- wire mapping helpers

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function required(value: string | null, field: string, payload: unknown): string {
  if (value === null) {
    throw new GraphApiError("GRAPH_UNKNOWN", `Instagram Graph API response is missing required field "${field}"`, {
      cause: payload,
    });
  }
  return value;
}

export function mapAccount(raw: unknown): GraphAccount {
  const a = rec(raw);
  return {
    id: required(str(a.id), "id", raw),
    username: required(str(a.username), "username", raw),
    followersCount: num(a.followers_count),
    followsCount: num(a.follows_count),
    mediaCount: num(a.media_count),
  };
}

function formatOf(mediaType: string, productType: string | null): GraphMedia["format"] {
  if (productType === "REELS") return "Reel";
  if (mediaType === "CAROUSEL_ALBUM") return "Carousel";
  return mediaType || "?";
}

function buildMedia(raw: Record<string, unknown>): GraphMedia {
  const mediaType = str(raw.media_type) ?? "";
  const productType = str(raw.media_product_type);
  return {
    externalId: required(str(raw.id), "id", raw),
    permalink: str(raw.permalink) ?? "",
    mediaType,
    productType,
    format: formatOf(mediaType, productType),
    caption: str(raw.caption),
    postedAt: required(str(raw.timestamp), "timestamp", raw),
    likeCount: num(raw.like_count),
    commentsCount: num(raw.comments_count),
    thumbnailUrl: str(raw.thumbnail_url),
  };
}

/** Maps the Graph API's `{data: [{name, values: [{value}]}]}` insights envelope onto
 *  the app's flat shape. `isReel` gates `views`, matching ig_stats.py exactly: `views`
 *  is only ever requested for `media_product_type === "REELS"`, so a non-reel post must
 *  not carry a stray value even if the API happened to send one. */
export function mapInsights(raw: unknown, isReel: boolean): GraphPostInsights {
  const rows = Array.isArray(rec(raw).data) ? (rec(raw).data as unknown[]) : [];
  const stats: Record<string, number | null> = {};
  for (const row of rows) {
    const r = rec(row);
    const name = str(r.name);
    if (!name) continue;
    const values = Array.isArray(r.values) ? r.values : [];
    stats[name] = num(rec(values[0]).value);
  }
  return {
    reach: stats.reach ?? null,
    saved: stats.saved ?? null,
    shares: stats.shares ?? null,
    totalInteractions: stats.total_interactions ?? null,
    comments: stats.comments ?? null,
    likes: stats.likes ?? null,
    views: isReel ? (stats.views ?? null) : null,
    profileVisits: stats.profile_visits ?? null,
    followsFromPost: stats.follows ?? null,
    watchTimeSec: null,
    reposts: stats.reposts ?? null,
    skipRate: stats.reels_skip_rate ?? null,
    avgWatchTimeMs: stats.ig_reels_avg_watch_time ?? null,
    totalWatchTimeMs: stats.ig_reels_video_view_total_time ?? null,
    bioLinkTaps: null,
  };
}

/** Action type name for a bio link tap in profile_activity. ponytail: taken from Meta's
 *  docs, not a live response (02 section 9); a wrong name would read as 0 taps. */
export const BIO_LINK_ACTION = "BIO_LINK_CLICKED";

/** Called only on a successful profile_activity response (a failed call leaves bioLinkTaps
 *  null). Graph omits zero-valued action types, so an absent bio link action means 0 taps. */
export function mapBioLinkTaps(raw: unknown): number | null {
  for (const row of arr(rec(raw).data)) {
    for (const b of arr(rec(rec(row).total_value).breakdowns)) {
      for (const r of arr(rec(b).results)) {
        if (arr(rec(r).dimension_values).includes(BIO_LINK_ACTION)) return num(rec(r).value);
      }
    }
  }
  return 0;
}

function mapBreakdown(raw: unknown, metric: string, dimension: string, timeframe: string): GraphBreakdownRow[] {
  const out: GraphBreakdownRow[] = [];
  for (const row of arr(rec(raw).data)) {
    for (const b of arr(rec(rec(row).total_value).breakdowns)) {
      for (const r of arr(rec(b).results)) {
        const key = str(arr(rec(r).dimension_values)[0]);
        const value = num(rec(r).value);
        if (key !== null && value !== null) out.push({ metric, dimension, key, value, timeframe });
      }
    }
  }
  return out;
}

/**
 * Comment text that ig_stats.py knows came from Kai's own testing or the ChatbotX
 * auto-reply, so a report does not present self-tests as audience engagement. Copied
 * verbatim (not re-derived) so the two clients cannot classify the same comment two
 * different ways — see the contract's requirement that the port "keep the metric
 * strings byte for byte identical".
 *
 * `classifierVersion` on the stored row exists precisely because this list is fragile:
 * if the ChatbotX reply copy changes, these sets go stale silently and a row classified
 * under them is only identifiable as such because it carries this version string.
 */
const SELF_TEST_TEXT = new Set(["machine", "pack", "machine gun", "machine gun man", "machine dude"]);
const BOT_REPLY_TEXT = new Set([
  "sent the kit details to your dms. take a look 🥰",
  "please check the dm",
  "sent you a message! check it out!",
  "nice! check your dms!",
]);

/** Identifies which hardcoded string sets produced a `GraphComment.kind`. Stored on
 *  every `own_comments` row rather than assumed, so a row classified under an older
 *  version of `SELF_TEST_TEXT`/`BOT_REPLY_TEXT` is identifiable instead of silently
 *  wrong once those sets are next edited. */
export const CLASSIFIER_VERSION = "ported-from-ig_stats.py-2026-07-31";

export function classifyComment(text: string | null, username: string | null, accountUsername: string | null): GraphComment["kind"] {
  const t = (text ?? "").trim().toLowerCase();
  if (username && accountUsername && username === accountUsername) {
    return BOT_REPLY_TEXT.has(t) ? "bot-or-self-reply" : "own-comment";
  }
  if (SELF_TEST_TEXT.has(t)) return "self-test";
  if (BOT_REPLY_TEXT.has(t)) return "bot-reply";
  return "organic";
}

function buildComment(mediaPermalink: string, raw: Record<string, unknown>, accountUsername: string | null): GraphComment {
  const text = str(raw.text) ?? "";
  const username = str(raw.username);
  return {
    externalId: required(str(raw.id), "id", raw),
    permalink: mediaPermalink,
    author: username,
    text,
    postedAt: str(raw.timestamp),
    kind: classifyComment(text, username, accountUsername),
  };
}

// ---------------------------------------------------------------- token redaction

/** Strips every occurrence of the live token out of a string before it can reach a
 *  caller, a thrown error or a log line. Mirrors `ig_stats.py`'s `_get`, which does the
 *  same by string replace on an HTTP error body. */
export function redactToken(text: string, token: string): string {
  return token ? text.split(token).join("<redacted>") : text;
}

// ---------------------------------------------------------------- call ledger

const HOUR_MS = 3_600_000;

/** Every HTTP call this process makes to Graph, counted in the transport so no caller can
 *  miss one (measurement, token checks, account reads, publish). `total` gives a run its
 *  own count (calls since it started); `at` the rolling hour. Kept on globalThis next to
 *  the measure lock, because tsx server.ts and the Next bundle each load their own copy of
 *  this module in the same process.
 *  ponytail: in memory, so a restart forgets the last hour's calls; persist it if restarts
 *  mid-hour ever push a run over Instagram's limit. */
export interface GraphCallLedger {
  total: number;
  at: number[];
}
export function graphCallLedger(): GraphCallLedger {
  const g = globalThis as { __crowsnestOwnMeasure?: { graphCalls?: GraphCallLedger } };
  return ((g.__crowsnestOwnMeasure ??= {}).graphCalls ??= { total: 0, at: [] });
}
export function graphCallsInLastHour(now = Date.now()): number {
  return graphCallLedger().at.filter((t) => t > now - HOUR_MS && t <= now).length;
}
function noteGraphCall(): void {
  const ledger = graphCallLedger();
  const now = Date.now();
  ledger.total += 1;
  ledger.at = ledger.at.filter((t) => t > now - HOUR_MS);
  ledger.at.push(now);
}

// ---------------------------------------------------------------- transport

type GraphFailureKind = "auth" | "permission" | "rate_limit" | "invalid_request" | "network" | "unknown";

type GraphGetResult<T> = { ok: true; data: T } | { ok: false; message: string; kind: GraphFailureKind };

/** Distinguishes an expired/revoked token from a throttled call from an unrecognized
 *  failure, using the HTTP status and the Graph API's own error envelope
 *  (`{error: {code}}`). Meta documents code 190 (and 102) for a dead token, and codes
 *  4/17/32/613 and 80000-80014 (business use case limits; Instagram's is 80002, sent as
 *  HTTP 400) for rate limits. A failure Meta marks `is_transient: true`, or codes 1/2
 *  (unknown, service unavailable) and 9007 (media not ready), is worth retrying, so it is
 *  `unknown` (publish retries that class) rather than a terminal invalid_request. */
function classifyHttpFailure(status: number, body: unknown): GraphFailureKind {
  const error = rec(rec(body).error);
  const code = num(error.code);
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613 || (code !== null && code >= 80000 && code <= 80014)) return "rate_limit";
  // Not type "OAuthException": Meta sends that type on nearly every error, including an
  // unsupported metric (code 100) and a permission refusal (code 10), which must stay
  // per-post failures rather than end the run.
  if (status === 401 || code === 190 || code === 102) return "auth";
  if (error.is_transient === true || code === 1 || code === 2 || code === 9007) return "unknown";
  // A permission or scope refusal (code 10, 200-299): the token works but lacks a grant.
  // Needs reauthorization for the account call; stays non-fatal for a per-metric call.
  if (code !== null && (code === 10 || (code >= 200 && code <= 299))) return "permission";
  // Any other 4xx (code 100 invalid parameter, a bad video_url or caption): Instagram
  // rejected the request itself, so repeating it cannot succeed. Publish treats this as
  // terminal; a per-metric insights call still treats it as non-fatal.
  if (status >= 400 && status < 500) return "invalid_request";
  return "unknown";
}

/** True when a stored per-post fetchError ("HTTP <status>: <body>", as graphRequest builds
 *  it) is a non-transient invalid_request: Instagram will refuse it the same way again. */
export function isPermanentFailure(message: string): boolean {
  const f = parseFailure(message);
  return f !== null && classifyHttpFailure(f.status, f.body) === "invalid_request";
}

function parseFailure(message: string): { status: number; body: unknown } | null {
  const m = /^HTTP (\d+): ([\s\S]*)$/.exec(message);
  if (!m) return null;
  let body: unknown = null;
  try {
    body = JSON.parse(m[2]);
  } catch {
    // Not JSON: classify on the status alone.
  }
  return { status: Number(m[1]), body };
}

/** Code 10 on one media's insights is usually "(#10) Not enough viewers for the media to
 *  show insights", a per-post refusal. Only a scope code (200-299), or a code 10 that names
 *  a permission, means the token itself lacks the insights grant. */
function tokenWidePermission(message: string): boolean {
  const error = rec(rec(parseFailure(message)?.body).error);
  const code = num(error.code);
  if (code !== null && code >= 200 && code <= 299) return true;
  const text = str(error.message) ?? "";
  return code === 10 && /permission|scope/i.test(text) && !/not enough/i.test(text);
}

function errorCodeFor(kind: GraphFailureKind): GraphErrorCode {
  switch (kind) {
    case "auth":
      return "GRAPH_AUTH_FAILED";
    case "permission":
      return "GRAPH_PERMISSION_DENIED";
    case "rate_limit":
      return "GRAPH_RATE_LIMITED";
    case "invalid_request":
      return "GRAPH_INVALID_REQUEST";
    case "network":
      return "GRAPH_NETWORK";
    default:
      return "GRAPH_UNKNOWN";
  }
}

/** Shared transport for both GET (reads) and POST (Reel container create/publish, B2).
 *  GET puts params in the query string; POST puts them in a form body — same Graph API
 *  convention the container/publish edges use. Every other rule (timeout, token
 *  redaction, error classification, logging) is identical for both, so this is the one
 *  place that plumbing lives. */
async function graphRequest<T>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string | number | undefined>,
  token: string
): Promise<GraphGetResult<T>> {
  const url = new URL(`${HOST}/${config.IG_GRAPH_API_VERSION}/${path}`);
  const init: RequestInit = { method, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };

  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    url.searchParams.set("access_token", token);
  } else {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) body.set(k, String(v));
    }
    body.set("access_token", token);
    init.body = body;
  }

  let res: Response;
  // Counted before the call: a timeout or dropped connection may still have reached Graph.
  noteGraphCall();
  try {
    res = await fetch(url.toString(), init);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    log.warn("graph.request.network_error", { path });
    return { ok: false, message: redactToken(`network error: ${raw}`, token), kind: "network" };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // A non-JSON error body is still informative; body stays null and the message
    // below falls back to the bare status.
  }

  if (!res.ok) {
    const kind = classifyHttpFailure(res.status, body);
    log.warn("graph.request.error", { path, status: res.status, kind });
    return { ok: false, message: redactToken(`HTTP ${res.status}: ${JSON.stringify(body ?? {})}`, token), kind };
  }

  log.debug("graph.request.ok", { path });
  return { ok: true, data: body as T };
}

function graphGet<T>(path: string, params: Record<string, string | number | undefined>, token: string): Promise<GraphGetResult<T>> {
  return graphRequest<T>("GET", path, params, token);
}

function graphPost<T>(path: string, params: Record<string, string | number | undefined>, token: string): Promise<GraphGetResult<T>> {
  return graphRequest<T>("POST", path, params, token);
}

const CORE_METRICS = "reach,saved,shares,total_interactions,comments,likes";
const REEL_CORE_METRICS = `${CORE_METRICS},views`;
/** FEED media (image, carousel) also report follows and profile_visits. */
const FEED_EXTENDED_METRICS = `${CORE_METRICS},follows,profile_visits`;
/** No follows or profile_visits: Meta lists them for FEED and STORY only ("Other Available
 *  Metrics (Non-Reels)"), and one refused name fails the whole call, which would drop
 *  watch time, skip rate and reposts with it. profile_activity is asked separately. */
const REEL_EXTENDED_METRICS =
  "views,reach,likes,comments,shares,saved,total_interactions,reposts,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate";

/** Auth and rate-limit failures end a measurement run; everything else is per-post
 *  (fetchPostInsights also ends it on a permission refusal of the core metric set). */
function fatalOf(result: GraphGetResult<unknown>): GraphApiError | null {
  return !result.ok && (result.kind === "auth" || result.kind === "rate_limit") ? new GraphApiError(errorCodeFor(result.kind), result.message) : null;
}

function errorOf(result: { ok: false; message: string; kind: GraphFailureKind }): GraphApiError {
  return new GraphApiError(errorCodeFor(result.kind), result.message);
}

// ---------------------------------------------------------------- configuration gate

/** Synchronous, network-free check used by the query layer: is there a token to read
 *  stored data against at all. Query modules use this instead of calling `checkToken`
 *  (which makes a live network call) because contract 1 requires every own-channel
 *  query to answer instantly from the database. */
export function isGraphConfigured(): boolean {
  return Boolean(getSecret("IG_GRAPH_TOKEN") && getSecret("IG_GRAPH_USER_ID"));
}

function requireConfigured(): { token: string; userId: string } {
  const token = getSecret("IG_GRAPH_TOKEN");
  const userId = getSecret("IG_GRAPH_USER_ID");
  if (!token || !userId) {
    throw new GraphApiError("GRAPH_NOT_CONFIGURED", "No Graph API token configured (IG_GRAPH_TOKEN / IG_GRAPH_USER_ID).");
  }
  return { token, userId };
}

// ---------------------------------------------------------------- client

export const graphClient: GraphClient = {
  async fetchAccount(): Promise<GraphAccount> {
    // "me" alias, matching ig_stats.py's fetch_account exactly — it resolves through
    // the token itself, so it needs no separate id lookup the way the media and
    // comments edges below do.
    const { token } = requireConfigured();
    const result = await graphGet<unknown>("me", { fields: "id,username,followers_count,follows_count,media_count" }, token);
    if (!result.ok) throw new GraphApiError(errorCodeFor(result.kind), result.message);
    return mapAccount(result.data);
  },

  async fetchMedia(limit = 50): Promise<GraphMedia[]> {
    const { token, userId } = requireConfigured();
    const result = await graphGet<{ data?: unknown[] }>(
      `${userId}/media`,
      { fields: "id,media_type,media_product_type,permalink,timestamp,like_count,comments_count,caption,thumbnail_url", limit },
      token
    );
    if (!result.ok) throw new GraphApiError(errorCodeFor(result.kind), result.message);
    return arr(result.data.data).map((raw) => buildMedia(rec(raw)));
  },

  async fetchPostInsights(media: GraphMedia): Promise<PullResult<GraphPostInsights, GraphApiError>> {
    const { token } = requireConfigured();
    const path = `${media.externalId}/insights`;
    const isReel = media.productType === "REELS";
    let r = await graphGet<unknown>(path, { metric: isReel ? REEL_EXTENDED_METRICS : FEED_EXTENDED_METRICS }, token);
    let stop = fatalOf(r);
    if (stop) return { kind: "failed", reason: stop };
    if (!r.ok) {
      // One unsupported metric name fails the whole call; retry once with the set that
      // worked before the rework, so the post keeps its core numbers. Logged with Graph's
      // own message (token already redacted) so a refused metric is visible.
      log.warn("graph.insights.extended_fallback", { mediaId: media.externalId, isReel, error: r.message });
      r = await graphGet<unknown>(path, { metric: isReel ? REEL_CORE_METRICS : CORE_METRICS }, token);
      // The core set refused for a missing scope too: the token lacks the insights grant, so
      // every other post would fail the same way. A refused extended set alone is not fatal.
      stop = fatalOf(r) ?? (!r.ok && r.kind === "permission" && tokenWidePermission(r.message) ? new GraphApiError("GRAPH_PERMISSION_DENIED", r.message) : null);
      if (stop) return { kind: "failed", reason: stop };
    }
    // Still refused but not token-wide: this post's own refusal ("not enough viewers"), so
    // it never carries GRAPH_PERMISSION_DENIED, which callers read as the run's stop.
    if (!r.ok) return { kind: "failed", reason: new GraphApiError(r.kind === "permission" ? "GRAPH_INVALID_REQUEST" : errorCodeFor(r.kind), r.message) };
    const insights = mapInsights(r.data, isReel);
    if (!isReel) return { kind: "complete", rows: insights };
    const activity = await graphGet<unknown>(path, { metric: "profile_activity", breakdown: "action_type", metric_type: "total_value" }, token);
    stop = fatalOf(activity);
    if (stop) return { kind: "partial", rows: insights, missing: "bio link taps", reason: stop };
    // A refused profile_activity is Instagram's answer for this reel, not a cut pull.
    insights.bioLinkTaps = activity.ok ? mapBioLinkTaps(activity.data) : null;
    return { kind: "complete", rows: insights };
  },

  async fetchAccountBreakdowns(): Promise<GraphAccountBreakdowns> {
    const { token, userId } = requireConfigured();
    // Meta's documented shape for views: period=day, metric_type=total_value, breakdown
    // follower_type. since/until are optional; without them the API looks back 24 hours,
    // recorded as timeframe "day".
    const r = await graphGet<unknown>(`${userId}/insights`, { metric: "views", period: "day", metric_type: "total_value", breakdown: "follower_type" }, token);
    const stop = fatalOf(r);
    if (stop) return { split: { kind: "failed", reason: stop }, audience: { kind: "failed", reason: stop } };
    if (!r.ok) log.warn("graph.breakdowns.split_failed", { error: r.message });
    const split: PullResult<GraphBreakdownRow[], GraphApiError> = r.ok ? { kind: "complete", rows: mapBreakdown(r.data, "views", "follower_type", "day") } : { kind: "failed", reason: errorOf(r) };
    const rows: GraphBreakdownRow[] = [];
    const dimensions = ["age", "country", "gender"];
    for (const [i, dimension] of dimensions.entries()) {
      const d = await graphGet<unknown>(
        `${userId}/insights`,
        { metric: "engaged_audience_demographics", period: "lifetime", timeframe: "this_month", metric_type: "total_value", breakdown: dimension },
        token
      );
      if (!d.ok) {
        // Below 100 engagements Instagram refuses all three; one refusal answers for the rest.
        const reason = fatalOf(d) ?? errorOf(d);
        const audience: PullResult<GraphBreakdownRow[], GraphApiError> = i === 0 ? { kind: "failed", reason } : { kind: "partial", rows, missing: dimensions.slice(i).join(", "), reason };
        return { split, audience };
      }
      rows.push(...mapBreakdown(d.data, "engaged_audience_demographics", dimension, "this_month"));
    }
    return { split, audience: { kind: "complete", rows } };
  },

  async fetchComments(accountUsername: string, media: Pick<GraphMedia, "externalId" | "permalink" | "commentsCount">[]): Promise<PullResult<GraphComment[], GraphApiError>> {
    const { token } = requireConfigured();
    const out: GraphComment[] = [];
    const missing: string[] = [];
    let landed = 0;
    let reason: GraphApiError | null = null;
    for (const m of media) {
      if (!m.commentsCount) continue;
      const result = await graphGet<{ data?: unknown[] }>(`${m.externalId}/comments`, { fields: "id,text,username,timestamp", limit: 100 }, token);
      if (!result.ok) {
        log.warn("graph.comments.media_failed", { mediaId: m.externalId });
        missing.push(m.externalId);
        // A dead token or a rate limit ends the pull: every further call would fail too.
        const stop = fatalOf(result);
        reason = stop ?? reason ?? errorOf(result);
        if (stop) break;
        continue;
      }
      landed += 1;
      for (const row of arr(result.data.data)) out.push(buildComment(m.permalink, rec(row), accountUsername));
    }
    if (reason === null) return { kind: "complete", rows: out };
    if (landed === 0) return { kind: "failed", reason };
    return { kind: "partial", rows: out, missing: missing.join(", "), reason };
  },

  async checkToken(): Promise<GraphTokenStatus> {
    if (!isGraphConfigured()) {
      return { configured: false, username: null, state: "not_configured", message: null, checkedAt: new Date().toISOString() };
    }
    const result = await graphGet<unknown>("me", { fields: "id,username" }, getSecret("IG_GRAPH_TOKEN") as string);
    const checkedAt = new Date().toISOString();
    if (result.ok) {
      const acct = rec(result.data);
      return { configured: true, username: str(acct.username), state: "ok", message: null, checkedAt };
    }
    const state: GraphTokenStatus["state"] =
      result.kind === "auth" ? "auth_failed" : result.kind === "permission" ? "permission_denied" : result.kind === "rate_limit" ? "rate_limited" : result.kind === "network" ? "network" : "unknown";
    return { configured: true, username: null, state, message: result.message, checkedAt };
  },
};

// ---------------------------------------------------------------- Reels publish (B2)
// Three-step own-channel publish flow (see `documents/architecture/publish.md`): create a media container against a
// public `video_url`, poll `status_code` until it leaves IN_PROGRESS, then publish the
// finished container. Reuses `graphPost`/`graphGet`/`requireConfigured`/`GraphApiError`
// above rather than a parallel client — same auth, same token redaction, same error
// classification as every other call in this file.

/** Poll cadence for `pollReelContainer`. `delayMs` is injectable so tests resolve the
 *  poll loop instantly instead of waiting on real timers. */
export interface PollReelContainerOptions {
  /** Number of status checks before giving up with GRAPH_TIMEOUT. Default 30. */
  maxAttempts?: number;
  /** Wait between checks. Default 2000ms. */
  delayMs?: number;
  /** Injected sleep, defaults to a real `setTimeout`. Tests pass a no-op so the poll
   *  loop runs to completion without actually waiting. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_POLL_MAX_ATTEMPTS = 30;
const DEFAULT_POLL_DELAY_MS = 2_000;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Step 1: POST /{ig-user-id}/media with media_type=REELS. Returns the container id the
 *  next two steps operate on. */
export async function createReelContainer({ videoUrl, caption }: { videoUrl: string; caption?: string }): Promise<{ containerId: string }> {
  const { token, userId } = requireConfigured();
  const result = await graphPost<unknown>(`${userId}/media`, { media_type: "REELS", video_url: videoUrl, caption }, token);
  if (!result.ok) throw new GraphApiError(errorCodeFor(result.kind), result.message);
  const containerId = str(rec(result.data).id);
  if (!containerId) {
    throw new GraphApiError("GRAPH_CONTAINER_FAILED", "Instagram did not return a container id for the new Reel.", { cause: result.data });
  }
  return { containerId };
}

/** Step 2: GET /{container-id}?fields=status_code, bounded by `maxAttempts`. Resolves
 *  once status_code is FINISHED; throws GRAPH_CONTAINER_FAILED on ERROR/EXPIRED and
 *  GRAPH_TIMEOUT if it never leaves IN_PROGRESS within the cap — this never loops
 *  unbounded. */
export async function pollReelContainer(containerId: string, opts: PollReelContainerOptions = {}): Promise<{ status: "FINISHED" }> {
  const { token } = requireConfigured();
  const maxAttempts = opts.maxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;
  const delayMs = opts.delayMs ?? DEFAULT_POLL_DELAY_MS;
  const sleep = opts.sleep ?? realSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await graphGet<unknown>(containerId, { fields: "status_code" }, token);
    if (!result.ok) throw new GraphApiError(errorCodeFor(result.kind), result.message);

    const statusCode = str(rec(result.data).status_code);
    if (statusCode === "FINISHED") return { status: "FINISHED" };
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      throw new GraphApiError("GRAPH_CONTAINER_FAILED", `Instagram Reel container ${containerId} entered status ${statusCode}.`, { cause: result.data });
    }
    // IN_PROGRESS (or an unrecognized status) — keep polling until the attempt cap.
    if (attempt < maxAttempts) await sleep(delayMs);
  }
  throw new GraphApiError("GRAPH_TIMEOUT", `Instagram Reel container ${containerId} did not finish processing after ${maxAttempts} attempts.`);
}

/** Step 3: POST /{ig-user-id}/media_publish with creation_id=<container-id>. Returns
 *  the published media's id. */
export async function publishReel(containerId: string): Promise<{ mediaId: string }> {
  const { token, userId } = requireConfigured();
  const result = await graphPost<unknown>(`${userId}/media_publish`, { creation_id: containerId }, token);
  if (!result.ok) throw new GraphApiError(errorCodeFor(result.kind), result.message);
  const mediaId = str(rec(result.data).id);
  if (!mediaId) {
    throw new GraphApiError("GRAPH_CONTAINER_FAILED", "Instagram did not return a media id after publishing the Reel.", { cause: result.data });
  }
  return { mediaId };
}
