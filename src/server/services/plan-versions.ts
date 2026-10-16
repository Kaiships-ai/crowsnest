import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
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
  .refine((p) => PERIOD_KEY[p.period].test(p.periodKey), "periodKey must be YYYY-MM for a month or YYYY-Www for a week");

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
type KeptPost = { id: string; title: string; state: string };

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

function periodPosts(tx: Tx, v: PlanVersionRow) {
  const ids = tx
    .select({ id: tables.planVersions.id })
    .from(tables.planVersions)
    .where(and(eq(tables.planVersions.period, v.period), eq(tables.planVersions.periodKey, v.periodKey)))
    .all()
    .map((r) => r.id);
  return tx
    .select({ id: tables.plannedPosts.id, title: tables.plannedPosts.title, state: tables.plannedPosts.state, reelKey: tables.plannedPosts.planReelKey })
    .from(tables.plannedPosts)
    .where(and(inArray(tables.plannedPosts.planVersionId, ids), isNotNull(tables.plannedPosts.planReelKey)))
    .all();
}

// Drafts of the period are brought to exactly `v`'s reels; any other state is Kai's or the
// publisher's and is only reported.
function syncDrafts(tx: Tx, v: PlanVersionRow): { created: number; updated: number; removed: number; kept: KeptPost[] } {
  const reels = v.reels as Reel[];
  const posts = periodPosts(tx, v);
  const kept = posts.filter((p) => p.state !== "draft").map(({ id, title, state }) => ({ id, title, state }));
  const keptKeys = new Set(posts.filter((p) => p.state !== "draft").map((p) => p.reelKey));
  const drafts = new Map(posts.filter((p) => p.state === "draft").map((p) => [p.reelKey!, p.id]));
  const wanted = new Set(reels.map((r) => r.key));
  const removeIds = [...drafts].filter(([key]) => !wanted.has(key)).map(([, id]) => id);
  const P = tables.plannedPosts;
  const now = nowIso();

  if (removeIds.length) tx.delete(P).where(and(inArray(P.id, removeIds), eq(P.state, "draft"))).run();
  const updateIds = [...drafts].filter(([key]) => wanted.has(key)).map(([, id]) => id);
  // Cleared first so two reels can swap keywords without tripping planned_posts_keyword_lower.
  if (updateIds.length) tx.update(P).set({ keyword: null }).where(inArray(P.id, updateIds)).run();

  let created = 0;
  let updated = 0;
  for (const r of reels) {
    if (keptKeys.has(r.key)) continue;
    const fields = {
      title: r.title,
      plannedDate: r.date ?? null,
      plannedTime: r.time ?? null,
      keyword: r.keyword ?? null,
      note: r.note ?? null,
      planVersionId: v.id,
      planReelKey: r.key,
      updatedAt: now,
    };
    const id = drafts.get(r.key);
    if (id) {
      tx.update(P).set(fields).where(and(eq(P.id, id), eq(P.state, "draft"))).run();
      updated++;
    } else {
      tx.insert(P).values({ id: newId(), state: "draft", createdAt: now, ...fields }).run();
      created++;
    }
  }
  return { created, updated, removed: removeIds.length, kept };
}

function isUniqueViolation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  }
  return false;
}

function findVersion(tx: Tx, id: string) {
  return tx.select().from(tables.planVersions).where(eq(tables.planVersions.id, id)).get();
}

function guardKeywords<T>(run: () => T): T | Fail {
  try {
    return run();
  } catch (err) {
    if (isUniqueViolation(err)) return fail("KEYWORD_TAKEN", "a reel keyword is already held by another plan, possibly a scheduled or published one in this period; nothing was changed");
    throw err;
  }
}

export type ApproveResult = { ok: true; changed: boolean; live: { id: string; version: number }; created: number; updated: number; removed: number; kept: KeptPost[] } | Fail;

export function approvePlanVersion(id: string): ApproveResult {
  return guardKeywords(() =>
    db.transaction((tx): ApproveResult => {
      const v = findVersion(tx, id);
      if (!v) return fail("VERSION_NOT_FOUND", `no plan version ${id}`);
      if (v.status === "live") return { ok: true, changed: false, live: { id: v.id, version: v.version }, created: 0, updated: 0, removed: 0, kept: [] };
      const now = nowIso();
      const V = tables.planVersions;
      tx.update(V).set({ status: "superseded", updatedAt: now }).where(and(eq(V.period, v.period), eq(V.periodKey, v.periodKey), eq(V.status, "live"))).run();
      tx.update(V).set({ status: "live", approvedAt: now, updatedAt: now }).where(eq(V.id, v.id)).run();
      return { ok: true, changed: true, live: { id: v.id, version: v.version }, ...syncDrafts(tx, v) };
    }),
  );
}

export type UndoResult = { ok: true; live: { id: string; version: number } | null; created: number; updated: number; removed: number; kept: KeptPost[] } | Fail;

// Returns the period to the version that was live before the current one: the undone
// version goes back to proposed so it can be approved again.
export function undoPlanVersion(ref: unknown): UndoResult {
  const parsed = PlanRefSchema.safeParse(ref);
  if (!parsed.success) return fail("INVALID_PLAN", z.prettifyError(parsed.error));
  const { period, periodKey } = parsed.data;
  const V = tables.planVersions;
  return guardKeywords(() =>
    db.transaction((tx): UndoResult => {
      const inPeriod = and(eq(V.period, period), eq(V.periodKey, periodKey));
      const live = tx.select().from(V).where(and(inPeriod, eq(V.status, "live"))).get();
      if (!live) return fail("NOTHING_TO_UNDO", `no live version for ${period} ${periodKey}`);
      const prev = tx.select().from(V).where(and(inPeriod, eq(V.status, "superseded"), isNotNull(V.approvedAt))).orderBy(desc(V.approvedAt), desc(V.version)).get();
      const now = nowIso();
      tx.update(V).set({ status: "proposed", approvedAt: null, updatedAt: now }).where(eq(V.id, live.id)).run();
      if (!prev) {
        const posts = periodPosts(tx, live);
        const drafts = posts.filter((p) => p.state === "draft").map((p) => p.id);
        if (drafts.length) tx.delete(tables.plannedPosts).where(and(inArray(tables.plannedPosts.id, drafts), eq(tables.plannedPosts.state, "draft"))).run();
        const kept = posts.filter((p) => p.state !== "draft").map(({ id, title, state }) => ({ id, title, state }));
        return { ok: true, live: null, created: 0, updated: 0, removed: drafts.length, kept };
      }
      tx.update(V).set({ status: "live", updatedAt: now }).where(eq(V.id, prev.id)).run();
      return { ok: true, live: { id: prev.id, version: prev.version }, ...syncDrafts(tx, prev) };
    }),
  );
}

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
    added.length && `added ${added.join("; ")}`,
    removed.length && `removed ${removed.join("; ")}`,
    changed.length && `changed ${changed.join("; ")}`,
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
  const parsed = PlanRefSchema.and(z.object({ version: z.number().int().positive().optional() })).safeParse(input);
  if (!parsed.success) return fail("INVALID_PLAN", z.prettifyError(parsed.error));
  const { period, periodKey, version } = parsed.data;
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
  return { ok: true, versions };
}
