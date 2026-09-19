"use client";

import { useState } from "react";
import Link from "next/link";

import { platformLabel } from "@/components/feed/platform-chip";
import { formatMultiplier } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RankingRow } from "./dashboard-chart-data";

const COLLAPSED_LIMIT = 8;

/**
 * "Score ranking list" (v1-scope.md P1 list): every scored post, highest first, with a
 * "show all" toggle collapsing to the top 8 by default. The binary amber/muted read is
 * still the same "beat its channel" (score >= 1) convention `median-baseline.tsx` and
 * the feed card use. Bar width is not: the shared 0.2x-12x `scalePosition` clamps, so
 * 13x and 116x both drew a full bar. Here the bars scale to the highest score in the
 * set instead, which is the only comparison this list is making.
 *
 * Props are the slim `RankingRow` projection, not FeedItems — this is a client
 * component, so the full array would serialize the whole library into the RSC payload.
 */
export function ScoreRankingList({ rows, unranked }: { rows: RankingRow[]; unranked: number }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, COLLAPSED_LIMIT);
  // Rows arrive highest-first, so the first is the set max. A single min floor keeps a
  // real score visible when it is a rounding error next to the top one.
  const maxScore = rows[0]?.score ?? 1;

  if (rows.length === 0) {
    return (
      <div>
        <span data-lab className="font-mono text-2xs text-muted-foreground">
          Ranking
        </span>
        <p className="mt-6 max-w-[52ch] text-sm text-muted-foreground">
          Nothing has a score yet — a channel needs enough posts before one means anything.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-6">
        <span data-lab className="font-mono text-2xs text-muted-foreground">
          Ranking · <span data-num>{rows.length}</span> scored
          {unranked > 0 ? <span> · {unranked} not scored yet</span> : null}
        </span>
        {rows.length > COLLAPSED_LIMIT && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="shrink-0 font-mono text-2xs text-muted-foreground hover:text-foreground"
          >
            {showAll ? "Show top 8" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
      <div className="mt-6 flex flex-col gap-1.5">
        {visible.map((row) => {
          const beat = row.score >= 1;
          const widthPct = Math.max(1.5, (row.score / maxScore) * 100);
          return (
            <Link
              key={row.videoId}
              href={`/feed/${row.videoId}`}
              className="grid min-h-[46px] grid-cols-[64px_96px_minmax(0,1fr)_auto] items-center gap-4 border-b border-border hover:bg-card"
            >
              <span data-num className={cn("text-right font-mono text-sm", beat ? "text-primary" : "text-muted-foreground")}>
                {formatMultiplier(row.score)}
              </span>
              <span className="relative h-1.5" aria-hidden>
                <span
                  className={cn("absolute top-0 left-0 h-1.5", beat ? "bg-primary" : "bg-border")}
                  style={{ width: `${widthPct}%` }}
                />
              </span>
              <span className={cn("truncate text-sm", beat ? "text-foreground" : "text-muted-foreground")}>
                {row.caption ?? "—"}
                {row.deleted && (
                  <span className="ml-2 text-2xs text-destructive">no longer on {platformLabel(row.platform)}</span>
                )}
              </span>
              <span className="shrink-0 truncate text-right font-mono text-xs text-muted-foreground">{row.handle}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
