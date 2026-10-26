import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db, newId, nowIso, tables } from "@/server/db";
import { PLAN_PERIODS } from "@/server/db/schema";

export const ReelSchema = z.object({
  key: z.string().trim().min(1).max(64).describe("Stable id of this reel across versions, e.g. 'w44-plugin'. Keep it when you edit a reel."),
  title: z.string().trim().min(1).max(200),
  date: z.iso.date().nullable().optional().describe("YYYY-MM-DD, or null for an undated reel."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM").nullable().optional(),
  keyword: z.string().trim().min(1).max(64).nullable().optional().describe("Comment keyword, unique across plans, case-insensitive."),
  note: z.string().max(2000).nullable().optional(),
});

export const ReelListSchema = z
  .array(ReelSchema)
  .min(1)
  .max(62)
  .refine((reels) => new Set(reels.map((r) => r.key)).size === reels.length, "reel keys must be unique")
  .refine((reels) => {
    const kws = reels.flatMap((r) => (r.keyword ? [r.keyword.toLowerCase()] : []));
    return new Set(kws).size === kws.length;
  }, "keywords must be unique within the plan");

const PERIOD_KEY = { month: /^\d{4}-(0[1-9]|1[0-2])$/, week: /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/ } as const;

export const PlanRefSchema = z
  .object({
    period: z.enum(PLAN_PERIODS),
    periodKey: z.string().describe("Month 'YYYY-MM' or ISO week 'YYYY-Www', e.g. '2026-W44'."),
  })
  .refine((p) => PERIOD_KEY[p.period].test(p.periodKey), "periodKey must be YYYY-MM for a month or YYYY-Www for a week")
  .refine((p) => !p.periodKey.endsWith("W53") || hasWeek53(Number(p.periodKey.slice(0, 4))), "this ISO year has only 52 weeks");

function hasWeek53(year: number): boolean {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
  return jan1 === 4 || (leap && jan1 === 3);
}

export const ProposePlanSchema = z.object({
  period: z.enum(PLAN_PERIODS),
  periodKey: z.string().describe("Month 'YYYY-MM' or ISO week 'YYYY-Www', e.g. '2026-W44'."),
  agent: z.string().trim().min(1).max(64).describe("Who proposed this plan: 'claude', 'codex', or your label."),
  reels: ReelListSchema,
});

export type Reel = z.infer<typeof ReelSchema>;
export type PlanRef = z.infer<typeof PlanRefSchema>;
type Fail = { ok: false; error: string; code: string };
type PlanVersionRow = typeof tables.planVersions.$inferSelect;

const fail = (code: string, error: string): Fail => ({ ok: false, code, error });

export function proposePlan(input: unknown): { ok: true; id: string; version: number } | Fail {
  const parsed = ProposePlanSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_PLAN", z.prettifyError(parsed.error));
  const ref = PlanRefSchema.safeParse(parsed.data);
  if (!ref.success) return fail("INVALID_PLAN", z.prettifyError(ref.error));
  const { period, periodKey, agent, reels } = parsed.data;
  return db.transaction((tx) => {
    const last = tx
      .select({ version: tables.planVersions.version })
      .from(tables.planVersions)
      .where(and(eq(tables.planVersions.period, period), eq(tables.planVersions.periodKey, periodKey)))
      .orderBy(desc(tables.planVersions.version))
      .get();
    const version = (last?.version ?? 0) + 1;
    const id = newId();
    const now = nowIso();
    tx.insert(tables.planVersions).values({ id, period, periodKey, version, status: "proposed", reels, agent, createdAt: now, updatedAt: now }).run();
    return { ok: true as const, id, version };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Post = typeof tables.plannedPosts.$inferSelect;
export type SyncedFields = { title: string; date: string | null; time: string | null; keyword: string | null; note: string | null };
const SYNCED = ["title", "date", "time", "keyword", "note"] as const;
export type KeepReason = "not_draft" | "has_script" | "has_video" | "has_caption" | "has_source_video" | "has_magnet" | "has_settings" | "edited";
export type KeptPost = { id: string; title: string; state: string; reelKey: string; reason: KeepReason; notApplied: string[] };
type SyncResult = { created: number; updated: number; removed: number; kept: KeptPost[] };

const synced = (r: Reel): SyncedFields => ({ title: r.title, date: r.date ?? null, time: r.time ?? null, keyword: r.keyword ?? null, note: r.note ?? null });
const current = (p: Post): SyncedFields => ({ title: p.title, date: p.plannedDate, time: p.plannedTime, keyword: p.keyword, note: p.note });
const sameFields = (a: SyncedFields, b: SyncedFields) => SYNCED.every((f) => a[f] === b[f]);

function keepReason(p: Post): KeepReason | null {
  if (p.state !== "draft") return "not_draft";
  if (p.scriptId) return "has_script";
  if (p.videoAssetId) return "has_video";
  if (p.caption) return "has_caption";
  if (p.sourceVideoId) return "has_source_video";
  if (p.magnetUrl) return "has_magnet";
  if (p.targetLengthSec != null || p.videoKind || p.remixSessionId) return "has_settings";
  if (!p.planSynced || !sameFields(current(p), p.planSynced as SyncedFields)) return "edited";
  return null;
}

function periodPosts(tx: Tx, v: PlanVersionRow): Post[] {
  const ids = tx
    .select({ id: tables.planVersions.id })
    .from(tables.planVersions)
    .where(and(eq(tables.planVersions.period, v.period), eq(tables.planVersions.periodKey, v.periodKey)))
    .all()
    .map((r) => r.id);
  return tx.select().from(tables.plannedPosts).where(and(inArray(tables.plannedPosts.planVersionId, ids), isNotNull(tables.plannedPosts.planReelKey))).all();
}

function syncDrafts(tx: Tx, v: PlanVersionRow): SyncResult {
  const target = new Map((v.reels as Reel[]).map((r) => [r.key, synced(r)]));
  const P = tables.plannedPosts;
  const now = nowIso();
  const kept: KeptPost[] = [];
  const pristine = new Map<string, string>();
  for (const p of periodPosts(tx, v)) {
    const key = p.planReelKey!;
    const reason = keepReason(p);
    if (!reason) {
      pristine.set(key, p.id);
      continue;
    }
    const want = target.get(key);
    const was = p.planSynced as SyncedFields | null;
    const notApplied = !want ? ["removed"] : was ? SYNCED.filter((f) => was[f] !== want[f]) : [...SYNCED];
    kept.push({ id: p.id, title: p.title, state: p.state, reelKey: key, reason, notApplied });
    target.delete(key);
  }

  const removeIds = [...pristine].filter(([key]) => !target.has(key)).map(([, id]) => id);
  if (removeIds.length) tx.delete(P).where(inArray(P.id, removeIds)).run();
  const updateIds = [...pristine].filter(([key]) => target.has(key)).map(([, id]) => id);
  // Cleared first so two reels can swap keywords without tripping planned_posts_keyword_lower.
  if (updateIds.length) tx.update(P).set({ keyword: null }).where(inArray(P.id, updateIds)).run();

  for (const f of target.values()) {
    if (!f.keyword) continue;
    const holder = tx.select({ id: P.id, reelKey: P.planReelKey }).from(P).where(sql`lower(${P.keyword}) = ${f.keyword.toLowerCase()}`).get();
    if (holder) throw new KeywordTaken(f.keyword, holder);
  }

  let created = 0;
  for (const [key, f] of target) {
    const fields = { title: f.title, plannedDate: f.date, plannedTime: f.time, keyword: f.keyword, note: f.note, planSynced: f, planVersionId: v.id, planReelKey: key, updatedAt: now };
    const id = pristine.get(key);
    if (id) tx.update(P).set(fields).where(eq(P.id, id)).run();
    else {
      tx.insert(P).values({ id: newId(), state: "draft", createdAt: now, ...fields }).run();
      created++;
    }
  }
  return { created, updated: updateIds.length, removed: removeIds.length, kept };
}

class KeywordTaken extends Error {
  constructor(keyword: string, holder: { id: string; reelKey: string | null }) {
    super(`keyword ${keyword} is held by post ${holder.id} (reel key ${holder.reelKey ?? "none, not from a plan"}); nothing was changed`);
  }
}

function uniqueIndexHit(err: unknown): string | null {
  for (let e = err; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE") return e.message;
  }
  return null;
}

function findVersion(tx: Tx, id: string) {
  return tx.select().from(tables.planVersions).where(eq(tables.planVersions.id, id)).get();
}

function guardKeywords<T>(run: () => T): T | Fail {
  try {
    return run();
  } catch (err) {
    if (err instanceof KeywordTaken) return fail("KEYWORD_TAKEN", err.message);
    const msg = uniqueIndexHit(err);
    if (msg?.includes("planned_posts_keyword_lower")) return fail("KEYWORD_TAKEN", "a reel keyword is already held by another plan, possibly a kept or scheduled one in this period; nothing was changed");
    if (msg) return fail("PLAN_CONFLICT", `${msg}; nothing was changed`);
    throw err;
  }
}

export type ApproveResult = ({ ok: true; changed: boolean; live: { id: string; version: number } } & SyncResult) | Fail;

export function approvePlanVersion(id: string, approver: string): ApproveResult {
  return guardKeywords(() =>
    db.transaction((tx): ApproveResult => {
      const v = findVersion(tx, id);
      if (!v) return fail("VERSION_NOT_FOUND", `no plan version ${id}`);
      if (v.status === "live") return { ok: true, changed: false, live: { id: v.id, version: v.version }, created: 0, updated: 0, removed: 0, kept: [] };
      const now = nowIso();
      const V = tables.planVersions;
      tx.update(V).set({ status: "superseded", updatedAt: now }).where(and(eq(V.period, v.period), eq(V.periodKey, v.periodKey), eq(V.status, "live"))).run();
      tx.update(V).set({ status: "live", approvedAt: now, approvedBy: approver, updatedAt: now }).where(eq(V.id, v.id)).run();
      return { ok: true, changed: true, live: { id: v.id, version: v.version }, ...syncDrafts(tx, v) };
    }),
  );
}

export type PlanChange = { key: string; kind: "add" | "remove" | "edit"; before: Reel | null; after: Reel | null };

const reelOrder = (a: Reel, b: Reel) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || (a.time ?? "").localeCompare(b.time ?? "") || a.key.localeCompare(b.key);

/** What a proposal changes against the live plan, one entry per reel key, in plan order. */
export function planChanges(live: Reel[], proposed: Reel[]): PlanChange[] {
  const before = new Map(live.map((r) => [r.key, r]));
  const after = new Map(proposed.map((r) => [r.key, r]));
  const changes: PlanChange[] = [];
  for (const r of proposed) {
    const old = before.get(r.key);
    if (!old) changes.push({ key: r.key, kind: "add", before: null, after: r });
    else if (!sameFields(synced(old), synced(r))) changes.push({ key: r.key, kind: "edit", before: old, after: r });
  }
  for (const r of live) if (!after.has(r.key)) changes.push({ key: r.key, kind: "remove", before: r, after: null });
  return changes.sort((a, b) => reelOrder(a.after ?? a.before!, b.after ?? b.before!));
}

/** The live plan with only the chosen changes applied. */
export function applyChanges(live: Reel[], changes: PlanChange[]): Reel[] {
  const reels = new Map(live.map((r) => [r.key, r]));
  for (const c of changes) {
    if (c.after) reels.set(c.key, c.after);
    else reels.delete(c.key);
  }
  return [...reels.values()].sort(reelOrder);
}

/** Approves a proposal with only the changes the approver kept. All kept: the proposal goes
 *  live as it is. Some kept: a new version made of the live plan plus those changes is
 *  proposed under the approver's name and goes live instead, and the proposal stays behind it. */
export function approvePlanChanges(versionId: string, keys: string[], approver: string): ApproveResult {
  const V = tables.planVersions;
  const v = db.select().from(V).where(eq(V.id, versionId)).get();
  if (!v) return fail("VERSION_NOT_FOUND", `no plan version ${versionId}`);
  if (v.status !== "proposed") return fail("NOT_PROPOSED", `v${v.version} is ${v.status}, not waiting for approval`);
  const live = db.select().from(V).where(and(eq(V.period, v.period), eq(V.periodKey, v.periodKey), eq(V.status, "live"))).get();
  const changes = planChanges((live?.reels as Reel[] | undefined) ?? [], v.reels as Reel[]);
  const kept = changes.filter((c) => keys.includes(c.key));
  if (kept.length === 0) return fail("NOTHING_KEPT", "no change is switched on; nothing was approved");
  if (kept.length === changes.length) return approvePlanVersion(v.id, approver);
  const reels = applyChanges((live?.reels as Reel[] | undefined) ?? [], kept);
  const proposed = proposePlan({ period: v.period, periodKey: v.periodKey, agent: approver, reels });
  if (!proposed.ok) return proposed;
  const approved = approvePlanVersion(proposed.id, approver);
  // A refused approval leaves no half-made version behind.
  if (!approved.ok) db.delete(V).where(eq(V.id, proposed.id)).run();
  return approved;
}

export type UndoResult = ({ ok: true; live: { id: string; version: number } } & SyncResult) | Fail;

/** `expectLiveId` pins the undo to the version the caller just approved: if another
 *  version went live since, nothing changes. */
export function undoPlanVersion(ref: unknown, expectLiveId?: string): UndoResult {
  const parsed = PlanRefSchema.safeParse(ref);
  if (!parsed.success) return fail("INVALID_PLAN", z.prettifyError(parsed.error));
  const { period, periodKey } = parsed.data;
  const V = tables.planVersions;
  return guardKeywords(() =>
    db.transaction((tx): UndoResult => {
      const inPeriod = and(eq(V.period, period), eq(V.periodKey, periodKey));
      const live = tx.select().from(V).where(and(inPeriod, eq(V.status, "live"))).get();
      if (!live) return fail("NOTHING_TO_UNDO", `no live version for ${period} ${periodKey}`);
      if (expectLiveId && live.id !== expectLiveId) return fail("LIVE_CHANGED", `v${live.version} is live now, not the version you approved; nothing was changed`);
      const prev = tx.select().from(V).where(and(inPeriod, eq(V.status, "superseded"), isNotNull(V.approvedAt))).orderBy(desc(V.approvedAt), desc(V.version)).get();
      if (!prev) return fail("NOTHING_TO_UNDO", `v${live.version} is the only version ever live for ${period} ${periodKey}; nothing earlier to restore`);
      const now = nowIso();
      tx.update(V).set({ status: "proposed", approvedAt: null, approvedBy: null, updatedAt: now }).where(eq(V.id, live.id)).run();
      tx.update(V).set({ status: "live", updatedAt: now }).where(eq(V.id, prev.id)).run();
      return { ok: true, live: { id: prev.id, version: prev.version }, ...syncDrafts(tx, prev) };
    }),
  );
}

const names = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join("; ")} +${xs.length - 3} more` : xs.join("; "));

function diffReels(prev: Reel[], next: Reel[]): string {
  const before = new Map(prev.map((r) => [r.key, r]));
  const after = new Set(next.map((r) => r.key));
  const added = next.filter((r) => !before.has(r.key)).map((r) => r.title);
  const removed = prev.filter((r) => !after.has(r.key)).map((r) => r.title);
  const changed = next
    .filter((r) => before.has(r.key))
    .flatMap((r) => {
      const old = before.get(r.key)!;
      const fields = (["title", "date", "time", "keyword", "note"] as const).filter((f) => (old[f] ?? null) !== (r[f] ?? null));
      return fields.length ? [`${r.title} (${fields.join(", ")})`] : [];
    });
  const parts = [
    added.length && `added ${names(added)}`,
    removed.length && `removed ${names(removed)}`,
    changed.length && `changed ${names(changed)}`,
  ].filter(Boolean);
  return parts.length ? parts.join(". ") : "no reel changes";
}

export interface PlanVersionSummary {
  id: string;
  version: number;
  status: string;
  agent: string;
  reelCount: number;
  createdAt: string;
  approvedAt: string | null;
  diff: string;
  reels?: Reel[];
}

export function listPlanVersions(input: unknown): { ok: true; versions: PlanVersionSummary[] } | Fail {
  const parsed = PlanRefSchema.and(z.object({ version: z.number().int().positive().optional(), limit: z.number().int().default(5) })).safeParse(input);
  if (!parsed.success) return fail("INVALID_PLAN", z.prettifyError(parsed.error));
  const { period, periodKey, version } = parsed.data;
  const limit = Math.min(50, Math.max(1, parsed.data.limit));
  const V = tables.planVersions;
  const rows = db.select().from(V).where(and(eq(V.period, period), eq(V.periodKey, periodKey))).orderBy(V.version).all();
  const versions = rows.map((r, i) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    agent: r.agent,
    reelCount: (r.reels as Reel[]).length,
    createdAt: r.createdAt,
    approvedAt: r.approvedAt,
    diff: i === 0 ? "first version" : `vs v${rows[i - 1].version}: ${diffReels(rows[i - 1].reels as Reel[], r.reels as Reel[])}`,
    ...(r.version === version ? { reels: r.reels as Reel[] } : {}),
  }));
  if (version !== undefined && !rows.some((r) => r.version === version)) return fail("INVALID_PLAN", `no version ${version} for ${period} ${periodKey}`);
  const newest = versions.reverse().slice(0, limit);
  const asked = versions.find((v) => v.version === version);
  return { ok: true, versions: asked && !newest.includes(asked) ? [...newest, asked] : newest };
}
