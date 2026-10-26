import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, newId, nowIso, tables } from "@/server/db";
import { FUNNEL_SOURCES } from "@/server/db/schema";
import { METRIC_IDS, METRIC_LEDGER, type Metric, type MetricId, type MetricSource, type MetricWindow } from "@/server/metrics/ledger";
import { newestCaptureByPost } from "@/server/queries/own-channel";

type FunnelSource = (typeof FUNNEL_SOURCES)[number];

function allowedMetrics(source: FunnelSource): string[] {
  return Object.values(METRIC_LEDGER).flatMap((m) => (m.kind === "count" && m.source.kind === "reel_funnel" && m.source.source === source ? [m.source.metric] : []));
}

export const FUNNEL_METRICS_TEXT = FUNNEL_SOURCES.map((source) => `${source}: ${allowedMetrics(source).join(", ")}`).join("; ");

export const FunnelRowSchema = z
  .object({
    keyword: z.string().trim().min(1).max(64),
    source: z.enum(FUNNEL_SOURCES),
    metric: z.string().trim().toLowerCase(),
    value: z.number().nonnegative(),
    capturedAt: z.iso
      .datetime({ offset: true })
      .refine((t) => !(Date.parse(t) > Date.now() + 5 * 60_000), "capturedAt is in the future"),
  })
  .superRefine((row, ctx) => {
    const allowed = allowedMetrics(row.source);
    if (!allowed.includes(row.metric)) {
      ctx.addIssue({ code: "custom", path: ["metric"], message: `unknown metric "${row.metric}" for ${row.source}; allowed: ${allowed.join(", ")}` });
    }
  });

export const SaveFunnelSchema = z.object({
  agent: z.string().trim().min(1).max(64),
  rows: z.array(FunnelRowSchema).min(1).max(1000),
});

export function saveFunnel(input: unknown): { ok: true; saved: number } | { ok: false; error: string } {
  const parsed = SaveFunnelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const now = nowIso();
  const values = parsed.data.rows.map((r) => ({
    id: newId(),
    keyword: r.keyword,
    source: r.source,
    metric: r.metric,
    value: r.value,
    capturedAt: new Date(r.capturedAt).toISOString(),
    agent: parsed.data.agent,
    createdAt: now,
  }));
  db.transaction((tx) => {
    tx.insert(tables.reelFunnel).values(values).run();
  });
  return { ok: true, saved: values.length };
}

export type Reading =
  | { status: "value"; value: number; capturedAt: string }
  | { status: "missing" }
  | { status: "not-connected"; connector: Extract<MetricSource, { kind: "not-connected" }>["connector"] };

export type MetricReading = { id: MetricId; label: string; window: MetricWindow; target: number | null } & Reading;

export interface FunnelEntry {
  keyword: string;
  plan: { id: string; title: string } | null;
  metrics: MetricReading[];
}

/** A plan's reel: the own post Kai marked by hand, else the one whose Graph media id publish stored. Pair with JOIN_PLAN_OWN_POST on `planned_posts p`. */
export const PLAN_OWN_POST_ID = sql.raw("coalesce(p.published_own_post_id, own_by_media.id)");
export const JOIN_PLAN_OWN_POST = sql.raw("LEFT JOIN own_posts own_by_media ON own_by_media.external_id = p.published_media_id");

type LatestRow = { key: string; keyword: string; source: FunnelSource; metric: string; value: number; captured_at: string };
type PlanRow = { key: string; id: string; title: string; keyword: string; own_post_id: string | null };
type InsightRow = typeof tables.ownPostInsights.$inferSelect;

export async function getFunnel(keyword?: string): Promise<FunnelEntry[]> {
  const only = keyword?.trim() ? sql`lower(keyword) = lower(${keyword.trim()})` : sql`1`;
  const snapshots = db.all<LatestRow>(sql`
    WITH latest AS (
      SELECT lower(keyword) AS key, keyword, source, metric, value, captured_at,
        ROW_NUMBER() OVER (PARTITION BY lower(keyword), source, metric ORDER BY captured_at DESC, rowid DESC) AS rn
      FROM reel_funnel
      WHERE ${only}
    )
    SELECT key, keyword, source, metric, value, captured_at FROM latest WHERE rn = 1
  `);
  const plans = db.all<PlanRow>(sql`
    SELECT lower(p.keyword) AS key, p.id, p.title, p.keyword, ${PLAN_OWN_POST_ID} AS own_post_id
    FROM planned_posts p ${JOIN_PLAN_OWN_POST}
    WHERE p.keyword IS NOT NULL AND ${only}
  `);
  const insights = await newestCaptureByPost(plans.flatMap((p) => (p.own_post_id ? [p.own_post_id] : [])), true);

  const planByKey = new Map(plans.map((p) => [p.key, p]));
  const snapshotByKey = new Map(snapshots.map((r) => [`${r.key}|${r.source}|${r.metric}`, r]));
  const keys = [...new Set([...plans.map((p) => p.key), ...snapshots.map((r) => r.key)])].sort();

  return keys.map((key) => {
    const plan = planByKey.get(key);
    const insight = plan?.own_post_id ? insights.get(plan.own_post_id) : undefined;
    const readSource = (s: MetricSource): Reading => {
      if (s.kind === "not-connected") return { status: "not-connected", connector: s.connector };
      if (s.kind === "own_post_insights") return readInsight(insight, s.column);
      const row = snapshotByKey.get(`${key}|${s.source}|${s.metric}`);
      return row ? { status: "value", value: row.value, capturedAt: row.captured_at } : { status: "missing" };
    };
    const read = (m: Metric): Reading =>
      m.kind === "count" ? readSource(m.source) : ratio(read(METRIC_LEDGER[m.numerator]), read(METRIC_LEDGER[m.denominator]));
    return {
      keyword: plan?.keyword ?? snapshots.find((r) => r.key === key)?.keyword ?? key,
      plan: plan ? { id: plan.id, title: plan.title } : null,
      metrics: METRIC_IDS.map((id) => {
        const m = METRIC_LEDGER[id];
        return { id, label: m.label, window: m.window, target: m.target, ...read(m) };
      }),
    };
  });
}

function readInsight(row: InsightRow | undefined, column: Extract<MetricSource, { kind: "own_post_insights" }>["column"]): Reading {
  const value = row?.[column];
  return row && value != null ? { status: "value", value, capturedAt: row.capturedAt } : { status: "missing" };
}

export function ratio(numerator: Reading, denominator: Reading): Reading {
  if (numerator.status === "not-connected") return numerator;
  if (denominator.status === "not-connected") return denominator;
  if (numerator.status === "missing" || denominator.status === "missing" || denominator.value === 0) return { status: "missing" };
  const capturedAt = numerator.capturedAt < denominator.capturedAt ? numerator.capturedAt : denominator.capturedAt;
  return { status: "value", value: numerator.value / denominator.value, capturedAt };
}
