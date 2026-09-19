"use client";

import { useState } from "react";
import Link from "next/link";

import { platformLabel } from "@/components/feed/platform-chip";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMultiplier } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RankingRow } from "./dashboard-chart-data";

const COLLAPSED_LIMIT = 8;

/**
 * "Score ranking list" (v1-scope.md P1 list): every scored post, highest first, with a
 * "show all" toggle collapsing to the top 8 by default. The binary emphasised/muted read
 * is still the same "beat its channel" (score >= 1) convention `median-baseline.tsx` and
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
      <Card>
        <CardHeader>
          <CardTitle>Ranking</CardTitle>
        </CardHeader>
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Nothing has a score yet — a channel needs enough posts before one means anything.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Ranking · <span data-num>{rows.length}</span> scored
          {unranked > 0 ? <span> · {unranked} not scored yet</span> : null}
        </CardTitle>
        {rows.length > COLLAPSED_LIMIT && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show top 8" : `Show all ${rows.length}`}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[72px] text-right">Score</TableHead>
              <TableHead className="w-[96px]">
                <span className="sr-only">Score relative to the top post</span>
              </TableHead>
              <TableHead>Post</TableHead>
              <TableHead className="text-right">Channel</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => {
              const beat = row.score >= 1;
              const widthPct = Math.max(1.5, (row.score / maxScore) * 100);
              return (
                // `relative` on the row plus the caption link's `after:inset-0` keeps the
                // whole row clickable with a single anchor, the way the grid row was.
                <TableRow key={row.videoId} className="relative">
                  <TableCell data-num className={cn("text-right font-mono text-sm", beat ? "text-primary" : "text-muted-foreground")}>
                    {formatMultiplier(row.score)}
                  </TableCell>
                  <TableCell>
                    <span className="relative block h-1.5" aria-hidden>
                      <span
                        className={cn("absolute top-0 left-0 h-1.5", beat ? "bg-primary" : "bg-border")}
                        style={{ width: `${widthPct}%` }}
                      />
                    </span>
                  </TableCell>
                  <TableCell className="max-w-0">
                    <Link
                      href={`/feed/${row.videoId}`}
                      className={cn("block truncate after:absolute after:inset-0", beat ? "text-foreground" : "text-muted-foreground")}
                    >
                      {row.caption ?? "—"}
                      {row.deleted && (
                        <span className="ml-2 text-2xs text-destructive">no longer on {platformLabel(row.platform)}</span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate text-right font-mono text-xs text-muted-foreground">
                    {row.handle}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
