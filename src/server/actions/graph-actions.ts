"use server";

import { eq } from "drizzle-orm";
import { db, newId, nowIso, tables } from "../db";
import { log } from "../lib/logger";
import { CLASSIFIER_VERSION, graphClient, type GraphComment, type GraphPost, type GraphTokenStatus } from "../graph/client";
import { GraphApiError, type GraphErrorCode } from "../graph/errors";
import { OWN_COMMENTS_FETCH_ERROR_KEY } from "../queries/own-channel";

/**
 * Server actions backing own-channel Instagram Insights (V1 data contracts §1).
 *
 * Follows the same rules `sync-actions.ts` and `ig-actions.ts` already establish:
 * nothing here throws across the action boundary, and every failure carries a `code`
 * so the UI can tell "no token configured" apart from "token rejected" apart from
 * "rate limited" — each of those has a different next step for the user.
 */

type ActionResult<T extends object> = ({ ok: true } & T) | { ok: false; error: string; code?: GraphErrorCode | "GRAPH_UNKNOWN" };

function toFailure(err: unknown): { ok: false; error: string; code: GraphErrorCode } {
  if (err instanceof GraphApiError) return { ok: false, error: err.userMessage, code: err.code };
  const message = err instanceof Error ? err.message : String(err);
  log.error("graph.action.unexpected", { error: message });
  return { ok: false, error: message, code: "GRAPH_UNKNOWN" };
}

function messageOf(err: unknown): string {
  if (err instanceof GraphApiError) return err.userMessage;
  return err instanceof Error ? err.message : String(err);
}

/** Upserts one own_posts row keyed on externalId (the Graph media id), same
 *  select-then-insert-or-update shape `sync-engine.ts`'s `upsertVideo` already uses.
 *  Returns the internal row id so the caller can attach an insights row to it. */
async function upsertOwnPost(post: GraphPost, measuredAt: string): Promise<string> {
  const [existing] = await db.select({ id: tables.ownPosts.id }).from(tables.ownPosts).where(eq(tables.ownPosts.externalId, post.externalId)).limit(1);

  const common = {
    permalink: post.permalink,
    mediaType: post.mediaType,
    productType: post.productType,
    format: post.format,
    caption: post.caption,
    postedAt: post.postedAt,
    lastMeasuredAt: measuredAt,
  };

  if (existing) {
    await db.update(tables.ownPosts).set(common).where(eq(tables.ownPosts.id, existing.id));
    return existing.id;
  }

  const id = newId();
  await db.insert(tables.ownPosts).values({ id, externalId: post.externalId, ...common, firstSeenAt: measuredAt });
  return id;
}

/** Upserts one own_comments row keyed on externalId (the Graph comment id). A comment
 *  whose post permalink does not match any known own_posts row is skipped rather than
 *  failing the whole run: own_comments.own_post_id is NOT NULL, so a comment that
 *  cannot be linked cannot be stored, and `fetchComments`'s own media page (limit 50)
 *  is not guaranteed to be the exact same set `fetchPosts` returned. */
async function upsertOwnComment(comment: GraphComment, postIdByPermalink: Map<string, string>): Promise<boolean> {
  const ownPostId = postIdByPermalink.get(comment.permalink);
  if (!ownPostId) {
    log.warn("graph.comment.orphaned", { permalink: comment.permalink });
    return false;
  }

  const [existing] = await db.select({ id: tables.ownComments.id }).from(tables.ownComments).where(eq(tables.ownComments.externalId, comment.externalId)).limit(1);
  const common = {
    author: comment.author,
    text: comment.text,
    postedAt: comment.postedAt,
    kind: comment.kind,
    classifierVersion: CLASSIFIER_VERSION,
    capturedAt: nowIso(),
  };

  if (existing) {
    await db.update(tables.ownComments).set(common).where(eq(tables.ownComments.id, existing.id));
  } else {
    await db.insert(tables.ownComments).values({ id: newId(), ownPostId, externalId: comment.externalId, ...common });
  }
  return true;
}

async function setCommentsFetchError(message: string | null): Promise<void> {
  if (message === null) {
    await db.delete(tables.appSettings).where(eq(tables.appSettings.key, OWN_COMMENTS_FETCH_ERROR_KEY));
    return;
  }
  const [existing] = await db.select({ key: tables.appSettings.key }).from(tables.appSettings).where(eq(tables.appSettings.key, OWN_COMMENTS_FETCH_ERROR_KEY)).limit(1);
  if (existing) {
    await db.update(tables.appSettings).set({ value: message }).where(eq(tables.appSettings.key, OWN_COMMENTS_FETCH_ERROR_KEY));
  } else {
    await db.insert(tables.appSettings).values({ key: OWN_COMMENTS_FETCH_ERROR_KEY, value: message });
  }
}

/**
 * Runs one full measurement: account, then every post plus its insights, then
 * comments. Writes a new `own_account_snapshots` row, upserts `own_posts` on
 * `externalId`, inserts one `own_post_insights` row per post measured, and upserts
 * `own_comments` on `externalId`. Never deletes — a post that disappears from the
 * account stays in `own_posts` with its history intact, because the history is the
 * point.
 *
 * Account and posts failing at all is a hard failure (`ok: false`): with no account and
 * no posts there is nothing to show. Comments failing after posts succeeded is reported
 * as `ok: true, partial: true` instead, because contract 1 treats "posts measured,
 * comments didn't" as a real, useful, partial result — not as the run having failed.
 */
export async function measureOwnChannelAction(): Promise<
  ActionResult<{
    measuredAt: string;
    postsSeen: number;
    postsMeasured: number;
    postsFailed: number;
    commentsSeen: number;
    /** Set when posts succeeded but comments failed, or vice versa. Comments failing
     *  is the only case that reaches this today — see `upsertOwnComment` above. */
    partial: boolean;
  }>
> {
  let account: Awaited<ReturnType<typeof graphClient.fetchAccount>>;
  try {
    account = await graphClient.fetchAccount();
  } catch (err) {
    return toFailure(err);
  }

  const measuredAt = nowIso();
  await db.insert(tables.ownAccountSnapshots).values({
    id: newId(),
    capturedAt: measuredAt,
    externalId: account.id,
    username: account.username,
    followerCount: account.followersCount,
    followsCount: account.followsCount,
    mediaCount: account.mediaCount,
  });

  let posts: GraphPost[];
  try {
    posts = await graphClient.fetchPosts();
  } catch (err) {
    return toFailure(err);
  }

  let postsMeasured = 0;
  let postsFailed = 0;
  for (const post of posts) {
    const ownPostId = await upsertOwnPost(post, measuredAt);
    await db.insert(tables.ownPostInsights).values({
      id: newId(),
      ownPostId,
      capturedAt: measuredAt,
      reach: post.insights.reach,
      saved: post.insights.saved,
      shares: post.insights.shares,
      totalInteractions: post.insights.totalInteractions,
      comments: post.insights.comments,
      likes: post.insights.likes,
      views: post.insights.views,
      profileVisits: post.insights.profileVisits,
      followsFromPost: post.insights.followsFromPost,
      watchTimeSec: post.insights.watchTimeSec,
      fetchError: post.insights.error,
    });
    if (post.insights.error) postsFailed += 1;
    else postsMeasured += 1;
  }

  let commentsSeen = 0;
  let partial = false;
  try {
    const comments = await graphClient.fetchComments(account.username);
    commentsSeen = comments.length;
    const allOwnPosts = await db.select({ id: tables.ownPosts.id, permalink: tables.ownPosts.permalink }).from(tables.ownPosts);
    const postIdByPermalink = new Map(allOwnPosts.map((p) => [p.permalink, p.id]));
    for (const comment of comments) {
      await upsertOwnComment(comment, postIdByPermalink);
    }
    await setCommentsFetchError(null);
  } catch (err) {
    partial = true;
    await setCommentsFetchError(messageOf(err));
    log.warn("graph.measure.comments_failed", { message: messageOf(err) });
  }

  log.info("graph.measure.done", { postsSeen: posts.length, postsMeasured, postsFailed, commentsSeen, partial });
  return { ok: true, measuredAt, postsSeen: posts.length, postsMeasured, postsFailed, commentsSeen, partial };
}

/**
 * Cheapest authenticated call, backing the settings token strip and "Test token".
 * `graphClient.checkToken()` is documented to never throw; the try/catch here only
 * guards against a genuine bug in that contract, matching `ig-actions.ts`'s own
 * defensive style. `ok: true` with `status.state: "not_configured"` is the correct,
 * successful answer to "is there a token" — see the contract's note on why `ok: false`
 * here would conflate "no token" with "the check itself broke".
 */
export async function checkGraphTokenAction(): Promise<ActionResult<{ status: GraphTokenStatus }>> {
  try {
    const status = await graphClient.checkToken();
    return { ok: true, status };
  } catch (err) {
    return toFailure(err);
  }
}
