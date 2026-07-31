"use client";

import { useState } from "react";
import Link from "next/link";

import { platformLabel } from "@/components/feed/platform-chip";
import { scalePosition } from "@/components/video/median-baseline";
import { formatMultiplier } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/server/queries/feed";
import { rankableItems } from "./dashboard-chart-data";

const COLLAPSED_LIMIT = 8;

/**
 * "Score ranking list" (v1-scope.md P1 list): every scored post, highest first, with a
 * "show all" toggle collapsing to the top 8 by default. Bar width and the binary
 * amber/muted read both come from the same "beat its channel" (score >= 1) convention
 * `median-baseline.tsx` and the feed card use, on the same 0.2x-12x `scalePosition`
 * scale — this list isn't a second definition of what a score means, it's the same one
 * read differently.
 */
export function ScoreRankingList({ items }: { items: FeedItem[] }) {
  const [showAll, setShowAll] = useState(false);
  const { ranked, unranked } = rankableItems(items);
  const rows = showAll ? ranked : ranked.slice(0, COLLAPSED_LIMIT);

  if (ranked.length === 0) {
    return (
      <div>
        <span data-lab className="font-mono text-2xs text-faint">
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
        <span data-lab className="font-mono text-2xs text-faint">
          Ranking · <span data-num>{ranked.length}</span> scored
          {unranked > 0 ? <span> · {unranked} not scored yet</span> : null}
        </span>
        {ranked.length > COLLAPSED_LIMIT && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="shrink-0 font-mono text-2xs text-muted-foreground hover:text-foreground"
          >
            {showAll ? "Show top 8" : `Show all ${ranked.length}`}
          </button>
        )}
      </div>
      <div className="mt-6 flex flex-col gap-1.5">
        {rows.map((item) => {
          const beat = item.outlierScore >= 1;
          return (
            <Link
              key={item.videoId}
              href={`/feed/${item.videoId}`}
              className="grid min-h-[46px] grid-cols-[64px_96px_minmax(0,1fr)_auto] items-center gap-4 border-b border-border hover:bg-card"
            >
              <span data-num className={cn("text-right font-mono text-sm", beat ? "text-score" : "text-muted-foreground")}>
                {formatMultiplier(item.outlierScore)}
              </span>
              <span className="relative h-1.5" aria-hidden>
                <span
                  className={cn("absolute top-0 left-0 h-1.5", beat ? "bg-score" : "bg-line-strong")}
                  style={{ width: `${Math.max(1.5, scalePosition(item.outlierScore) * 100)}%` }}
                />
              </span>
              <span className={cn("truncate text-sm", beat ? "text-foreground" : "text-muted-foreground")}>
                {item.caption ?? "—"}
                {item.deleted && (
                  <span className="ml-2 text-2xs text-destructive">no longer on {platformLabel(item.channel.platform)}</span>
                )}
              </span>
              <span className="shrink-0 truncate text-right font-mono text-xs text-faint">{item.channel.handle}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
