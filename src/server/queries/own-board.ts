import { desc, sql } from "drizzle-orm";

import { db, tables } from "@/server/db";
import type { CountId } from "@/server/metrics/ledger";
import { getFunnel, type FunnelEntry, type Reading } from "@/server/services/funnel";
import { computeOwnMedianReach, indexAgainstOwnMedian } from "@/server/services/own-metrics";
import { getSetting } from "@/server/settings";
import { entryReading, funnelSteps, type FunnelStep } from "./funnel-board";
import { getAccountBreakdowns, getOwnPostInsightHistory, getPostsWithLatestInsights, newestCaptureByPost, type AccountBreakdowns, type JoinedOwnPost } from "./own-channel";

const IG_KEYS = ["views", "reach", "likes", "comments", "shares", "saved", "reposts", "followsFromPost", "profileVisits", "bioLinkTaps", "avgWatchTimeMs", "skipRate"] as const;
type IgKey = (typeof IG_KEYS)[number];

const TOTAL_KEYS = ["views", "likes", "comments", "shares", "saved", "followsFromPost", "profileVisits", "bioLinkTaps"] as const satisfies readonly IgKey[];
type TotalKey = (typeof TOTAL_KEYS)[number];

const AFTER_KEYS = ["dm", "gift_page_visit", "purchase"] as const satisfies readonly CountId[];
type AfterKey = (typeof AFTER_KEYS)[number];

export type AfterReading = Reading | { status: "no-keyword" };
export type OwnTotal = Reading & { postsWithoutNumber: number };

export interface OwnPostCard {
  ownPostId: string;
  permalink: string;
  caption: string | null;
  format: string;
  postedAt: string;
  keyword: string | null;
  /** The newest pull of this post failed after (or without) its last good one: the numbers shown are older. */
  pullError: { error: string; at: string } | null;
  ig: Record<IgKey, Reading>;
  reachIndex: number | null;
  after: Record<AfterKey, AfterReading>;
}

export interface OwnBoard {
  username: string | null;
  windowDays: number;
  followers: Reading;
  netFollowers: Reading;
  totals: Record<TotalKey, OwnTotal>;
  viewsByFormat: { format: string; views: OwnTotal }[];
  after: Record<AfterKey, OwnTotal>;
  posts: OwnPostCard[];
  audience: AccountBreakdowns;
}

export interface OwnReelBoard {
  post: OwnPostCard;
  history: { capturedAt: string; views: number }[];
  after: { keyword: string; plan: FunnelEntry["plan"]; steps: FunnelStep[] } | null;
}

type PlanLink = { ownPostId: string; keyword: string };

function igReading(post: JoinedOwnPost, key: IgKey): Reading {
  const value = post.latestOk?.[key];
  return post.latestOk && value != null ? { status: "value", value, capturedAt: post.latestOk.capturedAt } : { status: "missing" };
}

function sumReadings(readings: AfterReading[]): OwnTotal {
  const values = readings.flatMap((r) => (r.status === "value" ? [r] : []));
  if (values.length === 0) return { status: "missing", postsWithoutNumber: readings.length };
  return {
    status: "value",
    value: values.reduce((sum, r) => sum + r.value, 0),
    capturedAt: values.reduce((oldest, r) => (r.capturedAt < oldest ? r.capturedAt : oldest), values[0].capturedAt),
    postsWithoutNumber: readings.length - values.length,
  };
}

const mapKeys = <K extends string, V>(keys: readonly K[], read: (key: K) => V): Record<K, V> =>
  // SAFETY: fromEntries over exactly `keys` yields a record with exactly those keys.
  Object.fromEntries(keys.map((k) => [k, read(k)])) as Record<K, V>;

function pullErrorOf(post: JoinedOwnPost, failed: { capturedAt: string; fetchError: string | null } | undefined): OwnPostCard["pullError"] {
  if (!failed?.fetchError || (post.latestOk && post.latestOk.capturedAt >= failed.capturedAt)) return null;
  return { error: failed.fetchError, at: failed.capturedAt };
}

async function loadCards(posts: JoinedOwnPost[]): Promise<OwnPostCard[]> {
  const [links, entries, minUsable, failed] = await Promise.all([
    db.all<PlanLink>(sql`
      SELECT published_own_post_id AS ownPostId, keyword FROM planned_posts
      WHERE published_own_post_id IS NOT NULL AND keyword IS NOT NULL
    `),
    getFunnel(),
    getSetting("scoreMinUsablePosts"),
    newestCaptureByPost(posts.map((p) => p.ownPostId), false),
  ]);
  const keywordByPost = new Map(links.map((l) => [l.ownPostId, l.keyword]));
  const entryByKey = new Map(entries.map((e) => [e.keyword.toLowerCase(), e]));
  const medianReach = computeOwnMedianReach(posts.map((p) => ({ ownPostId: p.ownPostId, reach: p.reach, postedAt: p.postedAt })), { minUsable });
  return posts.map((p) => {
    const keyword = keywordByPost.get(p.ownPostId) ?? null;
    const entry = keyword ? entryByKey.get(keyword.toLowerCase()) : undefined;
    return {
      ownPostId: p.ownPostId,
      permalink: p.permalink,
      caption: p.caption,
      format: p.format,
      postedAt: p.postedAt,
      keyword,
      pullError: pullErrorOf(p, failed.get(p.ownPostId)),
      ig: mapKeys(IG_KEYS, (k) => igReading(p, k)),
      reachIndex: indexAgainstOwnMedian(p.reach, medianReach),
      after: mapKeys(AFTER_KEYS, (k): AfterReading => (entry ? entryReading(entry, k) : keyword ? { status: "missing" } : { status: "no-keyword" })),
    };
  });
}

async function followerReadings(windowStart: string): Promise<{ followers: Reading; netFollowers: Reading }> {
  const snapshots = await db
    .select({ capturedAt: tables.ownAccountSnapshots.capturedAt, followerCount: tables.ownAccountSnapshots.followerCount })
    .from(tables.ownAccountSnapshots)
    .orderBy(desc(tables.ownAccountSnapshots.capturedAt));
  const counted = snapshots.flatMap((s) => (s.followerCount === null ? [] : [{ capturedAt: s.capturedAt, value: s.followerCount }]));
  const latest = counted[0];
  if (!latest) return { followers: { status: "missing" }, netFollowers: { status: "missing" } };
  const before = counted.find((s) => s.capturedAt <= windowStart);
  return {
    followers: { status: "value", value: latest.value, capturedAt: latest.capturedAt },
    netFollowers: before ? { status: "value", value: latest.value - before.value, capturedAt: latest.capturedAt } : { status: "missing" },
  };
}

export async function getOwnBoard(windowDays: number = 30): Promise<OwnBoard> {
  const windowStart = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const [all, [account], { followers, netFollowers }, audience] = await Promise.all([
    getPostsWithLatestInsights(),
    db.select({ username: tables.ownAccountSnapshots.username }).from(tables.ownAccountSnapshots).orderBy(desc(tables.ownAccountSnapshots.capturedAt)).limit(1),
    followerReadings(windowStart),
    getAccountBreakdowns(),
  ]);
  const posts = (await loadCards(all)).filter((p) => p.postedAt >= windowStart);
  const formats = [...new Set(posts.map((p) => p.format))].sort();
  return {
    username: account?.username ?? null,
    windowDays,
    followers,
    netFollowers,
    totals: mapKeys(TOTAL_KEYS, (k) => sumReadings(posts.map((p) => p.ig[k]))),
    viewsByFormat: formats.map((format) => ({ format, views: sumReadings(posts.filter((p) => p.format === format).map((p) => p.ig.views)) })),
    after: mapKeys(AFTER_KEYS, (k) => sumReadings(posts.map((p) => p.after[k]))),
    posts,
    audience,
  };
}

export async function getOwnReelBoard(ownPostId: string): Promise<OwnReelBoard> {
  const post = (await loadCards(await getPostsWithLatestInsights())).find((p) => p.ownPostId === ownPostId);
  if (!post) throw new Error(`no own post ${ownPostId}`);
  const [history, entries] = await Promise.all([getOwnPostInsightHistory(ownPostId), post.keyword ? getFunnel(post.keyword) : Promise.resolve([])]);
  const [entry] = entries;
  return {
    post,
    history: history.flatMap((h) => (h.views === null ? [] : [{ capturedAt: h.capturedAt, views: h.views }])).reverse(),
    after: post.keyword && entry ? { keyword: post.keyword, plan: entry.plan, steps: funnelSteps([entry]) } : null,
  };
}
