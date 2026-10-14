/**
 * Six own-channel stat tiles (v1-scope.md §1 "My channel": "Six stat tiles, each
 * carrying its sample size. Locked."). Every tile below reads straight off
 * `OwnChannelOverview` — nothing here computes a number the query didn't already
 * produce, and every `OwnMetric` renders its own sample size in the same breath as its
 * value, never as a separate footnote that could go stale on its own.
 *
 * `profileVisits`, `followsFromPost` and `watchTimeSec` have no tile here at all — the
 * ported Graph client never requests them (own-channel.ts's `WIRED` map), and a tile for
 * a number the app cannot produce is the exact "control that does nothing" the brief
 * bans, just wearing a stat-tile costume instead of a button.
 */

import type { OwnChannelOverview, OwnMetric } from "@/server/queries/own-channel";

function formatInt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US");
}

function Tile({ value, label, sample, tone = "foreground" }: { value: string; label: string; sample: string; tone?: "foreground" | "score" }) {
  return (
    <div>
      <span
        data-num
        className={`block font-mono text-[52px] leading-none tracking-tight tabular-nums ${tone === "score" ? "text-primary" : "text-foreground"}`}
      >
        {value}
      </span>
      <span className="mt-3 block max-w-[19ch] text-[15px] text-muted-foreground">{label}</span>
      <span className="mt-1.5 block font-mono text-2xs text-muted-foreground">{sample}</span>
    </div>
  );
}

function metricSample(m: OwnMetric): string {
  if (!m.wired) return "not requested";
  if (m.sampleSize === 0) return m.failedSampleSize > 0 ? `0 of ${m.failedSampleSize} failed` : "no posts measured";
  return `n=${m.sampleSize}${m.failedSampleSize > 0 ? `, ${m.failedSampleSize} failed` : ""}`;
}

export function OwnStatTiles({ overview }: { overview: OwnChannelOverview }) {
  return (
    <div className="grid grid-cols-2 gap-x-14 gap-y-10 sm:grid-cols-3">
      <Tile value={formatInt(overview.account?.followerCount ?? null)} label="Followers" sample={overview.account ? "latest snapshot" : "never measured"} />
      <Tile value={formatInt(overview.metrics.reach.value)} label={`Reach, last ${overview.windowDays}d`} sample={metricSample(overview.metrics.reach)} />
      <Tile value={formatInt(overview.metrics.saved.value)} label={`Saves, last ${overview.windowDays}d`} sample={metricSample(overview.metrics.saved)} />
      <Tile value={formatInt(overview.metrics.shares.value)} label={`Shares, last ${overview.windowDays}d`} sample={metricSample(overview.metrics.shares)} />
      <Tile
        value={overview.medianReach === null ? "—" : formatInt(overview.medianReach)}
        label="Median reach"
        sample={overview.medianReach === null ? `n=${overview.medianSampleSize}, needs more measured posts` : `n=${overview.medianSampleSize}`}
        tone="score"
      />
      <Tile
        value={String(overview.postsMeasured)}
        label={`Posts measured, last ${overview.windowDays}d`}
        sample={`of ${overview.postsInWindow} posted in window`}
      />
    </div>
  );
}
