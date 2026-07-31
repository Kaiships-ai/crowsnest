import { config } from "../config";
import { log } from "../lib/logger";
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
 *  2. A per-post insights failure is a field on that post (`GraphPost.insights.error`),
 *     never an exception that takes the whole pull down with it.
 *  3. This client never touches the instagrapi sidecar's credentials or transport
 *     (`src/server/ig/`), and the sidecar never touches this token. Separate transports,
 *     separate tables, separate code paths — including a separate error hierarchy
 *     (`./errors.ts`, not `../ig/errors.ts`).
 */

const HOST = "https://graph.instagram.com";
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------- public shapes
// Byte-for-byte the interface specified in docs/product/v1-data-contracts.md §1, so a
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
  /** Requested only when the metric name has been verified against a live call.
   *  ig_stats.py never requests these, so this port never can either — see the
   *  contract's "no tile ships for a metric until one real API call has returned it". */
  profileVisits: number | null;
  followsFromPost: number | null;
  watchTimeSec: number | null;
  /** Non-null when this one post's insights call failed while others succeeded. */
  error: string | null;
}

export interface GraphPost {
  externalId: string;
  permalink: string;
  mediaType: string;
  productType: string | null;
  format: "Reel" | "Carousel" | string;
  caption: string | null;
  postedAt: string;
  likeCount: number | null;
  commentsCount: number | null;
  insights: GraphPostInsights;
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
  state: "ok" | "not_configured" | "auth_failed" | "rate_limited" | "network" | "unknown";
  message: string | null;
  checkedAt: string;
}

export interface GraphClient {
  fetchAccount(): Promise<GraphAccount>;
  fetchPosts(limit?: number): Promise<GraphPost[]>;
  fetchComments(accountUsername: string): Promise<GraphComment[]>;
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

function formatOf(mediaType: string, productType: string | null): GraphPost["format"] {
  if (productType === "REELS") return "Reel";
  if (mediaType === "CAROUSEL_ALBUM") return "Carousel";
  return mediaType || "?";
}

function buildPost(raw: Record<string, unknown>, insights: GraphPostInsights): GraphPost {
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
    insights,
  };
}

function emptyInsights(error: string): GraphPostInsights {
  return {
    reach: null,
    saved: null,
    shares: null,
    totalInteractions: null,
    comments: null,
    likes: null,
    views: null,
    profileVisits: null,
    followsFromPost: null,
    watchTimeSec: null,
    error,
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
    profileVisits: null,
    followsFromPost: null,
    watchTimeSec: null,
    error: null,
  };
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

// ---------------------------------------------------------------- transport

type GraphFailureKind = "auth" | "rate_limit" | "network" | "unknown";

type GraphGetResult<T> = { ok: true; data: T } | { ok: false; message: string; kind: GraphFailureKind };

/** Distinguishes an expired/revoked token from a throttled call from an unrecognized
 *  failure, using the HTTP status first and the Graph API's own error envelope
 *  (`{error: {code, type}}`) second. Meta documents code 190 / type "OAuthException"
 *  for a dead token, and codes 4/17/32/613 for various rate-limit conditions; the exact
 *  set is unverified against a live call (see the "no live token" caveat in the
 *  report), so `unknown` is the deliberately honest fallback rather than a guess. */
function classifyHttpFailure(status: number, body: unknown): GraphFailureKind {
  if (status === 401) return "auth";
  const err = rec(rec(body).error);
  const code = typeof err.code === "number" ? err.code : null;
  const type = typeof err.type === "string" ? err.type : null;
  if (type === "OAuthException" || code === 190) return "auth";
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) return "rate_limit";
  return "unknown";
}

function errorCodeFor(kind: GraphFailureKind): GraphErrorCode {
  switch (kind) {
    case "auth":
      return "GRAPH_AUTH_FAILED";
    case "rate_limit":
      return "GRAPH_RATE_LIMITED";
    case "network":
      return "GRAPH_NETWORK";
    default:
      return "GRAPH_UNKNOWN";
  }
}

async function graphGet<T>(path: string, params: Record<string, string | number | undefined>, token: string): Promise<GraphGetResult<T>> {
  const url = new URL(`${HOST}/${config.IG_GRAPH_API_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  url.searchParams.set("access_token", token);

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
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

// ---------------------------------------------------------------- configuration gate

/** Synchronous, network-free check used by the query layer: is there a token to read
 *  stored data against at all. Query modules use this instead of calling `checkToken`
 *  (which makes a live network call) because contract 1 requires every own-channel
 *  query to answer instantly from the database. */
export function isGraphConfigured(): boolean {
  return Boolean(config.IG_GRAPH_TOKEN && config.IG_GRAPH_USER_ID);
}

function requireConfigured(): { token: string; userId: string } {
  if (!config.IG_GRAPH_TOKEN || !config.IG_GRAPH_USER_ID) {
    throw new GraphApiError("GRAPH_NOT_CONFIGURED", "No Graph API token configured (IG_GRAPH_TOKEN / IG_GRAPH_USER_ID).");
  }
  return { token: config.IG_GRAPH_TOKEN, userId: config.IG_GRAPH_USER_ID };
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

  async fetchPosts(limit = 50): Promise<GraphPost[]> {
    const { token, userId } = requireConfigured();
    const mediaResult = await graphGet<{ data?: unknown[] }>(
      `${userId}/media`,
      { fields: "id,media_type,media_product_type,permalink,timestamp,like_count,comments_count,caption", limit },
      token
    );
    if (!mediaResult.ok) throw new GraphApiError(errorCodeFor(mediaResult.kind), mediaResult.message);

    const items = Array.isArray(mediaResult.data.data) ? mediaResult.data.data : [];
    const posts: GraphPost[] = [];
    for (const raw of items) {
      const m = rec(raw);
      const isReel = m.media_product_type === "REELS";
      let metrics = "reach,saved,shares,total_interactions,comments,likes";
      if (isReel) metrics += ",views";

      const mediaId = str(m.id);
      let insights: GraphPostInsights;
      if (!mediaId) {
        // Rule 2: a per-post failure never aborts the run. A post with no id at all
        // cannot be measured, so it gets the same treatment as an insights call that
        // failed, not a thrown error for the whole batch.
        insights = emptyInsights("post has no id, cannot fetch insights");
      } else {
        const insightsResult = await graphGet<unknown>(`${mediaId}/insights`, { metric: metrics }, token);
        insights = insightsResult.ok ? mapInsights(insightsResult.data, isReel) : emptyInsights(insightsResult.message);
      }
      posts.push(buildPost(m, insights));
    }
    return posts;
  },

  async fetchComments(accountUsername: string): Promise<GraphComment[]> {
    const { token, userId } = requireConfigured();
    const mediaResult = await graphGet<{ data?: unknown[] }>(
      `${userId}/media`,
      { fields: "id,permalink,timestamp,comments_count", limit: 50 },
      token
    );
    if (!mediaResult.ok) throw new GraphApiError(errorCodeFor(mediaResult.kind), mediaResult.message);

    const items = Array.isArray(mediaResult.data.data) ? mediaResult.data.data : [];
    const out: GraphComment[] = [];
    for (const raw of items) {
      const m = rec(raw);
      const commentsCount = num(m.comments_count);
      if (!commentsCount) continue;
      const mediaId = str(m.id);
      if (!mediaId) continue;
      const permalink = str(m.permalink) ?? "";

      const commentsResult = await graphGet<{ data?: unknown[] }>(`${mediaId}/comments`, { fields: "id,text,username,timestamp", limit: 100 }, token);
      if (!commentsResult.ok) {
        // Unlike a post's insights, `GraphComment` has no per-item error slot (the
        // contract does not give it one), so a single media's comment pull failing
        // is logged and that media's comments are skipped rather than the whole
        // batch throwing. This is a real gap versus ig_stats.py, which folds a
        // per-media failure into the same list as a distinguishable row — see the
        // report for why that shape could not be carried over unchanged.
        log.warn("graph.comments.media_failed", { mediaId });
        continue;
      }
      const rows = Array.isArray(commentsResult.data.data) ? commentsResult.data.data : [];
      for (const row of rows) {
        out.push(buildComment(permalink, rec(row), accountUsername));
      }
    }
    return out;
  },

  async checkToken(): Promise<GraphTokenStatus> {
    if (!isGraphConfigured()) {
      return { configured: false, username: null, state: "not_configured", message: null, checkedAt: new Date().toISOString() };
    }
    const result = await graphGet<unknown>("me", { fields: "id,username" }, config.IG_GRAPH_TOKEN as string);
    const checkedAt = new Date().toISOString();
    if (result.ok) {
      const acct = rec(result.data);
      return { configured: true, username: str(acct.username), state: "ok", message: null, checkedAt };
    }
    const state: GraphTokenStatus["state"] =
      result.kind === "auth" ? "auth_failed" : result.kind === "rate_limit" ? "rate_limited" : result.kind === "network" ? "network" : "unknown";
    return { configured: true, username: null, state, message: result.message, checkedAt };
  },
};
