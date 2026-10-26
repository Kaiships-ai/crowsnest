import { instagramGraph } from "@/server/connectors/instagram-graph/manifest";
import { CONNECTORS } from "@/server/connectors/registry";
import type { Connector } from "@/server/connectors/types";
import { GIFT_PAGE_PREFIX } from "@/server/connectors/umami/days";
import { db, tables } from "@/server/db";
import { clockNow } from "@/server/lib/clock";
import { FUNNEL_STEPS, METRIC_LEDGER, type CountId, type MetricId, type MetricSource } from "@/server/metrics/ledger";
import { getVaultBoard, type VaultRow } from "@/server/queries/vault-board";
import { getFunnel, ratio, type FunnelEntry, type MetricReading, type Reading } from "@/server/services/funnel";

export type StepSource = "instagram" | Extract<MetricSource, { kind: "reel_funnel" }>["source"] | Extract<MetricSource, { kind: "not-connected" }>["connector"];

export type TotalReading = Reading & { keywordsWithoutNumber: number };

export interface FunnelStep {
  id: CountId;
  label: string;
  source: StepSource;
  total: TotalReading;
  rate: { id: MetricId; label: string; target: number | null; reading: Reading } | null;
}

export type Coverage = { status: "value"; tied: number; total: number } | Exclude<Reading, { status: "value" }>;

/** The newest pull of the step's source, when it did not complete. */
export type StepPull = "failed" | "partial" | null;
export type BoardStep = FunnelStep & { pull: StepPull };

export interface FunnelBoard {
  steps: BoardStep[];
  keywords: { keyword: string; plan: FunnelEntry["plan"]; steps: Reading[] }[];
  coverage: { visits: Coverage; orders: Coverage };
}

function sourceOf(source: MetricSource): StepSource {
  if (source.kind === "own_post_insights") return "instagram";
  if (source.kind === "reel_funnel") return source.source;
  return source.connector;
}

export const entryReading = (entry: FunnelEntry, id: MetricId): MetricReading => {
  const found = entry.metrics.find((m) => m.id === id);
  if (!found) throw new Error(`funnel entry ${entry.keyword} has no ${id}`);
  return found;
};

function sumReadings(readings: Reading[], notConnected: Reading | null): TotalReading {
  if (notConnected?.status === "not-connected") return { ...notConnected, keywordsWithoutNumber: 0 };
  const values = readings.flatMap((r) => (r.status === "value" ? [r] : []));
  if (values.length === 0) return { status: "missing", keywordsWithoutNumber: 0 };
  return {
    status: "value",
    value: values.reduce((sum, r) => sum + r.value, 0),
    capturedAt: values.reduce((oldest, r) => (r.capturedAt < oldest ? r.capturedAt : oldest), values[0].capturedAt),
    keywordsWithoutNumber: readings.length - values.length,
  };
}

/** Every clean gift-page pageview Umami stored, tagged or not: the denominator of visit coverage. */
function allGiftPageviews(): number | null {
  const days = db.select({ clean: tables.umamiDays.clean }).from(tables.umamiDays).all();
  if (days.length === 0) return null;
  return days.reduce((sum, d) => sum + Object.entries(d.clean.paths).reduce((s, [path, n]) => s + (path.startsWith(GIFT_PAGE_PREFIX) ? n : 0), 0), 0);
}

function visitCoverage(entries: FunnelEntry[]): Coverage {
  const total = allGiftPageviews();
  if (total === null) return { status: "missing" };
  const tied = entries.reduce((sum, e) => {
    const r = entryReading(e, "gift_page_visit");
    return sum + (e.plan && r.status === "value" ? r.value : 0);
  }, 0);
  return { status: "value", tied, total };
}

function coverage(entries: FunnelEntry[], id: CountId): Coverage {
  const metric = METRIC_LEDGER[id];
  if (metric.source.kind === "not-connected") return { status: "not-connected", connector: metric.source.connector };
  const valued = entries.flatMap((e) => {
    const r = entryReading(e, id);
    return r.status === "value" ? [{ tied: e.plan !== null, value: r.value }] : [];
  });
  if (valued.length === 0) return { status: "missing" };
  return {
    status: "value",
    tied: valued.reduce((sum, v) => sum + (v.tied ? v.value : 0), 0),
    total: valued.reduce((sum, v) => sum + v.value, 0),
  };
}

function notConnectedReading(id: CountId): Reading | null {
  const source = METRIC_LEDGER[id].source;
  return source.kind === "not-connected" ? { status: "not-connected", connector: source.connector } : null;
}

const stepTotal = (entries: FunnelEntry[], id: CountId) => sumReadings(entries.map((e) => entryReading(e, id)), notConnectedReading(id));

/** A step's rate over only the keywords that have both its number and the step before's, so neither side counts a keyword the other lacks. */
function matchedRate(entries: FunnelEntry[], step: CountId, previous: CountId): Reading {
  const both = entries.filter((e) => entryReading(e, step).status === "value" && entryReading(e, previous).status === "value");
  return ratio(stepTotal(both, step), stepTotal(both, previous));
}

export function funnelSteps(entries: FunnelEntry[]): FunnelStep[] {
  return FUNNEL_STEPS.map(({ count, rate }, i): FunnelStep => {
    const metric = METRIC_LEDGER[count];
    return {
      id: count,
      label: metric.label,
      source: sourceOf(metric.source),
      total: stepTotal(entries, count),
      rate: rate ? { id: rate, label: METRIC_LEDGER[rate].label, target: METRIC_LEDGER[rate].target, reading: matchedRate(entries, count, FUNNEL_STEPS[i - 1].count) } : null,
    };
  });
}

const CONNECTOR_OF_SOURCE: Partial<Record<StepSource, string>> = { instagram: instagramGraph.id };

export function withPulls(steps: FunnelStep[], sources: Pick<VaultRow, "id" | "state">[]): BoardStep[] {
  const stateOf = new Map(sources.map((s) => [s.id, s.state]));
  return steps.map((step) => {
    const state = stateOf.get(CONNECTOR_OF_SOURCE[step.source] ?? step.source);
    return { ...step, pull: state === "error" ? "failed" : state === "partial" ? "partial" : null };
  });
}

export async function getFunnelBoard(now: Date = clockNow(), registry: Connector[] = CONNECTORS): Promise<FunnelBoard> {
  const entries = await getFunnel();
  return {
    steps: withPulls(funnelSteps(entries), getVaultBoard(now, registry)),
    keywords: entries.map((e) => ({ keyword: e.keyword, plan: e.plan, steps: FUNNEL_STEPS.map(({ count }) => entryReading(e, count)) })),
    coverage: { visits: visitCoverage(entries), orders: coverage(entries, "purchase") },
  };
}
