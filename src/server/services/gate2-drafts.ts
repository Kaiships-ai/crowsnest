import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { publishNowAction, schedulePublishAction } from "@/server/actions/planned-post-actions";
import { db, nowIso, tables } from "@/server/db";
import type { SimpleResult } from "@/server/lib/action-result";
import { draftGatedCall, journalOutcome, journalPending } from "@/server/services/agent-journal";
import { PUBLISH_TOOL } from "@/server/services/publish-post";

type Plan = typeof tables.plannedPosts.$inferSelect;
type Draft = typeof tables.gateDrafts.$inferSelect;

/** "now", or a local wall-clock `YYYY-MM-DDTHH:mm` the scheduler publishes at. */
export type PublishAt = "now" | string;

export interface PublishDraftInput {
  postId: string;
  at: PublishAt;
  videoAssetId: string | null;
  caption: string | null;
  coverAssetId: string | null;
  keyword: string | null;
}

export type CheckId = "video" | "caption" | "keyword" | "time" | "cover";
export interface PublishCheck {
  id: CheckId;
  status: "ok" | "warn" | "missing";
  detail: string;
}

const LOCAL_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DRAFTABLE = ["draft", "scheduled", "failed"] as const;

function timeCheck(at: PublishAt, now: number): PublishCheck {
  if (at === "now") return { id: "time", status: "ok", detail: "Publish right after approval" };
  if (!LOCAL_AT.test(at) || Number.isNaN(Date.parse(at))) return { id: "time", status: "missing", detail: "Pick a publish time" };
  if (new Date(at).getTime() <= now) return { id: "time", status: "missing", detail: `${at.replace("T", " ")} has passed` };
  return { id: "time", status: "ok", detail: `Publish at ${at.replace("T", " ")}` };
}

function keywordCheck(keyword: string | null, caption: string | null): PublishCheck {
  if (!keyword) return { id: "keyword", status: "warn", detail: "No keyword, so the funnel cannot follow this reel" };
  const firstLine = (caption ?? "").split("\n")[0].toLowerCase();
  if (!firstLine.includes(keyword.toLowerCase())) return { id: "keyword", status: "warn", detail: `Keyword ${keyword} is not on caption line 1` };
  return { id: "keyword", status: "ok", detail: `Keyword ${keyword} on caption line 1` };
}

/** The five checks Gate 2 shows before a publish (wireframe B6-01). Only a missing keyword warns; the rest block. */
export function publishChecks(plan: Pick<Plan, "videoAssetId" | "caption" | "coverAssetId" | "keyword">, at: PublishAt, now = Date.now()): PublishCheck[] {
  const caption = plan.caption?.trim() ? plan.caption : null;
  return [
    plan.videoAssetId ? { id: "video", status: "ok", detail: "Video attached" } : { id: "video", status: "missing", detail: "Attach the reel's mp4" },
    caption ? { id: "caption", status: "ok", detail: caption.split("\n")[0] } : { id: "caption", status: "missing", detail: "Write a caption" },
    keywordCheck(plan.keyword, caption),
    timeCheck(at, now),
    plan.coverAssetId ? { id: "cover", status: "ok", detail: "Cover attached" } : { id: "cover", status: "missing", detail: "No cover next to the video (<name>-cover.png)" },
  ];
}

async function loadPlan(postId: string): Promise<Plan | null> {
  const [plan] = await db.select().from(tables.plannedPosts).where(eq(tables.plannedPosts.id, postId)).limit(1);
  return plan ?? null;
}

const GONE = { ok: false, error: "That planned post no longer exists.", code: "PLAN_NOT_FOUND" } as const;

export async function getPublishChecks(postId: string, at: PublishAt): Promise<{ ok: true; checks: PublishCheck[] } | typeof GONE> {
  const plan = await loadPlan(postId);
  return plan ? { ok: true, checks: publishChecks(plan, at) } : GONE;
}

/** Kai's "Send to Gate 2" on a reel: stores a publish draft of the reel as it is now. Nothing is sent. */
export async function draftPublish(
  postId: string,
  at: PublishAt,
  proposer: string,
): Promise<{ ok: true; draftId: string } | { ok: false; error: string; code: string; checks?: PublishCheck[] }> {
  const plan = await loadPlan(postId);
  if (!plan) return GONE;
  if (!(DRAFTABLE as readonly string[]).includes(plan.state) || plan.scheduledAt) {
    return { ok: false, error: "This reel is already armed, publishing or published.", code: "PLAN_LOCKED" };
  }
  const checks = publishChecks(plan, at);
  if (checks.some((c) => c.status === "missing")) return { ok: false, error: "Fix the missing checks before sending this reel to Gate 2.", code: "PUBLISH_CHECKS_FAILED", checks };
  const [waiting] = await db
    .select({ id: tables.gateDrafts.id })
    .from(tables.gateDrafts)
    .where(and(eq(tables.gateDrafts.tool, PUBLISH_TOOL), eq(tables.gateDrafts.status, "pending"), sql`json_extract(${tables.gateDrafts.rawInput}, '$.postId') = ${postId}`));
  if (waiting) return { ok: false, error: "This reel already waits in Gate 2.", code: "DRAFT_EXISTS" };
  const input: PublishDraftInput = { postId, at, videoAssetId: plan.videoAssetId, caption: plan.caption, coverAssetId: plan.coverAssetId, keyword: plan.keyword };
  return { ok: true, draftId: draftGatedCall(proposer, PUBLISH_TOOL, input) };
}

async function runPublish(input: PublishDraftInput): Promise<SimpleResult> {
  const plan = await loadPlan(input.postId);
  if (!plan) return GONE;
  if (plan.videoAssetId !== input.videoAssetId || plan.caption !== input.caption || plan.coverAssetId !== input.coverAssetId) {
    return { ok: false, error: "The reel's video, caption or cover changed after this draft. Reject it and send the reel again.", code: "DRAFT_STALE" };
  }
  const missing = publishChecks(plan, input.at).find((c) => c.status === "missing");
  if (missing) return { ok: false, error: missing.detail, code: "PUBLISH_CHECKS_FAILED" };
  return input.at === "now" ? publishNowAction(input.postId) : schedulePublishAction(input.postId, input.at);
}

// SAFETY: draftPublish is the only writer of publish_reel drafts, and it stores a PublishDraftInput.
const publishInput = (d: Draft): PublishDraftInput | null => (d.tool === PUBLISH_TOOL ? (d.rawInput as PublishDraftInput) : null);

async function loadDraft(id: string): Promise<Draft | null> {
  const [draft] = await db.select().from(tables.gateDrafts).where(eq(tables.gateDrafts.id, id)).limit(1);
  return draft ?? null;
}

const NOT_PENDING = { ok: false, error: "This draft was already decided.", code: "DRAFT_NOT_PENDING" } as const;

/** Runs the drafted action in-process. The draft is marked approved first, because publish refuses a reel with no
 *  approved draft; a run that fails puts it back to pending with the error, so Kai can approve again or reject. */
export async function approveGateDraft(id: string, approver: string): Promise<SimpleResult> {
  const draft = await loadDraft(id);
  if (!draft) return { ok: false, error: "That draft no longer exists.", code: "DRAFT_NOT_FOUND" };
  if (draft.status !== "pending") return NOT_PENDING;
  const input = publishInput(draft);
  if (!input) return { ok: false, error: `Lead Studio cannot run ${draft.tool} yet.`, code: "DRAFT_NO_RUNNER" };
  const call = journalPending(approver, draft.tool, draft.rawInput, "gate2", id);
  const claimed = await db
    .update(tables.gateDrafts)
    .set({ status: "approved", decidedBy: approver, decidedAt: nowIso(), lastError: null })
    .where(and(eq(tables.gateDrafts.id, id), eq(tables.gateDrafts.status, "pending")))
    .returning({ id: tables.gateDrafts.id });
  if (claimed.length === 0) {
    journalOutcome(call, "error");
    return NOT_PENDING;
  }
  let result: SimpleResult;
  try {
    result = await runPublish(input);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err), code: "DRAFT_RUN_FAILED" };
  }
  if (!result.ok) {
    await db.update(tables.gateDrafts).set({ status: "pending", decidedBy: null, decidedAt: null, lastError: result.error }).where(eq(tables.gateDrafts.id, id));
  }
  journalOutcome(call, result.ok ? "ok" : "error");
  return result;
}

export async function rejectGateDraft(id: string, approver: string): Promise<SimpleResult> {
  const draft = await loadDraft(id);
  if (!draft) return { ok: false, error: "That draft no longer exists.", code: "DRAFT_NOT_FOUND" };
  const call = journalPending(approver, draft.tool, draft.rawInput, "gate2", id);
  const done = await db
    .update(tables.gateDrafts)
    .set({ status: "rejected", decidedBy: approver, decidedAt: nowIso() })
    .where(and(eq(tables.gateDrafts.id, id), eq(tables.gateDrafts.status, "pending")))
    .returning({ id: tables.gateDrafts.id });
  journalOutcome(call, done.length ? "rejected" : "error");
  return done.length ? { ok: true } : NOT_PENDING;
}

export interface Gate2Item {
  id: string;
  tool: string;
  caller: string;
  createdAt: string;
  status: Draft["status"];
  decidedBy: string | null;
  decidedAt: string | null;
  lastError: string | null;
  /** Null for a tool Lead Studio has no runner for; the board then shows the raw input. */
  publish: (PublishDraftInput & { title: string; to: string; checks: PublishCheck[]; stale: boolean }) | null;
  rawInput: unknown;
}

const DECIDED_SHOWN = 10;

/** The Gate 2 board: every draft waiting, newest first, then the last decided ones with who approved them and when. */
export async function getGate2Board(): Promise<{ pending: Gate2Item[]; decided: Gate2Item[] }> {
  const pending = await db.select().from(tables.gateDrafts).where(eq(tables.gateDrafts.status, "pending")).orderBy(desc(tables.gateDrafts.createdAt));
  const decided = await db.select().from(tables.gateDrafts).where(ne(tables.gateDrafts.status, "pending")).orderBy(desc(tables.gateDrafts.decidedAt)).limit(DECIDED_SHOWN);
  const inputs = [...pending, ...decided].flatMap((d) => publishInput(d) ?? []);
  const plans = inputs.length
    ? await db.select().from(tables.plannedPosts).where(inArray(tables.plannedPosts.id, inputs.map((i) => i.postId)))
    : [];
  const byId = new Map(plans.map((p) => [p.id, p]));
  const [own] = await db.select({ handle: tables.channels.handle }).from(tables.channels).where(eq(tables.channels.isOwn, true)).limit(1);
  const to = own ? `Instagram ${own.handle.startsWith("@") ? own.handle : `@${own.handle}`}` : "Your Instagram account";

  const item = (d: Draft): Gate2Item => {
    const base = { id: d.id, tool: d.tool, caller: d.caller, createdAt: d.createdAt, status: d.status, decidedBy: d.decidedBy, decidedAt: d.decidedAt, lastError: d.lastError, rawInput: d.rawInput };
    const input = publishInput(d);
    if (!input) return { ...base, publish: null };
    const plan = byId.get(input.postId);
    const stale = !plan || plan.videoAssetId !== input.videoAssetId || plan.caption !== input.caption || plan.coverAssetId !== input.coverAssetId;
    return { ...base, publish: { ...input, title: plan?.title ?? "(deleted reel)", to, checks: publishChecks(input, input.at), stale } };
  };
  return { pending: pending.map(item), decided: decided.map(item) };
}
