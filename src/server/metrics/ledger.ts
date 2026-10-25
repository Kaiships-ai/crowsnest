import type { FUNNEL_SOURCES } from "@/server/db/schema";

type FunnelSource = (typeof FUNNEL_SOURCES)[number];

/** Where a count comes from. `not-connected` names the connector W2 has not built yet, so
 *  a reading of it is `not-connected`, never 0. */
export type MetricSource =
  | { kind: "own_post_insights"; column: "views" | "followsFromPost" | "bioLinkTaps" }
  | { kind: "reel_funnel"; source: FunnelSource; metric: string }
  | { kind: "not-connected"; connector: "umami" | "polar" | "chatbotx" };

/** Every number is the reel's newest lifetime snapshot. DA-05 adds the 48 h, 7 and 30 day windows. */
export type MetricWindow = "reel-lifetime";

interface MetricBase {
  label: string;
  window: MetricWindow;
  target: number | null;
}

export interface CountMetric extends MetricBase {
  kind: "count";
  source: MetricSource;
}

export interface RateMetric extends MetricBase {
  kind: "rate";
  numerator: CountId;
  denominator: CountId;
}

const COUNTS = {
  view: { kind: "count", label: "Views", window: "reel-lifetime", target: null, source: { kind: "own_post_insights", column: "views" } },
  follow: { kind: "count", label: "Follows", window: "reel-lifetime", target: null, source: { kind: "own_post_insights", column: "followsFromPost" } },
  bio_link_tap: { kind: "count", label: "Link in bio taps", window: "reel-lifetime", target: null, source: { kind: "own_post_insights", column: "bioLinkTaps" } },
  comment_keyword: { kind: "count", label: "Keyword comments", window: "reel-lifetime", target: null, source: { kind: "not-connected", connector: "chatbotx" } },
  dm: { kind: "count", label: "DMs", window: "reel-lifetime", target: null, source: { kind: "reel_funnel", source: "chatbotx", metric: "dms" } },
  gift_page_visit: { kind: "count", label: "Gift page visits", window: "reel-lifetime", target: null, source: { kind: "reel_funnel", source: "umami", metric: "visits" } },
  email: { kind: "count", label: "Emails", window: "reel-lifetime", target: null, source: { kind: "reel_funnel", source: "umami", metric: "emails" } },
  checkout: { kind: "count", label: "Checkouts", window: "reel-lifetime", target: null, source: { kind: "not-connected", connector: "polar" } },
  purchase: { kind: "count", label: "Purchases", window: "reel-lifetime", target: null, source: { kind: "reel_funnel", source: "polar", metric: "orders" } },
  revenue: { kind: "count", label: "Revenue", window: "reel-lifetime", target: null, source: { kind: "reel_funnel", source: "polar", metric: "revenue" } },
  skool_member: { kind: "count", label: "Skool members", window: "reel-lifetime", target: null, source: { kind: "reel_funnel", source: "skool", metric: "members" } },
} as const satisfies Record<string, CountMetric>;

export type CountId = keyof typeof COUNTS;

const RATES = {
  follow_rate: { kind: "rate", label: "Follow rate", window: "reel-lifetime", target: null, numerator: "follow", denominator: "view" },
  bio_link_tap_rate: { kind: "rate", label: "Link in bio tap rate", window: "reel-lifetime", target: null, numerator: "bio_link_tap", denominator: "view" },
  comment_rate: { kind: "rate", label: "Keyword comment rate", window: "reel-lifetime", target: null, numerator: "comment_keyword", denominator: "view" },
  dm_rate: { kind: "rate", label: "DM rate", window: "reel-lifetime", target: null, numerator: "dm", denominator: "comment_keyword" },
  visit_rate: { kind: "rate", label: "Gift page visit rate", window: "reel-lifetime", target: null, numerator: "gift_page_visit", denominator: "dm" },
  checkout_rate: { kind: "rate", label: "Checkout rate", window: "reel-lifetime", target: null, numerator: "checkout", denominator: "gift_page_visit" },
  purchase_rate: { kind: "rate", label: "Purchase rate", window: "reel-lifetime", target: null, numerator: "purchase", denominator: "checkout" },
} as const satisfies Record<string, RateMetric>;

/** The one definition of every funnel number, in funnel order: counts, then the rates
 *  between them. Boards and MCP tools read numbers through `services/funnel.ts`, which
 *  computes them from this table, so a target or formula changes here and nowhere else. */
export const METRIC_LEDGER = { ...COUNTS, ...RATES };

export type MetricId = keyof typeof METRIC_LEDGER;
export type Metric = CountMetric | RateMetric;

// SAFETY: Object.keys of a const object literal returns exactly its own keys.
export const METRIC_IDS = Object.keys(METRIC_LEDGER) as MetricId[];
