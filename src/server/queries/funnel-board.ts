import { FUNNEL_STEPS, METRIC_IDS, METRIC_LEDGER, type CountId, type MetricId, type MetricSource } from "@/server/metrics/ledger";
import { getFunnel, ratio, type FunnelEntry, type MetricReading, type Reading } from "@/server/services/funnel";

/** Where a count comes from: `instagram` for the reel's own insights, else the funnel source or the connector not built yet. */
export type StepSource = "instagram" | Extract<MetricSource, { kind: "reel_funnel" }>["source"] | Extract<MetricSource, { kind: "not-connected" }>["connector"];

/** A sum over keywords. `missingKeywords` counts keywords with no number while others have one, so the total is a floor. */
export type TotalReading = Reading & { missingKeywords: number };

export interface FunnelStep {
  id: CountId;
  label: string;
  source: StepSource;
  total: TotalReading;
  /** The rate from the step before; null on the first step. */
  rate: { id: MetricId; label: string; target: number | null; reading: Reading } | null;
}

export type Coverage = { status: "value"; tied: number; total: number } | Exclude<Reading, { status: "value" }>;

export interface FunnelBoard {
  steps: FunnelStep[];
  keywords: { keyword: string; plan: FunnelEntry["plan"]; steps: Reading[] }[];
  /** Of all gift-page visits and orders stored per keyword, how many sit under a keyword a planned reel holds. */
  coverage: { visits: Coverage; orders: Coverage };
}

function sourceOf(source: MetricSource): StepSource {
  if (source.kind === "own_post_insights") return "instagram";
  if (source.kind === "reel_funnel") return source.source;
  return source.connector;
}

function rateId(numerator: CountId, denominator: CountId): MetricId {
  const id = METRIC_IDS.find((m) => {
    const metric = METRIC_LEDGER[m];
    return metric.kind === "rate" && metric.numerator === numerator && metric.denominator === denominator;
  });
  if (!id) throw new Error(`the ledger has no rate ${numerator}/${denominator}`);
  return id;
}

const reading = (entry: FunnelEntry, id: MetricId): MetricReading => {
  const found = entry.metrics.find((m) => m.id === id);
  if (!found) throw new Error(`funnel entry ${entry.keyword} has no ${id}`);
  return found;
};

function sumReadings(readings: Reading[], notConnected: Reading | null): TotalReading {
  if (notConnected?.status === "not-connected") return { ...notConnected, missingKeywords: 0 };
  const values = readings.flatMap((r) => (r.status === "value" ? [r] : []));
  if (values.length === 0) return { status: "missing", missingKeywords: 0 };
  return {
    status: "value",
    value: values.reduce((sum, r) => sum + r.value, 0),
    capturedAt: values.reduce((oldest, r) => (r.capturedAt < oldest ? r.capturedAt : oldest), values[0].capturedAt),
    missingKeywords: readings.length - values.length,
  };
}

function coverage(entries: FunnelEntry[], id: CountId): Coverage {
  const metric = METRIC_LEDGER[id];
  if (metric.source.kind === "not-connected") return { status: "not-connected", connector: metric.source.connector };
  const valued = entries.flatMap((e) => {
    const r = reading(e, id);
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

export async function getFunnelBoard(): Promise<FunnelBoard> {
  const entries = await getFunnel();
  const totals = FUNNEL_STEPS.map((id) => sumReadings(entries.map((e) => reading(e, id)), notConnectedReading(id)));
  const steps = FUNNEL_STEPS.map((id, i): FunnelStep => {
    const metric = METRIC_LEDGER[id];
    const prev = i > 0 ? FUNNEL_STEPS[i - 1] : null;
    const rid = prev ? rateId(id, prev) : null;
    const rate = rid ? { id: rid, label: METRIC_LEDGER[rid].label, target: METRIC_LEDGER[rid].target, reading: ratio(totals[i], totals[i - 1]) } : null;
    return { id, label: metric.label, source: sourceOf(metric.source), total: totals[i], rate };
  });
  return {
    steps,
    keywords: entries.map((e) => ({ keyword: e.keyword, plan: e.plan, steps: FUNNEL_STEPS.map((id) => reading(e, id)) })),
    coverage: { visits: coverage(entries, "gift_page_visit"), orders: coverage(entries, "purchase") },
  };
}
