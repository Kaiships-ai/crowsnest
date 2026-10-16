import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, newId, nowIso, tables } from "@/server/db";
import { FUNNEL_SOURCES } from "@/server/db/schema";

export const FunnelRowSchema = z.object({
  keyword: z.string().trim().min(1).max(64),
  source: z.enum(FUNNEL_SOURCES),
  metric: z.string().trim().toLowerCase().min(1).max(64),
  value: z.number().nonnegative(),
  capturedAt: z.iso
    .datetime({ offset: true })
    .refine((t) => Date.parse(t) <= Date.now() + 5 * 60_000, "capturedAt is in the future")
    .optional(),
});

export const SaveFunnelSchema = z.object({
  agent: z.string().trim().min(1).max(64).describe("Who captured these numbers, for provenance: 'claude', 'codex', or your label."),
  rows: z.array(FunnelRowSchema).min(1).max(1000).describe("1 to 1000 rows: { keyword, source, metric, value, capturedAt? }."),
});

export interface FunnelEntry {
  keyword: string;
  source: (typeof FUNNEL_SOURCES)[number];
  metric: string;
  value: number;
  capturedAt: string;
  agent: string;
  plan: { id: string; title: string } | null;
}

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
    capturedAt: r.capturedAt ? new Date(r.capturedAt).toISOString() : now,
    agent: parsed.data.agent,
    createdAt: now,
  }));
  db.transaction((tx) => {
    tx.insert(tables.reelFunnel).values(values).run();
  });
  return { ok: true, saved: values.length };
}

type LatestRow = {
  keyword: string;
  source: FunnelEntry["source"];
  metric: string;
  value: number;
  captured_at: string;
  agent: string;
  plan_id: string | null;
  plan_title: string | null;
};

export function getFunnel(): FunnelEntry[] {
  const rows = db.all<LatestRow>(sql`
    WITH latest AS (
      SELECT keyword, source, metric, value, captured_at, agent,
        ROW_NUMBER() OVER (PARTITION BY lower(keyword), source, metric ORDER BY captured_at DESC, rowid DESC) AS rn
      FROM reel_funnel
    )
    SELECT l.keyword, l.source, l.metric, l.value, l.captured_at, l.agent, p.id AS plan_id, p.title AS plan_title
    FROM latest l
    LEFT JOIN planned_posts p ON p.keyword IS NOT NULL AND lower(p.keyword) = lower(l.keyword)
    WHERE l.rn = 1
    ORDER BY lower(l.keyword), l.source, l.metric
  `);
  return rows.map((r) => ({
    keyword: r.keyword,
    source: r.source,
    metric: r.metric,
    value: r.value,
    capturedAt: r.captured_at,
    agent: r.agent,
    plan: r.plan_id ? { id: r.plan_id, title: r.plan_title ?? "" } : null,
  }));
}
